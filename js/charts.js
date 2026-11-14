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

const SVG_PALETTES = {
  light: {
    indigo: '#24486e',
    seal: '#bd3928',
    sub: '#595148',
    muted: '#746b60',
    line: '#d6ccba',
    heat: ['#eae2d3', '#c2d1df', '#6d92b6', '#24486e', '#bd3928']
  },
  dark: {
    indigo: '#7ba6d4',
    seal: '#e46552',
    sub: '#b6ae9f',
    muted: '#8e8679',
    line: '#38332d',
    heat: ['#24211e', '#22374c', '#375c82', '#7ba6d4', '#e46552']
  }
};

function getSvgPalette() {
  const scheme = document.querySelector('meta[name="color-scheme"]')?.content;
  const isDark =
    scheme === 'dark' ||
    (scheme !== 'light' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches));
  return isDark ? SVG_PALETTES.dark : SVG_PALETTES.light;
}

function computeMean(items) {
  const scored = items.filter((w) => typeof w.score === 'number' && !Number.isNaN(w.score));
  if (!scored.length) return null;
  const sum = scored.reduce((acc, w) => acc + w.score, 0);
  return sum / scored.length;
}

function renderKpiStrip(container, works) {
  const completed = works.filter((w) => w.status === 'completed').length;
  const watching = works.filter((w) => w.status === 'watching').length;
  const planned = works.filter((w) => w.status === 'planned').length;
  const hallCount = works.filter((w) => w.hallOfFame).length;
  const scored = works.filter((w) => typeof w.score === 'number' && !Number.isNaN(w.score));
  const mean = computeMean(works);
  const topScore = scored.reduce((m, w) => Math.max(m, w.score), 0);
  const activeCats = new Set(works.map((w) => w.category)).size;
  const compRate = works.length ? Math.round((completed / works.length) * 100) : 0;
  const hallRate = works.length ? Math.round((hallCount / works.length) * 100) : 0;
  const currentYear = String(new Date().getFullYear());
  const yearCompleted = works.filter(
    (w) => w.status === 'completed' && String(w.completedAt || '').startsWith(currentYear)
  ).length;

  const kpis = [
    { label: '收录总计', value: String(works.length), sub: `覆盖 ${activeCats} 大品类`, cls: '' },
    { label: '已完成', value: String(completed), sub: `完结率 ${compRate}%`, cls: '' },
    { label: '在看 / 在玩', value: String(watching), sub: `计划待看 ${planned} 部`, cls: '' },
    { label: '个人殿堂神作', value: String(hallCount), sub: `占比 ${hallRate}%`, cls: 'accent-seal' },
    { label: '平均评分', value: mean === null ? '—' : mean.toFixed(2), sub: scored.length ? `最高 ★${topScore.toFixed(1)} · ${scored.length} 评` : '暂无评分', cls: 'accent-seal' },
    { label: `${currentYear} 年完成`, value: String(yearCompleted), sub: '今年已归档', cls: '' }
  ];

  container.innerHTML = kpis
    .map(
      (k, idx) => `<div class="kpi-card">
        <div class="kpi-head">
          <span class="kpi-label">${escapeHtml(k.label)}</span>
          <span class="kpi-idx" aria-hidden="true">${String(idx + 1).padStart(2, '0')}</span>
        </div>
        <div class="kpi-value ${k.cls}">${escapeHtml(k.value)}</div>
        <div class="kpi-sub">${escapeHtml(k.sub)}</div>
      </div>`
    )
    .join('');
}

function renderCategoryBreakdown(container, works, activeCategory, onCategoryToggle) {
  const total = Math.max(works.length, 1);
  const stats = CATEGORY_META.map((cat) => {
    const subset = works.filter((w) => w.category === cat.id);
    const mean = computeMean(subset);
    return { ...cat, count: subset.length, mean };
  });

  const rowsHtml = stats
    .map((cat) => {
      const pct = Math.round((cat.count / total) * 100);
      const meanStr = cat.mean === null ? '—' : cat.mean.toFixed(1);
      const pressed = activeCategory === cat.id ? 'true' : 'false';
      return `<button type="button" class="cat-bar-btn" data-cat-toggle="${cat.id}" aria-pressed="${pressed}">
        <span>${escapeHtml(cat.label)}</span>
        <span class="cat-track"><span class="cat-fill" style="width:${pct}%"></span></span>
        <span class="cat-stat">${cat.count} · ★${meanStr}</span>
      </button>`;
    })
    .join('');

  const novels = works.filter((w) => w.category === 'novel');
  const subSummary = Object.entries(NOVEL_SUBTYPE_LABELS)
    .map(([key, label]) => `${label} ${novels.filter((n) => n.subCategory === key).length}`)
    .join(' / ');

  container.innerHTML = `<div class="cat-bars">${rowsHtml}</div>`;

  const titleEl = document.getElementById('cat-insight-title');
  const subEl = document.getElementById('cat-insight-sub');
  const footEl = document.getElementById('cat-insight-foot');
  if (titleEl && subEl && footEl) {
    const topByCount = [...stats].sort((a, b) => b.count - a.count)[0];
    const withMean = stats.filter((s) => s.mean !== null);
    const bestMean = [...withMean].sort((a, b) => b.mean - a.mean)[0];
    if (works.length && topByCount && bestMean) {
      titleEl.textContent =
        topByCount.id === bestMean.id
          ? `${topByCount.label}主力收藏（${topByCount.count} 部）· 均分 ★${bestMean.mean.toFixed(1)}`
          : `${topByCount.label}收录最多（${topByCount.count} 部）· ${bestMean.label}均分 ★${bestMean.mean.toFixed(1)}`;
    } else {
      titleEl.textContent = '六大品类占比与均分';
    }
    subEl.textContent = '点击任意品类条可与下方画廊联动筛选';
    footEl.textContent = `小说构成 · ${subSummary}`;
  }

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

  const titleEl = document.getElementById('score-insight-title');
  const subEl = document.getElementById('score-insight-sub');
  const footEl = document.getElementById('score-insight-foot');
  if (titleEl && subEl && footEl) {
    const highCount = scored.filter((w) => w.score >= 9.0).length;
    const highPct = scored.length ? Math.round((highCount / scored.length) * 100) : 0;
    const mean = computeMean(works);
    titleEl.textContent = scored.length
      ? `9.0+ 高赞佳作占 ${highPct}%（${highCount}/${scored.length}）`
      : '个人评分分布';
    subEl.textContent = scored.length
      ? `整体均分 ★${mean.toFixed(2)} · 区间 0.0 – 10.0`
      : '0.0 – 10.0 分制';
    footEl.textContent = 'HISTOGRAM · 朱红区间代表 9.0+ 高赞';
  }

  const pal = getSvgPalette();
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
      const fillCls = idx >= 5 ? 'svg-fill-seal' : 'svg-fill-indigo';
      const fillHex = idx >= 5 ? pal.seal : pal.indigo;
      return `<g>
        <title>${escapeHtml(b.label)} 区间：${count} 部</title>
        <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="5" fill="${fillHex}" class="${fillCls} hist-bar" style="--bar-idx:${idx}" opacity="${count ? '0.92' : '0.22'}"/>
        <text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" fill="${pal.sub}" class="svg-fill-sub" font-size="11" font-family="monospace">${count}</text>
        <text x="${x + barW / 2}" y="${baseLine + 16}" text-anchor="middle" fill="${pal.muted}" class="svg-fill-muted" font-size="10.5" font-family="monospace">${escapeHtml(b.label)}</text>
      </g>`;
    })
    .join('');

  container.innerHTML = `<div class="svg-box">
    <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="个人评分分布直方图">
      <line x1="8" y1="${baseLine}" x2="${w - 8}" y2="${baseLine}" stroke="${pal.line}" class="svg-stroke-line" stroke-width="1"/>
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

  const pal = getSvgPalette();
  const last12Total = months.reduce((acc, m) => acc + m.count, 0);
  const peakMonth = [...months].sort((a, b) => b.count - a.count)[0];
  const maxCount = Math.max(...months.map((m) => m.count), 1);
  const w = 360;
  const h = 84;
  const baseLine = 62;
  const bars = months
    .map((m, idx) => {
      const barH = m.count === 0 ? 3 : Math.max(7, Math.round((m.count / maxCount) * 44));
      const x = 10 + idx * 29;
      const y = baseLine - barH;
      const fillCls = m.count ? 'svg-fill-indigo' : 'svg-heat-0';
      const fillHex = m.count ? pal.indigo : pal.heat[0];
      return `<g>
        <title>${escapeHtml(m.key)}：完成 ${m.count} 部</title>
        <rect x="${x}" y="${y}" width="18" height="${barH}" rx="4" fill="${fillHex}" class="${fillCls}${m.count ? ' hist-bar' : ''}" style="--bar-idx:${idx}"/>
        <text x="${x + 9}" y="${baseLine + 14}" text-anchor="middle" fill="${pal.muted}" class="svg-fill-muted" font-size="9" font-family="monospace">${escapeHtml(m.label)}</text>
      </g>`;
    })
    .join('');

  return {
    last12Total,
    peakMonth,
    svg: `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="近12个月完成趋势">
      <line x1="6" y1="${baseLine}" x2="${w - 6}" y2="${baseLine}" stroke="${pal.line}" class="svg-stroke-line" stroke-width="1"/>
      ${bars}
    </svg>`
  };
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

  const pal = getSvgPalette();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - 52 * 7 + (6 - end.getDay()));

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
      `<rect x="${week * step}" y="${dow * step}" width="${cell}" height="${cell}" rx="1.5" fill="${pal.heat[level]}" class="svg-heat-${level}"><title>${escapeHtml(tip)}</title></rect>`
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
  const trend = buildMonthTrendSvg(works, now);
  actEl.innerHTML = `<div class="svg-box">${trend.svg}</div>
    <div class="svg-box">${buildHeatmapSvg(works, now)}</div>`;

  const actTitle = document.getElementById('act-insight-title');
  const actSub = document.getElementById('act-insight-sub');
  const actFoot = document.getElementById('act-insight-foot');
  if (actTitle && actSub && actFoot) {
    actTitle.textContent = trend.last12Total
      ? `近 12 个月归档 ${trend.last12Total} 部 · ${trend.peakMonth.key} 峰值 ${trend.peakMonth.count} 部`
      : '近 12 月趋势 & 52 周热力图';
    actSub.textContent = '按完成日期汇总 · 悬停色块查看当日作品';
    actFoot.innerHTML = `<span>52-WEEK CADENCE</span><span class="heat-legend" aria-hidden="true">LESS <i class="heat-dot" style="background:var(--heat-0)"></i><i class="heat-dot" style="background:var(--heat-1)"></i><i class="heat-dot" style="background:var(--heat-2)"></i><i class="heat-dot" style="background:var(--heat-3)"></i><i class="heat-dot" style="background:var(--heat-4)"></i> MORE</span>`;
  }
}
