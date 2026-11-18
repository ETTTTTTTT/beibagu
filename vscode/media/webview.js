(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  let questions = [];
  let deleted = new Set();
  let progress = {};
  let wrong = {};
  let selectedCats = []; // 空 = 全部分类；多选筛选
  let showCatFilter = false;
  let mode = 'practice'; // practice | weak | review
  let view = 'practice'; // practice | bank | edit | mastery | history
  let masterySort = 'understanding'; // understanding | answered | name
  let idx = 0;
  let positionRestored = false;
  let revealed = false;
  /** 点质量分后钉住本题，等用户点下一题再切（复习到期池移出时也不自动滑题） */
  let heldAfterMarkId = null;
  let bank = { label: '题库', source: 'builtin' };
  let search = '';
  let editing = null;
  let editCats = []; // 编辑中的多选分类
  let practiceCatEdit = false; // 刷题页内联改分类
  let practiceEditCats = [];
  let practiceAnswerEdit = false; // 刷题页内联改参考答案
  let practiceAnswerDraft = '';
  let draftCache = { id: '', text: '' };
  let pitfallCache = { id: '', text: '' };
  let historyFilterQid = null; // null = 全部；否则只看某题
  let historyExpanded = {}; // entry key -> 是否展开

  function pitfallsOf(id) {
    const p = progress[id] || {};
    return Array.isArray(p.pitfalls) ? p.pitfalls.filter((x) => x && String(x.text || '').trim()) : [];
  }

  function lastAnswerOf(id) {
    const p = progress[id] || {};
    const direct = String(p.lastAnswer || '').trim();
    if (direct) return direct;
    const hist = answerHistoryOf(id);
    for (const a of hist) {
      const t = String(a?.text || '').trim();
      if (t) return t;
    }
    return '';
  }

  function answerHistoryOf(id) {
    const p = progress[id] || {};
    return Array.isArray(p.answerHistory)
      ? p.answerHistory.filter(
          (a) => a && (String(a.text || '').trim() || String(a.pitfall || '').trim())
        )
      : [];
  }

  function currentDraftText(qId) {
    const draftEl = $('draft');
    if (draftEl && draftCache.id === qId) return (draftEl.value || '').trim();
    if (draftCache.id === qId) return String(draftCache.text || '').trim();
    return '';
  }

  function rememberDraft(qId, text) {
    draftCache = { id: qId, text: String(text || '') };
  }

  function formatPitfallTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
  }

  function formatHistoryTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${y}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }

  function historyTs(iso) {
    const t = new Date(iso || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  function collectHistoryEntries() {
    const qmap = new Map(questions.map((q) => [q.id, q]));
    const items = [];
    Object.keys(progress || {}).forEach((qid) => {
      if (deleted.has(qid)) return;
      const q = qmap.get(qid);
      const title = q ? q.question : qid;
      const answers = answerHistoryOf(qid)
        .slice()
        .sort((a, b) => historyTs(b.at) - historyTs(a.at));
      const pits = pitfallsOf(qid);
      const claimed = new Set();

      answers.forEach((a, i) => {
        const t0 = historyTs(a.at);
        const t1 = i + 1 < answers.length ? historyTs(answers[i + 1].at) : -Infinity;
        let pitfall = String(a.pitfall || '').trim();
        let resolved = false;
        const extra = [];
        pits.forEach((p) => {
          const tp = historyTs(p.at);
          // 同一时间窗内的错点并入本条作答，不单独成行
          if (tp <= t0 + 3000 && tp > t1) {
            claimed.add(p.id);
            if (!pitfall) {
              pitfall = p.text;
              resolved = !!p.resolved;
            } else if (p.text === pitfall) {
              resolved = !!p.resolved;
            } else if (!extra.includes(p.text)) {
              extra.push(p.text);
            }
          }
        });
        if (pitfall) {
          const hit = pits.find((p) => p.text === pitfall);
          if (hit) {
            claimed.add(hit.id);
            resolved = !!hit.resolved;
          }
        }
        const pitfallAll = [pitfall, ...extra].filter(Boolean).join('\n\n');
        items.push({
          key: `a:${qid}:${a.id}`,
          qid,
          title,
          at: a.at,
          answer: String(a.text || '').trim(),
          pitfall: pitfallAll,
          understanding: a.understanding,
          aid: a.id,
          pid: '',
          resolved
        });
      });

      // 未能挂到作答上的旧错点：仍与空作答合成一条，避免再拆成「错点」专行
      pits.forEach((p) => {
        if (claimed.has(p.id)) return;
        if (answers.some((a) => String(a.pitfall || '').trim() === p.text)) return;
        items.push({
          key: `p:${qid}:${p.id}`,
          qid,
          title,
          at: p.at,
          answer: '',
          pitfall: p.text,
          understanding: null,
          aid: '',
          pid: p.id,
          resolved: !!p.resolved
        });
      });
    });
    items.sort((a, b) => historyTs(b.at) - historyTs(a.at));
    if (historyFilterQid) return items.filter((x) => x.qid === historyFilterQid);
    return items;
  }

  function currentPracticeQid() {
    const cur = current();
    return cur && cur.q ? cur.q.id : null;
  }

  function openHistoryView(filterQid) {
    historyFilterQid = filterQid || null;
    setView('history');
  }

  function catsOf(q) {
    if (Array.isArray(q.categories) && q.categories.length) {
      return q.categories.map((c) => String(c || '').trim()).filter(Boolean);
    }
    const out = [];
    // 多分类：逗号/顿号/竖线；路径「Parent / Child」整段保留（勿按裸 / 拆，否则 I/O 变 I、O）
    const push = (v) => {
      String(v || '')
        .split(/\s*[,，、|]\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => {
          if (!out.includes(s)) out.push(s);
        });
    };
    const cat = String(q.category || '').trim();
    if (cat) push(cat);
    else push(q.topic);
    return out.length ? out : ['未分类'];
  }

  function categoryTopic(categories) {
    const first = String((categories && categories[0]) || '').trim();
    if (!first) return '';
    return String(first.split(/\s+\/\s+/)[0] || first).trim();
  }

  function allCategories() {
    const set = new Set();
    visibleQuestions().forEach((q) => catsOf(q).forEach((c) => set.add(c)));
    questions.forEach((q) => catsOf(q).forEach((c) => set.add(c)));
    return [...set].sort((a, b) => a.localeCompare(b, 'zh'));
  }

  function visibleQuestions() {
    return questions.filter((q) => !deleted.has(q.id));
  }

  function reviewDueAt(id) {
    const p = progress[id];
    if (!p) return null;
    if (p.nextReviewAt) {
      const t = new Date(p.nextReviewAt).getTime();
      return Number.isFinite(t) ? t : null;
    }
    // 旧数据：评过分但没有下次复习时间 → 视为已到期，纳入间隔复习
    if (p.understanding != null && Number.isFinite(Number(p.understanding))) {
      return 0;
    }
    return null;
  }

  function isReviewDue(id) {
    const t = reviewDueAt(id);
    return t != null && t <= Date.now();
  }

  function dueIds() {
    return Object.keys(progress).filter((id) => isReviewDue(id));
  }

  function isWeakQuestion(q) {
    const u = understandingOf(q.id);
    // 已评过分且未到 100：专门留给「错题强化」模式
    return u != null && u < 100;
  }

  function pool() {
    let list = visibleQuestions();
    if (selectedCats.length) {
      const want = new Set(selectedCats);
      list = list.filter((q) => catsOf(q).some((c) => want.has(c)));
    }
    if (mode === 'review') {
      // 间隔复习：只出艾宾浩斯到期题，越逾期越靠前
      list = list
        .filter((q) => isReviewDue(q.id))
        .sort((a, b) => (reviewDueAt(a.id) || 0) - (reviewDueAt(b.id) || 0));
    } else if (mode === 'weak') {
      list = list.filter((q) => isWeakQuestion(q));
    }
    return list;
  }

  function formatNextReview(iso) {
    if (!iso) return '未安排';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '未安排';
    const diff = t - Date.now();
    if (diff <= 0) {
      const overdueH = Math.abs(diff) / 3600000;
      if (overdueH < 1) return '已到期';
      if (overdueH < 24) return `已逾期约 ${Math.round(overdueH)} 小时`;
      return `已逾期约 ${Math.round(overdueH / 24)} 天`;
    }
    const hours = diff / 3600000;
    if (hours < 24) return `约 ${Math.max(1, Math.round(hours))} 小时后`;
    return `约 ${Math.round(hours / 24)} 天后`;
  }

  function persistSession() {
    const list = pool();
    const q = list[idx];
    const lastQuestionId = q && q.id ? String(q.id) : '';
    vscode.postMessage({ type: 'saveSession', lastQuestionId });
    try {
      vscode.setState({ ...(vscode.getState() || {}), lastQuestionId });
    } catch (_) {
      /* ignore */
    }
  }

  /** 打开时恢复上次位置；若该题已答过，跳到其后第一道未答题 */
  function restoreLastPosition(lastQuestionId) {
    const list = pool();
    if (!list.length) {
      idx = 0;
      return;
    }
    let start = 0;
    const want = String(lastQuestionId || '').trim();
    if (want) {
      const hit = list.findIndex((q) => q.id === want);
      if (hit >= 0) start = hit;
    }
    let next = -1;
    for (let i = start; i < list.length; i += 1) {
      if (!isAnswered(list[i].id)) {
        next = i;
        break;
      }
    }
    if (next < 0) {
      for (let i = 0; i < start; i += 1) {
        if (!isAnswered(list[i].id)) {
          next = i;
          break;
        }
      }
    }
    idx = next >= 0 ? next : start;
  }

  function current() {
    const list = pool();
    if (heldAfterMarkId) {
      const inPool = list.findIndex((q) => q.id === heldAfterMarkId);
      if (inPool >= 0) {
        idx = inPool;
        return { list, q: list[idx] };
      }
      // 复习模式：刚打分后离开到期池，仍展示本题直到用户点下一题
      const held = visibleQuestions().find((q) => q.id === heldAfterMarkId);
      if (held) return { list, q: held, held: true };
      heldAfterMarkId = null;
    }
    if (!list.length) return null;
    if (idx >= list.length) idx = list.length - 1;
    if (idx < 0) idx = 0;
    return { list, q: list[idx] };
  }

  function canGoNext() {
    const list = pool();
    if (heldAfterMarkId) {
      if (!list.length) return true; // 清掉钉住，进入空池提示
      const hit = list.findIndex((q) => q.id === heldAfterMarkId);
      if (hit < 0) return true; // 已移出池，点下一题进入池内当前 idx
      return hit < list.length - 1;
    }
    if (!list.length) return false;
    return idx < list.length - 1;
  }

  function canGoPrev() {
    const list = pool();
    if (!list.length) return false;
    if (heldAfterMarkId) {
      const hit = list.findIndex((q) => q.id === heldAfterMarkId);
      if (hit < 0) return idx > 0;
      return hit > 0;
    }
    return idx > 0;
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 压缩多余空行，避免参考答案显示大片空白 */
  function compactText(s) {
    return String(s || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function pills(cats) {
    return (cats || []).map((c) => `<span class="pill">${esc(c)}</span>`).join('');
  }

  function filteredBank() {
    const key = search.trim().toLowerCase();
    let list = questions.slice();
    if (key) {
      list = list.filter((q) => {
        const blob = `${q.id} ${q.question} ${catsOf(q).join(' ')} ${q.answer}`.toLowerCase();
        return blob.includes(key);
      });
    }
    return list;
  }

  function ensureMasteryTab() {
    const tabs = document.querySelector('.tabs');
    if (!tabs) return;
    let tab = $('tab-mastery');
    if (!tab) {
      tab = document.createElement('button');
      tab.id = 'tab-mastery';
      tab.className = 'tab';
      tab.textContent = '分类理解度';
      tabs.appendChild(tab);
    } else {
      tab.textContent = '分类理解度';
    }
    tab.onclick = () => setView('mastery');
    if (!$('toolbar-mastery')) {
      const bar = document.createElement('div');
      bar.id = 'toolbar-mastery';
      bar.className = 'toolbar hidden';
      bar.innerHTML =
        '<span class="muted">分类理解程度 = 该分类下每题理解程度均值（未答按 0%）</span>' +
        '<button id="btn-mastery-weak" class="ghost">去刷理解度最低分类</button>';
      const bankBar = $('toolbar-bank');
      if (bankBar && bankBar.parentNode) bankBar.parentNode.insertBefore(bar, bankBar.nextSibling);
      else tabs.parentNode.parentNode.insertBefore(bar, $('main'));
    }
    const weak = $('btn-mastery-weak');
    if (weak) {
      weak.onclick = () => {
        const rows = categoryUnderstandingRows();
        if (!rows.length) return;
        const worst = rows.slice().sort((a, b) => a.understanding - b.understanding)[0];
        selectedCats = [worst.name];
        mode = 'practice';
        idx = 0;
        revealed = false;
        setView('practice');
      };
    }
  }

  function isAnswered(id) {
    const p = progress[id];
    return !!(p && (p.understanding != null || p.lastAt || p.reviews));
  }

  function understandingOf(id) {
    const p = progress[id];
    if (!p || p.understanding == null || !Number.isFinite(Number(p.understanding))) return null;
    return Number(p.understanding);
  }

  /** 7 档质量：与艾宾浩斯 7 档间隔一一对应 */
  const QUALITY_LEVELS = [
    { score: 15, id: 'btn-q1', label: '不会', days: 1 },
    { score: 30, id: 'btn-q2', label: '生疏', days: 2 },
    { score: 45, id: 'btn-q3', label: '半懂', days: 4 },
    { score: 60, id: 'btn-q4', label: '勉强', days: 7 },
    { score: 75, id: 'btn-q5', label: '会了', days: 15 },
    { score: 90, id: 'btn-q6', label: '较熟', days: 30 },
    { score: 100, id: 'btn-q7', label: '掌握', days: 60 }
  ];

  function qualityToStage(u) {
    const n = clamp(Math.round(Number(u) || 0), 0, 100);
    if (n >= 95) return 6;
    if (n >= 85) return 5;
    if (n >= 70) return 4;
    if (n >= 55) return 3;
    if (n >= 40) return 2;
    if (n >= 25) return 1;
    return 0;
  }

  /** 答题质量文案（底层仍存 0–100） */
  function qualityLabel(u) {
    if (u == null || !Number.isFinite(Number(u))) return '未评';
    const lv = QUALITY_LEVELS[qualityToStage(u)];
    return lv ? lv.label : '未评';
  }

  function syncQualityButtons(currentU) {
    const activeScore =
      currentU == null || !Number.isFinite(Number(currentU))
        ? null
        : QUALITY_LEVELS[qualityToStage(currentU)].score;
    for (const lv of QUALITY_LEVELS) {
      const btn = $(lv.id);
      if (!btn) continue;
      const on = activeScore === lv.score;
      btn.classList.toggle('primary', on);
      btn.classList.toggle('ghost', !on);
    }
  }

  /** 分类理解程度：未答按 0%，已答用你标的理解程度 */
  function categoryUnderstandingRows() {
    const map = new Map();
    visibleQuestions().forEach((q) => {
      catsOf(q).forEach((cat) => {
        if (!map.has(cat)) {
          map.set(cat, { name: cat, total: 0, answered: 0, unanswered: 0, sumAll: 0, sumAnswered: 0 });
        }
        const row = map.get(cat);
        row.total += 1;
        const u = understandingOf(q.id);
        if (u == null && !isAnswered(q.id)) {
          row.unanswered += 1;
          row.sumAll += 0;
        } else {
          const val = u == null ? 0 : u;
          row.answered += 1;
          row.sumAnswered += val;
          row.sumAll += val;
        }
      });
    });
    return [...map.values()].map((row) => {
      const understanding = row.total ? Math.round((row.sumAll / row.total) * 10) / 10 : 0;
      const answeredAvg = row.answered ? Math.round((row.sumAnswered / row.answered) * 10) / 10 : 0;
      return {
        ...row,
        understanding,
        answeredAvg,
        coverage: row.total ? Math.round((row.answered / row.total) * 1000) / 10 : 0
      };
    });
  }

  function setToolbarVisible(el, visible) {
    if (!el) return;
    el.classList.toggle('hidden', !visible);
    el.style.display = visible ? 'flex' : 'none';
  }

  function setView(next) {
    try {
      ensureMasteryTab();
    } catch (e) {
      console.error(e);
    }
    view = next;
    if (view !== 'practice') showCatFilter = false;
    $('tab-practice')?.classList.toggle('active', view === 'practice');
    $('tab-bank')?.classList.toggle('active', view === 'bank' || view === 'edit');
    $('tab-mastery')?.classList.toggle('active', view === 'mastery');
    $('tab-history')?.classList.toggle('active', view === 'history');
    setToolbarVisible($('toolbar-practice'), view === 'practice');
    setToolbarVisible($('toolbar-bank'), view === 'bank' || view === 'edit');
    setToolbarVisible($('toolbar-mastery'), view === 'mastery');
    setToolbarVisible($('toolbar-history'), view === 'history');
    setToolbarVisible($('foot-practice'), view === 'practice');
    render();
  }

  function filterLabel() {
    if (!selectedCats.length) return '全部分类';
    if (selectedCats.length === 1) return selectedCats[0];
    return `已选 ${selectedCats.length} 个分类`;
  }

  function render() {
    ensureMasteryTab();
    const list = pool();
    const due = dueIds().length;
    if (view === 'practice') {
      if (mode === 'review') {
        $('meta').textContent = `间隔复习 · 到期 ${list.length} 题`;
      } else if (mode === 'weak') {
        $('meta').textContent = `错题强化 ${list.length} 题`;
      } else {
        $('meta').textContent = `${list.length} 题 · 间隔到期 ${due}`;
      }
    } else if (view === 'mastery') {
      const rows = categoryUnderstandingRows();
      const overall = rows.length
        ? Math.round((rows.reduce((s, r) => s + r.understanding, 0) / rows.length) * 10) / 10
        : 0;
      $('meta').textContent = `${rows.length} 个分类 · 平均理解程度 ${overall}%`;
    } else if (view === 'history') {
      const entries = collectHistoryEntries();
      $('meta').textContent = historyFilterQid
        ? `本题历史 ${entries.length} 条`
        : `答题历史 ${entries.length} 条 · 按时间倒序`;
    } else {
      $('meta').textContent = `共 ${questions.length} 题 · 已隐藏 ${deleted.size}`;
    }
    $('bank').textContent = bank.label || '题库';
    $('bank').className = 'bank-tag' + (bank.source === 'custom' ? ' custom' : '');

    if (view === 'bank') return renderBankList();
    if (view === 'edit') return renderEditor();
    if (view === 'mastery') return renderMastery();
    if (view === 'history') return renderHistory();
    return renderPractice();
  }

  function renderHistory() {
    const filterLabel = $('history-filter-label');
    if (filterLabel) {
      if (historyFilterQid) {
        const q = questions.find((x) => x.id === historyFilterQid);
        const title = q ? q.question : historyFilterQid;
        const short = title.length > 28 ? title.slice(0, 28) + '…' : title;
        filterLabel.textContent = `筛选：${short}`;
      } else {
        filterLabel.textContent = '筛选：全部题目';
      }
    }

    const entries = collectHistoryEntries();
    const body =
      entries.length === 0
        ? '<div class="empty"><p>暂无作答记录。</p><p class="hint">在刷题页保存作答或添加错点后，会按时间出现在这里（作答与错点合在一条）。</p></div>'
        : `<div class="history-list">${entries
            .map((item) => {
              const open = !!historyExpanded[item.key];
              const bits = [];
              if (item.answer) bits.push('作答');
              if (item.pitfall) bits.push('错点');
              const kindLabel = bits.length ? bits.join('+') : '记录';
              const extras = [];
              if (item.understanding != null) extras.push(`理解 ${item.understanding}%`);
              if (item.pitfall) extras.push(item.resolved ? '错点已消化' : '含错点');
              const titleShort =
                item.title.length > 42 ? item.title.slice(0, 42) + '…' : item.title;
              const preview = item.answer || item.pitfall || '';
              const previewShort =
                preview.length > 36 ? preview.slice(0, 36).replace(/\s+/g, ' ') + '…' : preview;
              const answerBlock = item.answer
                ? `<div class="history-part"><div class="history-part-label">作答</div><pre class="history-detail-text">${esc(
                    item.answer
                  )}</pre></div>`
                : '';
              const pitfallBlock = item.pitfall
                ? `<div class="history-part"><div class="history-part-label">错点${
                    item.resolved ? ' · 已消化' : ''
                  }</div><pre class="history-detail-text is-pitfall">${esc(
                    item.pitfall
                  )}</pre></div>`
                : '';
              return `
              <div class="history-item is-combo ${open ? 'is-open' : ''}" data-key="${esc(item.key)}">
                <div class="history-row-wrap">
                  <button type="button" class="history-row" data-key="${esc(item.key)}" aria-expanded="${open ? 'true' : 'false'}">
                    <span class="history-caret">${open ? '▼' : '▶'}</span>
                    <span class="history-time">${esc(formatHistoryTime(item.at))}</span>
                    <span class="pill history-kind">${esc(kindLabel)}</span>
                    ${extras.length ? `<span class="muted history-extra">${esc(extras.join(' · '))}</span>` : ''}
                    <span class="history-title">${esc(titleShort)}</span>
                    ${previewShort ? `<span class="muted history-preview">${esc(previewShort)}</span>` : ''}
                  </button>
                  <button type="button" class="danger ghost hist-delete" title="删除这条历史" data-qid="${esc(
                    item.qid
                  )}" data-aid="${esc(item.aid || '')}" data-pid="${esc(item.pid || '')}" data-key="${esc(
                item.key
              )}">删除</button>
                </div>
                <div class="history-detail" ${open ? '' : 'hidden'}>
                  <div class="history-detail-meta muted">${esc(item.title)}</div>
                  ${answerBlock}
                  ${pitfallBlock}
                  <div class="history-detail-actions">
                    ${
                      item.aid
                        ? `<button type="button" class="ghost hist-restore" data-qid="${esc(item.qid)}" data-aid="${esc(
                            item.aid
                          )}">填回并去刷题</button>`
                        : `<button type="button" class="ghost hist-goto" data-qid="${esc(item.qid)}">去刷此题</button>`
                    }
                    <button type="button" class="danger ghost hist-delete" data-qid="${esc(item.qid)}" data-aid="${esc(
                      item.aid || ''
                    )}" data-pid="${esc(item.pid || '')}" data-key="${esc(item.key)}">删除这条</button>
                  </div>
                </div>
              </div>`;
            })
            .join('')}</div>`;

    $('main').innerHTML = `
      <div class="history-summary card">
        <div class="editor-head">
          <b>答题历史</b>
          <span class="muted">按时间戳倒序 · 作答与错点合一条 · 点击展开 · 可删除</span>
        </div>
      </div>
      ${body}
    `;

    document.querySelectorAll('.history-row').forEach((btn) => {
      btn.onclick = () => {
        const key = btn.dataset.key;
        historyExpanded[key] = !historyExpanded[key];
        renderHistory();
      };
    });
    document.querySelectorAll('.hist-goto').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        jumpToQuestion(btn.dataset.qid);
      };
    });
    document.querySelectorAll('.hist-restore').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const qid = btn.dataset.qid;
        const item = answerHistoryOf(qid).find((a) => a.id === btn.dataset.aid);
        if (item) {
          if (item.text) rememberDraft(qid, item.text);
          if (item.pitfall) pitfallCache = { id: qid, text: item.pitfall };
        }
        jumpToQuestion(qid);
      };
    });
    document.querySelectorAll('.hist-delete').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = btn.dataset.key || '';
        let qid = btn.dataset.qid || '';
        let aid = btn.dataset.aid || '';
        let pid = btn.dataset.pid || '';
        // 兜底：从 key 解析（a:qid:aid / p:qid:pid）
        if ((!aid && !pid) || !qid) {
          const m = String(key).match(/^(a|p):(.+):([^:]+)$/);
          if (m) {
            qid = qid || m[2];
            if (m[1] === 'a') aid = aid || m[3];
            else pid = pid || m[3];
          }
        }
        if (!qid || (!aid && !pid)) {
          alert('无法定位这条历史，请关掉面板后重新打开再试');
          return;
        }
        delete historyExpanded[key];
        // 先本地去掉，避免「点了没反应」；宿主确认取消时会用 state 回滚
        if (aid && progress[qid] && Array.isArray(progress[qid].answerHistory)) {
          progress[qid] = {
            ...progress[qid],
            answerHistory: progress[qid].answerHistory.filter((a) => a && a.id !== aid)
          };
        } else if (pid && progress[qid] && Array.isArray(progress[qid].pitfalls)) {
          progress[qid] = {
            ...progress[qid],
            pitfalls: progress[qid].pitfalls.filter((p) => p && p.id !== pid)
          };
        }
        renderHistory();
        vscode.postMessage({
          type: 'deleteAnswerHistory',
          id: qid,
          answerId: aid,
          pitfallId: pid,
          key
        });
      };
    });
  }

  function jumpToQuestion(qid) {
    if (!qid) return;
    const all = pool();
    let i = all.findIndex((q) => q.id === qid);
    if (i < 0) {
      selectedCats = [];
      mode = 'practice';
      i = pool().findIndex((q) => q.id === qid);
    }
    if (i < 0) {
      const full = questions.filter((q) => !deleted.has(q.id));
      i = full.findIndex((q) => q.id === qid);
      if (i >= 0) {
        selectedCats = [];
        mode = 'practice';
        idx = pool().findIndex((q) => q.id === qid);
      }
    } else {
      idx = i;
    }
    revealed = false;
    practiceCatEdit = false;
    practiceAnswerEdit = false;
    persistSession();
    setView('practice');
  }

  function renderMastery() {
    let rows = categoryUnderstandingRows();
    if (masterySort === 'answered') {
      rows = rows.slice().sort((a, b) => b.answered - a.answered || a.name.localeCompare(b.name, 'zh'));
    } else if (masterySort === 'name') {
      rows = rows.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    } else {
      rows = rows.slice().sort((a, b) => a.understanding - b.understanding || a.name.localeCompare(b.name, 'zh'));
    }

    const body = rows
      .map((r) => {
        const level =
          r.understanding >= 85
            ? '高'
            : r.understanding >= 60
              ? '中'
              : r.understanding >= 30
                ? '低'
                : '弱';
        return `
        <div class="mastery-row" data-cat="${esc(r.name)}">
          <div class="mastery-head">
            <b>${esc(r.name)}</b>
            <span class="mastery-score">${r.understanding}%</span>
            <span class="pill">${level}</span>
          </div>
          <div class="mastery-bar"><i style="width:${Math.min(100, r.understanding)}%"></i></div>
          <div class="mastery-meta muted">
            共 ${r.total} 题 · 已答 ${r.answered} · 未答 ${r.unanswered}
            · 已答平均理解 ${r.answered ? r.answeredAvg + '%' : '-'}
            · 覆盖 ${r.coverage}%
          </div>
          <div class="mastery-actions">
            <button class="ghost btn-go-all" data-cat="${esc(r.name)}">刷此分类</button>
            <button class="ghost btn-go-todo" data-cat="${esc(r.name)}">只刷未答</button>
            <button class="ghost btn-go-weak" data-cat="${esc(r.name)}">只刷理解&lt;80%</button>
            ${
              r.name === '未分类'
                ? ''
                : `<button class="ghost danger-text btn-del-cat" data-cat="${esc(r.name)}">删除分类</button>`
            }
          </div>
        </div>`;
      })
      .join('');

    $('main').innerHTML = `
      <div class="mastery-summary card">
        <div class="editor-head">
          <b>各分类理解程度</b>
          <span class="muted">理解程度即你标注的 0–100%；分类分 = 含未答（按 0%）的均值</span>
        </div>
        <div class="mastery-sort">
          <button class="ghost ${masterySort === 'understanding' ? 'primary' : ''}" id="sort-u">按理解程度</button>
          <button class="ghost ${masterySort === 'answered' ? 'primary' : ''}" id="sort-a">按已答数</button>
          <button class="ghost ${masterySort === 'name' ? 'primary' : ''}" id="sort-n">按名称</button>
        </div>
      </div>
      <div class="mastery-list">${body || '<div class="empty">暂无分类数据</div>'}</div>
    `;

    $('sort-u').onclick = () => {
      masterySort = 'understanding';
      renderMastery();
    };
    $('sort-a').onclick = () => {
      masterySort = 'answered';
      renderMastery();
    };
    $('sort-n').onclick = () => {
      masterySort = 'name';
      renderMastery();
    };

    const goPractice = (cat, filterMode) => {
      selectedCats = [cat];
      mode = 'practice';
      idx = 0;
      revealed = false;
      if (filterMode === 'todo') {
        // 练习池先选分类，再在进入后靠临时过滤：用 review-like 自定义
        setView('practice');
        // 跳到第一道未答题
        const list = pool().filter((q) => !isAnswered(q.id));
        if (list.length) {
          const all = pool();
          const i = all.findIndex((q) => q.id === list[0].id);
          if (i >= 0) idx = i;
        }
        render();
        return;
      }
      if (filterMode === 'weak') {
        setView('practice');
        const list = pool().filter((q) => {
          const u = understandingOf(q.id);
          return u == null || u < 80;
        });
        if (list.length) {
          const all = pool();
          const i = all.findIndex((q) => q.id === list[0].id);
          if (i >= 0) idx = i;
        }
        render();
        return;
      }
      setView('practice');
    };

    $('main').querySelectorAll('.btn-go-all').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        goPractice(btn.dataset.cat, 'all');
      };
    });
    $('main').querySelectorAll('.btn-go-todo').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        goPractice(btn.dataset.cat, 'todo');
      };
    });
    $('main').querySelectorAll('.btn-go-weak').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        goPractice(btn.dataset.cat, 'weak');
      };
    });
    $('main').querySelectorAll('.btn-del-cat').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        requestDeleteCategory(btn.dataset.cat);
      };
    });
  }

  function requestDeleteCategory(cat) {
    const name = String(cat || '').trim();
    if (!name || name === '未分类') return;
    vscode.postMessage({ type: 'deleteCategory', category: name });
  }

  function renderCatFilterPanel() {
    const poolCats = allCategories();
    return `
      <div class="cat-filter card">
        <div class="editor-head">
          <b>分类筛选（可多选）</b>
          <button id="cat-filter-close" class="ghost">收起</button>
        </div>
        <p class="hint muted" style="margin:0 0 8px">点分类名筛选；点右侧 × 可删除分类（题目保留）。</p>
        <div class="cat-pool" id="practice-cat-pool">
          ${poolCats
            .map((c) => {
              const on = selectedCats.includes(c);
              const canDel = c !== '未分类';
              return `<span class="cat-chip-wrap">
                <button type="button" class="cat-chip ${on ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>
                ${
                  canDel
                    ? `<button type="button" class="cat-del" data-cat="${esc(c)}" title="删除分类「${esc(c)}」">×</button>`
                    : ''
                }
              </span>`;
            })
            .join('') || '<span class="muted">暂无分类</span>'}
        </div>
        <div class="editor-actions">
          <button id="cat-filter-all" class="ghost">全选清空（看全部）</button>
          <button id="cat-filter-done" class="primary">完成</button>
        </div>
      </div>
    `;
  }

  function bindCatFilterPanel() {
    $('cat-filter-close')?.addEventListener('click', () => {
      showCatFilter = false;
      render();
    });
    $('cat-filter-done')?.addEventListener('click', () => {
      showCatFilter = false;
      idx = 0;
      revealed = false;
      persistSession();
      render();
    });
    $('cat-filter-all')?.addEventListener('click', () => {
      selectedCats = [];
      idx = 0;
      revealed = false;
      persistSession();
      render();
    });
    $('practice-cat-pool')?.querySelectorAll('.cat-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = btn.dataset.cat;
        if (selectedCats.includes(c)) selectedCats = selectedCats.filter((x) => x !== c);
        else selectedCats = [...selectedCats, c];
        idx = 0;
        revealed = false;
        persistSession();
        render();
      });
    });
    $('practice-cat-pool')?.querySelectorAll('.cat-del').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        requestDeleteCategory(btn.dataset.cat);
      });
    });
  }

  function practicePoolList() {
    let list = visibleQuestions();
    if (selectedCats.length) {
      const want = new Set(selectedCats);
      list = list.filter((q) => catsOf(q).some((c) => want.has(c)));
    }
    return list;
  }

  function practiceProgress() {
    const list = practicePoolList();
    let done = 0;
    let weak = 0;
    for (const q of list) {
      const u = understandingOf(q.id);
      if (u != null) done += 1;
      if (u != null && u < 100) weak += 1;
    }
    return { done, total: list.length, weak };
  }

  function setBadge(el, text, title) {
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.title = title || '';
      el.classList.remove('hidden');
    } else {
      el.textContent = '';
      el.title = '';
      el.classList.add('hidden');
    }
  }

  function syncModeSwitch() {
    const practiceBtn = $('btn-mode-practice');
    const weakBtn = $('btn-mode-weak');
    const reviewBtn = $('btn-mode-review');
    if (!practiceBtn || !reviewBtn) return;
    const modes = [
      ['practice', practiceBtn],
      ['weak', weakBtn],
      ['review', reviewBtn]
    ];
    for (const [key, btn] of modes) {
      if (!btn) continue;
      const on = mode === key;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    }

    const { done, total, weak } = practiceProgress();
    setBadge(
      $('mode-practice-badge'),
      total > 0 ? `${done}/${total}` : '',
      `已标注理解度 ${done} / 当前筛选 ${total} 题`
    );
    setBadge(
      $('mode-weak-badge'),
      weak > 0 ? String(weak > 99 ? '99+' : weak) : '',
      `错题强化：理解度未到 100% 共 ${weak} 题`
    );
    const due = dueIds().length;
    setBadge(
      $('mode-review-badge'),
      due > 0 ? String(due > 99 ? '99+' : due) : '',
      `间隔复习到期 ${due} 题`
    );
  }

  function renderPractice() {
    wireFootActions();
    $('btn-topic').textContent = filterLabel();
    syncModeSwitch();

    if (showCatFilter) {
      practiceCatEdit = false;
      $('main').innerHTML = renderCatFilterPanel();
      bindCatFilterPanel();
      return;
    }

    const cur = current();
    if (!cur) {
      practiceCatEdit = false;
      practiceAnswerEdit = false;
      const emptyCopy =
        mode === 'review'
          ? {
              title: '当前没有到期的间隔复习。',
              hint: '按艾宾浩斯安排：评理解度后会写入下次复习时间；到期才会出现在这里。想提前练未满分题，请用「错题强化」。',
              action: '去练习',
              next: 'practice'
            }
          : mode === 'weak'
            ? {
                title: '暂无需要强化的错题。',
                hint: '在练习里作答并标注理解度（未到 100%）后会出现在这里。',
                action: '去练习',
                next: 'practice'
              }
            : {
                title: '当前筛选下没有题目。',
                hint: '可点「分类筛选」改条件。',
                action: '',
                next: ''
              };
      $('main').innerHTML = `
        <div class="empty">
          <p>${emptyCopy.title}</p>
          <p class="hint">${emptyCopy.hint}</p>
          ${
            emptyCopy.action
              ? `<p style="margin-top:12px"><button id="btn-goto-practice" class="primary" type="button">${emptyCopy.action}</button></p>`
              : ''
          }
        </div>`;
      const go = $('btn-goto-practice');
      if (go) go.onclick = () => setMode(emptyCopy.next || 'practice');
      return;
    }
    const q = cur.q;
    const p = progress[q.id] || {};
    const cats = catsOf(q);
    const uNum = understandingOf(q.id);
    const u = qualityLabel(uNum);
    syncQualityButtons(uNum);
    if (practiceCatEdit && practiceEditCats.length === 0 && cats.length) {
      practiceEditCats = cats.filter((c) => c !== '未分类');
    }
    const poolCats = allCategories().filter((c) => c !== '未分类');
    const extra = practiceEditCats.filter((c) => !poolCats.includes(c));
    const options = [...poolCats, ...extra];
    const answerOpen = revealed || practiceAnswerEdit;

    const catEditor = practiceCatEdit
      ? `
      <div class="practice-cat-edit">
        <div class="editor-head">
          <b>修改本题分类（可多选）</b>
        </div>
        <div class="cat-selected" id="p-cat-selected">
          ${
            practiceEditCats.length
              ? practiceEditCats
                  .map(
                    (c) =>
                      `<button type="button" class="cat-chip on removable" data-cat="${esc(c)}">${esc(c)} ×</button>`
                  )
                  .join('')
              : '<span class="muted">未选分类</span>'
          }
        </div>
        <div class="cat-pool" id="p-cat-pool">
          ${options
            .map((c) => {
              const on = practiceEditCats.includes(c);
              return `<button type="button" class="cat-chip ${on ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`;
            })
            .join('') || '<span class="muted">还没有分类，下方添加</span>'}
        </div>
        <div class="cat-add-row">
          <input id="p-cat-new" placeholder="输入新分类，回车添加" />
          <button id="p-cat-add" class="ghost" type="button">添加</button>
          <button id="p-cat-save" class="primary" type="button">保存分类</button>
          <button id="p-cat-cancel" class="ghost" type="button">取消</button>
        </div>
      </div>`
      : '';

    const answerBlock = practiceAnswerEdit
      ? `
        <div id="answer" class="answer-box is-open">
          <div class="editor-head">
            <b>编辑参考答案</b>
            <span class="muted">有内容即自动保存</span>
          </div>
          <label class="field">参考答案
            <textarea id="p-answer" rows="10" placeholder="输入参考答案，自动保存">${esc(practiceAnswerDraft)}</textarea>
          </label>
        </div>`
      : `
        <div id="answer" class="answer-box ${answerOpen ? 'is-open' : 'is-collapsed'}" aria-expanded="${
          answerOpen ? 'true' : 'false'
        }">
          <div class="answer-toggle-head" id="btn-answer-fold" role="button" tabindex="0" title="${
            answerOpen ? '点击收起参考答案' : '点击展开参考答案'
          }">
            <span class="answer-toggle-title">
              <span class="answer-caret">${answerOpen ? '▼' : '▶'}</span>
              <b>参考答案</b>
              <span class="muted fold-hint">${answerOpen ? '点击收起' : '点击展开'}</span>
            </span>
          </div>
          <div class="answer-body" ${answerOpen ? '' : 'hidden'}>
            <div class="answer-content" id="answer-content" title="双击编辑参考答案">${esc(
              compactText(q.answer || '暂无')
            )}</div>
            <div class="answer-fold-bar">
              <button type="button" id="btn-collapse-answer" class="ghost">收起</button>
            </div>
          </div>
        </div>`;

    // 刷题页只写本次内容；历史作答/错点一律在「答题历史」查看
    $('main').innerHTML = `
      <div class="stats">
        <span>${idx + 1} / ${cur.list.length}</span>
        <span>质量 ${u}</span>
        ${
          mode === 'review'
            ? `<span>阶段 ${p.stage != null ? p.stage + 1 : '-'}/7</span>
        <span>间隔 ${p.intervalDays != null ? p.intervalDays + ' 天' : '-'}</span>
        <span>下次 ${formatNextReview(p.nextReviewAt)}</span>`
            : ''
        }
      </div>
      <div class="card">
        <div class="meta-rows">
          <div class="meta-row">
            <span class="meta-label">分类</span>
            <div class="meta-values">${pills(cats.length ? cats : ['未分类'])}</div>
            <button id="btn-edit-cats" class="ghost cat-edit-btn" type="button">${practiceCatEdit ? '收起' : '改分类'}</button>
          </div>
          <div class="meta-row">
            <span class="meta-label">题型</span>
            <div class="meta-values"><span class="pill">简答题</span></div>
          </div>
        </div>
        ${catEditor}
        <div class="q-title-row">
          <div class="q-title">${esc(q.question)}</div>
          <button id="btn-deepseek" class="ghost q-deepseek-btn" type="button" title="先给标准答案，再点评参考答案是否最优">DeepSeek 详解</button>
        </div>
        ${answerBlock}
        <div class="input-box attempt-box">
          <div class="editor-head">
            <b>本次作答与错点</b>
            <button id="btn-open-q-history" class="ghost cat-edit-btn" type="button">查看历史</button>
          </div>
          <div class="attempt-label">作答</div>
          <textarea id="draft" rows="10" placeholder=""></textarea>
          <div class="draft-score-row">
            <button id="btn-deepseek-score" class="ghost" type="button" title="根据参考答案给本作答打分">DeepSeek 打分</button>
          </div>
          <div class="attempt-pitfall">
            <div class="attempt-label">错点</div>
            <textarea id="pitfall-input" rows="6" placeholder=""></textarea>
          </div>
          <div class="draft-actions">
            <button id="btn-save-draft" class="primary" type="button">保存本条</button>
          </div>
        </div>
      </div>
    `;
    $('btn-prev').disabled = !canGoPrev();
    $('btn-next').disabled = !canGoNext();

    const deepseekBtn = $('btn-deepseek');
    if (deepseekBtn) deepseekBtn.onclick = () => askDeepSeek();
    const scoreBtn = $('btn-deepseek-score');
    if (scoreBtn) scoreBtn.onclick = () => scoreDeepSeek();

    const draft = $('draft');
    if (draft) {
      // 优先本会话草稿；否则回填上次已保存作答，避免重开后空白
      if (draftCache.id === q.id) draft.value = draftCache.text;
      else {
        const prev = lastAnswerOf(q.id);
        draft.value = prev;
        if (prev) rememberDraft(q.id, prev);
      }
      draft.oninput = () => {
        rememberDraft(q.id, draft.value);
      };
    }
    const saveDraftBtn = $('btn-save-draft');
    if (saveDraftBtn) {
      saveDraftBtn.onclick = () => {
        const text = currentDraftText(q.id) || (draft ? draft.value.trim() : '');
        const pitEl = $('pitfall-input');
        const pitfall = (
          pitEl && pitEl.value
            ? pitEl.value
            : pitfallCache.id === q.id
              ? pitfallCache.text
              : ''
        ).trim();
        if (!text && !pitfall) {
          alert('请先写下作答或错点再保存');
          if (draft) draft.focus();
          return;
        }
        rememberDraft(q.id, text);
        vscode.postMessage({
          type: 'checkpointAttempt',
          id: q.id,
          userAnswer: text,
          pitfall
        });
        // 保存后清空输入，历史去「答题历史」看
        draftCache = { id: q.id, text: '' };
        pitfallCache = { id: q.id, text: '' };
        if (draft) draft.value = '';
        if (pitEl) pitEl.value = '';
      };
    }
    const pitfallInput = $('pitfall-input');
    if (pitfallInput) {
      if (pitfallCache.id === q.id) pitfallInput.value = pitfallCache.text;
      else pitfallInput.value = '';
      pitfallInput.oninput = () => {
        pitfallCache = { id: q.id, text: pitfallInput.value };
      };
    }
    const openQHistory = $('btn-open-q-history');
    if (openQHistory) {
      openQHistory.onclick = () => openHistoryView(q.id);
    }
    $('btn-edit-cats').onclick = () => {
      if (practiceCatEdit) {
        practiceCatEdit = false;
      } else {
        practiceCatEdit = true;
        practiceAnswerEdit = false;
        practiceEditCats = catsOf(q).filter((c) => c !== '未分类');
      }
      render();
    };

    if (!practiceAnswerEdit) {
      const foldHead = $('btn-answer-fold');
      if (foldHead) {
        const toggle = () => {
          revealed = !revealed;
          render();
        };
        foldHead.onclick = toggle;
        foldHead.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        };
      }
      const collapseBtn = $('btn-collapse-answer');
      if (collapseBtn) {
        collapseBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          revealed = false;
          render();
        };
      }
      const answerContent = $('answer-content');
      if (answerContent) {
        answerContent.ondblclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          practiceAnswerEdit = true;
          practiceCatEdit = false;
          revealed = true;
          practiceAnswerDraft = q.answer || '';
          render();
        };
      }
    }

    if (practiceAnswerEdit) {
      const ta = $('p-answer');
      if (ta) {
        const persistAnswer = (raw) => {
          const answer = String(raw || '').trim();
          if (!answer) return;
          practiceAnswerDraft = answer;
          const categories = catsOf(q).filter((c) => c !== '未分类');
          vscode.postMessage({
            type: 'upsertQuestion',
            quiet: true,
            question: {
              id: q.id,
              categories,
              topic: categoryTopic(categories) || q.topic || '',
              category: categories.join(' | ') || q.category || '',
              question: q.question,
              answer,
              analysis: q.analysis || ''
            }
          });
          const local = questions.find((x) => x.id === q.id);
          if (local) local.answer = answer;
        };
        let saveTimer = null;
        ta.oninput = () => {
          practiceAnswerDraft = ta.value || '';
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(() => persistAnswer(ta.value), 400);
        };
        ta.onblur = () => {
          if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
          }
          persistAnswer(ta.value);
          practiceAnswerEdit = false;
          revealed = true;
          render();
        };
        setTimeout(() => {
          ta.focus();
          const len = ta.value.length;
          try {
            ta.setSelectionRange(len, len);
          } catch (_) {
            /* ignore */
          }
        }, 0);
      }
    }

    if (!practiceCatEdit) return;

    const toggleCat = (c) => {
      if (practiceEditCats.includes(c)) practiceEditCats = practiceEditCats.filter((x) => x !== c);
      else practiceEditCats = [...practiceEditCats, c];
      render();
    };
    $('p-cat-pool')?.querySelectorAll('.cat-chip').forEach((btn) => {
      btn.onclick = () => toggleCat(btn.dataset.cat);
    });
    $('p-cat-selected')?.querySelectorAll('.cat-chip').forEach((btn) => {
      btn.onclick = () => toggleCat(btn.dataset.cat);
    });
    const addNew = () => {
      const name = ($('p-cat-new').value || '').trim();
      if (!name) return;
      name.split(/\s*[,，、|]\s*/).forEach((part) => {
        const c = part.trim();
        if (c && !practiceEditCats.includes(c)) practiceEditCats.push(c);
      });
      render();
    };
    $('p-cat-add').onclick = addNew;
    $('p-cat-new').onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addNew();
      }
    };
    $('p-cat-cancel').onclick = () => {
      practiceCatEdit = false;
      practiceEditCats = [];
      render();
    };
    $('p-cat-save').onclick = () => {
      const categories = practiceEditCats.slice();
      vscode.postMessage({
        type: 'upsertQuestion',
        question: {
          id: q.id,
          categories,
          topic: categoryTopic(categories),
          category: categories.join(' | '),
          question: q.question,
          answer: q.answer || '',
          analysis: q.analysis || ''
        }
      });
      const local = questions.find((x) => x.id === q.id);
      if (local) {
        local.categories = categories;
        local.topic = categoryTopic(categories);
        local.category = categories.join(' | ');
      }
      practiceCatEdit = false;
      practiceEditCats = [];
      render();
    };
  }

  function renderBankList() {
    const list = filteredBank();
    const rows = list
      .map((q) => {
        const isDeleted = deleted.has(q.id);
        const preview = String(q.question || '').replace(/\s+/g, ' ').slice(0, 72);
        const cats = catsOf(q);
        const pits = pitfallsOf(q.id);
        const openPits = pits.filter((x) => !x.resolved).length;
        return `
        <div class="bank-row ${isDeleted ? 'is-deleted' : ''}" data-id="${esc(q.id)}">
          <div class="bank-main">
            <div class="bank-title">${esc(preview)}${preview.length >= 72 ? '…' : ''}</div>
            <div class="bank-meta">
              ${pills(cats)}
              <span class="muted">${esc(q.id)}</span>
              ${pits.length ? `<span class="pill ${openPits ? 'danger-pill' : ''}">错点 ${pits.length}${openPits ? `·未消化 ${openPits}` : ''}</span>` : ''}
              ${isDeleted ? '<span class="pill danger-pill">已隐藏</span>' : ''}
            </div>
          </div>
          <div class="bank-actions">
            <button class="ghost btn-edit" data-id="${esc(q.id)}">编辑</button>
            ${
              isDeleted
                ? `<button class="ghost btn-restore" data-id="${esc(q.id)}">恢复</button>`
                : ''
            }
            <button class="danger ghost btn-remove" data-id="${esc(q.id)}">删除</button>
          </div>
        </div>`;
      })
      .join('');

    $('main').innerHTML = `
      <div class="bank-summary muted">显示 ${list.length} / ${questions.length} 题 · 编辑页可多选分类</div>
      <div class="bank-list">${rows || '<div class="empty">没有匹配的题目</div>'}</div>
    `;

    $('main').querySelectorAll('.btn-edit').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        openEdit(questions.find((x) => x.id === btn.dataset.id));
      };
    });
    $('main').querySelectorAll('.btn-remove').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const q = questions.find((x) => x.id === btn.dataset.id);
        if (!q) return;
        vscode.postMessage({ type: 'removeQuestion', id: q.id, question: q.question || '' });
      };
    });
    $('main').querySelectorAll('.btn-restore').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: 'restoreQuestion', id: btn.dataset.id });
      };
    });
    $('main').querySelectorAll('.bank-row').forEach((row) => {
      row.onclick = () => openEdit(questions.find((x) => x.id === row.dataset.id));
    });
  }

  function openEdit(q) {
    if (!q) return;
    editing = { ...q };
    editCats = catsOf(q).filter((c) => c !== '未分类' || catsOf(q).length === 1);
    if (editCats.length === 1 && editCats[0] === '未分类' && !q.categories?.length && !q.topic && !q.category) {
      editCats = [];
    }
    setView('edit');
  }

  function renderEditor() {
    const q = editing || { id: '', question: '', answer: '', analysis: '' };
    const isNew = !q.id;
    const poolCats = allCategories().filter((c) => c !== '未分类');
    const extra = editCats.filter((c) => !poolCats.includes(c));
    const options = [...poolCats, ...extra];

    $('main').innerHTML = `
      <div class="card editor">
        <div class="editor-head">
          <b>${isNew ? '新增题目' : '编辑题目'}</b>
          <span class="muted">${isNew ? '保存后会写入自定义题库' : esc(q.id)}</span>
        </div>
        <div class="field">分类（可多选）
          <div class="cat-selected" id="edit-selected">
            ${
              editCats.length
                ? editCats
                    .map(
                      (c) =>
                        `<button type="button" class="cat-chip on removable" data-cat="${esc(c)}">${esc(c)} ×</button>`
                    )
                    .join('')
                : '<span class="muted">未选分类</span>'
            }
          </div>
          <div class="cat-pool" id="edit-pool">
            ${options
              .map((c) => {
                const on = editCats.includes(c);
                return `<button type="button" class="cat-chip ${on ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`;
              })
              .join('') || '<span class="muted">还没有分类，先在下方添加</span>'}
          </div>
          <div class="cat-add-row">
            <input id="f-cat-new" placeholder="输入新分类，回车添加" />
            <button id="f-cat-add" class="ghost" type="button">添加分类</button>
          </div>
        </div>
        <label class="field">题目
          <textarea id="f-question" rows="4" placeholder="题干">${esc(q.question || '')}</textarea>
        </label>
        <label class="field">答案
          <textarea id="f-answer" rows="10" placeholder="参考答案">${esc(q.answer || '')}</textarea>
        </label>
        <div class="editor-actions">
          <button id="f-save" class="primary">保存</button>
          <button id="f-cancel" class="ghost">返回列表</button>
          ${!isNew ? '<button id="f-delete" class="danger ghost">删除</button>' : ''}
        </div>
      </div>
    `;

    const toggleCat = (c) => {
      if (editCats.includes(c)) editCats = editCats.filter((x) => x !== c);
      else editCats = [...editCats, c];
      renderEditor();
    };

    $('edit-pool')?.querySelectorAll('.cat-chip').forEach((btn) => {
      btn.onclick = () => toggleCat(btn.dataset.cat);
    });
    $('edit-selected')?.querySelectorAll('.cat-chip').forEach((btn) => {
      btn.onclick = () => toggleCat(btn.dataset.cat);
    });

    const addNew = () => {
      const name = ($('f-cat-new').value || '').trim();
      if (!name) return;
      name.split(/\s*[,，、|]\s*/).forEach((part) => {
        const c = part.trim();
        if (c && !editCats.includes(c)) editCats.push(c);
      });
      $('f-cat-new').value = '';
      renderEditor();
    };
    $('f-cat-add').onclick = addNew;
    $('f-cat-new').onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addNew();
      }
    };

    $('f-save').onclick = () => {
      const question = ($('f-question').value || '').trim();
      if (!question) {
        alert('题目不能为空');
        return;
      }
      const categories = editCats.slice();
      vscode.postMessage({
        type: 'upsertQuestion',
        question: {
          id: q.id || undefined,
          categories,
          topic: categoryTopic(categories),
          category: categories.join(' | '),
          question,
          answer: $('f-answer').value || '',
          analysis: q.analysis || ''
        }
      });
      editing = null;
      editCats = [];
      setView('bank');
    };
    $('f-cancel').onclick = () => {
      editing = null;
      editCats = [];
      setView('bank');
    };
    const del = $('f-delete');
    if (del) {
      del.onclick = () => {
        vscode.postMessage({ type: 'removeQuestion', id: q.id, question: q.question || '' });
        editing = null;
        editCats = [];
        setView('bank');
      };
    }
  }

  function setMode(next) {
    const target =
      next === 'review' ? 'review' : next === 'weak' ? 'weak' : 'practice';
    if (mode === target) return;
    mode = target;
    idx = 0;
    revealed = false;
    heldAfterMarkId = null;
    practiceCatEdit = false;
    practiceEditCats = [];
    practiceAnswerEdit = false;
    persistSession();
    render();
  }

  const EBBINGHAUS_DAYS = [1, 2, 4, 7, 15, 30, 60];

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function scheduleByEbbinghaus(understanding) {
    const u = clamp(Math.round(Number(understanding) || 0), 0, 100);
    const stage = qualityToStage(u);
    const days = EBBINGHAUS_DAYS[stage];
    return {
      understanding: u,
      stage,
      intervalDays: days,
      nextReviewAt: new Date(Date.now() + days * 86400000).toISOString(),
      lastAt: new Date().toISOString()
    };
  }

  /** 切题 / 离开前：把当前作答与错点草稿写入历史 */
  function checkpointCurrent() {
    const cur = current();
    if (!cur) return;
    const qid = cur.q.id;
    const userAnswer = currentDraftText(qid);
    const pitEl = $('pitfall-input');
    const pitfall = (
      pitEl && pitEl.value
        ? pitEl.value
        : pitfallCache.id === qid
          ? pitfallCache.text
          : ''
    ).trim();
    if (!userAnswer && !pitfall) return;
    if (userAnswer) rememberDraft(qid, userAnswer);
    vscode.postMessage({
      type: 'checkpointAttempt',
      id: qid,
      userAnswer,
      pitfall
    });
    if (pitfall) {
      pitfallCache = { id: qid, text: '' };
      if (pitEl) pitEl.value = '';
    }
  }

  function mark(understanding) {
    const cur = current();
    if (!cur) return;
    const u = Number(understanding);
    if (!Number.isFinite(u) || u < 0 || u > 100) {
      alert('请输入 0–100 的理解程度');
      return;
    }
    const qid = cur.q.id;
    const prev = progress[qid] || {};
    const scheduled = scheduleByEbbinghaus(u, prev);
    const pitEl = $('pitfall-input');
    const pendingPitfall = (
      pitEl && pitEl.value
        ? pitEl.value
        : pitfallCache.id === qid
          ? pitfallCache.text
          : ''
    ).trim();
    // 不论理解度高低，框里有字就一并记入错误点
    const pitfall = pendingPitfall || '';
    const userAnswer = currentDraftText(qid);
    if (userAnswer) rememberDraft(qid, userAnswer);
    // 本地先写入调度，复习池可立刻按 nextReviewAt 移出本题
    progress[qid] = {
      ...prev,
      ...scheduled,
      understanding: Math.round(u),
      reviews: (prev.reviews || 0) + 1
    };
    vscode.postMessage({
      type: 'mark',
      id: qid,
      understanding: Math.round(u),
      scheduled,
      pitfall,
      userAnswer
    });
    if (pitfall) pitfallCache = { id: qid, text: '' };
    // 只记分排程，不自动切题；由用户点「下一题」
    heldAfterMarkId = qid;
    persistSession();
    render();
  }

  function removeCurrent() {
    const cur = current();
    if (!cur) return;
    // 确认放到扩展宿主（webview 内 confirm 常被静默拦截，表现为点了没反应）
    vscode.postMessage({
      type: 'delete',
      id: cur.q.id,
      question: cur.q.question || ''
    });
    revealed = false;
  }

  function askDeepSeek() {
    const cur = current();
    if (!cur) {
      alert('当前没有题目');
      return;
    }
    vscode.postMessage({
      type: 'askDeepSeek',
      question: cur.q.question || '',
      answer: cur.q.answer || '',
      analysis: cur.q.analysis || '',
      pitfalls: pitfallsOf(cur.q.id)
    });
  }

  function scoreDeepSeek() {
    const cur = current();
    if (!cur) {
      alert('当前没有题目');
      return;
    }
    const draftEl = $('draft');
    const userAnswer = currentDraftText(cur.q.id) || (draftEl ? draftEl.value.trim() : '');
    if (!userAnswer) {
      alert('请先在答题框写下你的作答，再点 DeepSeek 打分');
      if (draftEl) draftEl.focus();
      return;
    }
    // 同步缓存，避免跳转前丢失；打分时一并持久化作答
    rememberDraft(cur.q.id, userAnswer);
    vscode.postMessage({
      type: 'scoreDeepSeek',
      id: cur.q.id,
      question: cur.q.question || '',
      userAnswer,
      answer: cur.q.answer || '',
      analysis: cur.q.analysis || '',
      pitfalls: pitfallsOf(cur.q.id)
    });
  }

  function startEditAnswer() {
    const cur = current();
    if (!cur) {
      alert('当前没有题目');
      return;
    }
    practiceAnswerEdit = true;
    practiceCatEdit = false;
    revealed = true;
    practiceAnswerDraft = cur.q.answer || '';
    closeMoreMenu();
    render();
  }

  function closeMoreMenu() {
    const menu = $('more-menu');
    const btn = $('btn-more');
    if (menu) {
      menu.classList.add('hidden');
      menu.style.display = 'none';
    }
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function toggleMoreMenu() {
    const menu = $('more-menu');
    const btn = $('btn-more');
    if (!menu) return;
    const open = menu.style.display !== 'none' && !menu.classList.contains('hidden');
    if (open) closeMoreMenu();
    else {
      menu.classList.remove('hidden');
      menu.style.display = 'flex';
      if (btn) btn.setAttribute('aria-expanded', 'true');
    }
  }

  function wireFootActions() {
    const editAns = $('btn-edit-answer-foot');
    if (editAns) editAns.onclick = startEditAnswer;
    const del = $('btn-delete');
    if (del) {
      del.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMoreMenu();
        removeCurrent();
      };
    }
    const more = $('btn-more');
    if (more) more.onclick = (e) => {
      e.stopPropagation();
      toggleMoreMenu();
    };
  }

  ensureMasteryTab();
  $('tab-practice').onclick = () => setView('practice');
  $('tab-bank').onclick = () => setView('bank');
  if ($('tab-mastery')) $('tab-mastery').onclick = () => setView('mastery');
  if ($('tab-history')) {
    $('tab-history').onclick = () => {
      historyFilterQid = null;
      setView('history');
    };
  }
  const histAll = $('btn-history-all');
  if (histAll) {
    histAll.onclick = () => {
      historyFilterQid = null;
      renderHistory();
      $('meta').textContent = `答题历史 ${collectHistoryEntries().length} 条 · 按时间倒序`;
    };
  }
  const histCurrent = $('btn-history-current');
  if (histCurrent) {
    histCurrent.onclick = () => {
      const qid = currentPracticeQid() || historyFilterQid;
      if (!qid) {
        alert('请先在刷题页打开一道题');
        return;
      }
      historyFilterQid = qid;
      renderHistory();
      $('meta').textContent = `本题历史 ${collectHistoryEntries().length} 条`;
    };
  }
  $('btn-topic').onclick = () => {
    showCatFilter = !showCatFilter;
    render();
  };
  $('btn-mode-practice').onclick = () => setMode('practice');
  $('btn-mode-weak').onclick = () => setMode('weak');
  $('btn-mode-review').onclick = () => setMode('review');
  $('btn-prev').onclick = () => {
    if (!canGoPrev()) return;
    checkpointCurrent();
    const beforeId = heldAfterMarkId;
    heldAfterMarkId = null;
    const list = pool();
    if (!list.length) {
      revealed = false;
      practiceCatEdit = false;
      practiceEditCats = [];
      practiceAnswerEdit = false;
      persistSession();
      render();
      return;
    }
    const hit = beforeId ? list.findIndex((q) => q.id === beforeId) : idx;
    if (hit > 0) idx = hit - 1;
    else if (hit < 0) idx = Math.max(0, Math.min(idx, list.length - 1) - 1);
    revealed = false;
    practiceCatEdit = false;
    practiceEditCats = [];
    practiceAnswerEdit = false;
    persistSession();
    render();
  };
  $('btn-next').onclick = () => {
    if (!canGoNext()) return;
    checkpointCurrent();
    const beforeId = heldAfterMarkId;
    heldAfterMarkId = null;
    const list = pool();
    if (!list.length) {
      revealed = false;
      practiceCatEdit = false;
      practiceEditCats = [];
      practiceAnswerEdit = false;
      persistSession();
      render();
      return;
    }
    const hit = beforeId ? list.findIndex((q) => q.id === beforeId) : idx;
    if (hit >= 0) {
      idx = hit < list.length - 1 ? hit + 1 : hit;
    } else {
      // 复习：打分后已离开到期池，当前 idx 就是下一题
      if (idx >= list.length) idx = list.length - 1;
    }
    revealed = false;
    practiceCatEdit = false;
    practiceEditCats = [];
    practiceAnswerEdit = false;
    persistSession();
    render();
  };
  const legacyReveal = $('btn-reveal');
  if (legacyReveal) legacyReveal.remove();
  for (const lv of QUALITY_LEVELS) {
    const btn = $(lv.id);
    if (btn) btn.onclick = () => mark(lv.score);
  }
  const legacyConfirm = $('btn-u-custom');
  if (legacyConfirm) legacyConfirm.remove();
  const legacyCustom = $('understand-custom');
  if (legacyCustom) legacyCustom.remove();
  wireFootActions();
  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.more-wrap');
    if (wrap && !wrap.contains(e.target)) closeMoreMenu();
  });
  const importMerge = $('btn-import-merge');
  if (importMerge) {
    importMerge.onclick = () => vscode.postMessage({ type: 'importBank', mode: 'merge' });
  }
  const importReplace2 = $('btn-import-replace-2');
  if (importReplace2) {
    importReplace2.onclick = () => vscode.postMessage({ type: 'importBank', mode: 'replace' });
  }
  $('btn-reset').onclick = () => vscode.postMessage({ type: 'resetProgress' });
  const reloadUi = $('btn-reload-ui');
  if (reloadUi) reloadUi.onclick = () => vscode.postMessage({ type: 'reloadShell' });
  $('btn-add').onclick = () => {
    editing = { id: '', question: '', answer: '', analysis: '' };
    editCats = [];
    setView('edit');
  };
  $('btn-export').onclick = () => vscode.postMessage({ type: 'exportBank' });
  $('bank-search').oninput = (e) => {
    search = e.target.value || '';
    if (view === 'bank') renderBankList();
  };

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'state') {
      try {
        const p = msg.payload || {};
        questions = p.questions || [];
        deleted = new Set(p.deleted || []);
        progress = p.progress || {};
        wrong = p.wrong || {};
        bank = p.bank || { label: '题库', source: 'builtin' };
        const known = new Set(allCategories());
        selectedCats = selectedCats.filter((c) => known.has(c));
        if (practiceEditCats && practiceEditCats.length) {
          practiceEditCats = practiceEditCats.filter((c) => known.has(c));
        }
        if (!positionRestored) {
          let lastId = String(p.session?.lastQuestionId || '').trim();
          if (!lastId) {
            try {
              lastId = String((vscode.getState() || {}).lastQuestionId || '').trim();
            } catch (_) {
              /* ignore */
            }
          }
          restoreLastPosition(lastId);
          positionRestored = true;
          persistSession();
        } else if (idx >= pool().length) {
          idx = Math.max(0, pool().length - 1);
        }
        // 正在改参考答案时不要整页重绘，避免打断输入
        const editingAnswer =
          practiceAnswerEdit &&
          document.activeElement &&
          document.activeElement.id === 'p-answer';
        if (editingAnswer) return;
        setView(view || 'practice');
      } catch (err) {
        const meta = $('meta');
        if (meta) meta.textContent = '加载失败';
        const main = $('main');
        if (main) main.innerHTML = `<div class="empty">渲染出错：${esc(err && err.message)}</div>`;
      }
    }
    if (msg.type === 'reload') {
      vscode.postMessage({ type: 'ready' });
    }
  });

  // 先校正工具栏显示，再拉数据
  setView('practice');
  vscode.postMessage({ type: 'ready' });
})();
