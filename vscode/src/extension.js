const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const STATE_FILE = 'quiz-state.json';
const CUSTOM_BANK_FILE = 'custom-questions.json';

/**
 * @param {vscode.ExtensionContext} context
 */
function migrateFromLegacyStorage(context) {
  ensureStorage(context);
  const destDir = context.globalStorageUri.fsPath;
  const destState = path.join(destDir, STATE_FILE);
  if (fs.existsSync(destState)) return;
  const oldDir = path.join(path.dirname(destDir), 'huaxin.shiroha-quiz-cursor');
  if (!fs.existsSync(oldDir)) return;
  for (const f of [STATE_FILE, CUSTOM_BANK_FILE]) {
    const from = path.join(oldDir, f);
    const to = path.join(destDir, f);
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      try {
        fs.copyFileSync(from, to);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

function activate(context) {
  migrateFromLegacyStorage(context);
  const launcher = new LauncherProvider();
  const treeView = vscode.window.createTreeView('shirohaQuiz.launcher', {
    treeDataProvider: launcher,
    showCollapseAll: false
  });
  context.subscriptions.push(treeView);
  // 点左侧「面试背题」图标就直接打开中间面板
  context.subscriptions.push(
    treeView.onDidChangeVisibility((e) => {
      if (e.visible) QuizPanel.show(context);
    })
  );

  const open = () => QuizPanel.show(context);
  context.subscriptions.push(vscode.commands.registerCommand('shirohaQuiz.open', open));
  context.subscriptions.push(vscode.commands.registerCommand('shirohaQuiz.launcher.open', open));
  context.subscriptions.push(
    vscode.commands.registerCommand('shirohaQuiz.importBank', () => importBankInteractive(context, 'replace'))
  );
  context.subscriptions.push(
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('shirohaQuiz.resetProgress', () => resetProgress(context))
  );

  // 右下角状态栏常驻入口（优先级拉高，避免被挤进 ...）
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000);
  status.name = '面试背题';
  status.text = '$(book) 面试背题';
  status.tooltip = '打开面试背题面板（快捷键 Ctrl+Alt+B 或 F9）';
  status.command = 'shirohaQuiz.open';
  status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  status.show();
  context.subscriptions.push(status);

  // 首次/升级后提示一次入口位置
  const tipKey = 'shirohaQuiz.entryTip.v3';
  if (!context.globalState.get(tipKey)) {
    context.globalState.update(tipKey, true);
    vscode.window
      .showInformationMessage(
        '面试背题：右下角点「面试背题」，或按 Ctrl+Alt+B / F9',
        '立刻打开'
      )
      .then((pick) => {
        if (pick === '立刻打开') open();
      });
  }
}

function deactivate() {}

class LauncherProvider {
  getTreeItem() {
    const item = new vscode.TreeItem('打开背题面板（编辑器中间）', vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('book');
    item.command = { command: 'shirohaQuiz.open', title: '打开背题面板' };
    item.tooltip = '在编辑器中间打开面试背题';
    return item;
  }

  getChildren() {
    return [this.getTreeItem()];
  }
}

function statePath(context) {
  return path.join(context.globalStorageUri.fsPath, STATE_FILE);
}

function customBankPath(context) {
  return path.join(context.globalStorageUri.fsPath, CUSTOM_BANK_FILE);
}

function ensureStorage(context) {
  fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
}

function defaultState(questions) {
  return {
    schemaVersion: 1,
    questions,
    progress: {},
    wrong: {},
    deleted: [],
    session: { lastQuestionId: '' },
    updatedAt: new Date().toISOString()
  };
}

/** 多分类只用逗号/顿号/竖线拆；路径里的「 / 」保留（如 Java SE / I/O） */
function pushCategoryParts(out, value) {
  if (value == null || value === '') return;
  if (Array.isArray(value)) {
    value.forEach((v) => pushCategoryParts(out, v));
    return;
  }
  String(value)
    .split(/\s*[,，、|]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((s) => {
      if (!out.includes(s)) out.push(s);
    });
}

function categoryTopic(categories) {
  const first = String((categories && categories[0]) || '').trim();
  if (!first) return '';
  const parts = first.split(/\s+\/\s+/);
  return String(parts[0] || first).trim();
}

function parseCategories(q) {
  const out = [];
  if (Array.isArray(q.categories) && q.categories.length) {
    pushCategoryParts(out, q.categories);
    return out;
  }
  // 题库 category 多为完整路径「Parent / Child」，整段算一条，避免和扁平碎片不一致
  const cat = String(q.category || '').trim();
  if (cat) {
    pushCategoryParts(out, cat);
    return out;
  }
  pushCategoryParts(out, q.topic);
  pushCategoryParts(out, q.tag);
  pushCategoryParts(out, q.tags);
  return out;
}

function normalizeQuestions(raw) {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.questions)
      ? raw.questions
      : Array.isArray(raw?.data)
        ? raw.data
        : [];
  return list
    .map((q, i) => {
      const categories = parseCategories(q);
      return {
        id: String(q.id || q.qid || `q-${i + 1}`),
        type: String(q.type || 'short'),
        question: String(q.question || q.title || q.stem || '').trim(),
        answer: Array.isArray(q.answer)
          ? q.answer.join('\n')
          : String(q.answer || q.explanation || q.rightAnswer || ''),
        analysis: String(q.analysis || q.解析 || ''),
        categories,
        // 多分类用 | 连接，避免和路径分隔符「 / 」冲突
        category: categories.join(' | '),
        topic: categoryTopic(categories)
      };
    })
    .filter((q) => q.question);
}

function loadBundledQuestions(context) {
  const file = path.join(context.extensionPath, 'media', 'questions.json');
  return normalizeQuestions(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function readCustomMeta(context) {
  const customPath = customBankPath(context);
  if (!fs.existsSync(customPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(customPath, 'utf8'));
    return {
      title: raw?.meta?.title || '自定义题库',
      questionCount: Array.isArray(raw?.questions) ? raw.questions.length : 0,
      source: raw?.meta?.source || '',
      importedAt: raw?.meta?.importedAt || ''
    };
  } catch (_) {
    return null;
  }
}

/** 永久删除名单（tombstone）：防止内置题库再拷回来 */
function readRemovedIds(context) {
  try {
    const file = statePath(context);
    if (!fs.existsSync(file)) return new Set();
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Set([...(state.deleted || []), ...(state.removedIds || [])]);
  } catch (_) {
    return new Set();
  }
}

function loadActiveQuestions(context) {
  const removed = readRemovedIds(context);
  const customPath = customBankPath(context);
  let list = [];
  if (fs.existsSync(customPath)) {
    try {
      list = normalizeQuestions(JSON.parse(fs.readFileSync(customPath, 'utf8')));
    } catch (_) {
      list = loadBundledQuestions(context);
    }
  } else {
    list = loadBundledQuestions(context);
  }
  return list.filter((q) => !removed.has(q.id));
}

function writeCustomBank(context, questions, metaExtra = {}) {
  ensureStorage(context);
  const prev = readCustomMeta(context) || {};
  const removed = readRemovedIds(context);
  const filtered = questions.filter((q) => !removed.has(q.id));
  fs.writeFileSync(
    customBankPath(context),
    JSON.stringify(
      {
        meta: {
          title: metaExtra.title || prev.title || '自定义题库',
          questionCount: filtered.length,
          importedAt: prev.importedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: metaExtra.source || prev.source || 'panel-edit'
        },
        questions: filtered
      },
      null,
      2
    ),
    'utf8'
  );
}

/** 编辑前把内置题库复制成可写自定义题库（自动跳过已删除 id） */
function ensureEditableBank(context) {
  if (fs.existsSync(customBankPath(context))) return;
  const removed = readRemovedIds(context);
  const qs = loadBundledQuestions(context).filter((q) => !removed.has(q.id));
  writeCustomBank(context, qs, {
    title: '自定义编辑题库（来自内置）',
    source: 'edited-from-builtin'
  });
}

function loadState(context) {
  ensureStorage(context);
  const file = statePath(context);
  const bank = loadActiveQuestions(context);
  if (!fs.existsSync(file)) {
    const state = defaultState(bank);
    saveState(context, state);
    return state;
  }
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const deleted = new Set([...(state.deleted || []), ...(state.removedIds || [])]);
    state.allQuestions = bank;
    state.questions = bank.slice();
    state.progress = state.progress || {};
    state.wrong = state.wrong || {};
    state.deleted = [...deleted];
    state.session =
      state.session && typeof state.session === 'object'
        ? { lastQuestionId: String(state.session.lastQuestionId || '') }
        : { lastQuestionId: '' };
    return state;
  } catch (e) {
    const state = defaultState(bank);
    state.allQuestions = bank;
    saveState(context, state);
    return state;
  }
}

function saveState(context, state) {
  ensureStorage(context);
  state.updatedAt = new Date().toISOString();
  const toSave = {
    schemaVersion: state.schemaVersion || 1,
    progress: state.progress || {},
    wrong: state.wrong || {},
    deleted: state.deleted || [],
    session: {
      lastQuestionId: String(state.session?.lastQuestionId || '')
    },
    updatedAt: state.updatedAt
  };
  fs.writeFileSync(statePath(context), JSON.stringify(toSave), 'utf8');
}

function bankInfo(context) {
  const custom = readCustomMeta(context);
  if (custom) {
    return {
      source: 'custom',
      title: custom.title,
      label: `自定义 · ${custom.title}`
    };
  }
  return {
    source: 'builtin',
    title: '内置 Java 核心题库',
    label: '内置 Java 核心题库'
  };
}

/**
 * 艾宾浩斯遗忘曲线复习间隔（天）· 共 7 档
 * 答题质量 7 级与间隔一一对应：不会→1天 … 掌握→60天
 */
const EBBINGHAUS_DAYS = [1, 2, 4, 7, 15, 30, 60];

/** 质量分 → 档位 0–6（与 EBBINGHAUS_DAYS 下标对齐） */
function qualityToStage(understanding) {
  const u = clamp(Math.round(Number(understanding) || 0), 0, 100);
  if (u >= 95) return 6;
  if (u >= 85) return 5;
  if (u >= 70) return 4;
  if (u >= 55) return 3;
  if (u >= 40) return 2;
  if (u >= 25) return 1;
  return 0;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * @param {number} understanding 0-100（7 档按钮：15/30/45/60/75/90/100）
 * @param {{ stage?: number }} prev
 */
function scheduleByEbbinghaus(understanding, prev = {}) {
  const u = clamp(Math.round(Number(understanding) || 0), 0, 100);
  const stage = qualityToStage(u);
  const days = EBBINGHAUS_DAYS[stage];
  const ms = days * 86400000;
  return {
    understanding: u,
    stage,
    intervalDays: days,
    nextReviewAt: new Date(Date.now() + ms).toISOString(),
    lastAt: new Date().toISOString()
  };
}

function applyImportedBank(context, mode, filePath, parsed, questions) {
  ensureStorage(context);
  let nextQuestions = questions;

  if (mode === 'merge') {
    const current = loadActiveQuestions(context);
    const map = new Map(current.map((q) => [q.id, q]));
    for (const q of questions) map.set(q.id, q);
    nextQuestions = [...map.values()];
  }

  writeCustomBank(context, nextQuestions, {
    title: parsed?.meta?.title || path.basename(filePath),
    source: filePath
  });

  const state = loadState(context);
  if (mode === 'replace') {
    state.progress = {};
    state.wrong = {};
    state.deleted = [];
    state.session = { lastQuestionId: '' };
  } else {
    const ids = new Set(nextQuestions.map((q) => q.id));
    state.deleted = (state.deleted || []).filter((id) => ids.has(id));
  }
  saveState(context, state);
  return loadState(context);
}

async function importBankInteractive(context, preferredMode) {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: '导入题库',
    filters: { JSON: ['json'] }
  });
  if (!uris || !uris[0]) return { ok: false, cancelled: true };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(uris[0].fsPath, 'utf8'));
  } catch (e) {
    vscode.window.showErrorMessage(`题库 JSON 解析失败：${e.message}`);
    return { ok: false, error: e.message };
  }

  const questions = normalizeQuestions(parsed);
  if (!questions.length) {
    vscode.window.showErrorMessage(
      '未识别到题目。请使用 { "questions": [ { "question": "...", "answer": "..." } ] }'
    );
    return { ok: false, error: 'empty' };
  }

  let mode = preferredMode;
  if (!mode) {
    const picked = await vscode.window.showQuickPick(
      [
        { label: '替换当前题库', description: '用新题库覆盖（学习进度会清空）', mode: 'replace' },
        { label: '合并到当前题库', description: '同 id 覆盖，新题追加', mode: 'merge' }
      ],
      { placeHolder: `识别到 ${questions.length} 题，选择导入方式` }
    );
    if (!picked) return { ok: false, cancelled: true };
    mode = picked.mode;
  }

  const state = applyImportedBank(context, mode, uris[0].fsPath, parsed, questions);
  QuizPanel.current?.refresh();
  vscode.window.showInformationMessage(
    `已导入 ${questions.length} 题（当前共 ${state.questions.length} 题）`
  );
  return { ok: true, imported: questions.length, total: state.questions.length };
}

async function restoreBuiltinBank(context) {
  const ok = await vscode.window.showWarningMessage(
    '恢复内置 Java 题库？自定义题库会被移除，学习进度会清空。',
    { modal: true },
    '恢复内置'
  );
  if (ok !== '恢复内置') return false;
  const customPath = customBankPath(context);
  if (fs.existsSync(customPath)) fs.unlinkSync(customPath);
  const state = defaultState(loadBundledQuestions(context));
  saveState(context, state);
  QuizPanel.current?.refresh();
  vscode.window.showInformationMessage(`已恢复内置题库（${state.questions.length} 题）`);
  return true;
}

async function resetProgress(context) {
  const ok = await vscode.window.showWarningMessage(
        '确定重置学习进度？（题库会保留，理解程度与复习安排会清空）',
    { modal: true },
    '重置'
  );
  if (ok !== '重置') return false;
  const state = loadState(context);
  state.progress = {};
  state.wrong = {};
  state.session = { lastQuestionId: '' };
  state.deleted = state.deleted || [];
  saveState(context, state);
  QuizPanel.current?.refresh();
  vscode.window.showInformationMessage('学习进度已重置');
  return true;
}

function upsertQuestion(context, payload) {
  ensureEditableBank(context);
  const incoming = normalizeQuestions([payload])[0];
  if (!incoming) {
    vscode.window.showErrorMessage('题目内容不能为空');
    return false;
  }
  if (!payload.id) {
    incoming.id = `custom-${Date.now()}`;
  } else {
    incoming.id = String(payload.id);
  }

  const all = loadActiveQuestions(context);
  const idx = all.findIndex((q) => q.id === incoming.id);
  if (idx >= 0) all[idx] = { ...all[idx], ...incoming };
  else all.push(incoming);

  writeCustomBank(context, all);
  const state = loadState(context);
  state.deleted = (state.deleted || []).filter((id) => id !== incoming.id);
  saveState(context, state);
  return true;
}

/** 从全部题目中移除某个分类标签（不删题目） */
async function deleteCategory(context, category) {
  const name = String(category || '').trim();
  if (!name) return false;
  if (name === '未分类') {
    vscode.window.showWarningMessage('「未分类」是系统占位，不能删除');
    return false;
  }
  ensureEditableBank(context);
  const all = loadActiveQuestions(context);
  const affected = all.filter((q) => parseCategories(q).includes(name));
  if (!affected.length) {
    vscode.window.showInformationMessage(`没有题目带有分类「${name}」`);
    return false;
  }
  const choice = await vscode.window.showWarningMessage(
    `确定删除分类「${name}」？\n将从 ${affected.length} 道题中移除该分类，题目本身保留。`,
    { modal: true },
    '删除分类'
  );
  if (choice !== '删除分类') return false;

  const next = all.map((q) => {
    const cats = parseCategories(q).filter((c) => c !== name);
    return {
      ...q,
      categories: cats,
      category: cats.join(' | '),
      topic: cats[0] || ''
    };
  });
  writeCustomBank(context, next);
  vscode.window.showInformationMessage(
    `已删除分类「${name}」，影响 ${affected.length} 道题`
  );
  return true;
}

function removeQuestionHard(context, id) {
  if (!id) return false;
  // 先写入删除名单，再写题库，避免拷贝内置题时又带回来
  ensureStorage(context);
  let state;
  try {
    state = fs.existsSync(statePath(context))
      ? JSON.parse(fs.readFileSync(statePath(context), 'utf8'))
      : defaultState([]);
  } catch (_) {
    state = defaultState([]);
  }
  state.deleted = Array.from(new Set([...(state.deleted || []), id]));
  state.progress = state.progress || {};
  state.wrong = state.wrong || {};
  delete state.progress[id];
  delete state.wrong[id];
  saveState(context, state);

  ensureEditableBank(context);
  // 直接读文件再删，避免 loadActiveQuestions 已过滤导致漏写
  const customPath = customBankPath(context);
  let all = [];
  try {
    all = normalizeQuestions(JSON.parse(fs.readFileSync(customPath, 'utf8')));
  } catch (_) {
    all = loadBundledQuestions(context);
  }
  writeCustomBank(
    context,
    all.filter((q) => q.id !== id),
    { source: 'panel-delete' }
  );
  return true;
}

function restoreQuestion(context, id) {
  if (!id) return false;
  // 恢复 = 从删除名单移除；若自定义题库没有该题，从内置补回
  const state = loadState(context);
  state.deleted = (state.deleted || []).filter((x) => x !== id);
  saveState(context, state);

  ensureEditableBank(context);
  const customPath = customBankPath(context);
  let all = [];
  try {
    all = normalizeQuestions(JSON.parse(fs.readFileSync(customPath, 'utf8')));
  } catch (_) {
    all = [];
  }
  if (!all.some((q) => q.id === id)) {
    const bundled = loadBundledQuestions(context).find((q) => q.id === id);
    if (bundled) all.push(bundled);
  }
  writeCustomBank(context, all, { source: 'panel-restore' });
  return true;
}

function getWebviewHtml(webview, extensionUri) {
  const bust = String(Date.now());
  const scriptUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.js'))
    .with({ query: `t=${bust}` });
  const styleUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.css'))
    .with({ query: `t=${bust}` });
  const nonce = `n${bust}`;
  // script-src 必须带 cspSource，否则外部 webview.js 会被拦截，一直停在「加载中」
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `script-src ${webview.cspSource} 'nonce-${nonce}'`
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <style>
    .hidden{display:none!important}
    body{margin:0;background:var(--vscode-editor-background,#1e1e1e);color:var(--vscode-editor-foreground,#ddd);font:13px/1.55 var(--vscode-font-family,sans-serif)}
    #boot-error{padding:16px;color:#f87171}
  </style>
  <title>beibagu · 面试背题</title>
</head>
<body>
  <div id="app">
    <header class="top">
      <div class="title-block">
        <b>面试背题</b>
        <span id="meta" class="muted">加载中…</span>
        <span id="bank" class="bank-tag">题库</span>
      </div>
      <div class="actions tabs">
        <button id="tab-practice" class="tab active">刷题</button>
        <button id="tab-bank" class="tab">题库列表</button>
        <button id="tab-mastery" class="tab">分类理解度</button>
        <button id="tab-history" class="tab">答题历史</button>
      </div>
    </header>
    <div class="toolbar" id="toolbar-practice">
      <button id="btn-topic" class="ghost">分类筛选</button>
      <div class="mode-switch" role="tablist" aria-label="刷题模式">
        <button id="btn-mode-practice" class="mode-btn active" role="tab" aria-selected="true" type="button" title="按分类刷题">练习<span id="mode-practice-badge" class="mode-badge mode-badge-soft hidden"></span></button>
        <button id="btn-mode-weak" class="mode-btn" role="tab" aria-selected="false" type="button" title="理解度未到 100% 的题，专项强化">错题强化<span id="mode-weak-badge" class="mode-badge mode-badge-weak hidden"></span></button>
        <button id="btn-mode-review" class="mode-btn" role="tab" aria-selected="false" type="button" title="艾宾浩斯间隔复习：仅到期题">复习<span id="mode-review-badge" class="mode-badge hidden"></span></button>
      </div>
      <button id="btn-import-merge" class="ghost">导入题目</button>
      <button id="btn-reset" class="ghost">重置进度</button>
      <button id="btn-reload-ui" class="ghost">刷新界面</button>
    </div>
    <div class="toolbar hidden" id="toolbar-bank" style="display:none">
      <input id="bank-search" class="search" type="search" placeholder="搜索题目 / 主题 / id…" />
      <button id="btn-add" class="primary">新增题目</button>
      <button id="btn-export" class="ghost">导出 JSON</button>
      <button id="btn-import-replace-2" class="ghost">导入题库</button>
    </div>
    <div class="toolbar hidden" id="toolbar-mastery" style="display:none">
      <span class="muted">分类理解程度 = 该分类下每题理解程度均值（未答按 0%）</span>
      <button id="btn-mastery-weak" class="ghost">去刷理解度最低分类</button>
    </div>
    <div class="toolbar hidden" id="toolbar-history" style="display:none">
      <button id="btn-history-all" class="ghost">全部题目</button>
      <button id="btn-history-current" class="ghost">仅本题</button>
      <span id="history-filter-label" class="muted"></span>
    </div>
    <main id="main" class="main"><div class="muted" style="padding:16px">正在加载题目…</div></main>
    <footer class="foot" id="foot-practice">
      <div class="foot-group">
        <button id="btn-prev" class="ghost" title="上一题">上一题</button>
        <button id="btn-next" class="ghost" title="下一题">下一题</button>
      </div>
      <div class="foot-group foot-understand" title="7 档质量对应艾宾浩斯 7 档间隔">
        <span class="foot-label muted">答题质量</span>
        <button id="btn-q1" class="ghost quality-btn" data-u="15" type="button" title="档1 · 约 1 天后">不会</button>
        <button id="btn-q2" class="ghost quality-btn" data-u="30" type="button" title="档2 · 约 2 天后">生疏</button>
        <button id="btn-q3" class="ghost quality-btn" data-u="45" type="button" title="档3 · 约 4 天后">半懂</button>
        <button id="btn-q4" class="ghost quality-btn" data-u="60" type="button" title="档4 · 约 7 天后">勉强</button>
        <button id="btn-q5" class="ghost quality-btn" data-u="75" type="button" title="档5 · 约 15 天后">会了</button>
        <button id="btn-q6" class="ghost quality-btn" data-u="90" type="button" title="档6 · 约 30 天后">较熟</button>
        <button id="btn-q7" class="ghost quality-btn" data-u="100" type="button" title="档7 · 约 60 天后">掌握</button>
      </div>
      <div class="foot-group more-wrap">
        <button id="btn-more" class="ghost" type="button" aria-expanded="false">更多 ▾</button>
        <div id="more-menu" class="more-menu hidden" style="display:none">
          <button id="btn-edit-answer-foot" class="more-item" type="button">改参考答案</button>
          <button id="btn-delete" class="more-item danger-text" type="button">删除本题</button>
        </div>
      </div>
    </footer>
  </div>
  <div id="boot-error" class="hidden"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
  <script nonce="${nonce}">
    setTimeout(function () {
      var m = document.getElementById('meta');
      if (m && /加载中/.test(m.textContent || '')) {
        var e = document.getElementById('boot-error');
        if (e) {
          e.classList.remove('hidden');
          e.textContent = '界面脚本未加载成功。请点「刷新界面」，或命令面板执行 Reload Window。';
        }
      }
    }, 2500);
  </script>
</body>
</html>`;
}

class QuizPanel {
  static current;

  static show(context) {
    if (QuizPanel.current) {
      // 再次打开时热刷新面板资源，无需 Reload Window
      QuizPanel.current.reloadShell();
      QuizPanel.current.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'shirohaQuizPanel',
      '面试背题',
      { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
      }
    );
    QuizPanel.current = new QuizPanel(context, panel);
  }

  constructor(context, panel) {
    this.context = context;
    this.panel = panel;
    panel.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'resources', 'icon.svg'));
    panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);
    this._disposeWire = wireWebview(context, panel.webview);
    this._watchMedia();
    panel.onDidDispose(() => {
      this._disposeWire?.dispose?.();
      this._mediaWatcher?.close?.();
      clearTimeout(this._mediaTimer);
      QuizPanel.current = undefined;
    });
  }

  /** 监视 media 下 js/css 变化，自动重载面板 */
  _watchMedia() {
    const mediaDir = path.join(this.context.extensionPath, 'media');
    try {
      this._mediaWatcher = fs.watch(mediaDir, { persistent: false }, (_event, filename) => {
        const name = String(filename || '');
        if (name && !/\.(js|css)$/i.test(name)) return;
        clearTimeout(this._mediaTimer);
        this._mediaTimer = setTimeout(() => {
          if (QuizPanel.current === this && !this._reloading) this.reloadShell();
        }, 400);
      });
    } catch (_) {
      // ignore
    }
  }

  reloadShell() {
    if (this._reloading) return;
    this._reloading = true;
    try {
      this.panel.webview.html = getWebviewHtml(this.panel.webview, this.context.extensionUri);
    } finally {
      setTimeout(() => {
        this._reloading = false;
      }, 500);
    }
  }

  refresh() {
    pushPayload(this.context, this.panel.webview);
  }

  postMessage(msg) {
    this.panel.webview.postMessage(msg);
  }
}

function pushPayload(context, webview) {
  try {
    const state = loadState(context);
    const info = bankInfo(context);
    webview.postMessage({
      type: 'state',
      payload: {
        questions: state.allQuestions || loadActiveQuestions(context),
        visibleIds: (state.questions || []).map((q) => q.id),
        deleted: state.deleted || [],
        progress: state.progress,
        wrong: state.wrong,
        session: state.session || { lastQuestionId: '' },
        updatedAt: state.updatedAt,
        storagePath: statePath(context),
        bank: info
      }
    });
  } catch (e) {
    webview.postMessage({
      type: 'state',
      payload: {
        questions: [],
        deleted: [],
        progress: {},
        wrong: {},
        session: { lastQuestionId: '' },
        bank: { label: `加载失败：${e.message}`, source: 'builtin' }
      }
    });
    vscode.window.showErrorMessage(`背题面板加载失败：${e.message}`);
  }
}

/** 查找本机 Google Chrome */
function findChromePath() {
  const cfg = vscode.workspace.getConfiguration('shirohaQuiz');
  const custom = String(cfg.get('chromePath') || '').trim();
  if (custom && fs.existsSync(custom)) return custom;

  const localApp = process.env.LOCALAPPDATA || '';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    path.join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser'
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || '';
}

/** 优先用 Chrome 打开 URL；找不到再走系统默认浏览器 */
function openUrlInChrome(url) {
  return new Promise((resolve) => {
    const preferChrome = vscode.workspace.getConfiguration('shirohaQuiz').get('openLinksInChrome', true);
    const chrome = preferChrome ? findChromePath() : '';
    if (!chrome) {
      vscode.env.openExternal(vscode.Uri.parse(url)).then(
        () => resolve({ ok: true, via: 'default' }),
        () => resolve({ ok: false, via: 'default' })
      );
      return;
    }
    try {
      const child = spawn(chrome, [url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
      resolve({ ok: true, via: 'chrome', chrome });
    } catch (e) {
      vscode.env.openExternal(vscode.Uri.parse(url)).then(
        () => resolve({ ok: true, via: 'default' }),
        () => resolve({ ok: false, via: 'default', error: e.message })
      );
    }
  });
}

const DEEPSEEK_CDP_PORT = 9333;
let lastDeepSeekPrompt = '';
/** 防止连点/并发填入互相踩掉页面上下文 */
let deepSeekFillLock = Promise.resolve();
let deepSeekFillSeq = 0;

function httpGetJson(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        raw += c;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function deepSeekChromeProfileDir() {
  return path.join(os.tmpdir(), 'shiroha-quiz-deepseek-chrome');
}

async function isDeepSeekCdpAlive() {
  try {
    const ver = await httpGetJson(`http://127.0.0.1:${DEEPSEEK_CDP_PORT}/json/version`, 800);
    return !!(ver && (ver.webSocketDebuggerUrl || ver.Browser));
  } catch (_) {
    return false;
  }
}

/** 启动带远程调试的独立 Chrome（专用配置，登录一次即可复用） */
async function ensureDeepSeekChrome(url) {
  const chrome = findChromePath();
  if (!chrome) return { ok: false, reason: 'no-chrome' };
  if (await isDeepSeekCdpAlive()) {
    // 已有调试实例：再开一个 DeepSeek 标签
    try {
      await httpGetJson(
        `http://127.0.0.1:${DEEPSEEK_CDP_PORT}/json/new?${encodeURIComponent(url)}`,
        2000
      );
    } catch (_) {
      /* 部分 Chrome 用 PUT；失败就靠已有标签 */
      try {
        const list = await httpGetJson(`http://127.0.0.1:${DEEPSEEK_CDP_PORT}/json/list`, 1500);
        const page = Array.isArray(list)
          ? list.find((t) => t && t.type === 'page' && /deepseek\.com/i.test(String(t.url || '')))
          : null;
        if (page && page.id) {
          await httpGetJson(
            `http://127.0.0.1:${DEEPSEEK_CDP_PORT}/json/activate/${page.id}`,
            1500
          );
        }
      } catch (_) {
        /* ignore */
      }
    }
    return { ok: true, via: 'chrome-cdp-reuse', chrome };
  }
  try {
    fs.mkdirSync(deepSeekChromeProfileDir(), { recursive: true });
    const child = spawn(
      chrome,
      [
        `--remote-debugging-port=${DEEPSEEK_CDP_PORT}`,
        `--user-data-dir=${deepSeekChromeProfileDir()}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-popup-blocking',
        '--new-window',
        url
      ],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.unref();
    return { ok: true, via: 'chrome-cdp', chrome };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function cdpSend(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20000);
    const onMessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data || ''));
        if (msg.id !== id) return;
        clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } catch (e) {
        clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        reject(e);
      }
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function listDeepSeekCdpPages() {
  const list = await httpGetJson(`http://127.0.0.1:${DEEPSEEK_CDP_PORT}/json/list`, 2000);
  return Array.isArray(list) ? list.filter((t) => t && t.type === 'page' && t.webSocketDebuggerUrl) : [];
}

async function waitForDeepSeekPageTarget(timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const pages = await listDeepSeekCdpPages();
      const page =
        pages.find((t) => /deepseek\.com/i.test(String(t.url || '')) && !/sign_in/i.test(String(t.url || ''))) ||
        pages.find((t) => /deepseek\.com/i.test(String(t.url || ''))) ||
        pages[0];
      if (page) return page;
    } catch (_) {
      /* chrome 还没起来 */
    }
    await sleep(400);
  }
  throw new Error('等待 DeepSeek 页面超时');
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const t = setTimeout(() => reject(new Error('CDP 连接超时')), 10000);
    ws.addEventListener('open', () => {
      clearTimeout(t);
      resolve(ws);
    });
    ws.addEventListener('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

const DEEPSEEK_PICK_INPUT_JS = `(() => {
  const sels = [
    'textarea#chat-input',
    'textarea[placeholder*="消息"]',
    'textarea[placeholder*="Send"]',
    'textarea[placeholder*="输入"]',
    'textarea',
    '[contenteditable="true"]',
    'div[role="textbox"]'
  ];
  for (const s of sels) {
    const el = document.querySelector(s);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 16) continue;
    return el;
  }
  return null;
})()`;

function isContextDestroyedError(err) {
  const msg = String((err && err.message) || err || '');
  return /Execution context was destroyed|Cannot find context|Inspected target navigated|session closed|WebSocket is not open/i.test(
    msg
  );
}

/**
 * 通过 CDP 把提示词写入 DeepSeek 输入框。
 * 若落在登录页，会提示并等待登录完成后再填入。
 * 页面跳转导致 context destroyed 时会自动重连重试。
 */
async function fillDeepSeekInputViaCdpOnce(prompt, opts = {}) {
  const text = String(prompt || '');
  const loginWaitMs = Number(opts.loginWaitMs || 180000);
  let page = await waitForDeepSeekPageTarget(25000);
  let ws = await connectCdp(page.webSocketDebuggerUrl);
  let nextId = 1;
  const send = (method, params) => cdpSend(ws, nextId++, method, params);

  const hardReconnect = async () => {
    const pages = await listDeepSeekCdpPages();
    const better =
      pages.find((t) => /deepseek\.com/i.test(String(t.url || '')) && !/sign_in/i.test(String(t.url || ''))) ||
      pages.find((t) => /deepseek\.com/i.test(String(t.url || ''))) ||
      pages[0];
    if (!better || !better.webSocketDebuggerUrl) throw new Error('DeepSeek 标签丢失');
    try {
      ws.close();
    } catch (_) {
      /* ignore */
    }
    page = better;
    ws = await connectCdp(page.webSocketDebuggerUrl);
    nextId = 1;
    await send('Runtime.enable');
    await send('Page.enable');
  };

  const refreshTargetIfNeeded = async () => {
    const pages = await listDeepSeekCdpPages();
    const better =
      pages.find((t) => /deepseek\.com/i.test(String(t.url || '')) && !/sign_in/i.test(String(t.url || ''))) ||
      pages.find((t) => /deepseek\.com/i.test(String(t.url || '')));
    if (better && better.webSocketDebuggerUrl && better.webSocketDebuggerUrl !== page.webSocketDebuggerUrl) {
      await hardReconnect();
    }
  };

  const sendRobust = async (method, params) => {
    try {
      return await send(method, params);
    } catch (e) {
      if (!isContextDestroyedError(e)) throw e;
      await sleep(600);
      await hardReconnect();
      return send(method, params);
    }
  };

  try {
    await send('Runtime.enable');
    await send('Page.enable');

    if (/sign_in|login/i.test(String(page.url || ''))) {
      vscode.window.showInformationMessage(
        'DeepSeek 需要先登录（专用窗口只需一次）。请在弹出的 Chrome 里登录，登录后会自动填入提示词。'
      );
      const t0 = Date.now();
      while (Date.now() - t0 < loginWaitMs) {
        await sleep(1500);
        try {
          await refreshTargetIfNeeded();
        } catch (_) {
          /* ignore */
        }
        if (!/sign_in|login/i.test(String(page.url || ''))) break;
        try {
          const probe = await sendRobust('Runtime.evaluate', {
            expression: DEEPSEEK_PICK_INPUT_JS,
            returnByValue: false
          });
          if (probe && probe.result && probe.result.objectId) break;
        } catch (_) {
          /* ignore */
        }
      }
    }

    const ready = await sendRobust('Runtime.evaluate', {
      expression: `(() => new Promise((resolve) => {
        const pick = () => {
          const sels = [
            'textarea#chat-input',
            'textarea[placeholder*="消息"]',
            'textarea[placeholder*="Send"]',
            'textarea[placeholder*="输入"]',
            'textarea',
            '[contenteditable="true"]',
            'div[role="textbox"]'
          ];
          for (const s of sels) {
            const el = document.querySelector(s);
            if (!el) continue;
            const r = el.getBoundingClientRect();
            if (r.width >= 40 && r.height >= 16) return el;
          }
          return null;
        };
        const t0 = Date.now();
        const tick = () => {
          if (pick()) return resolve({ ok: true, href: location.href });
          if (Date.now() - t0 > ${Math.max(20000, Math.min(loginWaitMs, 120000))}) {
            return resolve({ ok: false, href: location.href });
          }
          setTimeout(tick, 400);
        };
        tick();
      }))()`,
      awaitPromise: true,
      returnByValue: true
    });
    const readyVal = ready && ready.result && ready.result.value;
    if (!readyVal || !readyVal.ok) {
      const href = (readyVal && readyVal.href) || page.url || '';
      if (/sign_in|login/i.test(href)) {
        throw new Error('仍在登录页：请先在 DeepSeek 窗口完成登录，再点「重试自动填入」');
      }
      throw new Error(`未找到 DeepSeek 输入框（${href}）`);
    }

    // 页面刚进聊天时可能立刻再跳一次，稍等再写
    await sleep(500);
    try {
      await refreshTargetIfNeeded();
    } catch (_) {
      /* ignore */
    }

    const filled = await sendRobust('Runtime.evaluate', {
      expression: `(() => {
        const text = ${JSON.stringify(text)};
        const sels = [
          'textarea#chat-input',
          'textarea[placeholder*="消息"]',
          'textarea[placeholder*="Send"]',
          'textarea[placeholder*="输入"]',
          'textarea',
          '[contenteditable="true"]',
          'div[role="textbox"]'
        ];
        let el = null;
        for (const s of sels) {
          const node = document.querySelector(s);
          if (!node) continue;
          const r = node.getBoundingClientRect();
          if (r.width >= 40 && r.height >= 16) { el = node; break; }
        }
        if (!el) return { ok: false, reason: 'no-el' };
        el.focus();
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && desc.set) desc.set.call(el, text);
          else el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          try {
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, text);
          } catch (_) {
            el.textContent = text;
          }
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
        }
        const now = (el.value != null ? String(el.value) : String(el.innerText || el.textContent || ''));
        if (!(now.length > 0)) return { ok: false, reason: 'empty' };

        const clickSend = () => {
          const btnSels = [
            'button[aria-label*="发送"]',
            'button[aria-label*="Send"]',
            'button[data-testid*="send"]',
            'div[role="button"][aria-label*="发送"]',
            'div[role="button"][aria-label*="Send"]'
          ];
          for (const s of btnSels) {
            const b = document.querySelector(s);
            if (b && !b.disabled) {
              b.click();
              return 'btn:' + s;
            }
          }
          const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
          const hit = buttons.reverse().find((b) => {
            if (b.disabled) return false;
            const t = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).trim();
            const r = b.getBoundingClientRect();
            if (r.width < 20 || r.height < 20 || r.bottom < window.innerHeight * 0.5) return false;
            return /发送|Send|submit/i.test(t) || (b.querySelector('svg') && r.right > window.innerWidth * 0.7);
          });
          if (hit) {
            hit.click();
            return 'btn:heuristic';
          }
          return null;
        };

        let sent = clickSend();
        if (!sent) {
          const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
          el.dispatchEvent(new KeyboardEvent('keydown', opts));
          el.dispatchEvent(new KeyboardEvent('keyup', opts));
          sent = 'enter';
        }
        return { ok: true, len: now.length, sent };
      })()`,
      returnByValue: true
    });
    const val = filled && filled.result && filled.result.value;
    if (!val || !val.ok) throw new Error('写入输入框失败');
    // 再补一次发送：部分页面要等 input 后按钮才可点
    await sleep(400);
    try {
      await sendRobust('Runtime.evaluate', {
        expression: `(() => {
          const btnSels = [
            'button[aria-label*="发送"]',
            'button[aria-label*="Send"]',
            'button[data-testid*="send"]',
            'div[role="button"][aria-label*="发送"]',
            'div[role="button"][aria-label*="Send"]'
          ];
          for (const s of btnSels) {
            const b = document.querySelector(s);
            if (b && !b.disabled) { b.click(); return { ok: true, via: s }; }
          }
          const el = document.querySelector('textarea#chat-input, textarea, [contenteditable="true"]');
          if (el) {
            el.focus();
            const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ ctrlKey: true }, opts)));
            el.dispatchEvent(new KeyboardEvent('keydown', opts));
            return { ok: true, via: 'enter' };
          }
          return { ok: false };
        })()`,
        returnByValue: true
      });
    } catch (_) {
      /* ignore */
    }
    return { ok: true, len: val.len || 0 };
  } finally {
    try {
      ws.close();
    } catch (_) {
      /* ignore */
    }
  }
}

async function fillDeepSeekInputViaCdp(prompt, opts = {}) {
  let lastErr;
  for (let i = 0; i < 3; i += 1) {
    try {
      return await fillDeepSeekInputViaCdpOnce(prompt, opts);
    } catch (e) {
      lastErr = e;
      if (!isContextDestroyedError(e) || i === 2) throw e;
      await sleep(800 + i * 400);
    }
  }
  throw lastErr;
}

/** 复制提示词，开 Chrome，并用 CDP 自动填入 DeepSeek 输入框。 */
async function openDeepSeekWithPrompt(prompt, tipPrefix) {
  const text = String(prompt || '').trim();
  if (!text) {
    vscode.window.showWarningMessage('没有可发送的内容');
    return;
  }
  lastDeepSeekPrompt = text;
  try {
    await vscode.env.clipboard.writeText(text);
  } catch (_) {
    /* 剪贴板失败也不阻断自动填入 */
  }

  const run = async () => {
    const seq = ++deepSeekFillSeq;
    const url = 'https://chat.deepseek.com/';
    const launched = await ensureDeepSeekChrome(url);
    if (!launched.ok) {
      const fallback = await openUrlInChrome(url);
      if (!fallback.ok) {
        vscode.window.showErrorMessage('无法打开浏览器，请手动访问 chat.deepseek.com（提示词已尽量复制）');
        return;
      }
      vscode.window.showInformationMessage(
        `${tipPrefix || '已打开 DeepSeek'}。未找到 Chrome，请在输入框 Ctrl+V 粘贴（已复制）。`
      );
      return;
    }

    const prefix = tipPrefix || '已打开 DeepSeek';
    try {
      const r = await fillDeepSeekInputViaCdp(text, { loginWaitMs: 180000 });
      // 被更新的并发任务抢占时，不再弹失败
      if (seq !== deepSeekFillSeq) return;
      vscode.window.showInformationMessage(
        `${prefix}。已自动填入输入框（${r.len} 字），确认后发送即可。`
      );
    } catch (e) {
      if (seq !== deepSeekFillSeq) return;
      const pick = await vscode.window.showWarningMessage(
        `${prefix}。自动填入失败：${e.message || e}。提示词已复制。`,
        '重试自动填入'
      );
      if (pick === '重试自动填入') {
        const retrySeq = ++deepSeekFillSeq;
        try {
          const r = await fillDeepSeekInputViaCdp(lastDeepSeekPrompt || text, { loginWaitMs: 180000 });
          if (retrySeq !== deepSeekFillSeq) return;
          vscode.window.showInformationMessage(`已自动填入输入框（${r.len} 字）。`);
        } catch (e2) {
          if (retrySeq !== deepSeekFillSeq) return;
          // 页面跳转类错误：再静默重试一次，成功就不报红
          if (isContextDestroyedError(e2)) {
            try {
              await sleep(1000);
              const r3 = await fillDeepSeekInputViaCdp(lastDeepSeekPrompt || text, { loginWaitMs: 60000 });
              if (retrySeq !== deepSeekFillSeq) return;
              vscode.window.showInformationMessage(`已自动填入输入框（${r3.len} 字）。`);
              return;
            } catch (_) {
              /* fallthrough */
            }
          }
          vscode.window.showErrorMessage(`重试仍失败：${e2.message || e2}。请在输入框 Ctrl+V。`);
        }
      }
    }
  };

  const prev = deepSeekFillLock;
  let release;
  deepSeekFillLock = new Promise((r) => {
    release = r;
  });
  await prev.catch(() => {});
  try {
    await run();
  } finally {
    release();
  }
}

function formatPitfallsForPrompt(pitfalls) {
  const list = Array.isArray(pitfalls)
    ? pitfalls.map((p) => String(p?.text || '').trim()).filter(Boolean)
    : [];
  if (!list.length) return '';
  return ['【我之前的答题错点】', ...list.map((t, i) => `${i + 1}. ${t}`)].join('\n');
}

/**
 * DeepSeek 详解：携带参考答案；先让 AI 给标准最优答，再点评参考答案是否最优并指出不足。
 */
async function openDeepSeekExplain(question, answer, analysis, pitfalls) {
  const q = String(question || '').trim();
  if (!q) {
    vscode.window.showWarningMessage('当前没有题目');
    return;
  }
  const ans = String(answer || '').trim();
  const ana = String(analysis || '').trim();
  const pit = formatPitfallsForPrompt(pitfalls);
  const prompt = [
    '你是资深 Java/后端面试官与辅导员。请详解下面这道面试题。',
    '',
    '请严格按顺序完成（用中文）：',
    '',
    '第一步【标准答案】',
    '- 先只根据「题目」给出你认为的最优/标准面试回答（口述友好、要点齐全）。',
    '- 这一步不要照抄「参考答案」，先独立作答。',
    '',
    '第二步【深入解析】',
    '- 解释原理、为什么、边界与易混点；补 1 个简短项目例子；给 3 个追问及简答。',
    '',
    '第三步【点评参考答案】',
    '- 对照你刚给出的标准答案，点评下方「参考答案」是否已是最优回答。',
    '- 若是最优：明确写「参考答案已是最优」，可补充还能更精炼的地方（可无）。',
    '- 若不是最优：明确写「参考答案不是最优」，并逐条点出不足之处（错误、过时、遗漏、表述不清、深度不够等）。',
    pit ? '' : null,
    pit ? '第四步【错点纠偏】针对「我之前的答题错点」逐条纠正。' : null,
    '',
    '【题目】',
    q,
    '',
    '【参考答案】',
    ans || '（题库暂无参考答案）',
    ana ? `\n【参考答案补充】\n${ana}` : '',
    pit ? `\n${pit}` : ''
  ]
    .filter((x) => x != null && x !== '')
    .join('\n');

  await openDeepSeekWithPrompt(prompt, '已打开 DeepSeek 详解');
}

/**
 * DeepSeek 打分：我的作答 + 参考答案 → 评分与点评
 */
async function openDeepSeekScore(question, userAnswer, refAnswer, analysis, pitfalls) {
  const q = String(question || '').trim();
  const mine = String(userAnswer || '').trim();
  if (!q) {
    vscode.window.showWarningMessage('当前没有题目');
    return;
  }
  if (!mine) {
    vscode.window.showWarningMessage('请先在答题框写下你的作答，再点 DeepSeek 打分');
    return;
  }
  const ref = String(refAnswer || '').trim();
  const ana = String(analysis || '').trim();
  const pit = formatPitfallsForPrompt(pitfalls);
  const prompt = [
    '你是严格但友善的资深面试官。请对我的作答打分并点评。',
    '',
    '原则：以行业通用最优答为标准；「题库参考」仅作辅助，若其有误/过时，以正确知识为准，并在点评中注明。',
    '',
    '输出格式（必须按此结构）：',
    '1) 总分：x/100（整数）',
    '2) 分项：完整性 / 准确性 / 条理清晰度 / 面试表达（每项 0-25，并各给一句评语）',
    '3) 亮点：我答对/答得好的点（条目列出）',
    '4) 不足：遗漏、错误、表述问题（条目列出）',
    '5) 改进版口述：给出一版更适合面试口述的答案（控制在 1 分钟内能说完）',
    '6) 追问演练：出 2 个可能追问，并给出简短参考答法',
    pit ? '7) 对照「我之前的答题错点」：本次是否又犯、如何避免（逐条）' : '',
    ref || ana ? '8) 题库参考是否可靠：一句话结论（正确/部分正确/有误）' : '',
    '',
    '评分标准：',
    '- 90+：要点齐全、原理清楚、可直接上面试',
    '- 70-89：大体正确，有小遗漏或表达可优化',
    '- 50-69：部分正确，关键点缺失较多',
    '- <50：偏差大或几乎未答到点上',
    '',
    '【题目】',
    q,
    '',
    '【我的作答】',
    mine,
    '',
    '【题库参考（可能有误，仅供对照）】',
    ref || '（暂无参考答案，请按通用面试标准评判）',
    ana ? `\n【题库补充（可能有误）】\n${ana}` : '',
    pit ? `\n${pit}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  await openDeepSeekWithPrompt(prompt, '已打开 DeepSeek 打分');
}

function normalizePitfalls(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((p, i) => {
      const text = String(p?.text || '').trim();
      if (!text) return null;
      return {
        id: String(p?.id || `pit-${Date.now()}-${i}`),
        text,
        at: String(p?.at || new Date().toISOString()),
        resolved: !!p?.resolved
      };
    })
    .filter(Boolean);
}

function appendPitfall(prevProgress, text) {
  const t = String(text || '').trim();
  if (!t) return normalizePitfalls(prevProgress?.pitfalls);
  const pitfalls = normalizePitfalls(prevProgress?.pitfalls);
  // 与最近一条全文相同则只刷新时间，避免连点重复堆叠
  if (pitfalls[0] && pitfalls[0].text === t.slice(0, 2000)) {
    pitfalls[0] = { ...pitfalls[0], at: new Date().toISOString(), resolved: false };
    return pitfalls;
  }
  pitfalls.unshift({
    id: `pit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: t.slice(0, 2000),
    at: new Date().toISOString(),
    resolved: false
  });
  // 保留足够历史供复习（实质上长期保留）
  return pitfalls.slice(0, 200);
}

function normalizeAnswerHistory(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((a, i) => {
      const text = String(a?.text || '').trim();
      const pitfall = String(a?.pitfall || '').trim();
      if (!text && !pitfall) return null;
      const understanding =
        a?.understanding != null && Number.isFinite(Number(a.understanding))
          ? Math.max(0, Math.min(100, Math.round(Number(a.understanding))))
          : null;
      return {
        id: String(a?.id || `ans-${Date.now()}-${i}`),
        text: text.slice(0, 8000),
        pitfall: pitfall.slice(0, 2000),
        at: String(a?.at || new Date().toISOString()),
        understanding
      };
    })
    .filter(Boolean);
}

/**
 * 写入本次作答（可带错点）：更新 lastAnswer，并追加「作答+错点」合一的历史。
 * force=true 时（如点下一题）即使同文也记一版时间戳快照；仍跳过与上一条完全相同且无理解度/错点变化的连点。
 */
function mergeUserAnswer(prevProgress, userAnswer, understanding, force, pitfallText) {
  const text = String(userAnswer || '').trim();
  const pit = String(pitfallText || '').trim().slice(0, 2000);
  if (!text && !pit) {
    return {
      lastAnswer: prevProgress?.lastAnswer || '',
      lastAnswerAt: prevProgress?.lastAnswerAt || '',
      answerHistory: normalizeAnswerHistory(prevProgress?.answerHistory)
    };
  }
  const at = new Date().toISOString();
  const u =
    understanding != null && Number.isFinite(Number(understanding))
      ? Math.max(0, Math.min(100, Math.round(Number(understanding))))
      : null;
  let history = normalizeAnswerHistory(prevProgress?.answerHistory);
  const nextText = text ? text.slice(0, 8000) : history[0]?.text || '';
  const sameAsLast =
    history[0] &&
    history[0].text === nextText &&
    (u == null || history[0].understanding === u) &&
    (!pit || history[0].pitfall === pit);
  if (!text && pit && history[0]) {
    // 仅补错点：挂到最近一条，不另起一行
    history[0] = {
      ...history[0],
      pitfall: pit,
      at,
      understanding: u != null ? u : history[0].understanding
    };
  } else if (!sameAsLast) {
    history.unshift({
      id: `ans-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: nextText,
      pitfall: pit || '',
      at,
      understanding: u
    });
  } else if (u != null || force || pit) {
    history[0] = {
      ...history[0],
      understanding: u != null ? u : history[0].understanding,
      pitfall: pit || history[0].pitfall || '',
      at
    };
  }
  // 长期保留作答历史，供复习对照
  history = history.slice(0, 200);
  return {
    lastAnswer: text ? text.slice(0, 8000) : prevProgress?.lastAnswer || nextText || '',
    lastAnswerAt: text || pit ? at : prevProgress?.lastAnswerAt || '',
    answerHistory: history
  };
}

function wireWebview(context, webview) {
  const pushState = () => pushPayload(context, webview);

  const sub = webview.onDidReceiveMessage(async (msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'ready') {
      pushState();
      return;
    }
    if (msg.type === 'saveSession') {
      const state = loadState(context);
      state.session = {
        lastQuestionId: String(msg.lastQuestionId || '').trim()
      };
      saveState(context, state);
      return;
    }
    if (msg.type === 'importBank') {
      await importBankInteractive(context, msg.mode === 'merge' ? 'merge' : 'replace');
      pushState();
      return;
    }
    if (msg.type === 'useBuiltin') {
      // 已移除「恢复内置」入口；忽略旧前端误发
      return;
    }
    if (msg.type === 'resetProgress') {
      await resetProgress(context);
      pushState();
      return;
    }
    if (msg.type === 'upsertQuestion') {
      if (upsertQuestion(context, msg.question || {})) {
        if (!msg.quiet) vscode.window.showInformationMessage('题目已保存');
        pushState();
      }
      return;
    }
    if (msg.type === 'deleteCategory') {
      if (await deleteCategory(context, msg.category)) {
        pushState();
      }
      return;
    }
    if (msg.type === 'removeQuestion') {
      const id = String(msg.id || '');
      if (!id) return;
      const title = String(msg.question || '').trim();
      const preview = title ? `\n\n${title.slice(0, 80)}` : '';
      const choice = await vscode.window.showWarningMessage(
        `确定从题库删除这道题？删除后不可恢复。${preview}`,
        { modal: true },
        '删除'
      );
      if (choice !== '删除') return;
      if (removeQuestionHard(context, id)) {
        pushState();
      }
      return;
    }
    if (msg.type === 'restoreQuestion') {
      restoreQuestion(context, msg.id);
      pushState();
      return;
    }
    if (msg.type === 'exportBank') {
      const qs = loadActiveQuestions(context);
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(require('os').homedir(), 'shiroha-quiz-bank.json')),
        filters: { JSON: ['json'] },
        saveLabel: '导出题库'
      });
      if (!uri) return;
      const info = bankInfo(context);
      fs.writeFileSync(
        uri.fsPath,
        JSON.stringify(
          {
            meta: { title: info.title, questionCount: qs.length, exportedAt: new Date().toISOString() },
            questions: qs
          },
          null,
          2
        ),
        'utf8'
      );
      vscode.window.showInformationMessage(`已导出 ${qs.length} 题`);
      return;
    }
    if (msg.type === 'askDeepSeek') {
      await openDeepSeekExplain(
        msg.question || '',
        msg.answer || '',
        msg.analysis || '',
        msg.pitfalls || []
      );
      return;
    }
    if (msg.type === 'scoreDeepSeek') {
      // 打分前顺带持久化本次作答，便于复习对照
      const qid = String(msg.id || '');
      if (qid && String(msg.userAnswer || '').trim()) {
        const state = loadState(context);
        const prev = state.progress[qid] || {};
        const ans = mergeUserAnswer(prev, msg.userAnswer, null);
        state.progress[qid] = { ...prev, ...ans };
        saveState(context, state);
        pushState();
      }
      await openDeepSeekScore(
        msg.question || '',
        msg.userAnswer || '',
        msg.answer || '',
        msg.analysis || '',
        msg.pitfalls || []
      );
      return;
    }
    if (msg.type === 'addPitfall') {
      const state = loadState(context);
      const id = String(msg.id || '');
      const text = String(msg.text || '').trim();
      if (!id || !text) {
        vscode.window.showWarningMessage('请先写下答题错点');
        return;
      }
      const prev = state.progress[id] || {};
      const pitfalls = appendPitfall(prev, text);
      // 错点挂到最近一条历史（无历史则新建仅含错点的一条），不与作答拆开
      const ans = mergeUserAnswer(prev, '', null, true, text);
      state.progress[id] = { ...prev, ...ans, pitfalls };
      if (state.wrong[id]) {
        state.wrong[id] = {
          ...state.wrong[id],
          pitfalls,
          lastPitfallAt: pitfalls[0]?.at,
          lastAnswer: ans.lastAnswer || state.wrong[id].lastAnswer,
          lastAnswerAt: ans.lastAnswerAt || state.wrong[id].lastAnswerAt
        };
      }
      saveState(context, state);
      pushState();
      return;
    }
    if (msg.type === 'deletePitfall') {
      const state = loadState(context);
      const id = String(msg.id || '');
      const pitfallId = String(msg.pitfallId || '');
      if (!id || !pitfallId) return;
      const prev = state.progress[id] || {};
      const pitfalls = normalizePitfalls(prev.pitfalls).filter((p) => p.id !== pitfallId);
      state.progress[id] = { ...prev, pitfalls };
      if (state.wrong[id]) {
        state.wrong[id] = { ...state.wrong[id], pitfalls };
      }
      saveState(context, state);
      pushState();
      return;
    }
    if (msg.type === 'deleteAnswerHistory') {
      const state = loadState(context);
      let id = String(msg.id || '');
      let answerId = String(msg.answerId || '');
      let pitfallId = String(msg.pitfallId || '');
      const key = String(msg.key || '');
      if ((!answerId && !pitfallId) || !id) {
        const m = key.match(/^(a|p):(.+):([^:]+)$/);
        if (m) {
          id = id || m[2];
          if (m[1] === 'a') answerId = answerId || m[3];
          else pitfallId = pitfallId || m[3];
        }
      }
      if (!id || (!answerId && !pitfallId)) {
        vscode.window.showWarningMessage('无法删除：未找到对应的历史记录');
        pushState();
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        '确定删除这条答题历史？删除后不可恢复。',
        { modal: true },
        '删除'
      );
      if (choice !== '删除') {
        pushState(); // 回滚 webview 乐观更新
        return;
      }
      const prev = state.progress[id] || {};
      let history = normalizeAnswerHistory(prev.answerHistory);
      let pitfalls = normalizePitfalls(prev.pitfalls);

      if (answerId) {
        const removed = history.find((a) => a.id === answerId);
        history = history.filter((a) => a.id !== answerId);
        if (removed) {
          const pitTexts = new Set(
            String(removed.pitfall || '')
              .split(/\n\n+/)
              .map((t) => t.trim())
              .filter(Boolean)
          );
          const t0 = new Date(removed.at || 0).getTime();
          pitfalls = pitfalls.filter((p) => {
            if (pitTexts.has(p.text)) return false;
            const tp = new Date(p.at || 0).getTime();
            // 与该条作答同窗的错点一并清掉，避免历史列表里残留
            if (Number.isFinite(t0) && Number.isFinite(tp) && Math.abs(tp - t0) <= 3000) return false;
            return true;
          });
        }
      } else if (pitfallId) {
        pitfalls = pitfalls.filter((p) => p.id !== pitfallId);
      }

      const latest = history[0];
      const next = {
        ...prev,
        answerHistory: history,
        pitfalls,
        lastAnswer: latest ? latest.text : '',
        lastAnswerAt: latest ? latest.at : ''
      };
      state.progress[id] = next;
      if (state.wrong[id]) {
        state.wrong[id] = {
          ...state.wrong[id],
          pitfalls,
          lastAnswer: next.lastAnswer,
          lastAnswerAt: next.lastAnswerAt,
          lastPitfallAt: pitfalls[0]?.at
        };
      }
      saveState(context, state);
      pushState();
      return;
    }
    if (msg.type === 'togglePitfall') {
      const state = loadState(context);
      const id = String(msg.id || '');
      const pitfallId = String(msg.pitfallId || '');
      if (!id || !pitfallId) return;
      const prev = state.progress[id] || {};
      const pitfalls = normalizePitfalls(prev.pitfalls).map((p) =>
        p.id === pitfallId ? { ...p, resolved: !p.resolved } : p
      );
      state.progress[id] = { ...prev, pitfalls };
      if (state.wrong[id]) {
        state.wrong[id] = { ...state.wrong[id], pitfalls };
      }
      saveState(context, state);
      pushState();
      return;
    }
    if (msg.type === 'saveUserAnswer') {
      const state = loadState(context);
      const { id } = msg;
      if (!id) return;
      const prev = state.progress[id] || {};
      const ans = mergeUserAnswer(prev, msg.userAnswer, null, !!msg.force);
      state.progress[id] = { ...prev, ...ans };
      if (state.wrong[id]) {
        state.wrong[id] = {
          ...state.wrong[id],
          lastAnswer: ans.lastAnswer,
          lastAnswerAt: ans.lastAnswerAt
        };
      }
      saveState(context, state);
      pushState();
      return;
    }
    // 切题前快照：作答+错点写入同一条历史
    if (msg.type === 'checkpointAttempt') {
      const state = loadState(context);
      const id = String(msg.id || '');
      if (!id) return;
      const prev = state.progress[id] || {};
      const pitText = String(msg.pitfall || '').trim();
      const ans = mergeUserAnswer(prev, msg.userAnswer, null, true, pitText);
      const pitfalls = pitText
        ? appendPitfall({ ...prev, ...ans }, pitText)
        : normalizePitfalls(prev.pitfalls);
      state.progress[id] = { ...prev, ...ans, pitfalls };
      if (state.wrong[id]) {
        state.wrong[id] = {
          ...state.wrong[id],
          pitfalls,
          lastPitfallAt: pitfalls[0]?.at,
          lastAnswer: ans.lastAnswer || state.wrong[id].lastAnswer,
          lastAnswerAt: ans.lastAnswerAt || state.wrong[id].lastAnswerAt
        };
      }
      saveState(context, state);
      pushState();
      return;
    }
    if (msg.type === 'mark') {
      const state = loadState(context);
      const { id } = msg;
      if (!id) return;
      const understanding = Number(msg.understanding);
      if (!Number.isFinite(understanding)) {
        vscode.window.showWarningMessage('请填写 0–100 的理解程度');
        return;
      }
      const prev = state.progress[id] || {};
      // 优先用前端算好的艾宾浩斯结果（改算法后热更新即可），否则后端兜底
      const scheduled =
        msg.scheduled && typeof msg.scheduled === 'object'
          ? {
              ...scheduleByEbbinghaus(understanding, prev),
              ...msg.scheduled,
              understanding: clamp(Math.round(understanding), 0, 100)
            }
          : scheduleByEbbinghaus(understanding, prev);
      const pitText = String(msg.pitfall || '').trim();
      const pitfalls = pitText
        ? appendPitfall(prev, pitText)
        : normalizePitfalls(prev.pitfalls);
      const ans = mergeUserAnswer(prev, msg.userAnswer, scheduled.understanding, false, pitText);
      const next = {
        ...prev,
        ...scheduled,
        ...ans,
        pitfalls,
        reviews: (prev.reviews || 0) + 1,
        lastResult: scheduled.understanding >= 80 ? 'right' : 'partial',
        correct: (prev.correct || 0) + (scheduled.understanding >= 80 ? 1 : 0),
        wrong: (prev.wrong || 0) + (scheduled.understanding < 50 ? 1 : 0),
        streak: scheduled.understanding >= 80 ? (prev.streak || 0) + 1 : 0
      };
      state.progress[id] = next;
      if (scheduled.understanding < 80) {
        state.wrong[id] = {
          id,
          understanding: scheduled.understanding,
          count: (state.wrong[id]?.count || 0) + 1,
          lastAt: scheduled.lastAt || new Date().toISOString(),
          pitfalls,
          lastPitfallAt: pitfalls[0]?.at,
          lastAnswer: ans.lastAnswer,
          lastAnswerAt: ans.lastAnswerAt
        };
      } else {
        delete state.wrong[id];
      }
      saveState(context, state);
      pushState();
      return;
    }
    if (msg.type === 'reloadShell') {
      QuizPanel.current?.reloadShell();
      return;
    }
    if (msg.type === 'delete') {
      const id = String(msg.id || '');
      if (!id) return;
      const title = String(msg.question || '').trim();
      const preview = title ? `\n\n${title.slice(0, 80)}` : '';
      const choice = await vscode.window.showWarningMessage(
        `确定删除这道题？删除后不可恢复。${preview}`,
        { modal: true },
        '删除'
      );
      if (choice !== '删除') return;
      // 刷题页删除 = 硬删除（与列表一致，方便管理）
      removeQuestionHard(context, id);
      pushState();
      return;
    }
    if (msg.type === 'reload') {
      pushState();
    }
  });

  return sub;
}

module.exports = { activate, deactivate };
