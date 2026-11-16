// 余録 · YUROKU — archive views (wall / list / diary) and the work detail

import {
  esc, formatScore, hasScore, formatDate, yearOf, statusLabel, categoryLabel,
  categoryFullLabel, progressPercent, progressLabel, verbOf
} from './meta.js';
import { icon } from './icons.js';
import { compileMarkdown, coverSrc } from './markdown.js';

export function workHref(id) {
  return `#/w/${encodeURIComponent(id)}`;
}

function coverImg(work, { eager = false } = {}) {
  return `<img src="${esc(coverSrc(work))}" alt="" ${eager ? '' : 'loading="lazy"'} decoding="async" ` +
    `referrerpolicy="no-referrer" data-cover-id="${esc(work.id)}">`;
}

/** A blurred copy of the cover that glows in the cover's own colours behind it. */
function glowImg(work) {
  return `<img class="cover-glow" src="${esc(coverSrc(work))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

function scoreHtml(work) {
  if (hasScore(work)) return `<span class="score">${formatScore(work.score)}</span>`;
  return '<span class="score-none">未评分</span>';
}

// ---------- Wall ----------

// A bookmark ribbon hanging from the cover's top edge; the gold gradient is defined once in index.html.
const COVER_RIBBON = '<svg viewBox="0 0 16 24" aria-hidden="true" focusable="false"><path d="M0 0h16v24l-8-5.5L0 24Z"/><path class="ribbon-shine" d="M3 0v17.6"/></svg>';

function cardHtml(work, index) {
  const status = work.status !== 'completed'
    ? `<span class="cover-badge">${esc(statusLabel(work.status, work.category))}</span>` : '';
  const pct = progressPercent(work);
  const progress = work.status === 'watching' && pct !== null
    ? `<span class="cover-progress" style="--p:${pct}%"></span>` : '';
  const ribbon = work.hallOfFame
    ? `<span class="cover-ribbon" title="殿堂">${COVER_RIBBON}</span>` : '';
  const quote = work.oneLiner
    ? `<span class="cover-quote" aria-hidden="true">${esc(work.oneLiner)}</span>` : '';
  const meta = [categoryLabel(work), work.releaseYear].filter(Boolean).join(' · ');
  const hof = work.hallOfFame ? '<span class="visually-hidden">，殿堂作品</span>' : '';

  return `<li class="card" style="--i:${Math.min(index, 24)}">
    <a class="card-link" href="${workHref(work.id)}" data-work-link="${esc(work.id)}">
      <div class="cover-wrap">
        ${glowImg(work)}
        <div class="cover">${coverImg(work, { eager: index < 12 })}${ribbon}${status}${progress}${quote}</div>
      </div>
      <div class="card-text">
        <h3 class="card-title">${esc(work.title)}${hof}</h3>
        <p class="card-meta"><span>${esc(meta)}</span>${scoreHtml(work)}</p>
      </div>
    </a>
  </li>`;
}

export function renderWall(items) {
  return `<ul class="wall">${items.map(cardHtml).join('')}</ul>`;
}

// ---------- List ----------

const LIST_COLUMNS = [
  { key: 'title', label: '作品', cls: 'col-title' },
  { key: null, label: '分类', cls: 'col-cat' },
  { key: null, label: '状态', cls: 'col-status' },
  { key: 'score', label: '评分', cls: 'col-score num' },
  { key: 'recent', label: '看完', cls: 'col-date' }
];

export function renderList(items, sort) {
  const head = LIST_COLUMNS.map((col) => {
    if (!col.key) return `<th scope="col" class="${col.cls}">${col.label}</th>`;
    const active = sort.key === col.key;
    const aria = active ? ` aria-sort="${sort.dir === 'asc' ? 'ascending' : 'descending'}"` : '';
    return `<th scope="col" class="${col.cls}"${aria}><button type="button" class="sort-btn" data-sort-key="${col.key}">${col.label}${icon('arrow')}</button></th>`;
  }).join('');

  const rows = items.map((w) => {
    const status = statusLabel(w.status, w.category);
    const orig = w.originalTitle ? `<small lang="ja">${esc(w.originalTitle)}</small>` : '';
    const metaM = `<small class="row-meta-m">${esc([categoryLabel(w), status].join(' · '))}</small>`;
    const ribbon = w.hallOfFame ? `<span class="hof-ico" title="殿堂">${icon('ribbon')}</span>` : '';
    return `<tr>
      <td class="col-title">
        <a class="row-link" href="${workHref(w.id)}" data-work-link="${esc(w.id)}">
          <span class="thumb">${coverImg(w)}</span>
          <span class="row-text"><strong>${esc(w.title)}</strong>${orig}${metaM}</span>
        </a>
      </td>
      <td class="col-cat">${esc(categoryFullLabel(w))}</td>
      <td class="col-status"><span class="status-text"><span class="status-dot" data-status="${w.status}"></span>${esc(status)}</span></td>
      <td class="col-score num"><span class="score-cell">${ribbon}${scoreHtml(w)}</span></td>
      <td class="col-date">${esc(formatDate(w.completedAt)) || '<span class="muted">—</span>'}</td>
    </tr>`;
  }).join('');

  return `<div class="table-wrap"><table class="work-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------- Diary ----------

/** One diary line. The month is printed only on the first entry of each month. */
function diaryRow(w, { month = '', day = '', note = '' }) {
  const ribbon = w.hallOfFame ? `<span class="hof-ico" title="殿堂">${icon('ribbon')}</span>` : '';
  const date = note
    ? `<span class="diary-date"><span class="diary-note">${esc(note)}</span></span>`
    : `<span class="diary-date"><span class="diary-month">${esc(month)}</span><span class="diary-day">${esc(day)}</span></span>`;
  return `<li class="diary-row${month ? ' is-month-start' : ''}">
    <a href="${workHref(w.id)}" data-work-link="${esc(w.id)}">
      ${date}
      <span class="thumb">${coverImg(w)}</span>
      <span class="diary-main"><strong>${esc(w.title)}</strong><small>${esc(categoryFullLabel(w))}</small></span>
      <span class="diary-score">${ribbon}${scoreHtml(w)}</span>
    </a>
  </li>`;
}

const FULL_DATE = /^\d{4}-\d{2}-\d{2}/;

function splitDiary(items) {
  const dated = items
    .filter((w) => FULL_DATE.test(w.completedAt || ''))
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '') || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const undated = items.filter((w) => !FULL_DATE.test(w.completedAt || ''));
  return { dated, undated };
}

/** The order the diary shows its entries in: unfinished first, then newest first. */
export function diaryOrder(items) {
  const { dated, undated } = splitDiary(items);
  return [...undated, ...dated];
}

export function renderDiary(items) {
  const { dated, undated } = splitDiary(items);
  const blocks = [];

  if (undated.length) {
    const title = undated.every((w) => w.status !== 'completed') ? '还没看完' : '未记日期';
    const rows = undated.map((w) => diaryRow(w, { note: statusLabel(w.status, w.category) })).join('');
    blocks.push(`<section class="diary-year">
      <div class="diary-head"><h2>${title}</h2><span>${undated.length} 部</span></div>
      <ol class="diary-list">${rows}</ol>
    </section>`);
  }

  const years = new Map();
  for (const w of dated) {
    const y = yearOf(w.completedAt);
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(w);
  }
  for (const [year, list] of years) {
    let lastMonth = '';
    const rows = list.map((w) => {
      const month = String(Number(w.completedAt.slice(5, 7)));
      const first = month !== lastMonth;
      lastMonth = month;
      return diaryRow(w, { month: first ? `${month} 月` : '', day: String(Number(w.completedAt.slice(8, 10))) });
    }).join('');
    blocks.push(`<section class="diary-year">
      <div class="diary-head"><h2>${esc(year)}</h2><span>${list.length} 部</span></div>
      <ol class="diary-list">${rows}</ol>
    </section>`);
  }
  return `<div class="diary">${blocks.join('')}</div>`;
}

// ---------- Work page ----------

function pagerCard(work, step) {
  if (!work) return '<span class="pager-empty"></span>';
  const label = step < 0 ? '上一部' : '下一部';
  return `<a class="pager-card${step > 0 ? ' is-next' : ''}" href="${workHref(work.id)}" data-work-step="${step}">
    <span class="pager-arrow" aria-hidden="true">${icon(step < 0 ? 'chevron-left' : 'chevron-right')}</span>
    <span class="thumb">${coverImg(work)}</span>
    <span class="row-text"><small>${label}</small><strong>${esc(work.title)}</strong></span>
  </a>`;
}

/**
 * A full page for one record.
 * @param {object} ctx { prev, next, pos, total, backLabel } — neighbours in the archive order
 */
export function renderWorkPage(work, { prev = null, next = null, pos = 0, total = 0, backLabel = '档案' } = {}) {
  const nav = `<nav class="work-nav" aria-label="作品导航">
    <button type="button" class="work-back" data-action="back" title="返回（Esc）">${icon('chevron-left')}<span>返回${esc(backLabel)}</span></button>
    <div class="work-tools">
      ${pos ? `<span class="work-pos">${pos} / ${total}</span>` : ''}
      <button type="button" class="icon-btn" data-action="prev" aria-label="上一部（←）" title="上一部（←）"${prev ? '' : ' disabled'}>${icon('chevron-left')}</button>
      <button type="button" class="icon-btn" data-action="next" aria-label="下一部（→）" title="下一部（→）"${next ? '' : ' disabled'}>${icon('chevron-right')}</button>
      <span class="work-tools-sep" aria-hidden="true"></span>
      <button type="button" class="icon-btn" data-action="copy" aria-label="复制这条记录的链接" title="复制链接">${icon('link')}</button>
      <button type="button" class="icon-btn" data-action="edit" aria-label="编辑这条记录" title="编辑">${icon('pencil')}</button>
    </div>
  </nav>`;
  const pager = prev || next
    ? `<nav class="work-pager" aria-label="上一部与下一部">${pagerCard(prev, -1)}${pagerCard(next, 1)}</nav>`
    : '';
  return `${nav}${renderDetail(work)}${pager}`;
}

function renderDetail(work) {
  const kicker = [categoryFullLabel(work), work.releaseYear].filter(Boolean).join(' · ');
  const creator = [work.creator, work.platform].filter(Boolean).join(' · ');
  const verb = verbOf(work.category);

  const score = hasScore(work)
    ? `<span class="detail-score"><strong>${formatScore(work.score)}</strong><span>/ 10</span></span>`
    : '<span class="detail-score-none">未评分</span>';
  const hof = work.hallOfFame ? `<span class="hof-badge">${icon('ribbon')}殿堂</span>` : '';

  const facts = [`<div><dt>状态</dt><dd>${esc(statusLabel(work.status, work.category))}</dd></div>`];
  const progress = progressLabel(work);
  const pct = progressPercent(work);
  if (progress) {
    const meter = work.status === 'watching' && pct !== null
      ? `<div class="meter" role="img" aria-label="进度 ${pct}%"><span style="width:${pct}%"></span></div>` : '';
    facts.push(`<div><dt>进度</dt><dd>${esc(progress)}${meter}</dd></div>`);
  }
  if (work.completedAt) {
    const label = work.status === 'completed' ? `${verb}完` : '日期';
    facts.push(`<div><dt>${label}</dt><dd>${esc(formatDate(work.completedAt))}</dd></div>`);
  }

  const tags = work.tags.length
    ? `<ul class="tag-list" aria-label="标签">${work.tags.map((t) => `<li><button type="button" class="tag" data-tag="${esc(t)}">#${esc(t)}</button></li>`).join('')}</ul>`
    : '';
  const quote = work.oneLiner ? `<blockquote class="detail-quote">${esc(work.oneLiner)}</blockquote>` : '';
  const review = compileMarkdown(work.reviewMd);
  const reviewHtml = review
    ? `<div class="detail-review"><div class="prose">${review}</div></div>`
    : (work.oneLiner ? '' : '<div class="detail-review"><p class="prose-empty">还没有写观后感。</p></div>');
  const updated = work.updatedAt ? `更新于 ${esc(formatDate(work.updatedAt))}` : '';

  return `<article class="detail">
    <div class="detail-hero">
      <div class="detail-cover cover-wrap">${glowImg(work)}<div class="cover">${coverImg(work, { eager: true })}</div></div>
      <div class="detail-head">
        <p class="detail-kicker">${esc(kicker)}</p>
        <h1 class="detail-title" id="detail-title">${esc(work.title)}</h1>
        ${work.originalTitle ? `<p class="detail-orig" lang="ja">${esc(work.originalTitle)}</p>` : ''}
        ${creator ? `<p class="detail-creator">${esc(creator)}</p>` : ''}
        <div class="detail-rating">${score}${hof}</div>
        <dl class="detail-facts">${facts.join('')}</dl>
        ${tags}
      </div>
    </div>
    ${quote}
    ${reviewHtml}
    <p class="detail-foot">${updated}</p>
  </article>`;
}
