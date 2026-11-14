// 余録 · YUROKU — Main Application Controller

import { compileMarkdown, safeSetHTML, buildFallbackCoverDataUrl, escapeHtml } from './markdown.js';
import { renderDashboard, CATEGORY_META, NOVEL_SUBTYPE_LABELS } from './charts.js';
import { searchMediaMetadata, enrichBangumiSubject } from './search-api.js';
import {
  loadInitialData,
  saveDraft,
  clearDraft,
  saveToLocalRepoFile,
  serializeDataset,
  validateDataset,
  getGitHubConfig,
  saveGitHubConfig,
  pushToGitHub,
  pullFromGitHub
} from './sync.js';

const SUPPORTS_INVOKERS = 'commandForElement' in HTMLButtonElement.prototype;
if (!SUPPORTS_INVOKERS) {
  import('https://esm.run/invokers-polyfill').catch(() => {});
}

const STATUS_LABELS = {
  completed: '已完成',
  watching: '在看 / 在玩',
  planned: '想看 / 计划',
  dropped: '搁置 / 弃坑'
};

const VIEW_TITLES = {
  gallery: '海报画廊',
  hall: '个人殿堂与高分精选',
  timeline: '阅读观影时间轴',
  table: '全量归档表格'
};

const CAT_MAP = Object.fromEntries(CATEGORY_META.map((c) => [c.id, c.label]));
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

const state = {
  dataset: { version: 1, siteTitle: '余録 · YUROKU', siteSubtitle: '个人书影游私藏与批注录', works: [] },
  isDirty: false,
  category: 'all',
  subCategory: 'all',
  status: 'all',
  year: 'all',
  hallOnly: false,
  search: '',
  tag: '',
  sort: 'completedAt-desc',
  view: 'gallery',
  spotlightIndex: 0,
  initialStaggerDone: false,
  activeWorkId: null,
  editingWorkId: null,
  editorDirty: false,
  editorDiscardArmed: false,
  deleteArmed: false
};

let supportsDisplayTransition;
function canTransitionDisplay() {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    supportsDisplayTransition = false;
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit() {
  return Boolean(window.CSS?.supports?.('overlay', 'auto') && canTransitionDisplay());
}

async function closeTopLayer(dialog, returnValue) {
  if (!dialog?.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute('data-closing', '');
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 2000))
      ]);
    }
    if (!dialog.hasAttribute('data-closing')) return;
    dialog.removeAttribute('data-closing');
  }
  dialog.close(returnValue);
}

function safeWorkVtName(id) {
  return `vt-w-${String(id).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function runFilterTransition(mutator) {
  const canVt =
    Boolean(document.startViewTransition) &&
    state.dataset.works.length <= 60 &&
    !document.getElementById('gallery-grid')?.classList.contains('is-initial-stagger');
  if (!canVt) {
    mutator();
    return;
  }
  document.startViewTransition(mutator);
}

function showToast(msg) {
  const el = document.getElementById('toast-banner');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

function setupThemeToggle() {
  const meta = document.querySelector('meta[name="color-scheme"]');
  const btn = document.getElementById('theme-toggle');
  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  const applyFromStorage = () => {
    try {
      meta.content = localStorage.getItem('color-scheme') ?? 'light dark';
    } catch {
      meta.content = 'light dark';
    }
  };

  btn?.addEventListener('click', () => {
    const sysDark = mq.matches;
    const system = sysDark ? 'dark' : 'light';
    let stored = null;
    try {
      stored = localStorage.getItem('color-scheme');
    } catch {}
    const currentRendered = stored === 'dark' || stored === 'light' ? stored : system;
    const target = currentRendered === 'dark' ? 'light' : 'dark';
    try {
      if (target === system) {
        localStorage.removeItem('color-scheme');
        meta.content = 'light dark';
      } else {
        localStorage.setItem('color-scheme', target);
        meta.content = target;
      }
    } catch {
      meta.content = target;
    }
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'color-scheme') applyFromStorage();
  });
}

function setupDialogFallbacks() {
  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside =
        r.top <= event.clientY &&
        event.clientY <= r.top + r.height &&
        r.left <= event.clientX &&
        event.clientX <= r.left + r.width;
      if (!inside && (!('closedBy' in HTMLDialogElement.prototype) || !supportsTopLayerExit())) {
        closeTopLayer(dialog);
      }
    });
  }

  for (const dialog of document.querySelectorAll('dialog:not(#editor-dialog)')) {
    dialog.addEventListener('cancel', (event) => {
      if (!supportsTopLayerExit()) {
        event.preventDefault();
        closeTopLayer(dialog);
      }
    });
  }

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('button[commandfor][command]');
    if (!btn) return;
    const target = document.getElementById(btn.getAttribute('commandfor'));
    if (!target || target.tagName !== 'DIALOG') return;
    const cmd = btn.getAttribute('command');
    if (cmd === 'close' && !supportsTopLayerExit()) {
      event.preventDefault();
      closeTopLayer(target);
      return;
    }
    const nativeHandled = SUPPORTS_INVOKERS && btn.command === cmd;
    if (nativeHandled) return;
    event.preventDefault();
    if (cmd === 'show-modal' && typeof target.showModal === 'function' && !target.open) {
      target.showModal();
    } else if (cmd === 'close' && typeof target.close === 'function') {
      closeTopLayer(target);
    } else if (cmd === 'request-close' && typeof target.requestClose === 'function') {
      target.requestClose();
    } else if (cmd === 'request-close' && typeof target.close === 'function') {
      const cancelEv = new Event('cancel', { cancelable: true });
      if (target.dispatchEvent(cancelEv)) closeTopLayer(target);
    } else if (cmd.startsWith('--')) {
      const customEv = new Event('command');
      customEv.command = cmd;
      customEv.source = btn;
      target.dispatchEvent(customEv);
    }
  });

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('button[commandfor][command^="--"]');
    if (!btn) return;
    const cmd = btn.getAttribute('command');
    if (SUPPORTS_INVOKERS && btn.command === cmd) return;
    const target = document.getElementById(btn.getAttribute('commandfor'));
    if (!target || target.tagName === 'DIALOG') return;
    event.preventDefault();
    const customEv = new Event('command');
    customEv.command = cmd;
    customEv.source = btn;
    target.dispatchEvent(customEv);
  });
}

function categoryBadgeLabel(work) {
  if (work.category === 'novel' && NOVEL_SUBTYPE_LABELS[work.subCategory]) {
    return `日本小说 · ${NOVEL_SUBTYPE_LABELS[work.subCategory]}`;
  }
  return CAT_MAP[work.category] || work.category;
}

function getCoverSrc(work) {
  return work.coverUrl ? work.coverUrl : buildFallbackCoverDataUrl(work);
}

function attachCoverFallback(container, worksById) {
  for (const img of container.querySelectorAll('img[data-work-id]')) {
    img.addEventListener('error', () => {
      if (img.dataset.fallbackApplied) return;
      img.dataset.fallbackApplied = '1';
      const w = worksById.get(img.dataset.workId);
      img.src = buildFallbackCoverDataUrl(w || { title: img.alt });
    });
  }
}

function getFilteredWorks() {
  const q = state.search.trim().toLowerCase();
  const filtered = state.dataset.works.filter((w) => {
    if (state.category !== 'all' && w.category !== state.category) return false;
    if (state.category === 'novel' && state.subCategory !== 'all' && w.subCategory !== state.subCategory) {
      return false;
    }
    if (state.status !== 'all' && w.status !== state.status) return false;
    if (state.year !== 'all' && !String(w.completedAt || '').startsWith(state.year)) return false;
    if (state.hallOnly && !w.hallOfFame) return false;
    if (state.tag && !w.tags.includes(state.tag)) return false;
    if (q) {
      const hay = `${w.title} ${w.originalTitle} ${w.creator} ${w.oneLiner} ${w.platform} ${w.tags.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return filtered.sort((a, b) => {
    switch (state.sort) {
      case 'score-desc':
        return (b.score ?? -1) - (a.score ?? -1) || collator.compare(a.title, b.title);
      case 'score-asc':
        return (a.score ?? 99) - (b.score ?? 99) || collator.compare(a.title, b.title);
      case 'year-desc':
        return (b.releaseYear ?? 0) - (a.releaseYear ?? 0) || (b.score ?? -1) - (a.score ?? -1);
      case 'title-asc':
        return collator.compare(a.title, b.title);
      case 'completedAt-desc':
      default: {
        const da = a.completedAt || a.updatedAt || '';
        const db = b.completedAt || b.updatedAt || '';
        return db.localeCompare(da) || (b.score ?? -1) - (a.score ?? -1);
      }
    }
  });
}

function updateSyncStatusUI() {
  const pill = document.getElementById('btn-open-sync');
  const dot = document.getElementById('sync-status-dot');
  const label = document.getElementById('sync-status-label');
  if (!pill || !dot || !label) return;
  pill.classList.toggle('is-dirty', state.isDirty);
  dot.textContent = state.isDirty ? '●' : '✓';
  label.textContent = state.isDirty ? '有未同步修改' : '已同步';
}

function updateFilterControlsUI() {
  const works = state.dataset.works;
  document.getElementById('header-count').textContent = String(works.length);

  for (const el of document.querySelectorAll('[data-count-for]')) {
    const key = el.dataset.countFor;
    el.textContent = String(key === 'all' ? works.length : works.filter((w) => w.category === key).length);
  }
  for (const btn of document.querySelectorAll('#category-pills .pill-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.category === state.category));
  }

  const subRow = document.getElementById('novel-sub-pills');
  subRow.hidden = state.category !== 'novel';
  for (const btn of subRow.querySelectorAll('.pill-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.subtype === state.subCategory));
  }

  const yearSelect = document.getElementById('filter-year');
  const prevYear = state.year;
  const years = [...new Set(works.map((w) => String(w.completedAt || '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort(
    (a, b) => b.localeCompare(a)
  );
  yearSelect.innerHTML = `<option value="all">全部完成年份</option>${years
    .map((y) => `<option value="${y}">${y} 年</option>`)
    .join('')}`;
  yearSelect.value = years.includes(prevYear) ? prevYear : 'all';
  state.year = yearSelect.value;

  document.getElementById('filter-hof').setAttribute('aria-pressed', String(state.hallOnly));
  const tagChip = document.getElementById('active-tag-chip');
  tagChip.hidden = !state.tag;
  document.getElementById('active-tag-text').textContent = state.tag;

  const hasFilters =
    state.category !== 'all' ||
    state.subCategory !== 'all' ||
    state.status !== 'all' ||
    state.year !== 'all' ||
    state.hallOnly ||
    Boolean(state.tag) ||
    Boolean(state.search.trim());
  const resetBtn = document.getElementById('btn-reset-filters');
  if (resetBtn) resetBtn.hidden = !hasFilters;
}

function getSpotlightPool() {
  const works = state.dataset.works;
  const hof = works
    .filter((w) => w.hallOfFame)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.completedAt || '').localeCompare(a.completedAt || ''));
  if (hof.length) return hof;
  const rated = works
    .filter((w) => w.score !== null)
    .sort((a, b) => b.score - a.score);
  return rated.length ? rated.slice(0, 5) : works.slice(0, 5);
}

function renderHeroSpotlight() {
  const spotEl = document.getElementById('hero-spotlight');
  if (!spotEl) return;
  const pool = getSpotlightPool();
  if (!pool.length) {
    spotEl.hidden = true;
    spotEl.innerHTML = '';
    return;
  }
  spotEl.hidden = false;
  const idx = ((state.spotlightIndex % pool.length) + pool.length) % pool.length;
  state.spotlightIndex = idx;
  const w = pool[idx];
  const coverSrc = getCoverSrc(w);
  const metaParts = [categoryBadgeLabel(w), w.creator, w.releaseYear ? `${w.releaseYear}` : '']
    .filter(Boolean)
    .join(' · ');
  const numStr = `${String(idx + 1).padStart(2, '0')} / ${String(pool.length).padStart(2, '0')}`;

  spotEl.innerHTML = `<img class="hero-backdrop" referrerpolicy="no-referrer" src="${escapeHtml(coverSrc)}" data-work-id="${escapeHtml(w.id)}" alt="" aria-hidden="true">
    <div class="hero-inner">
      <div class="hero-cover-wrap">
        <img class="hero-cover" referrerpolicy="no-referrer" src="${escapeHtml(coverSrc)}" data-work-id="${escapeHtml(w.id)}" alt="${escapeHtml(w.title)} 封面">
      </div>
      <div style="min-width:0">
        <div class="hero-eyebrow-row">
          <span class="hero-kicker">CURATOR'S SPOTLIGHT · 私藏精选 ${escapeHtml(numStr)}</span>
          ${pool.length > 1 ? `<div class="hero-nav">
            <button type="button" class="spot-nav-btn" data-spot-nav="-1" aria-label="上一部精选">‹</button>
            <button type="button" class="spot-nav-btn" data-spot-nav="1" aria-label="下一部精选">›</button>
          </div>` : ''}
        </div>
        <h2 class="hero-title">${escapeHtml(w.title)}</h2>
        <div class="hero-meta">${escapeHtml(metaParts)} · 评分 ★${w.score !== null ? w.score.toFixed(1) : '未评'}</div>
        ${w.oneLiner ? `<blockquote class="hero-quote">${escapeHtml(w.oneLiner)}</blockquote>` : ''}
        <div class="hero-cta-row">
          <button type="button" class="btn btn-primary" data-open-work="${escapeHtml(w.id)}">展卷详读 →</button>
          ${w.hallOfFame ? '<span class="stamp-hof">🏛️ 个人殿堂神作</span>' : ''}
        </div>
      </div>
    </div>`;

  attachCoverFallback(spotEl, new Map([[w.id, w]]));
}

function renderColophon() {
  const statsEl = document.getElementById('colophon-stats');
  if (!statsEl) return;
  const works = state.dataset.works;
  statsEl.innerHTML = CATEGORY_META.map((cat) => {
    const count = works.filter((w) => w.category === cat.id).length;
    return `<span>${escapeHtml(cat.label)} <strong>${count}</strong></span>`;
  }).join('');
}

function renderGalleryView(items, worksById) {
  const grid = document.getElementById('gallery-grid');
  if (!items.length) {
    grid.classList.remove('is-initial-stagger');
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">没有符合当前筛选条件的作品记录。</div>';
    return;
  }
  const applyVt = items.length <= 60;
  grid.innerHTML = items
    .map((w, idx) => {
      const scoreText = w.score !== null ? w.score.toFixed(1) : '未评';
      const pct =
        w.progressTotal > 0 && w.progressCurrent !== null
          ? Math.min(100, Math.max(0, Math.round((w.progressCurrent / w.progressTotal) * 100)))
          : null;
      const meta = [w.creator, w.releaseYear, STATUS_LABELS[w.status]].filter(Boolean).join(' · ');
      const tagsHtml = w.tags
        .slice(0, 3)
        .map((t) => `<span class="mini-tag">#${escapeHtml(t)}</span>`)
        .join('');
      const vtAttr = applyVt ? ` style="view-transition-name:${safeWorkVtName(w.id)}"` : '';
      return `<article class="work-card"${vtAttr}>
        <button type="button" class="card-trigger" data-open-work="${escapeHtml(w.id)}">
          <div class="poster-frame">
            <img class="poster-img" referrerpolicy="no-referrer" src="${escapeHtml(getCoverSrc(w))}" data-work-id="${escapeHtml(w.id)}" alt="${escapeHtml(w.title)} 封面" ${idx >= 6 ? 'loading="lazy"' : ''}>
            <span class="poster-glare" aria-hidden="true"></span>
            <span class="badge-cat" data-media-kind="${escapeHtml(w.category)}">${escapeHtml(categoryBadgeLabel(w))}</span>
            <div class="badge-score-group">
              <span class="badge-score">${escapeHtml(scoreText)}</span>
              ${w.hallOfFame ? '<span class="stamp-hof">殿堂</span>' : ''}
            </div>
            ${pct !== null ? `<div class="progress-strip" aria-hidden="true"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}
          </div>
          <div class="card-body">
            <h3 class="card-title">${escapeHtml(w.title)}</h3>
            <div class="card-meta">${escapeHtml(meta)}</div>
            ${w.oneLiner ? `<p class="card-obi">${escapeHtml(w.oneLiner)}</p>` : ''}
            ${tagsHtml ? `<div class="card-footer-tags">${tagsHtml}</div>` : ''}
          </div>
        </button>
      </article>`;
    })
    .join('');

  if (!state.initialStaggerDone) {
    state.initialStaggerDone = true;
    grid.classList.add('is-initial-stagger');
    if (!CSS.supports('animation-delay: calc(sibling-index() * 0.1s)')) {
      [...grid.children].slice(0, 24).forEach((el, idx) => {
        el.style.setProperty('--sibling-index', String(idx + 1));
      });
    }
    setTimeout(() => grid.classList.remove('is-initial-stagger'), 1100);
  } else {
    grid.classList.remove('is-initial-stagger');
  }
  attachCoverFallback(grid, worksById);
}

function renderHallView(items, worksById) {
  const list = document.getElementById('hall-list');
  const ranked = [...items]
    .filter((w) => w.hallOfFame || (typeof w.score === 'number' && w.score >= 8.5))
    .sort((a, b) => Number(b.hallOfFame) - Number(a.hallOfFame) || (b.score ?? -1) - (a.score ?? -1));

  if (!ranked.length) {
    list.innerHTML = '<div class="empty-state" style="grid-column:1/-1">暂无殿堂标记或 8.5+ 高分作品。</div>';
    return;
  }

  list.innerHTML = ranked
    .map((w, idx) => {
      const rank = String(idx + 1).padStart(2, '0');
      return `<button type="button" class="hall-card" data-open-work="${escapeHtml(w.id)}">
        <img class="hall-poster" referrerpolicy="no-referrer" src="${escapeHtml(getCoverSrc(w))}" data-work-id="${escapeHtml(w.id)}" alt="${escapeHtml(w.title)} 封面" loading="lazy">
        <div style="min-width:0">
          <div>
            <span class="hall-rank">No.${rank}</span>
            <span class="mini-tag">${escapeHtml(categoryBadgeLabel(w))}</span>
            ${w.hallOfFame ? '<span class="stamp-hof" style="margin-inline-start:.3rem">殿堂</span>' : ''}
          </div>
          <h3 class="card-title" style="margin-top:.35rem">${escapeHtml(w.title)}</h3>
          <div class="card-meta">${escapeHtml([w.creator, w.releaseYear, w.score !== null ? `★ ${w.score.toFixed(1)}` : '未评'].filter(Boolean).join(' · '))}</div>
          ${w.oneLiner ? `<p class="card-obi" style="margin-top:.55rem;-webkit-line-clamp:3">${escapeHtml(w.oneLiner)}</p>` : ''}
        </div>
      </button>`;
    })
    .join('');
  attachCoverFallback(list, worksById);
}

function renderTimelineView(items, worksById) {
  const container = document.getElementById('timeline-groups');
  if (!items.length) {
    container.innerHTML = '<div class="empty-state">当前筛选条件下暂无时间轴记录。</div>';
    return;
  }

  const groups = new Map();
  for (const w of items) {
    const key = w.completedAt && /^\d{4}-\d{2}/.test(w.completedAt)
      ? `${w.completedAt.slice(0, 4)} 年 ${w.completedAt.slice(5, 7)} 月`
      : '正在追更 / 未设完成日';
    const arr = groups.get(key) || [];
    arr.push(w);
    groups.set(key, arr);
  }

  container.innerHTML = [...groups.entries()]
    .map(([monthLabel, list]) => {
      const rows = list
        .map(
          (w) => `<button type="button" class="timeline-item" data-open-work="${escapeHtml(w.id)}">
            <span class="timeline-date">${escapeHtml(w.completedAt || STATUS_LABELS[w.status])}</span>
            <img class="timeline-thumb" referrerpolicy="no-referrer" src="${escapeHtml(getCoverSrc(w))}" data-work-id="${escapeHtml(w.id)}" alt="" loading="lazy">
            <div style="min-width:0">
              <div style="font-weight:600">${escapeHtml(w.title)} <span class="mini-tag">${escapeHtml(categoryBadgeLabel(w))}</span></div>
              <div class="card-meta" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(w.oneLiner || w.creator)}</div>
            </div>
            <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent-seal)">${w.score !== null ? w.score.toFixed(1) : '—'}</span>
          </button>`
        )
        .join('');
      return `<div><h3 class="timeline-month">${escapeHtml(monthLabel)}（${list.length} 部）</h3><div class="timeline-entries">${rows}</div></div>`;
    })
    .join('');
  attachCoverFallback(container, worksById);
}

function renderTableView(items) {
  const tbody = document.getElementById('works-tbody');
  for (const th of document.querySelectorAll('#works-table thead th')) {
    th.removeAttribute('aria-sort');
  }
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--ink-secondary)">暂无匹配记录</td></tr>';
    return;
  }
  tbody.innerHTML = items
    .map((w) => {
      const scoreVal = w.score !== null ? w.score : -1;
      const yearVal = w.releaseYear ?? 0;
      const dateText = w.completedAt || '—';
      const note = w.progressText || w.oneLiner || '—';
      return `<tr data-work-id="${escapeHtml(w.id)}">
        <th scope="row">
          <button type="button" class="table-row-link" data-open-work="${escapeHtml(w.id)}">${escapeHtml(w.title)}</button>
          ${w.hallOfFame ? '<span class="stamp-hof" style="margin-inline-start:.35rem">殿堂</span>' : ''}
        </th>
        <td>${escapeHtml(categoryBadgeLabel(w))}</td>
        <td>${escapeHtml(STATUS_LABELS[w.status])}</td>
        <td data-value="${scoreVal}" style="font-family:var(--font-mono);font-weight:700">${w.score !== null ? w.score.toFixed(1) : '未评'}</td>
        <td data-value="${yearVal}" style="font-family:var(--font-mono)">${w.releaseYear || '—'}</td>
        <td data-value="${escapeHtml(w.completedAt || '')}" style="font-family:var(--font-mono)">${escapeHtml(dateText)}</td>
        <td style="max-width:26ch;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(note)}</td>
      </tr>`;
    })
    .join('');
}

function setupTableSorting() {
  const table = document.getElementById('works-table');
  const tbody = document.getElementById('works-tbody');
  const statusEl = document.getElementById('sort-status');

  const moveRows = (orderedRows) => {
    const move = Object.hasOwn(Element.prototype, 'moveBefore')
      ? (row) => tbody.moveBefore(row, null)
      : (row) => tbody.append(row);
    for (const row of orderedRows) move(row);
  };

  table.addEventListener('command', (event) => {
    if (event.command !== '--sort') return;
    const th = event.source?.closest('th');
    if (!th) return;
    const rows = [...tbody.rows].filter((r) => r.dataset.workId);
    if (!rows.length) return;

    const direction = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
    for (const header of table.tHead.rows[0].cells) header.removeAttribute('aria-sort');
    th.setAttribute('aria-sort', direction);

    const idx = th.cellIndex;
    const type = th.dataset.type || 'text';
    const factor = direction === 'ascending' ? 1 : -1;
    const valOf = (row) => row.cells[idx].dataset.value ?? row.cells[idx].textContent.trim();

    rows.sort((a, b) =>
      factor * (type === 'number' ? Number(valOf(a)) - Number(valOf(b)) : collator.compare(valOf(a), valOf(b)))
    );

    const applyReorder = () => moveRows(rows);
    if (rows.length <= 150 && table.startViewTransition) {
      table.startViewTransition(applyReorder);
    } else if (rows.length <= 150 && document.startViewTransition) {
      document.startViewTransition(applyReorder);
    } else {
      applyReorder();
    }

    const label = event.source.textContent.trim();
    statusEl.textContent = `已按「${label}」${direction === 'ascending' ? '升序' : '降序'}排列，共 ${rows.length} 条记录`;
  });
}

function resetAllFilters() {
  state.category = 'all';
  state.subCategory = 'all';
  state.status = 'all';
  state.year = 'all';
  state.hallOnly = false;
  state.tag = '';
  state.search = '';
  document.getElementById('filter-search').value = '';
  document.getElementById('filter-status').value = 'all';
  document.getElementById('filter-year').value = 'all';
}

function renderAll() {
  updateSyncStatusUI();
  updateFilterControlsUI();
  renderHeroSpotlight();
  renderColophon();
  renderDashboard(state.dataset.works, state.category, {
    onCategoryToggle: (cat) => {
      runFilterTransition(() => {
        state.category = state.category === cat ? 'all' : cat;
        if (state.category !== 'novel') state.subCategory = 'all';
        renderAll();
      });
    }
  });

  const filtered = getFilteredWorks();
  const worksById = new Map(state.dataset.works.map((w) => [w.id, w]));

  document.getElementById('view-heading').textContent = VIEW_TITLES[state.view] || '海报画廊';
  document.getElementById('view-meta').textContent = `当前显示 ${filtered.length} / ${state.dataset.works.length} 部`;

  for (const name of ['gallery', 'hall', 'timeline', 'table']) {
    document.getElementById(`${name}-view`).hidden = state.view !== name;
    document.getElementById(`tab-${name}`).setAttribute('aria-selected', String(state.view === name));
  }

  if (state.view === 'gallery') renderGalleryView(filtered, worksById);
  else if (state.view === 'hall') renderHallView(filtered, worksById);
  else if (state.view === 'timeline') renderTimelineView(filtered, worksById);
  else if (state.view === 'table') renderTableView(filtered);
}

function switchView(nextView) {
  if (state.view === nextView) return;
  const apply = () => {
    state.view = nextView;
    renderAll();
  };
  const focusHeading = () => {
    document.getElementById('view-heading')?.focus({ preventScroll: true });
  };

  if (!document.startViewTransition) {
    apply();
    focusHeading();
    return;
  }
  document.getElementById('gallery-grid')?.classList.remove('is-initial-stagger');
  const transition = document.startViewTransition(apply);
  transition.finished.finally(focusHeading);
}

async function openReader(workId) {
  const work = state.dataset.works.find((w) => w.id === workId);
  if (!work) return;
  state.activeWorkId = workId;
  state.deleteArmed = false;

  const delBtn = document.getElementById('btn-reader-delete');
  delBtn.textContent = '删除记录';

  const dialog = document.getElementById('reader-dialog');
  document.getElementById('reader-title').textContent = work.title;

  const specs = [
    ['品类', categoryBadgeLabel(work)],
    ['状态', STATUS_LABELS[work.status]],
    ['制作 / 作者', work.creator],
    ['发行年份', work.releaseYear ? `${work.releaseYear} 年` : ''],
    ['平台 / 出版', work.platform],
    ['进度', work.progressText],
    ['完成日期', work.completedAt],
    ['最近更新', work.updatedAt]
  ]
    .filter(([, val]) => Boolean(val))
    .map(([k, val]) => `<li><strong>${escapeHtml(k)}：</strong>${escapeHtml(val)}</li>`)
    .join('');

  const tagsHtml = work.tags
    .map((t) => `<button type="button" class="mini-tag" style="border:1px solid var(--border-hairline);cursor:pointer" data-filter-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`)
    .join('');

  const coverSrc = getCoverSrc(work);
  document.getElementById('reader-body').innerHTML = `<img class="reader-hero-wash" referrerpolicy="no-referrer" src="${escapeHtml(coverSrc)}" data-work-id="${escapeHtml(work.id)}" alt="" aria-hidden="true">
    <div class="reader-spread">
    <aside class="reader-aside">
      <img class="reader-poster" referrerpolicy="no-referrer" id="reader-poster-img" src="${escapeHtml(coverSrc)}" data-work-id="${escapeHtml(work.id)}" alt="${escapeHtml(work.title)} 封面">
      <ul class="reader-specs">${specs}</ul>
    </aside>
    <article style="min-width:0">
      <h3 class="reader-heading">${escapeHtml(work.title)}</h3>
      ${work.originalTitle ? `<p class="reader-orig">${escapeHtml(work.originalTitle)}</p>` : ''}
      <div class="reader-score-row">
        <span class="reader-score-num">${work.score !== null ? work.score.toFixed(1) : '暂未评分'}</span>
        ${work.hallOfFame ? '<span class="stamp-hof">🏛️ 个人殿堂神作</span>' : ''}
        ${tagsHtml}
      </div>
      ${work.oneLiner ? `<blockquote class="reader-obi">${escapeHtml(work.oneLiner)}</blockquote>` : ''}
      <div id="reader-prose" class="md-prose"></div>
    </article>
  </div>`;

  attachCoverFallback(document.getElementById('reader-body'), new Map([[work.id, work]]));

  if (!dialog.open) dialog.showModal();
  await safeSetHTML(document.getElementById('reader-prose'), compileMarkdown(work.reviewMd));
}

function resetEditorDiscardGuard() {
  state.editorDiscardArmed = false;
  const warn = document.getElementById('editor-discard-warn');
  const cancelBtn = document.getElementById('btn-editor-cancel');
  warn.classList.add('is-hidden');
  cancelBtn.textContent = '取消';
  cancelBtn.removeAttribute('aria-describedby');
}

function openEditor(workId = null) {
  const work = workId ? state.dataset.works.find((w) => w.id === workId) : null;
  state.editingWorkId = work ? work.id : null;
  state.editorDirty = false;
  resetEditorDiscardGuard();

  document.getElementById('editor-title').textContent = work ? `编辑：${work.title}` : '记录新作品';
  document.getElementById('lookup-query').value = '';
  document.getElementById('lookup-status').textContent = '';
  const resultsEl = document.getElementById('lookup-results');
  resultsEl.hidden = true;
  resultsEl.innerHTML = '';

  const cat = work?.category || (state.category !== 'all' ? state.category : 'anime');
  document.getElementById('field-title').value = work?.title || '';
  document.getElementById('field-orig-title').value = work?.originalTitle || '';
  document.getElementById('field-category').value = cat;
  document.getElementById('group-subtype').hidden = cat !== 'novel';
  document.getElementById('field-subtype').value = work?.subCategory || 'light-novel';
  document.getElementById('field-status').value = work?.status || 'completed';
  document.getElementById('field-creator').value = work?.creator || '';
  document.getElementById('field-year').value = work?.releaseYear || '';
  document.getElementById('field-completed-at').value =
    work?.completedAt ?? (work ? '' : new Date().toISOString().slice(0, 10));
  document.getElementById('field-platform').value = work?.platform || '';
  document.getElementById('field-progress-text').value = work?.progressText || '';
  document.getElementById('field-progress-cur').value = work?.progressCurrent ?? '';
  document.getElementById('field-progress-total').value = work?.progressTotal ?? '';
  document.getElementById('field-cover-url').value = work?.coverUrl || '';

  const unrated = work ? work.score === null : false;
  const scoreVal = work?.score ?? 8.5;
  document.getElementById('field-unrated').checked = unrated;
  document.getElementById('field-score-range').value = String(scoreVal);
  document.getElementById('field-score-num').value = String(scoreVal);
  document.getElementById('field-score-range').disabled = unrated;
  document.getElementById('field-score-num').disabled = unrated;
  document.getElementById('field-hof').checked = Boolean(work?.hallOfFame);
  document.getElementById('field-tags').value = work?.tags?.join(', ') || '';
  document.getElementById('field-one-liner').value = work?.oneLiner || '';
  document.getElementById('field-review').value = work?.reviewMd || '';

  document.getElementById('editor-dialog').showModal();
}

function collectEditorForm() {
  const category = document.getElementById('field-category').value;
  const unrated = document.getElementById('field-unrated').checked;
  const rawScore = Number(document.getElementById('field-score-num').value);
  const score = unrated || Number.isNaN(rawScore) ? null : Math.round(Math.min(10, Math.max(0, rawScore)) * 10) / 10;
  const curStr = document.getElementById('field-progress-cur').value.trim();
  const totStr = document.getElementById('field-progress-total').value.trim();
  const yrStr = document.getElementById('field-year').value.trim();
  const today = new Date().toISOString().slice(0, 10);

  return {
    id: state.editingWorkId || (crypto.randomUUID ? `w_${crypto.randomUUID()}` : `w_${Date.now()}`),
    title: document.getElementById('field-title').value.trim(),
    originalTitle: document.getElementById('field-orig-title').value.trim(),
    category,
    subCategory: category === 'novel' ? document.getElementById('field-subtype').value : '',
    status: document.getElementById('field-status').value,
    score,
    hallOfFame: document.getElementById('field-hof').checked,
    creator: document.getElementById('field-creator').value.trim(),
    releaseYear: yrStr ? Number(yrStr) || null : null,
    coverUrl: document.getElementById('field-cover-url').value.trim(),
    platform: document.getElementById('field-platform').value.trim(),
    progressText: document.getElementById('field-progress-text').value.trim(),
    progressCurrent: curStr !== '' ? Number(curStr) : null,
    progressTotal: totStr !== '' ? Number(totStr) : null,
    completedAt: document.getElementById('field-completed-at').value.trim(),
    updatedAt: today,
    tags: document.getElementById('field-tags').value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
    oneLiner: document.getElementById('field-one-liner').value.trim(),
    reviewMd: document.getElementById('field-review').value,
    isDemo: false
  };
}

async function handleMetadataLookup() {
  const query = document.getElementById('lookup-query').value.trim();
  const source = document.getElementById('lookup-source').value;
  const category = document.getElementById('field-category').value;
  const statusEl = document.getElementById('lookup-status');
  const resultsEl = document.getElementById('lookup-results');

  if (!query) {
    statusEl.textContent = '请先输入要检索的作品名称。';
    return;
  }
  statusEl.textContent = '正在检索中…';
  resultsEl.hidden = true;

  try {
    const items = await searchMediaMetadata(query, category, source);
    if (!items.length) {
      statusEl.textContent = '未命中条目；可切换“维基百科 zh/ja”或直接手动填写。';
      return;
    }
    statusEl.textContent = `找到 ${items.length} 条匹配，点击任意一条自动回填表单：`;
    resultsEl.hidden = false;
    resultsEl.innerHTML = items
      .map(
        (item, idx) => `<button type="button" class="lookup-item" data-lookup-idx="${idx}">
          <img class="lookup-thumb" referrerpolicy="no-referrer" src="${escapeHtml(item.coverUrl || buildFallbackCoverDataUrl({ title: item.title, category }))}" alt="">
          <div style="min-width:0">
            <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.title)}</div>
            <div class="field-hint">${escapeHtml([item.releaseYear, item.platform].filter(Boolean).join(' · ') || item.source)}</div>
          </div>
        </button>`
      )
      .join('');

    for (const btn of resultsEl.querySelectorAll('[data-lookup-idx]')) {
      btn.addEventListener('click', async () => {
        const picked = items[Number(btn.dataset.lookupIdx)];
        if (!picked) return;
        document.getElementById('field-title').value = picked.title;
        if (picked.originalTitle) document.getElementById('field-orig-title').value = picked.originalTitle;
        if (picked.releaseYear) document.getElementById('field-year').value = String(picked.releaseYear);
        if (picked.coverUrl) document.getElementById('field-cover-url').value = picked.coverUrl;
        if (picked.platform && !document.getElementById('field-platform').value) {
          document.getElementById('field-platform').value = picked.platform;
        }
        if (picked.tags.length && !document.getElementById('field-tags').value) {
          document.getElementById('field-tags').value = picked.tags.join(', ');
        }
        state.editorDirty = true;

        if (picked.source === 'bangumi') {
          statusEl.textContent = '正在补充 Bangumi 制作人员与集卷数…';
          try {
            const extra = await enrichBangumiSubject(picked.sourceId);
            if (extra.creator && !document.getElementById('field-creator').value) {
              document.getElementById('field-creator').value = extra.creator;
            }
            if (extra.progressTotal && !document.getElementById('field-progress-total').value) {
              document.getElementById('field-progress-total').value = String(extra.progressTotal);
            }
            if (extra.progressText && !document.getElementById('field-progress-text').value) {
              document.getElementById('field-progress-text').value = extra.progressText;
            }
            if (extra.coverUrl) document.getElementById('field-cover-url').value = extra.coverUrl;
          } catch {
            // Keep primary metadata even if detail enrichment fails
          }
        }
        statusEl.textContent = `已回填「${picked.title}」`;
        resultsEl.hidden = true;
      });
    }
  } catch (err) {
    statusEl.textContent = `检索失败：${err.message || '网络不可用'}，可直接手动输入。`;
  }
}

function setupMainAndModalEvents() {
  document.getElementById('btn-toggle-stats').addEventListener('click', (e) => {
    const panel = document.getElementById('stats-panel');
    const btn = e.currentTarget;
    const isCurrentlyOpen = !panel.hidden && !panel.classList.contains('is-collapsing');
    if (isCurrentlyOpen) {
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = '📊 展开看板';
      panel.classList.add('is-collapsing');
      const transitions = panel.getAnimations().filter((a) => a instanceof CSSTransition);
      if (!transitions.length) {
        panel.hidden = true;
      } else {
        Promise.allSettled(transitions.map((t) => t.finished)).then(() => {
          if (panel.classList.contains('is-collapsing')) panel.hidden = true;
        });
      }
    } else {
      panel.hidden = false;
      panel.classList.add('is-collapsing');
      getComputedStyle(panel).blockSize;
      requestAnimationFrame(() => panel.classList.remove('is-collapsing'));
      btn.setAttribute('aria-expanded', 'true');
      btn.textContent = '📊 隐藏看板';
    }
  });

  document.getElementById('hero-spotlight')?.addEventListener('click', (e) => {
    const navBtn = e.target.closest('[data-spot-nav]');
    if (navBtn) {
      state.spotlightIndex += Number(navBtn.dataset.spotNav) || 0;
      renderHeroSpotlight();
      return;
    }
    const trigger = e.target.closest('[data-open-work]');
    if (trigger) openReader(trigger.dataset.openWork);
  });

  document.getElementById('btn-new-work').addEventListener('click', () => openEditor(null));

  document.getElementById('category-pills').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-category]');
    if (!btn) return;
    runFilterTransition(() => {
      state.category = btn.dataset.category;
      if (state.category !== 'novel') state.subCategory = 'all';
      renderAll();
    });
  });

  document.getElementById('novel-sub-pills').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-subtype]');
    if (!btn) return;
    runFilterTransition(() => {
      state.subCategory = btn.dataset.subtype;
      renderAll();
    });
  });

  document.getElementById('filter-search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderAll();
  });
  document.getElementById('filter-status').addEventListener('change', (e) => {
    runFilterTransition(() => {
      state.status = e.target.value;
      renderAll();
    });
  });
  document.getElementById('filter-year').addEventListener('change', (e) => {
    runFilterTransition(() => {
      state.year = e.target.value;
      renderAll();
    });
  });
  document.getElementById('filter-hof').addEventListener('click', () => {
    runFilterTransition(() => {
      state.hallOnly = !state.hallOnly;
      renderAll();
    });
  });
  document.getElementById('active-tag-chip').addEventListener('click', () => {
    runFilterTransition(() => {
      state.tag = '';
      renderAll();
    });
  });
  document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
    runFilterTransition(() => {
      resetAllFilters();
      renderAll();
    });
  });
  document.getElementById('sort-select').addEventListener('change', (e) => {
    runFilterTransition(() => {
      state.sort = e.target.value;
      renderAll();
    });
  });

  for (const tab of document.querySelectorAll('[data-view]')) {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  }

  document.getElementById('main-content').addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-open-work]');
    if (trigger) openReader(trigger.dataset.openWork);
  });

  const readerDialog = document.getElementById('reader-dialog');
  readerDialog.addEventListener('click', (e) => {
    const spoiler = e.target.closest('.spoiler-inline');
    if (spoiler) {
      const next = spoiler.getAttribute('aria-expanded') !== 'true';
      spoiler.setAttribute('aria-expanded', String(next));
      return;
    }
    const tagBtn = e.target.closest('[data-filter-tag]');
    if (tagBtn) {
      closeTopLayer(readerDialog);
      runFilterTransition(() => {
        state.tag = tagBtn.dataset.filterTag;
        renderAll();
      });
    }
  });

  document.getElementById('btn-reader-edit').addEventListener('click', () => {
    const id = state.activeWorkId;
    readerDialog.close();
    openEditor(id);
  });

  document.getElementById('btn-reader-delete').addEventListener('click', (e) => {
    if (!state.deleteArmed) {
      state.deleteArmed = true;
      e.currentTarget.textContent = '确认删除？再次点击';
      return;
    }
    state.dataset.works = state.dataset.works.filter((w) => w.id !== state.activeWorkId);
    state.isDirty = true;
    saveDraft(state.dataset);
    closeTopLayer(readerDialog);
    renderAll();
    showToast('已删除作品记录（记得保存或推送同步）');
  });
}

function setupEditorEvents() {
  const editorDialog = document.getElementById('editor-dialog');
  const form = document.getElementById('editor-form');
  const rangeEl = document.getElementById('field-score-range');
  const numEl = document.getElementById('field-score-num');
  const unratedEl = document.getElementById('field-unrated');

  form.addEventListener('input', () => {
    state.editorDirty = true;
    resetEditorDiscardGuard();
  });

  document.getElementById('field-category').addEventListener('change', (e) => {
    document.getElementById('group-subtype').hidden = e.target.value !== 'novel';
  });

  rangeEl.addEventListener('input', () => {
    numEl.value = rangeEl.value;
  });
  numEl.addEventListener('input', () => {
    const val = Number(numEl.value);
    if (!Number.isNaN(val)) rangeEl.value = String(Math.min(10, Math.max(0, val)));
  });
  unratedEl.addEventListener('change', () => {
    rangeEl.disabled = unratedEl.checked;
    numEl.disabled = unratedEl.checked;
  });

  document.getElementById('btn-lookup').addEventListener('click', handleMetadataLookup);
  document.getElementById('lookup-query').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleMetadataLookup();
    }
  });

  editorDialog.addEventListener('cancel', (e) => {
    if (!state.editorDirty || state.editorDiscardArmed) {
      if (!supportsTopLayerExit()) {
        e.preventDefault();
        closeTopLayer(editorDialog);
      }
      return;
    }
    e.preventDefault();
    state.editorDiscardArmed = true;
    const warn = document.getElementById('editor-discard-warn');
    const cancelBtn = document.getElementById('btn-editor-cancel');
    warn.classList.remove('is-hidden');
    cancelBtn.textContent = '放弃修改';
    cancelBtn.setAttribute('aria-describedby', 'editor-discard-warn');
    cancelBtn.focus();
  });

  editorDialog.addEventListener('close', () => {
    editorDialog.returnValue = '';
    resetEditorDiscardGuard();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const item = collectEditorForm();
    if (!item.title) return;
    const idx = state.dataset.works.findIndex((w) => w.id === item.id);
    if (idx >= 0) state.dataset.works[idx] = item;
    else state.dataset.works.unshift(item);

    state.editorDirty = false;
    state.isDirty = true;
    saveDraft(state.dataset);
    closeTopLayer(editorDialog, 'saved');
    renderAll();
    showToast(`已保存「${item.title}」到本地草稿`);
  });
}

function setupSyncEvents() {
  const ghRepo = document.getElementById('gh-repo');
  const ghBranch = document.getElementById('gh-branch');
  const ghPath = document.getElementById('gh-path');
  const ghToken = document.getElementById('gh-token');
  const ghMsg = document.getElementById('gh-sync-msg');

  const cfg = getGitHubConfig();
  ghRepo.value = cfg.ownerRepo;
  ghBranch.value = cfg.branch;
  ghPath.value = cfg.filePath;
  ghToken.value = cfg.token;

  const readFormCfg = () =>
    saveGitHubConfig({
      ownerRepo: ghRepo.value,
      branch: ghBranch.value,
      filePath: ghPath.value,
      token: ghToken.value
    });

  document.getElementById('btn-gh-save-cfg').addEventListener('click', () => {
    readFormCfg();
    ghMsg.textContent = 'GitHub 配置已保存在本机 localStorage（未写入仓库）。';
  });

  document.getElementById('btn-save-local-json').addEventListener('click', async () => {
    try {
      const res = await saveToLocalRepoFile(state.dataset);
      state.isDirty = false;
      updateSyncStatusUI();
      showToast(res.message);
    } catch (err) {
      if (err?.name !== 'AbortError') showToast(`写入失败：${err.message}`);
    }
  });

  document.getElementById('btn-export-json').addEventListener('click', () => {
    const blob = new Blob([serializeDataset(state.dataset)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yuroku-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('已导出备份 JSON（不含 GitHub Token）');
  });

  document.getElementById('input-import-json').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = validateDataset(JSON.parse(await file.text()));
      state.dataset = parsed;
      state.isDirty = true;
      saveDraft(state.dataset);
      renderAll();
      showToast(`已导入 ${parsed.works.length} 条记录`);
    } catch (err) {
      showToast(`导入失败：${err.message}`);
    }
  });

  document.getElementById('btn-gh-push').addEventListener('click', async () => {
    const nextCfg = readFormCfg();
    ghMsg.textContent = '正在推送提交到 GitHub…';
    try {
      await pushToGitHub(state.dataset, nextCfg);
      state.isDirty = false;
      updateSyncStatusUI();
      ghMsg.textContent = `已成功提交至 ${nextCfg.ownerRepo}/${nextCfg.filePath}（${new Date().toLocaleTimeString()}）`;
      showToast('已提交到 GitHub 仓库');
    } catch (err) {
      ghMsg.textContent = `推送失败：${err.message}`;
    }
  });

  document.getElementById('btn-gh-pull').addEventListener('click', async () => {
    const nextCfg = readFormCfg();
    ghMsg.textContent = '正在从 GitHub 拉取最新数据…';
    try {
      state.dataset = await pullFromGitHub(nextCfg);
      state.isDirty = false;
      renderAll();
      ghMsg.textContent = `已同步远端最新 ${state.dataset.works.length} 条记录`;
      showToast('已从 GitHub 拉取最新数据');
    } catch (err) {
      ghMsg.textContent = `拉取失败：${err.message}`;
    }
  });

  document.getElementById('btn-clear-demos').addEventListener('click', () => {
    const before = state.dataset.works.length;
    state.dataset.works = state.dataset.works.filter((w) => !w.isDemo);
    const removed = before - state.dataset.works.length;
    if (removed === 0) {
      showToast('当前已无内置示例数据');
      return;
    }
    state.isDirty = true;
    saveDraft(state.dataset);
    renderAll();
    showToast(`已清空 ${removed} 条内置示例数据`);
  });

  document.getElementById('btn-discard-draft').addEventListener('click', async () => {
    clearDraft();
    const loaded = await loadInitialData();
    state.dataset = loaded.data;
    state.isDirty = false;
    renderAll();
    showToast('已丢弃本地未同步草稿，恢复线上 works.json');
  });
}

function setupTactileInteractions() {
  if (!window.matchMedia('(prefers-reduced-motion: no-preference) and (hover: hover)').matches) return;
  let rafId = 0;
  let lastTarget = null;
  let lastEvt = null;

  const flush = () => {
    rafId = 0;
    if (!lastTarget || !lastEvt) return;
    const r = lastTarget.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const xPct = Math.min(100, Math.max(0, ((lastEvt.clientX - r.left) / r.width) * 100));
    const yPct = Math.min(100, Math.max(0, ((lastEvt.clientY - r.top) / r.height) * 100));
    if (lastTarget.classList.contains('work-card')) {
      const rx = ((yPct - 50) / 50) * -4;
      const ry = ((xPct - 50) / 50) * 4;
      lastTarget.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
      lastTarget.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
      lastTarget.style.setProperty('--glare-x', `${xPct.toFixed(1)}%`);
      lastTarget.style.setProperty('--glare-y', `${yPct.toFixed(1)}%`);
    } else {
      lastTarget.style.setProperty('--spot-x', `${xPct.toFixed(1)}%`);
      lastTarget.style.setProperty('--spot-y', `${yPct.toFixed(1)}%`);
    }
  };

  document.addEventListener('pointermove', (e) => {
    const target = e.target.closest('.work-card, .kpi-card, .chart-card');
    if (!target) return;
    lastTarget = target;
    lastEvt = e;
    if (!rafId) rafId = requestAnimationFrame(flush);
  });

  document.addEventListener('pointerout', (e) => {
    const card = e.target.closest('.work-card');
    if (!card || (e.relatedTarget && card.contains(e.relatedTarget))) return;
    card.style.removeProperty('--rx');
    card.style.removeProperty('--ry');
  });
}

function setupShortcuts() {
  document.getElementById('btn-back-top')?.addEventListener('click', () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  });

  const viewMap = { '1': 'gallery', '2': 'hall', '3': 'timeline', '4': 'table' };
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      document.getElementById('filter-search')?.focus();
      return;
    }
    const active = document.activeElement;
    const isTyping = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
    if (isTyping || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === '/') {
      e.preventDefault();
      document.getElementById('filter-search')?.focus();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openEditor(null);
    } else if (viewMap[e.key]) {
      e.preventDefault();
      switchView(viewMap[e.key]);
    }
  });
}

async function init() {
  setupThemeToggle();
  setupDialogFallbacks();
  setupTableSorting();
  setupMainAndModalEvents();
  setupEditorEvents();
  setupSyncEvents();
  setupTactileInteractions();
  setupShortcuts();

  const loaded = await loadInitialData();
  state.dataset = loaded.data;
  state.isDirty = loaded.isDirty;
  renderAll();
}

init();
