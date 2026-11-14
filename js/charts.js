// 余録 · YUROKU — Pure SVG Data Visualization Dashboard

import { escapeHtml } from './markdown.js';

export const CATEGORY_META = [
  { id: 'movie', label: '电影' },
  { id: 'jdrama', label: '日本电视剧' },
  { id: 'manga', label: '日本漫画' },
  { id: 'anime', label: '动漫' },
  { id: 'novel', label: '日本小说' },
  { id: 'game', label: '游戏' }
];

export const NOVEL_SUBTYPE_LABELS = {
  'light-novel': '轻小说',
  'web-novel': '网络小说',
  'general-novel': '一般小说'
};

function computeMean(items) {
  const scored = items.filter((w) => typeof w.score === 'number' && !Number.isNaN(w.score));
  if (!scored.length) return null;
  const sum = scored.reduce((acc, w) => acc + w.score, 0);
  return sum / scored.length;
}

function renderKpiStrip(container, works) {
  const completed = works.filter((w) => w.status === 'completed').length;
  const watching = works.filter((w) => w.status === 'watching').length;
  const hallCount = works.filter((w) => w.hallOfFame).length;
  const mean = computeMean(works);
  const currentYear = String(new Date().getFullYear());
  const yearCompleted = works.filter(
    (w) => w.status === 'completed' && String(w.completedAt || '').startsWith(currentYear)
  ).length;

  const kpis = [
    { label: '收录总计', value: String(works.length), cls: '' },
    { label: '已完成', value: String(completed), cls: '' },
    { label: '在看 / 在玩', value: String(watching), cls: '' },
    { label: '个人殿堂神作', value: String(hallCount), cls: 'accent-seal' },
    { label: '平均评分', value: mean === null ? '—' : mean.toFixed(2), cls: 'accent-seal' },
    { label: `${currentYear} 年完成`, value: String(yearCompleted), cls: '' }
  ];

  container.innerHTML = kpis
    .map(
      (k) => `<div class="kpi-card">
        <div class="kpi-label">${escapeHtml(k.label)}</div>
        <div class="kpi-value ${k.cls}">${escapeHtml(k.value)}</div>
      </div>`
    )
    .join('');
}

function renderCategoryBreakdown(container, works, activeCategory, onCategoryToggle) {
  const total = Math.max(works.length, 1);
  const rowsHtml = CATEGORY_META.map((cat) => {
    const subset = works.filter((w) => w.category === cat.id);
    const pct = Math.round((subset.length / total) * 100);
    const mean = computeMean(subset);
    const meanStr = mean === null ? '—' : mean.toFixed(1);
    const pressed = activeCategory === cat.id ? 'true' : 'false';
    return `<button type="button" class="cat-bar-btn" data-cat-toggle="${cat.id}" aria-pressed="${pressed}">
      <span>${escapeHtml(cat.label)}</span>
      <span class="cat-track"><span class="cat-fill" style="width:${pct}%"></span></span>
      <span class="cat-stat">${subset.length} · ★${meanStr}</span>
    </button>`;
  }).join('');

  const novels = works.filter((w) => w.category === 'novel');
  const subSummary = Object.entries(NOVEL_SUBTYPE_LABELS)
    .map(([key, label]) => `${label} ${novels.filter((n) => n.subCategory === key).length}`)
    .join(' / ');

  container.innerHTML = `<div class="cat-bars">${rowsHtml}</div>
    <div class="chart-sub">日本小说构成：${escapeHtml(subSummary)}（点击品类条可筛选）</div>`;

  for (const btn of container.querySelectorAll('[data-cat-toggle]')) {
    btn.addEventListener('click', () => onCategoryToggle(btn.dataset.catToggle));
  }
}

function renderScoreHistogram(container, works) {
  const buckets = [
    { label: '<6', min: -1, max: 6 },
    { label: '6.0+', min: 6, max: 7 },
    { label: '7.0+', min: 7, max: 8 },
    { label: '8.0+', min: 8, max: 8.5 },
    { label: '8.5+', min: 8.5, max: 9 },
    { label: '9.0+', min: 9, max: 9.5 },
    { label: '9.5+', min: 9.5, max: 10.1 }
  ];

  const scored = works.filter((w) => typeof w.score === 'number' && !Number.isNaN(w.score));
  const counts = buckets.map(
    (b) => scored.filter((w) => w.score >= b.min && w.score < b.max).length
  );
  const maxCount = Math.max(...counts, 1);

  const w = 340;
  const h = 152;
  const barW = 34;
  const gap = 12;
  const leftPad = 14;
  const baseLine = 122;
  const maxBarH = 92;

  const barsSvg = buckets
    .map((b, idx) => {
      const count = counts[idx];
      const barH = count === 0 ? 3 : Math.max(8, Math.round((count / maxCount) * maxBarH));
      const x = leftPad + idx * (barW + gap);
      const y = baseLine - barH;
      const fillHex = idx >= 5 ? '#c43b28' : '#23476e';
      const fillCls = idx >= 5 ? 'svg-fill-seal' : 'svg-fill-indigo';
      return `<g>
        <title>${escapeHtml(b.label)} 区间：${count} 部</title>
        <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${fillHex}" class="${fillCls}" opacity="${count ? '0.92' : '0.22'}"/>
        <text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" fill="#5c544b" class="svg-fill-sub" font-size="11" font-family="monospace">${count}</text>
        <text x="${x + barW / 2}" y="${baseLine + 16}" text-anchor="middle" fill="#7c7469" class="svg-fill-muted" font-size="10.5" font-family="monospace">${escapeHtml(b.label)}</text>
      </g>`;
    })
    .join('');

  container.innerHTML = `<div class="svg-box">
    <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="个人评分分布直方图">
      <line x1="8" y1="${baseLine}" x2="${w - 8}" y2="${baseLine}" stroke="#d8cfc0" class="svg-stroke-line" stroke-width="1"/>
      ${barsSvg}
    </svg>
  </div>`;
}

function formatLocalDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildMonthTrendSvg(works, now) {
  const months = [];
  for (let i = 11; i >= 0; i -= 1) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    const label = `${dt.getMonth() + 1}月`;
    const count = works.filter((w) => {
      const dateStr = w.completedAt || (w.status === 'completed' ? w.updatedAt : '');
      return String(dateStr).startsWith(key);
    }).length;
    months.push({ key, label, count });
  }

  const maxCount = Math.max(...months.map((m) => m.count), 1);
  const w = 360;
  const h = 84;
  const baseLine = 62;
  const bars = months
    .map((m, idx) => {
      const barH = m.count === 0 ? 3 : Math.max(7, Math.round((m.count / maxCount) * 44));
      const x = 10 + idx * 29;
      const y = baseLine - barH;
      const fillHex = m.count ? '#23476e' : '#eae2d3';
      const fillCls = m.count ? 'svg-fill-indigo' : 'svg-heat-0';
      return `<g>
        <title>${escapeHtml(m.key)}：完成 ${m.count} 部</title>
        <rect x="${x}" y="${y}" width="18" height="${barH}" rx="2" fill="${fillHex}" class="${fillCls}"/>
        <text x="${x + 9}" y="${baseLine + 14}" text-anchor="middle" fill="#7c7469" class="svg-fill-muted" font-size="9" font-family="monospace">${escapeHtml(m.label)}</text>
      </g>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="近12个月完成趋势">
    <line x1="6" y1="${baseLine}" x2="${w - 6}" y2="${baseLine}" stroke="#d8cfc0" class="svg-stroke-line" stroke-width="1"/>
    ${bars}
  </svg>`;
}

function buildHeatmapSvg(works, now) {
  const byDate = new Map();
  for (const w of works) {
    const d = w.completedAt || (w.status === 'completed' ? w.updatedAt : '');
    if (!d) continue;
    const list = byDate.get(d) || [];
    list.push(w.title);
    byDate.set(d, list);
  }

  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - 52 * 7 + (6 - end.getDay()));

  const heatHex = ['#eae2d3', '#c2d1df', '#6d92b6', '#23476e', '#c43b28'];
  const cell = 8;
  const step = 10;
  const cells = [];
  const cursor = new Date(start);
  let week = 0;

  while (cursor <= end) {
    const dow = cursor.getDay();
    const key = formatLocalDateKey(cursor);
    const titles = byDate.get(key) || [];
    const level = Math.min(titles.length, 4);
    const tip = titles.length ? `${key}：${titles.join('、')}` : `${key}：无完成记录`;
    cells.push(
      `<rect x="${week * step}" y="${dow * step}" width="${cell}" height="${cell}" rx="1.5" fill="${heatHex[level]}" class="svg-heat-${level}"><title>${escapeHtml(tip)}</title></rect>`
    );
    if (dow === 6) week += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  const svgW = Math.max((week + 1) * step, 520);
  return `<svg viewBox="0 0 ${svgW} 72" role="img" aria-label="近52周记录热力图">${cells.join('')}</svg>`;
}

export function renderDashboard(works, activeCategory, { onCategoryToggle }) {
  const kpiEl = document.getElementById('kpi-strip');
  const catEl = document.getElementById('chart-categories');
  const scoreEl = document.getElementById('chart-scores');
  const actEl = document.getElementById('chart-activity');
  if (!kpiEl || !catEl || !scoreEl || !actEl) return;

  renderKpiStrip(kpiEl, works);
  renderCategoryBreakdown(catEl, works, activeCategory, onCategoryToggle);
  renderScoreHistogram(scoreEl, works);

  const now = new Date();
  actEl.innerHTML = `<div class="svg-box">${buildMonthTrendSvg(works, now)}</div>
    <div class="svg-box">${buildHeatmapSvg(works, now)}</div>`;
}
