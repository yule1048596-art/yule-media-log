// 余録 · YUROKU — shared vocabulary, labels and small helpers

export const CATEGORIES = [
  { id: 'movie', label: '电影', verb: '看' },
  { id: 'jdrama', label: '日剧', verb: '看' },
  { id: 'manga', label: '漫画', verb: '读' },
  { id: 'anime', label: '动画', verb: '看' },
  { id: 'novel', label: '小说', verb: '读' },
  { id: 'game', label: '游戏', verb: '玩' }
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export const NOVEL_SUBTYPES = [
  { id: 'light-novel', label: '轻小说' },
  { id: 'web-novel', label: '网络小说' },
  { id: 'general-novel', label: '一般小说' }
];

export const SUBTYPE_LABEL = Object.fromEntries(NOVEL_SUBTYPES.map((s) => [s.id, s.label]));

export const STATUSES = ['completed', 'watching', 'planned', 'dropped'];

export const STATUS_GENERIC = {
  completed: '已完成',
  watching: '进行中',
  planned: '计划中',
  dropped: '已弃坑'
};

export function verbOf(category) {
  return CATEGORY_BY_ID[category]?.verb || '看';
}

/** Category-aware status label: 看过 / 在读 / 想玩 / 弃坑 */
export function statusLabel(status, category) {
  const v = verbOf(category);
  switch (status) {
    case 'completed': return `${v}过`;
    case 'watching': return `在${v}`;
    case 'planned': return `想${v}`;
    case 'dropped': return '弃坑';
    default: return '';
  }
}

export function categoryLabel(work) {
  return CATEGORY_BY_ID[work?.category]?.label || '其他';
}

/** "小说 · 轻小说" or just "动画" */
export function categoryFullLabel(work) {
  const base = categoryLabel(work);
  const sub = work?.category === 'novel' ? SUBTYPE_LABEL[work.subCategory] : '';
  return sub ? `${base} · ${sub}` : base;
}

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatScore(score) {
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(1) : '';
}

export function hasScore(work) {
  return typeof work?.score === 'number' && Number.isFinite(work.score);
}

/** 2026-03-22 → 2026.03.22 */
export function formatDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
}

export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function yearOf(iso) {
  const m = String(iso || '').match(/^(\d{4})/);
  return m ? m[1] : '';
}

/** Year the work was finished; empty unless it is actually completed. */
export function finishedYear(work) {
  return work?.status === 'completed' ? yearOf(work.completedAt) : '';
}

export function progressPercent(work) {
  const raw = work?.progressCurrent;
  if (raw === null || raw === undefined || raw === '') return null; // Number(null) would read as 0%
  const cur = Number(raw);
  const total = Number(work?.progressTotal);
  if (!Number.isFinite(cur) || !Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((cur / total) * 100)));
}

/** Human progress string: prefer the free text, fall back to "12 / 28" */
export function progressLabel(work) {
  const text = String(work?.progressText || '').trim();
  const cur = work?.progressCurrent;
  const total = work?.progressTotal;
  const hasNums = Number.isFinite(cur) && Number.isFinite(total) && total > 0;
  if (work?.status === 'watching' && hasNums) {
    return text ? `${cur} / ${total} · ${text}` : `${cur} / ${total}`;
  }
  if (text) return text;
  if (hasNums) return `${cur} / ${total}`;
  return '';
}

export function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().trim();
}

export function mean(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
