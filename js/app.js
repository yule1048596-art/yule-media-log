// 余録 · YUROKU — app shell: state, hash routing, filters, rendering, shortcuts

import { CATEGORIES, NOVEL_SUBTYPES, esc, mean, normalizeText, finishedYear, formatDate } from './meta.js';
import { icon, hydrateIcons } from './icons.js';
import { fallbackCover, coverSrc, coverTone, hasCoverImage } from './markdown.js';
import { cachedPalette, extractPalette, bandScheme, pageAccent } from './palette.js';
import { loadInitialData, saveDraft } from './sync.js';
import { renderWall, renderList, renderDiary, diaryOrder, renderWorkPage, workHref } from './views.js';
import { renderStats, statsYears, statsSubtitle, bindChartTips } from './charts.js';
import { setupEditor, openEditor } from './editor.js';
import { setupSyncDialog, openSyncDialog } from './sync-ui.js';

const VIEW_KEY = 'yuroku_view';
const DENSITY_KEY = 'yuroku_density';
const DENSITIES = ['7', '5']; // posters per row on a full-width screen
const THEME_KEY = 'yuroku_theme';
const VIEWS = ['wall', 'list', 'diary'];
const SORT_DEFAULT_DIR = { recent: 'desc', score: 'desc', updated: 'desc', release: 'desc', title: 'asc' };
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

const defaultFilters = () => ({ category: 'all', sub: 'all', status: 'all', year: 'all', hof: false, tag: '', q: '' });

const state = {
  data: { version: 1, siteTitle: '', siteSubtitle: '', works: [] },
  ready: false, // data loaded from somewhere; editing is blocked until then
  dirty: false,
  pending: false,
  conflict: false,
  baseSha: '', // git blob sha of the remote works.json the local data derives from
  page: 'archive',
  workId: null,
  filters: defaultFilters(),
  sort: { key: 'recent', dir: 'desc' },
  view: 'wall',
  density: '7',
  statsYear: 'all'
};

const els = {};

function readPref(key, fallback, allowed) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: preference lasts for this visit only
  }
}

// ---------- Toast ----------

let toastTimer = 0;
function toast(message, kind = '') {
  const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
  if (els.toast.parentElement !== host) host.append(els.toast);
  els.toast.textContent = message;
  els.toast.dataset.kind = kind;
  // Force a reflow so the transition replays after re-parenting.
  void els.toast.offsetWidth;
  els.toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-on'), kind === 'error' ? 4500 : 2600);
}

// ---------- Data helpers ----------

const findWork = (id) => state.data.works.find((w) => w.id === id) || null;

const searchCache = new WeakMap();
function searchText(w) {
  let text = searchCache.get(w);
  if (text === undefined) {
    text = normalizeText([w.title, w.originalTitle, w.creator, w.platform, w.oneLiner, w.tags.join(' '), w.reviewMd].join('\n'));
    searchCache.set(w, text);
  }
  return text;
}

function filtersActive() {
  const f = state.filters;
  const d = defaultFilters();
  return Object.keys(d).some((k) => f[k] !== d[k]);
}

function filteredWorks() {
  const f = state.filters;
  const q = normalizeText(f.q);
  return state.data.works.filter((w) => {
    if (f.category !== 'all' && w.category !== f.category) return false;
    if (f.category === 'novel' && f.sub !== 'all' && w.subCategory !== f.sub) return false;
    if (f.status !== 'all' && w.status !== f.status) return false;
    if (f.year !== 'all' && finishedYear(w) !== f.year) return false;
    if (f.hof && !w.hallOfFame) return false;
    if (f.tag && !w.tags.includes(f.tag)) return false;
    if (q && !searchText(w).includes(q)) return false;
    return true;
  });
}

function sortWorks(list) {
  const { key, dir } = state.sort;
  const sign = dir === 'asc' ? 1 : -1;
  const when = (w) => w.completedAt || w.updatedAt || '';
  const tie = (a, b) => when(b).localeCompare(when(a)) || collator.compare(a.title, b.title);
  return [...list].sort((a, b) => {
    if (key === 'score') {
      const as = typeof a.score === 'number';
      const bs = typeof b.score === 'number';
      if (as !== bs) return as ? -1 : 1;
      const r = (a.score ?? 0) - (b.score ?? 0) || Number(a.hallOfFame) - Number(b.hallOfFame);
      return r ? r * sign : tie(a, b);
    }
    if (key === 'release') {
      const ay = a.releaseYear ?? null;
      const by = b.releaseYear ?? null;
      if ((ay === null) !== (by === null)) return ay === null ? 1 : -1;
      const r = (ay ?? 0) - (by ?? 0);
      return r ? r * sign : tie(a, b);
    }
    if (key === 'title') return collator.compare(a.title, b.title) * sign;
    if (key === 'updated') {
      const r = (a.updatedAt || '').localeCompare(b.updatedAt || '');
      return r ? r * sign : tie(a, b);
    }
    const r = when(a).localeCompare(when(b));
    return r ? r * sign : collator.compare(a.title, b.title);
  });
}

/** Ids in the order they appear on screen (drives prev/next on a work page). */
function orderedIds() {
  const items = sortWorks(filteredWorks());
  return (state.view === 'diary' ? diaryOrder(items) : items).map((w) => w.id);
}

function commit(message) {
  saveDraft(state.data, state.baseSha);
  state.dirty = true;
  state.pending = false;
  renderAll();
  if (message) toast(message);
}

function replaceData(data, { dirty, baseSha }) {
  state.data = data;
  state.dirty = dirty;
  state.pending = false;
  state.ready = true;
  if (baseSha !== undefined) state.baseSha = baseSha;
  if (!dirty) state.conflict = false;
  if (dirty) saveDraft(data, state.baseSha);
  renderAll();
}

function startEditor(work = null) {
  if (!state.ready) {
    toast('数据还没有加载成功，暂时不能编辑', 'error');
    return;
  }
  openEditor(work);
}

// ---------- Archive ----------

function renderIntro() {
  const works = state.data.works;
  const done = works.filter((w) => w.status === 'completed').length;
  const avg = mean(works.map((w) => w.score));
  const year = String(new Date().getFullYear());
  const thisYear = works.filter((w) => finishedYear(w) === year).length;
  els.introStats.innerHTML = [
    ['收录', works.length],
    ['已完成', done],
    ['平均分', avg === null ? '—' : avg.toFixed(1)],
    [`${year} 年看完`, thisYear]
  ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
}

function renderFilters(resultCount) {
  const f = state.filters;
  const works = state.data.works;

  const counts = {};
  for (const w of works) counts[w.category] = (counts[w.category] || 0) + 1;
  const tabs = [{ id: 'all', label: '全部', count: works.length }, ...CATEGORIES.map((c) => ({ ...c, count: counts[c.id] || 0 }))];
  els.catTabs.innerHTML = tabs.map((t) =>
    `<button type="button" class="cat-tab" data-cat="${t.id}" aria-pressed="${f.category === t.id}">${esc(t.label)}<span class="cat-tab-count">${t.count}</span></button>`
  ).join('');

  els.subChips.hidden = f.category !== 'novel';
  if (f.category === 'novel') {
    const subs = [{ id: 'all', label: '全部小说' }, ...NOVEL_SUBTYPES];
    els.subChips.innerHTML = subs.map((s) => {
      const n = s.id === 'all' ? counts.novel || 0 : works.filter((w) => w.subCategory === s.id).length;
      return `<button type="button" class="chip" data-sub="${s.id}" aria-pressed="${f.sub === s.id}">${esc(s.label)} ${n}</button>`;
    }).join('');
  }

  const years = statsYears(works);
  if (f.year !== 'all' && !years.includes(f.year)) years.unshift(f.year);
  els.fYear.innerHTML = `<option value="all">全部年份</option>${years.map((y) => `<option value="${esc(y)}">${esc(y)} 年看完</option>`).join('')}`;
  els.fYear.value = f.year;
  els.fStatus.value = f.status;
  els.fSort.value = state.sort.key;
  els.fSort.disabled = state.view === 'diary';
  els.fSort.title = state.view === 'diary' ? '日记视图按日期排列' : '';
  els.fHof.setAttribute('aria-pressed', String(f.hof));
  // Compare trimmed: rewriting the box mid-typing would swallow trailing spaces.
  if (els.q.value.trim() !== f.q) els.q.value = f.q;
  for (const b of els.viewSwitch.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
  els.densitySwitch.hidden = state.view !== 'wall';
  for (const b of els.densitySwitch.querySelectorAll('[data-density]')) b.setAttribute('aria-pressed', String(b.dataset.density === state.density));

  const total = works.length;
  els.resultCount.textContent = resultCount === total ? `共 ${total} 部` : `${total} 部中找到 ${resultCount} 部`;
  const pills = [];
  if (f.tag) pills.push(`<button type="button" class="filter-pill" data-clear="tag" aria-label="移除标签筛选 ${esc(f.tag)}">#${esc(f.tag)}${icon('x')}</button>`);
  if (f.q) pills.push(`<button type="button" class="filter-pill" data-clear="q" aria-label="清除搜索">“${esc(f.q)}”${icon('x')}</button>`);
  if (filtersActive()) pills.push('<button type="button" class="link-btn" data-clear="all">清除全部筛选</button>');
  els.activeFilters.innerHTML = pills.join('');
}

function renderArchive() {
  const items = sortWorks(filteredWorks());
  renderIntro();
  renderFilters(items.length);
  els.archiveView.dataset.density = state.density;

  if (!state.ready) {
    els.archiveView.innerHTML = '<div class="empty"><p class="empty-title">没能读取数据</p><p>data/works.json 加载失败，可能是网络问题。</p><button type="button" class="btn" data-action="reload">重新加载</button></div>';
    return;
  }
  if (!state.data.works.length) {
    els.archiveView.innerHTML = `<div class="empty"><p class="empty-title">还没有记录</p><p>点右上角的「记录」，添加第一部作品。</p><button type="button" class="btn btn-primary" data-action="new">${icon('plus')}记录作品</button></div>`;
    return;
  }
  if (!items.length) {
    els.archiveView.innerHTML = '<div class="empty"><p class="empty-title">没有符合条件的作品</p><button type="button" class="btn" data-clear="all">清除全部筛选</button></div>';
    return;
  }
  if (state.view === 'list') els.archiveView.innerHTML = renderList(items, state.sort);
  else if (state.view === 'diary') els.archiveView.innerHTML = renderDiary(items);
  else els.archiveView.innerHTML = renderWall(items);
  primeImages(els.archiveView);
}

/** Placeholder wall shown while works.json is loading. */
function renderSkeleton() {
  const card = '<li class="card"><div class="cover is-skeleton"></div><div class="sk-line"></div><div class="sk-line is-short"></div></li>';
  els.archiveView.innerHTML = `<ul class="wall" aria-hidden="true">${card.repeat(14)}</ul>`;
}

/** Covers that are still downloading fade in once they arrive (see the load listener). */
function primeImages(root) {
  for (const img of root.querySelectorAll('img')) {
    if (!img.complete) img.classList.add('is-pending');
  }
}

/** Restart a one-shot CSS animation class on an element. */
const playTimers = new WeakMap();
function play(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  const timers = playTimers.get(el) || {};
  clearTimeout(timers[cls]);
  timers[cls] = setTimeout(() => el.classList.remove(cls), 1200);
  playTimers.set(el, timers);
}

// ---------- Stats ----------

function renderStatsPage() {
  const works = state.data.works;
  const years = statsYears(works);
  if (state.statsYear !== 'all' && !years.includes(state.statsYear)) state.statsYear = 'all';
  els.statsYears.innerHTML = ['all', ...years].map((y) =>
    `<button type="button" data-year="${esc(y)}" aria-pressed="${state.statsYear === y}">${y === 'all' ? '全部' : esc(y)}</button>`
  ).join('');
  els.statsSub.textContent = statsSubtitle(works, state.statsYear);
  els.statsBody.innerHTML = renderStats(works, state.statsYear);
  primeImages(els.statsBody);
}

// ---------- Shell ----------

function renderFooter() {
  const latest = state.data.works.reduce((m, w) => ((w.updatedAt || '') > m ? w.updatedAt : m), '');
  els.footerMeta.textContent = latest ? `最近更新 ${formatDate(latest)}` : '';
}

function updateSyncDot() {
  els.syncDot.hidden = !state.dirty;
  const label = state.dirty ? '数据与同步（有未同步的修改）' : '数据与同步';
  els.btnSync.setAttribute('aria-label', label);
  els.btnSync.title = label;
}

/**
 * Colour field behind the page header: the current work's cover on a work page,
 * otherwise the most recent covers.
 */
let ambientKey = '';
function renderAmbient() {
  let srcs;
  const current = state.page === 'work' ? findWork(state.workId) : null;
  if (current) {
    srcs = [coverSrc(current)];
  } else {
    const works = state.data.works;
    const finished = works
      .filter((w) => w.status === 'completed' && w.completedAt)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    const used = new Set(finished);
    const others = works.filter((w) => !used.has(w)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    srcs = [...finished, ...others].slice(0, 6).map(coverSrc);
  }
  const key = srcs.join('|');
  if (key === ambientKey) return;
  ambientKey = key;
  els.ambient.innerHTML = srcs.length
    ? `<div class="ambient-strip">${srcs.map((s) => `<img src="${esc(s)}" alt="" decoding="async" referrerpolicy="no-referrer">`).join('')}</div>`
    : '';
  primeImages(els.ambient);
}

function renderAll() {
  renderArchive();
  if (state.page === 'stats') renderStatsPage();
  if (state.page === 'work' && !renderWorkInto(state.workId)) leaveWork();
  renderAmbient();
  updateSyncDot();
  renderFooter();
}

const PAGES = { archive: 'pageArchive', stats: 'pageStats', work: 'pageWork' };
const scrollMemory = { archive: 0, stats: 0 };

function showPage(page) {
  const from = state.page;
  if (from !== page && scrollMemory[from] !== undefined) scrollMemory[from] = window.scrollY;
  state.page = page;
  for (const [name, key] of Object.entries(PAGES)) els[key].hidden = name !== page;
  if (from !== page && !transitioning) play(els[PAGES[page]], 'is-switching');
  if (page !== 'work') {
    currentBand = null;
    syncTopbarBand();
  }
  const navTarget = page === 'stats' ? 'stats' : 'archive';
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === navTarget) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (page === 'stats') {
    document.title = '统计 · 余録';
    renderStatsPage();
  } else if (page === 'archive') {
    document.title = '余録 · 书影游记录';
    renderArchive();
  }
  return from;
}

// ---------- History & cover transitions ----------

let lastHash = location.hash;
let routeWaiters = [];

/** Change the URL ourselves; the matching hashchange/popstate is then ignored. */
function setHash(hash, { push = false } = {}) {
  history[push ? 'pushState' : 'replaceState'](null, '', hash);
  lastHash = location.hash;
}

/** Back/forward buttons and plain links: route once per real URL change. */
function onLocationChange() {
  if (location.hash === lastHash) return;
  lastHash = location.hash;
  applyRoute();
  const waiters = routeWaiters;
  routeWaiters = [];
  for (const resolve of waiters) resolve();
}

const VT_COVER = 'work-cover';
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
let transitioning = false;

function canMorph() {
  return typeof document.startViewTransition === 'function' && !reducedMotion?.matches && document.visibilityState === 'visible';
}

function inViewport(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

/** Resolve once an image can be painted (or after a short timeout), so snapshots never show an empty frame. */
function imageReady(img, timeout = 400) {
  if (!img) return Promise.resolve();
  img.classList.remove('is-pending');
  if (img.complete && img.naturalWidth) return Promise.resolve();
  const ready = typeof img.decode === 'function'
    ? img.decode().catch(() => {})
    : new Promise((resolve) => img.addEventListener('load', resolve, { once: true }));
  return Promise.race([ready, new Promise((resolve) => setTimeout(resolve, timeout))]);
}

/** The cover (or list thumbnail) of a work on the page that is showing now. */
function coverOnPage(id) {
  const page = els[PAGES[state.page]];
  if (!page || page.hidden) return null;
  for (const link of page.querySelectorAll('a[data-work-link]')) {
    if (link.dataset.workLink === id) return link.querySelector('.cover, .thumb');
  }
  return null;
}

/*
 * Scroll lock for the length of a transition. The animated cover lives in a fixed overlay
 * whose end position is measured when the new page is captured; scrolling during the
 * animation would move the real cover away from it, so wheel, touch and keyboard
 * scrolling are held until the new page is fully in place.
 */
const SCROLL_KEYS = new Set([' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown']);
let scrollLocks = 0;
function preventScroll(e) {
  e.preventDefault();
}
function preventScrollKeys(e) {
  if (SCROLL_KEYS.has(e.key) && !e.target.closest?.('input, textarea, select, [contenteditable="true"]')) e.preventDefault();
}
function lockScroll() {
  if (scrollLocks++ > 0) return;
  document.documentElement.classList.add('is-scroll-locked');
  window.addEventListener('wheel', preventScroll, { passive: false });
  window.addEventListener('touchmove', preventScroll, { passive: false });
  window.addEventListener('keydown', preventScrollKeys, true);
}
function unlockScroll() {
  if (scrollLocks === 0 || --scrollLocks > 0) return;
  document.documentElement.classList.remove('is-scroll-locked');
  window.removeEventListener('wheel', preventScroll);
  window.removeEventListener('touchmove', preventScroll);
  window.removeEventListener('keydown', preventScrollKeys, true);
}

/**
 * Run a route change as a view transition: the cover `from` (in the current view)
 * morphs into the cover `findTo()` returns in the new view, everything else crossfades.
 * Scrolling is locked until the transition has finished.
 * Falls back to an instant change without View Transitions or with reduced motion.
 */
let morphSeq = 0;

function morph(update, { from = null, findTo = null, mode = '' } = {}) {
  if (!canMorph()) return Promise.resolve(update());
  const seq = ++morphSeq;
  const root = document.documentElement;
  lockScroll();
  transitioning = true;
  // 'step' (prev / next): the cover crossfades in place and the text slides (see components.css)
  if (mode) root.dataset.vt = mode;
  else delete root.dataset.vt;
  // The clicked cover keeps its hover look in the snapshot; it fades out while the cover flies.
  if (from) from.style.viewTransitionName = VT_COVER;
  let to = null;
  const vt = document.startViewTransition(async () => {
    if (from) from.style.viewTransitionName = '';
    // The old view is captured by now, so the new view's elements can take their incoming names.
    if (mode) root.dataset.vt = `${mode}-in`;
    // The new view holds still while it animates: the top bar takes its colours at once,
    // and the cover glow and ambient field settle in after landing.
    root.classList.add('is-morphing');
    await update();
    to = findTo ? findTo() : null;
    if (to && !inViewport(to)) to = null;
    if (to) {
      to.style.viewTransitionName = VT_COVER;
      await imageReady(to.querySelector('img'));
    }
  });
  // Never leave the page frozen: if the old view cannot be captured quickly (no frames,
  // e.g. an occluded window), skip straight to the new page; and cap the whole run.
  const stall = setTimeout(() => vt.skipTransition?.(), 350);
  vt.ready.then(() => clearTimeout(stall), () => clearTimeout(stall));
  const guard = setTimeout(() => vt.skipTransition?.(), 1500);
  return vt.finished.catch(() => {}).finally(() => {
    clearTimeout(stall);
    clearTimeout(guard);
    if (to) to.style.viewTransitionName = '';
    // A newer transition that interrupted this one owns the page state now.
    if (seq === morphSeq) {
      transitioning = false;
      root.classList.remove('is-morphing');
      delete root.dataset.vt;
    }
    unlockScroll();
  });
}

const detailCover = () => els.workBody.querySelector('.detail-cover .cover');

let openSeq = 0;

/** Open a work from a link in a list: its cover flies into the work page. */
function openWork(id, link) {
  const seq = ++openSeq;
  const at = location.hash;
  // Sample the cover before the transition starts (a few ms for a cached image, capped), so the
  // new page is captured already coloured. The list stays live meanwhile; a newer click or a
  // route change in between cancels this one.
  const ready = canMorph() ? paletteFor(findWork(id)) : Promise.resolve();
  ready.then(() => {
    if (seq !== openSeq || location.hash !== at) return;
    cameFromApp = true;
    const from = link?.querySelector('.cover, .thumb') || null;
    morph(() => {
      setHash(workHref(id), { push: true });
      applyRoute();
    }, { from: from && inViewport(from) ? from : null, findTo: detailCover });
  });
}

// ---------- Work page ----------

let cameFromApp = false; // the work page was opened from a link inside the site
let returnPage = 'archive'; // where "返回" leads when there is no in-app history

function renderWorkInto(id) {
  const work = findWork(id);
  if (!work) return false;
  const ids = orderedIds();
  const i = ids.indexOf(id);
  const prev = i > 0 ? findWork(ids[i - 1]) : null;
  const next = i !== -1 && i < ids.length - 1 ? findWork(ids[i + 1]) : null;
  els.workBody.innerHTML = renderWorkPage(work, {
    prev,
    next,
    pos: i === -1 ? 0 : i + 1,
    total: ids.length,
    backLabel: returnPage === 'stats' ? '统计' : '档案'
  });
  primeImages(els.workBody);
  document.title = `${work.title} · 余録`;
  applyBand(work);
  warmPalettes([prev, next]);
  return true;
}

// ---------- Cover colours on the work page ----------

let currentBand = null; // { workId, scheme }
// Cover URLs that failed to load during this visit: their generated cover stands in, and so does its colour.
const brokenCovers = new Set();

/** Colours already known for a work (instant), or null. Generated covers use their category tone. */
function knownPalette(work) {
  if (!work) return null;
  const url = String(work.coverUrl || '').trim();
  if (!hasCoverImage(work) || brokenCovers.has(url)) return { dominant: coverTone(work.category), accent: null };
  return cachedPalette(url);
}

/** Sample covers in spare time (the work page's neighbours), so ←/→ lands on an already coloured page. */
function warmPalettes(works, { now = false } = {}) {
  const urls = works.filter((w) => w && !knownPalette(w)).map((w) => w.coverUrl.trim());
  if (!urls.length) return;
  const run = () => urls.forEach((url) => extractPalette(url));
  // A work the reader is reaching for is sampled right away (its cover is already on screen).
  if (now) return run();
  if (navigator.connection?.saveData) return;
  const later = window.requestIdleCallback
    ? (fn) => window.requestIdleCallback(fn, { timeout: 1500 })
    : (fn) => setTimeout(fn, 300);
  later(run);
}

/** Colours for a work, waiting at most `wait` ms for its cover to be sampled. */
function paletteFor(work, wait = 260) {
  const known = knownPalette(work);
  if (known || !work) return Promise.resolve(known);
  return Promise.race([extractPalette(work.coverUrl.trim()), new Promise((resolve) => setTimeout(() => resolve(null), wait))]);
}

function paintBand(work, palette) {
  const band = els.workBody.querySelector('.work-band');
  if (!band || state.page !== 'work' || state.workId !== work.id) return;
  const scheme = bandScheme(palette, { dark: document.documentElement.dataset.theme === 'dark' });
  for (const [key, value] of Object.entries(scheme.vars)) band.style.setProperty(key, value);
  band.dataset.tone = scheme.tone;
  // Marks and links in the reading area use the cover's accent, tuned to the page background.
  const root = getComputedStyle(document.documentElement);
  const accent = pageAccent(palette, root.getPropertyValue('--page-bg').trim(), root.getPropertyValue('--ink').trim());
  const main = els.workBody.querySelector('.work-main');
  main?.style.setProperty('--work-accent', accent.mark);
  main?.style.setProperty('--work-accent-ink', accent.text);
  currentBand = { workId: work.id, scheme };
  syncTopbarBand();
}

function applyBand(work) {
  currentBand = null;
  syncTopbarBand();
  if (!work) return;
  const known = knownPalette(work);
  if (known) {
    paintBand(work, known);
    return;
  }
  extractPalette(work.coverUrl.trim()).then((palette) => {
    if (palette) paintBand(work, palette);
  });
}

/** While the coloured header sits under the top bar, the bar takes the header's colours. */
function syncTopbarBand() {
  const bar = els.topbar;
  if (!bar) return;
  const band = currentBand && state.page === 'work' && state.workId === currentBand.workId
    ? els.workBody.querySelector('.work-band[data-tone]') : null;
  const under = Boolean(band) && band.getBoundingClientRect().bottom > bar.offsetHeight + 12;
  const want = under ? currentBand.scheme : null;
  if (bar.bandScheme === want) return;
  for (const key of Object.keys(bar.bandScheme?.vars || {})) bar.style.removeProperty(key);
  bar.bandScheme = want;
  if (want) for (const [key, value] of Object.entries(want.vars)) bar.style.setProperty(key, value);
  applyThemeMeta();
}

function stepWork(delta) {
  const ids = orderedIds();
  const i = ids.indexOf(state.workId);
  const next = ids[i + delta];
  if (i === -1 || !next) return;
  // Replace, so "返回" still leads to the list rather than through every neighbour.
  // (The neighbours' colours were sampled when this page rendered, so there is nothing to wait for.)
  // The page slides a little in the direction of travel (see the "step" rules in components.css).
  document.documentElement.style.setProperty('--vt-dir', delta > 0 ? '1' : '-1');
  morph(async () => {
    setHash(workHref(next));
    state.workId = next;
    renderWorkInto(next);
    renderAmbient();
    window.scrollTo(0, 0);
    // Capture the new page with its cover drawn, not halfway through loading
    await imageReady(detailCover()?.querySelector('img'));
  }, { mode: 'step' });
}

/** Back to wherever the work page was opened from; the cover flies back into the list. */
function goBack() {
  const id = state.workId;
  const update = () => new Promise((resolve) => {
    if (cameFromApp) {
      routeWaiters.push(resolve);
      history.back();
      setTimeout(resolve, 800); // in case the browser reports no URL change
    } else {
      setHash(returnPage === 'stats' ? '#/stats' : '#/');
      applyRoute();
      resolve();
    }
  });
  morph(update, { from: detailCover(), findTo: () => coverOnPage(id) });
}

/** Leave a work page that can no longer be shown (deleted, or missing). */
function leaveWork() {
  cameFromApp = false;
  setHash(returnPage === 'stats' ? '#/stats' : '#/');
  applyRoute();
}

async function copyWorkLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    toast('链接已复制');
  } catch {
    toast('复制失败，请直接复制地址栏里的链接', 'error');
  }
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (raw.startsWith('w/')) {
    let id = raw.slice(2);
    try { id = decodeURIComponent(id); } catch { /* keep raw */ }
    return { page: 'work', workId: id };
  }
  return { page: raw === 'stats' ? 'stats' : 'archive', workId: null };
}

function applyRoute({ initial = false } = {}) {
  const route = parseHash();
  if (route.page === 'work') {
    if (!findWork(route.workId)) {
      setHash('#/');
      cameFromApp = false;
      state.workId = null;
      showPage('archive');
      toast('找不到这条记录', 'error');
      return;
    }
    if (state.page !== 'work') returnPage = initial ? 'archive' : state.page;
    state.workId = route.workId;
    showPage('work');
    renderWorkInto(route.workId);
    renderAmbient();
    window.scrollTo(0, 0);
    return;
  }
  cameFromApp = false;
  state.workId = null;
  const from = showPage(route.page);
  renderAmbient();
  if (initial) return;
  if (from === 'work') window.scrollTo(0, scrollMemory[route.page] || 0);
  else if (from !== route.page) window.scrollTo(0, 0);
}

/** Show the archive with new filters (from a tag or a stats chart). */
function goToArchive(filters) {
  state.filters = { ...defaultFilters(), ...filters };
  cameFromApp = false;
  state.workId = null;
  if (location.hash !== '#/' && location.hash !== '') setHash('#/');
  showPage('archive');
  renderAmbient();
  els.filtersTop.scrollIntoView({ block: 'start' });
}

// ---------- Theme ----------

function applyThemeMeta() {
  const dark = document.documentElement.dataset.theme === 'dark';
  els.themeMeta.content = els.topbar?.bandScheme ? els.topbar.bandScheme.bg : (dark ? '#121211' : '#f6f5f2');
  els.btnTheme.setAttribute('aria-label', dark ? '切换到浅色' : '切换到深色');
}

function setupTheme() {
  applyThemeMeta();
  els.btnTheme.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    writePref(THEME_KEY, next);
    applyThemeMeta();
    if (state.page === 'work') applyBand(findWork(state.workId));
  });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
    let stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
    if (stored) return;
    document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
    applyThemeMeta();
    if (state.page === 'work') applyBand(findWork(state.workId));
  });
}

// ---------- Events ----------

function setFilter(patch) {
  Object.assign(state.filters, patch);
  renderArchive();
}

function setupEvents() {
  els.btnNew.addEventListener('click', () => startEditor(null));
  els.btnSync.addEventListener('click', openSyncDialog);

  // "#main" is not a route: move focus without touching the hash router.
  document.getElementById('skip-link').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('main').focus();
  });

  els.catTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (btn) setFilter({ category: btn.dataset.cat, sub: 'all' });
  });
  els.subChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sub]');
    if (btn) setFilter({ sub: btn.dataset.sub });
  });

  let qTimer = 0;
  els.q.addEventListener('input', () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => setFilter({ q: els.q.value.trim() }), 90);
  });
  els.fStatus.addEventListener('change', () => setFilter({ status: els.fStatus.value }));
  els.fYear.addEventListener('change', () => setFilter({ year: els.fYear.value }));
  els.fSort.addEventListener('change', () => {
    const key = els.fSort.value;
    state.sort = { key, dir: SORT_DEFAULT_DIR[key] || 'desc' };
    renderArchive();
  });
  els.fHof.addEventListener('click', () => setFilter({ hof: !state.filters.hof }));
  els.viewSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn || !VIEWS.includes(btn.dataset.view)) return;
    if (btn.dataset.view === state.view) return;
    state.view = btn.dataset.view;
    writePref(VIEW_KEY, state.view);
    renderArchive();
    play(els.archiveView, 'is-switching');
  });
  els.densitySwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-density]');
    if (!btn || !DENSITIES.includes(btn.dataset.density) || btn.dataset.density === state.density) return;
    state.density = btn.dataset.density;
    writePref(DENSITY_KEY, state.density);
    renderArchive();
    play(els.archiveView, 'is-switching');
  });

  // Clear buttons live in the result bar and in the empty state.
  els.pageArchive.addEventListener('click', (e) => {
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      const what = clear.dataset.clear;
      if (what === 'all') state.filters = defaultFilters();
      else if (what === 'tag') state.filters.tag = '';
      else if (what === 'q') state.filters.q = '';
      renderArchive();
      return;
    }
    if (e.target.closest('[data-action="new"]')) {
      startEditor(null);
      return;
    }
    if (e.target.closest('[data-action="reload"]')) {
      location.reload();
      return;
    }
    const sortBtn = e.target.closest('[data-sort-key]');
    if (sortBtn) {
      const key = sortBtn.dataset.sortKey;
      state.sort = state.sort.key === key
        ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: SORT_DEFAULT_DIR[key] || 'desc' };
      renderArchive();
      els.archiveView.querySelector(`[data-sort-key="${key}"]`)?.focus();
    }
  });

  // Sample a work's cover colours as soon as the reader reaches for it (hover, touch, focus),
  // so a click can start the cover transition at once instead of waiting for them.
  const warmLink = (e) => {
    const link = e.target.closest?.('a[data-work-link]');
    if (link) warmPalettes([findWork(link.dataset.workLink)], { now: true });
  };
  document.addEventListener('pointerover', warmLink, { passive: true });
  document.addEventListener('pointerdown', warmLink, { passive: true });
  document.addEventListener('focusin', warmLink);

  // In-app links to a work open it with the cover transition (new-tab clicks stay normal).
  document.addEventListener('click', (e) => {
    const link = e.target.closest?.('a[data-work-link]');
    if (link && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
      e.preventDefault();
      openWork(link.dataset.workLink, link);
      return;
    }
    const spoiler = e.target.closest?.('.spoiler');
    if (spoiler) {
      const open = spoiler.getAttribute('aria-pressed') === 'true';
      spoiler.setAttribute('aria-pressed', String(!open));
    }
  });

  // Stats interactions
  els.statsYears.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-year]');
    if (!btn) return;
    state.statsYear = btn.dataset.year;
    renderStatsPage();
  });
  els.statsBody.addEventListener('click', (e) => {
    const cat = e.target.closest('[data-stats-cat]');
    if (cat) {
      goToArchive({ category: cat.dataset.statsCat, year: state.statsYear === 'all' ? 'all' : state.statsYear });
      return;
    }
    const tag = e.target.closest('[data-tag]');
    if (tag) goToArchive({ tag: tag.dataset.tag, year: state.statsYear === 'all' ? 'all' : state.statsYear });
  });

  // Work page: back, neighbours, copy link, edit, tags
  els.pageWork.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (action) {
      const work = findWork(state.workId);
      if (action.dataset.action === 'back') goBack();
      else if (action.dataset.action === 'prev') stepWork(-1);
      else if (action.dataset.action === 'next') stepWork(1);
      else if (action.dataset.action === 'copy') copyWorkLink();
      else if (action.dataset.action === 'edit' && work) startEditor(work);
      return;
    }
    const step = e.target.closest('[data-work-step]');
    if (step && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
      e.preventDefault();
      stepWork(Number(step.dataset.workStep));
      return;
    }
    const tag = e.target.closest('[data-tag]');
    if (tag) goToArchive({ tag: tag.dataset.tag });
  });

  // Covers fade in when they arrive instead of popping in.
  document.addEventListener('load', (e) => {
    if (e.target instanceof HTMLImageElement) e.target.classList.remove('is-pending');
  }, true);

  // The top bar gets its hairline only once the page has scrolled under it.
  const topbar = document.querySelector('.topbar');
  const syncTopbar = () => {
    topbar.classList.toggle('is-scrolled', window.scrollY > 2);
    syncTopbarBand();
  };
  window.addEventListener('scroll', syncTopbar, { passive: true });
  syncTopbar();

  // Cover images that fail to load fall back to a generated cover.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const id = img.dataset.coverId;
    if (!id || img.dataset.fallback) {
      img.classList.remove('is-pending');
      return;
    }
    img.dataset.fallback = '1';
    const work = findWork(id);
    img.src = fallbackCover(work || { title: '', category: 'novel' });
    if (work && hasCoverImage(work)) {
      // Remembered, so later paints (theme change, re-render, reopening) use the stand-in's colour too.
      brokenCovers.add(work.coverUrl.trim());
      if (img.closest('.work-band')) paintBand(work, knownPalette(work));
    }
  }, true);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (typing || document.querySelector('dialog[open]')) return;
    if (state.page === 'work') {
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepWork(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepWork(1); return; }
      if (e.key === 'Escape') { e.preventDefault(); goBack(); return; }
    }
    if (e.key === '/') {
      e.preventDefault();
      if (state.page !== 'archive') {
        setHash('#/', { push: true });
        applyRoute();
      }
      els.q.focus();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      startEditor(null);
    }
  });

  window.addEventListener('hashchange', onLocationChange);
  window.addEventListener('popstate', onLocationChange);
}

// ---------- Boot ----------

async function init() {
  const ids = {
    pageArchive: 'page-archive', pageStats: 'page-stats', introStats: 'intro-stats',
    catTabs: 'cat-tabs', subChips: 'sub-chips', q: 'q', fStatus: 'f-status', fYear: 'f-year',
    fSort: 'f-sort', fHof: 'f-hof', resultCount: 'result-count', activeFilters: 'active-filters',
    archiveView: 'archive-view', statsYears: 'stats-years', statsSub: 'stats-sub', statsBody: 'stats-body',
    footerMeta: 'footer-meta', syncDot: 'sync-dot', btnSync: 'btn-sync', btnTheme: 'btn-theme',
    btnNew: 'btn-new', pageWork: 'page-work', workBody: 'work-body',
    chartTip: 'chart-tip', toast: 'toast', ambient: 'ambient'
  };
  for (const [key, id] of Object.entries(ids)) els[key] = document.getElementById(id);
  els.viewSwitch = document.querySelector('.view-switch');
  els.densitySwitch = document.getElementById('density-switch');
  els.filtersTop = document.querySelector('.filters');
  els.themeMeta = document.querySelector('meta[name="theme-color"]');
  els.topbar = document.querySelector('.topbar');

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  state.view = readPref(VIEW_KEY, 'wall', VIEWS);
  state.density = readPref(DENSITY_KEY, '7', DENSITIES);
  hydrateIcons(document);
  setupTheme();
  setupEvents();
  bindChartTips(els.statsBody, els.chartTip);

  setupEditor({
    onSave(work, isNew) {
      const list = state.data.works;
      const i = list.findIndex((w) => w.id === work.id);
      if (i >= 0) list[i] = work;
      else list.unshift(work);
      const hidden = isNew && !filteredWorks().some((w) => w.id === work.id);
      commit(`已保存「${work.title}」${hidden ? '（被当前筛选隐藏了）' : ''}`);
    },
    onDelete(id) {
      const work = findWork(id);
      state.data.works = state.data.works.filter((w) => w.id !== id);
      // Replace (not go back): the deleted work's URL must not stay current.
      if (state.page === 'work' && state.workId === id) leaveWork();
      commit(work ? `已删除「${work.title}」` : '已删除');
    }
  });

  setupSyncDialog({
    getData: () => state.data,
    getSyncState: () => ({ dirty: state.dirty, pending: state.pending, baseSha: state.baseSha, conflict: state.conflict }),
    setSyncState(patch) {
      for (const key of ['dirty', 'pending', 'baseSha', 'conflict']) {
        if (key in patch) state[key] = patch[key];
      }
      updateSyncDot();
    },
    replaceData,
    toast
  });

  if (!parseHash().page || parseHash().page === 'archive') renderSkeleton();
  const { data, isDirty, pending, remoteOk, baseSha, conflict } = await loadInitialData();
  state.data = data;
  state.dirty = isDirty;
  state.pending = pending;
  state.baseSha = baseSha;
  state.conflict = conflict;
  state.ready = remoteOk || isDirty || pending || data.works.length > 0;
  updateSyncDot();
  renderFooter();
  renderAmbient();
  applyRoute({ initial: true });
  if (state.page === 'archive' && state.view === 'wall') play(els.archiveView, 'is-entering');
  if (!state.ready) toast('没能读取 data/works.json', 'error');
  else if (conflict) toast('线上数据在你上次编辑后有更新，详情见「数据与同步」', 'error');
}

init();
