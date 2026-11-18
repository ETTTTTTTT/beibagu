const fs = require('fs');
const path = require('path');

const src = require('../media/questions.json');
const qs = src.questions || [];
const outDir = path.join(__dirname, '..', '..', 'banks');
fs.mkdirSync(outDir, { recursive: true });
const now = new Date().toISOString();

function normalize(q, i) {
  const categories = [];
  const seen = new Set();
  const push = (v) => {
    String(v || '')
      .split(/\s*[,，、|]\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => {
        if (!seen.has(s)) {
          seen.add(s);
          categories.push(s);
        }
      });
  };
  if (Array.isArray(q.categories) && q.categories.length) q.categories.forEach(push);
  else if (q.category) push(q.category);
  else push(q.topic);
  const answer = Array.isArray(q.answer) ? q.answer.join('\n') : String(q.answer || '');
  return {
    id: String(q.id || `q-${i + 1}`),
    type: String(q.type || 'short'),
    question: String(q.question || '').trim(),
    answer,
    analysis: String(q.analysis || ''),
    categories,
    category: categories.join(' | '),
    topic: (categories[0] || '').split(/\s+\/\s+/)[0] || ''
  };
}

const all = qs.map(normalize).filter((q) => q.question);

function write(name, title, list) {
  const file = path.join(outDir, name);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        meta: {
          title,
          questionCount: list.length,
          exportedAt: now,
          source: '内置 Java 面试核心题库'
        },
        questions: list
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`${name}\t${list.length}`);
}

write('全部-Java面试核心题库.json', 'Java面试核心题库（全部）', all);

const byParent = new Map();
for (const q of all) {
  const parent = (q.categories[0] || '未分类').split(/\s+\/\s+/)[0] || '未分类';
  if (!byParent.has(parent)) byParent.set(parent, []);
  byParent.get(parent).push(q);
}

const safe = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
for (const [k, v] of [...byParent.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
  write(`${safe(k)}.json`, `${k} 题库`, v);
}

try {
  const m = require('../data/mianshiya-import.json');
  const mq = Array.isArray(m.questions) ? m.questions : Array.isArray(m) ? m : [];
  if (mq.length) {
    const list = mq.map(normalize).filter((q) => q.question);
    write('面试鸭导入题库.json', (m.meta && m.meta.title) || '面试鸭题库', list);
  }
} catch (e) {
  console.log('mianshiya skip:', e.message);
}

console.log('OUT', outDir);
