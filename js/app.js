// 余録 · YUROKU — app shell: state, hash routing, filters, rendering, shortcuts

import { CATEGORIES, NOVEL_SUBTYPES, esc, mean, normalizeText, finishedYear, formatDate } from './meta.js';
import { icon, hydrateIcons } from './icons.js';
import { fallbackCover } from './markdown.js';
import { loadInitialData, saveDraft } from './sync.js';
import { renderWall, renderList, renderDiary, diaryOrder, renderDetail, workHref } from './views.js';
import { renderStats, statsYears, statsSubtitle, bindChartTips } from './charts.js';
import { setupEditor, openEditor, isEditorOpen } from './editor.js';
import { setupSyncDialog, openSyncDialog } from './sync-ui.js';

const VIEW_KEY = 'yuroku_view';
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
  detailId: null,
  filters: defaultFilters(),
  sort: { key: 'recent', dir: 'desc' },
  view: 'wall',
  statsYear: 'all'
};

const els = {};
let detailFromApp = false;

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

/** Ids in the order they appear on screen (drives prev/next in the detail). */
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

function renderAll() {
  renderArchive();
  if (state.page === 'stats') renderStatsPage();
  if (state.detailId && els.detail.open) {
    if (findWork(state.detailId)) renderDetailInto(state.detailId);
    else closeDetail();
  }
  updateSyncDot();
  renderFooter();
}

function showPage(page) {
  const changed = state.page !== page;
  state.page = page;
  els.pageArchive.hidden = page !== 'archive';
  els.pageStats.hidden = page !== 'stats';
  if (changed) play(page === 'stats' ? els.pageStats : els.pageArchive, 'is-switching');
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === page) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = page === 'stats' ? '统计 · 余録' : '余録 · 书影游记录';
  if (page === 'stats') renderStatsPage();
  else renderArchive();
}

// ---------- Detail ----------

function renderDetailInto(id) {
  const work = findWork(id);
  if (!work) return;
  els.detailBody.innerHTML = renderDetail(work);
  primeImages(els.detailBody);
  const ids = orderedIds();
  const i = ids.indexOf(id);
  els.detailPrev.disabled = i <= 0;
  els.detailNext.disabled = i === -1 || i >= ids.length - 1;
  els.detailPos.textContent = i === -1 ? '' : `${i + 1} / ${ids.length}`;
}

function openDetail(id) {
  state.detailId = id;
  renderDetailInto(id);
  els.detailBody.scrollTop = 0;
  if (!els.detail.open) {
    els.detail.showModal();
    els.detail.querySelector('[data-close]').focus({ preventScroll: true });
  }
}

function stepDetail(delta) {
  const ids = orderedIds();
  const i = ids.indexOf(state.detailId);
  const next = ids[i + delta];
  if (i === -1 || !next) return;
  history.replaceState(null, '', workHref(next));
  openDetail(next);
}

/** The URL already moved on (back button, filters): just close the dialog. */
function closeDetailSilently() {
  state.detailId = null;
  detailFromApp = false;
  if (els.detail.open) els.detail.close();
}

/** The user closed the detail: leave the #/w/… URL as well. */
function leaveDetailRoute() {
  state.detailId = null;
  if (!parseHash().detailId) return;
  if (detailFromApp) {
    detailFromApp = false;
    history.back();
  } else {
    history.replaceState(null, '', state.page === 'stats' ? '#/stats' : '#/');
  }
}

function closeDetail() {
  if (els.detail.open) els.detail.close();
  leaveDetailRoute();
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (raw.startsWith('w/')) {
    let id = raw.slice(2);
    try { id = decodeURIComponent(id); } catch { /* keep raw */ }
    return { page: null, detailId: id };
  }
  return { page: raw === 'stats' ? 'stats' : 'archive', detailId: null };
}

function applyRoute({ initial = false } = {}) {
  const route = parseHash();
  if (route.detailId) {
    if (initial) showPage('archive');
    if (!findWork(route.detailId)) {
      history.replaceState(null, '', '#/');
      closeDetailSilently();
      showPage('archive');
      toast('找不到这条记录', 'error');
      return;
    }
    openDetail(route.detailId);
    return;
  }
  closeDetailSilently();
  const changed = state.page !== route.page;
  showPage(route.page);
  if (changed && !initial) window.scrollTo(0, 0);
}

/** Leave a detail route and show the archive with new filters. */
function goToArchive(filters) {
  state.filters = { ...defaultFilters(), ...filters };
  if (location.hash !== '#/' && location.hash !== '') {
    history.replaceState(null, '', '#/');
  }
  closeDetailSilently();
  showPage('archive');
  els.filtersTop.scrollIntoView({ block: 'start' });
}

// ---------- Theme ----------

function applyThemeMeta() {
  const dark = document.documentElement.dataset.theme === 'dark';
  els.themeMeta.content = dark ? '#121211' : '#f6f5f2';
  els.btnTheme.setAttribute('aria-label', dark ? '切换到浅色' : '切换到深色');
}

function setupTheme() {
  applyThemeMeta();
  els.btnTheme.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    writePref(THEME_KEY, next);
    applyThemeMeta();
  });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
    let stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
    if (stored) return;
    document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
    applyThemeMeta();
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

  // Any in-app link to a work: remember that "back" should close the detail.
  document.addEventListener('click', (e) => {
    const link = e.target.closest?.('a[data-work-link]');
    if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) detailFromApp = true;
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

  // Detail dialog
  els.detailPrev.addEventListener('click', () => stepDetail(-1));
  els.detailNext.addEventListener('click', () => stepDetail(1));
  els.detail.querySelector('[data-close]').addEventListener('click', closeDetail);
  els.detailEdit.addEventListener('click', () => {
    const work = findWork(state.detailId);
    if (work) startEditor(work);
  });
  els.detailCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast('链接已复制');
    } catch {
      toast('复制失败，请直接复制地址栏里的链接', 'error');
    }
  });
  els.detailBody.addEventListener('click', (e) => {
    const tag = e.target.closest('[data-tag]');
    if (tag) goToArchive({ tag: tag.dataset.tag });
  });
  let downOnBackdrop = false;
  els.detail.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === els.detail; });
  els.detail.addEventListener('click', (e) => {
    if (e.target === els.detail && downOnBackdrop) closeDetail();
  });
  // Esc closes the dialog natively; sync the URL unless closeDetail() already did.
  els.detail.addEventListener('close', () => {
    if (state.detailId !== null) leaveDetailRoute();
  });

  // Covers fade in when they arrive instead of popping in.
  document.addEventListener('load', (e) => {
    if (e.target instanceof HTMLImageElement) e.target.classList.remove('is-pending');
  }, true);

  // The top bar gets its hairline only once the page has scrolled under it.
  const topbar = document.querySelector('.topbar');
  const syncTopbar = () => topbar.classList.toggle('is-scrolled', window.scrollY > 2);
  window.addEventListener('scroll', syncTopbar, { passive: true });
  syncTopbar();

  // Cover images that fail to load fall back to a generated cover.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.closest('.detail-wash')) { img.remove(); return; }
    const id = img.dataset.coverId;
    if (!id || img.dataset.fallback) {
      img.classList.remove('is-pending');
      return;
    }
    img.dataset.fallback = '1';
    img.src = fallbackCover(findWork(id) || { title: '', category: 'novel' });
  }, true);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (els.detail.open && !isEditorOpen()) {
      if (typing) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepDetail(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepDetail(1); }
      return;
    }
    if (typing || document.querySelector('dialog[open]')) return;
    if (e.key === '/') {
      e.preventDefault();
      if (state.page !== 'archive') {
        location.hash = '#/';
        showPage('archive');
      }
      els.q.focus();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      startEditor(null);
    }
  });

  window.addEventListener('hashchange', () => applyRoute());
}

// ---------- Boot ----------

async function init() {
  const ids = {
    pageArchive: 'page-archive', pageStats: 'page-stats', introStats: 'intro-stats',
    catTabs: 'cat-tabs', subChips: 'sub-chips', q: 'q', fStatus: 'f-status', fYear: 'f-year',
    fSort: 'f-sort', fHof: 'f-hof', resultCount: 'result-count', activeFilters: 'active-filters',
    archiveView: 'archive-view', statsYears: 'stats-years', statsSub: 'stats-sub', statsBody: 'stats-body',
    footerMeta: 'footer-meta', syncDot: 'sync-dot', btnSync: 'btn-sync', btnTheme: 'btn-theme',
    btnNew: 'btn-new', detail: 'detail-dialog', detailBody: 'detail-body', detailPrev: 'detail-prev',
    detailNext: 'detail-next', detailPos: 'detail-pos', detailEdit: 'detail-edit', detailCopy: 'detail-copy',
    chartTip: 'chart-tip', toast: 'toast'
  };
  for (const [key, id] of Object.entries(ids)) els[key] = document.getElementById(id);
  els.viewSwitch = document.querySelector('.view-switch');
  els.filtersTop = document.querySelector('.filters');
  els.themeMeta = document.querySelector('meta[name="theme-color"]');

  state.view = readPref(VIEW_KEY, 'wall', VIEWS);
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
      if (els.detail.open && state.detailId === id) {
        // Replace (not go back): the deleted work's URL must not stay current.
        detailFromApp = false;
        closeDetail();
      }
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
  applyRoute({ initial: true });
  if (state.page === 'archive' && state.view === 'wall') play(els.archiveView, 'is-entering');
  if (!state.ready) toast('没能读取 data/works.json', 'error');
  else if (conflict) toast('线上数据在你上次编辑后有更新，详情见「数据与同步」', 'error');
}

init();
