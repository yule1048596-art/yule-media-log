// 余録 · YUROKU — stats page: stat tiles, ranked bars, column charts, top list, tags
//
// Charts are plain HTML/CSS (crisp at any width). Every chart has a table twin;
// tooltips only repeat values that are also reachable without hovering.

import { CATEGORIES, esc, mean, formatScore, hasScore, finishedYear, categoryLabel } from './meta.js';
import { coverSrc } from './markdown.js';
import { workHref } from './views.js';

export function statsYears(works) {
  const years = new Set();
  for (const w of works) {
    const y = finishedYear(w);
    if (y) years.add(y);
  }
  return [...years].sort((a, b) => b.localeCompare(a));
}

function niceScale(max) {
  if (max <= 0) return { top: 1, step: 1 };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const mult = [1, 2, 5, 10].find((s) => s * pow >= rough) || 10;
  const step = Math.max(1, mult * pow);
  let top = Math.ceil(max / step) * step;
  if (top === max) top += step; // headroom for the peak label
  return { top, step };
}

function tableTwin(headers, rows) {
  const head = headers.map((h, i) => `<th scope="col"${i > 0 ? ' class="num"' : ''}>${esc(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td class="num">${esc(c)}</td>`)).join('')}</tr>`).join('');
  return `<details class="chart-table"><summary>查看数据表</summary><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></details>`;
}

function columnChart(data, { unit = '部' } = {}) {
  const max = Math.max(0, ...data.map((d) => d.value));
  const { top, step } = niceScale(max);
  const ticks = [];
  for (let t = 0; t <= top + 1e-9; t += step) ticks.push(t);
  // Direct-label only a single, unambiguous peak; ties are read off the axis.
  const peaks = data.filter((d) => d.value === max).length;
  const peak = max > 0 && peaks === 1 ? data.findIndex((d) => d.value === max) : -1;
  const pct = (v) => `${((v / top) * 100).toFixed(2)}%`;

  const yLabels = ticks.map((t) => `<span style="bottom:${pct(t)}">${t}</span>`).join('');
  const grid = ticks.map((t) => `<div class="colchart-grid${t === 0 ? ' is-base' : ''}" style="bottom:${pct(t)}"></div>`).join('');
  const cols = data.map((d, i) => {
    const label = `${d.tip}：${d.value} ${unit}`;
    return `<div class="col${d.value === 0 ? ' is-zero' : ''}" style="--h:${pct(d.value)}" tabindex="0" role="img" ` +
      `aria-label="${esc(label)}" data-tip-value="${esc(`${d.value} ${unit}`)}" data-tip-label="${esc(d.tip)}">` +
      `<span class="col-bar"></span>${i === peak ? `<span class="col-peak">${d.value}</span>` : ''}</div>`;
  }).join('');
  const xLabels = data.map((d) => `<span>${esc(d.label)}</span>`).join('');

  return `<div class="colchart">
    <div class="colchart-y" aria-hidden="true">${yLabels}</div>
    <div class="colchart-plot">${grid}<div class="colchart-cols">${cols}</div></div>
    <div class="colchart-x" aria-hidden="true">${xLabels}</div>
  </div>`;
}

const SCORE_BINS = [
  { label: '<6', tip: '6 分以下', test: (s) => s < 6 },
  { label: '6', tip: '6.0–6.4', test: (s) => s >= 6 && s < 6.5 },
  { label: '6.5', tip: '6.5–6.9', test: (s) => s >= 6.5 && s < 7 },
  { label: '7', tip: '7.0–7.4', test: (s) => s >= 7 && s < 7.5 },
  { label: '7.5', tip: '7.5–7.9', test: (s) => s >= 7.5 && s < 8 },
  { label: '8', tip: '8.0–8.4', test: (s) => s >= 8 && s < 8.5 },
  { label: '8.5', tip: '8.5–8.9', test: (s) => s >= 8.5 && s < 9 },
  { label: '9', tip: '9.0–9.4', test: (s) => s >= 9 && s < 9.5 },
  { label: '9.5', tip: '9.5–10', test: (s) => s >= 9.5 }
];

function panel(title, sub, body, { wide = false } = {}) {
  return `<section class="panel${wide ? ' panel-wide' : ''}">
    <h2 class="panel-title">${esc(title)}</h2>
    ${sub ? `<p class="panel-sub">${esc(sub)}</p>` : ''}
    <div class="panel-body">${body}</div>
  </section>`;
}

function stat(label, value, sub = '', { text = false } = {}) {
  return `<div class="stat">
    <span class="stat-label">${esc(label)}</span>
    <span class="stat-value${text ? ' is-text' : ''}">${esc(value)}</span>
    <span class="stat-sub">${esc(sub) || '&nbsp;'}</span>
  </div>`;
}

function byScoreDesc(a, b) {
  return (b.score - a.score) || (Number(b.hallOfFame) - Number(a.hallOfFame)) ||
    String(b.completedAt || '').localeCompare(String(a.completedAt || ''));
}

export function renderStats(works, year) {
  const all = year === 'all';
  const scoped = all ? works : works.filter((w) => finishedYear(w) === year);
  if (!scoped.length) {
    return `<div class="empty"><p class="empty-title">${all ? '还没有任何记录' : `${esc(year)} 年还没有看完的作品`}</p></div>`;
  }

  const scored = scoped.filter(hasScore);
  const avg = mean(scored.map((w) => w.score));
  const hof = scoped.filter((w) => w.hallOfFame).length;
  const hofScored = scored.filter((w) => w.hallOfFame).length;
  const top = [...scored].sort(byScoreDesc);

  // ----- KPI tiles -----
  let kpis;
  if (all) {
    const count = (s) => scoped.filter((w) => w.status === s).length;
    const thisYear = String(new Date().getFullYear());
    const doneThisYear = works.filter((w) => finishedYear(w) === thisYear);
    const latest = [...doneThisYear].sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
    kpis = [
      stat('收录作品', String(scoped.length), `已完成 ${count('completed')} · 进行中 ${count('watching')} · 计划 ${count('planned')}`),
      stat('平均分', avg === null ? '—' : avg.toFixed(2), scored.length ? `最高 ${formatScore(top[0].score)} · 最低 ${formatScore(top[top.length - 1].score)}` : '还没有评分'),
      stat('殿堂', String(hof), scored.length ? `已评分作品中占 ${Math.round((hofScored / scored.length) * 100)}%` : ''),
      stat(`${thisYear} 年看完`, String(doneThisYear.length), latest ? `最近：${latest.title}` : '')
    ];
  } else {
    const best = top[0];
    kpis = [
      stat(`${year} 年看完`, String(scoped.length), `${new Set(scoped.map((w) => w.category)).size} 个分类`),
      stat('平均分', avg === null ? '—' : avg.toFixed(2), `${scored.length} 部有评分`),
      stat('殿堂', String(hof), hof ? '本年度新入殿堂' : ''),
      stat('年度最高分', best ? best.title : '—', best ? `${formatScore(best.score)} · ${categoryLabel(best)}` : '', { text: true })
    ];
  }

  // ----- Categories: ranked horizontal bars -----
  const cats = CATEGORIES.map((c, order) => {
    const list = scoped.filter((w) => w.category === c.id);
    return { ...c, order, count: list.length, avg: mean(list.filter(hasScore).map((w) => w.score)) };
  }).sort((a, b) => b.count - a.count || a.order - b.order);
  const maxCat = Math.max(1, ...cats.map((c) => c.count));
  const catRows = cats.map((c) => {
    const width = c.count ? `${((c.count / maxCat) * 100).toFixed(2)}%` : '0';
    const avgText = c.avg === null ? '' : `均分 ${c.avg.toFixed(1)}`;
    const aria = `${c.label}：${c.count} 部${avgText ? `，${avgText}` : ''}。在档案中查看`;
    return `<li><button type="button" class="hbar" data-stats-cat="${c.id}" aria-label="${esc(aria)}">
      <span class="hbar-label">${esc(c.label)}</span>
      <span class="hbar-plot"><span class="hbar-fill" style="width:${width}"${c.count ? '' : ' hidden'}></span><span class="hbar-value">${c.count}</span></span>
      <span class="hbar-sub">${esc(avgText)}</span>
    </button></li>`;
  }).join('');
  const catTable = tableTwin(['分类', '数量', '均分'], cats.map((c) => [c.label, String(c.count), c.avg === null ? '—' : c.avg.toFixed(1)]));

  // ----- Score distribution -----
  let scoreBody;
  if (scored.length) {
    const bins = SCORE_BINS.map((b) => ({ label: b.label, tip: b.tip, value: scored.filter((w) => b.test(w.score)).length }));
    const firstUsed = Math.max(0, Math.min(bins.findIndex((b) => b.value > 0), SCORE_BINS.length - 5));
    const shown = bins.slice(firstUsed);
    scoreBody = columnChart(shown) + tableTwin(['分数段', '数量'], shown.map((b) => [b.tip, String(b.value)]));
  } else {
    scoreBody = '<p class="panel-empty">还没有评分</p>';
  }

  // ----- Completions over time -----
  let timeTitle;
  let timeSub;
  let timeBody;
  if (all) {
    const years = statsYears(works).sort();
    timeTitle = '每年看完';
    timeSub = '按看完日期统计';
    if (years.length) {
      const first = Number(years[0]);
      const last = Number(years[years.length - 1]);
      const span = [];
      for (let y = Math.max(first, last - 14); y <= last; y += 1) span.push(String(y));
      const data = span.map((y) => ({ label: y, tip: `${y} 年`, value: works.filter((w) => finishedYear(w) === y).length }));
      timeBody = columnChart(data) + tableTwin(['年份', '数量'], data.map((d) => [d.tip, String(d.value)]));
    } else {
      timeBody = '<p class="panel-empty">还没有填写看完日期的作品</p>';
    }
  } else {
    timeTitle = `${year} 年每月看完`;
    timeSub = '按看完日期统计';
    const data = Array.from({ length: 12 }, (_, i) => {
      const mm = String(i + 1).padStart(2, '0');
      return { label: `${i + 1}`, tip: `${year} 年 ${i + 1} 月`, value: scoped.filter((w) => w.completedAt.slice(5, 7) === mm).length };
    });
    timeBody = columnChart(data) + tableTwin(['月份', '数量'], data.map((d) => [d.tip, String(d.value)]));
  }

  // ----- Top rated -----
  const topBody = top.length
    ? `<ol class="toplist">${top.slice(0, 6).map((w, i) => `<li><a href="${workHref(w.id)}" data-work-link="${esc(w.id)}">
        <span class="toplist-rank">${i + 1}</span>
        <span class="thumb"><img src="${esc(coverSrc(w))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-cover-id="${esc(w.id)}"></span>
        <span class="row-text"><strong>${esc(w.title)}</strong><small>${esc(categoryLabel(w))}${w.hallOfFame ? ' · 殿堂' : ''}</small></span>
        <span class="score">${formatScore(w.score)}</span>
      </a></li>`).join('')}</ol>`
    : '<p class="panel-empty">还没有评分</p>';

  // ----- Tags -----
  const tagCount = new Map();
  for (const w of scoped) for (const t of w.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN')).slice(0, 18);
  const tagBody = tags.length
    ? `<div class="tagcloud">${tags.map(([t, n]) => `<button type="button" class="tag" data-tag="${esc(t)}" aria-label="${esc(`标签 ${t}：${n} 部，在档案中查看`)}">#${esc(t)}<b>${n}</b></button>`).join('')}</div>`
    : '<p class="panel-empty">还没有标签</p>';

  // ----- Shelf: every finished work as a cover, newest first -----
  const finished = (all ? works.filter((w) => finishedYear(w)) : scoped)
    .slice()
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const shelves = new Map();
  for (const w of finished) {
    const key = all ? finishedYear(w) : `${Number(w.completedAt.slice(5, 7))} 月`;
    if (!shelves.has(key)) shelves.set(key, []);
    shelves.get(key).push(w);
  }
  const shelfBody = shelves.size
    ? `<div class="shelf">${[...shelves].map(([key, list]) => `<div class="shelf-row">
        <div class="shelf-label"><strong>${esc(key)}</strong><span>${list.length} 部</span></div>
        <ul class="shelf-covers">${list.map((w) => `<li><a href="${workHref(w.id)}" data-work-link="${esc(w.id)}" title="${esc(w.title)}">
          <span class="cover"><img src="${esc(coverSrc(w))}" alt="${esc(w.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-cover-id="${esc(w.id)}"></span>
        </a></li>`).join('')}</ul>
      </div>`).join('')}</div>`
    : '<p class="panel-empty">还没有填写看完日期的作品</p>';
  const shelfSub = all ? '每一部看完的作品，按年份排列，最近的在前' : `${year} 年看完的作品，按月份排列`;

  return `<div class="kpis">${kpis.join('')}</div>
    <div class="stats-grid">
      ${panel('书架', shelfSub, shelfBody, { wide: true })}
      ${panel('分类', '按数量排序 · 点击在档案中查看', `<ul class="hbars">${catRows}</ul>${catTable}`)}
      ${panel('评分分布', scored.length ? `${scored.length} 部有评分` : '', scoreBody)}
      ${panel(timeTitle, timeSub, timeBody, { wide: true })}
      ${panel('评分最高', '同分时殿堂作品在前', topBody)}
      ${panel('常用标签', '点击在档案中查看', tagBody)}
    </div>`;
}

export function statsSubtitle(works, year) {
  if (year === 'all') return `全部 ${works.length} 部记录`;
  return `${year} 年看完的作品（按看完日期）`;
}

/** One shared tooltip for every column in root. */
export function bindChartTips(root, tip) {
  const show = (col) => {
    tip.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = col.dataset.tipValue || '';
    const span = document.createElement('span');
    span.textContent = col.dataset.tipLabel || '';
    tip.append(strong, span);
    tip.hidden = false;
    const bar = col.querySelector('.col-bar').getBoundingClientRect();
    const box = col.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const anchorY = bar.height > 0 ? bar.top : box.bottom;
    const x = Math.min(Math.max(8, box.left + box.width / 2 - tw / 2), window.innerWidth - tw - 8);
    const y = Math.max(8, anchorY - th - 10);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const hide = () => { tip.hidden = true; };
  root.addEventListener('pointerover', (e) => {
    const col = e.target.closest?.('.col');
    if (col && root.contains(col)) show(col);
  });
  root.addEventListener('pointerout', (e) => {
    const col = e.target.closest?.('.col');
    if (col && !col.contains(e.relatedTarget)) hide();
  });
  root.addEventListener('focusin', (e) => {
    const col = e.target.closest?.('.col');
    if (col) show(col); else hide();
  });
  root.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, { passive: true });
}
