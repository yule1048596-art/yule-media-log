// 余録 · YUROKU — add / edit dialog with Bangumi & Wikipedia lookup

import { CATEGORIES, NOVEL_SUBTYPES, STATUSES, statusLabel, verbOf, todayISO, esc } from './meta.js';
import { compileMarkdown, fallbackCover } from './markdown.js';
import { searchMediaMetadata, enrichBangumiSubject } from './search-api.js';

let dlg;
let form;
let ctx;
let current = null;
let dirty = false;
let scoreTouched = false;
let autoDate = false; // completedAt was filled in by us, not typed by the user
let lookupToken = 0;
let lookupRows = [];
let deleteTimer = 0;
let stash = null; // unsaved form contents kept when the browser forces the dialog shut

const $ = (sel) => form.querySelector(sel);
const field = (name) => form.elements.namedItem(name);
const val = (name) => String(field(name)?.value ?? '').trim();
function setVal(name, value) {
  const el = field(name);
  if (el) el.value = value ?? '';
}
function radioValue(name) {
  return form.querySelector(`input[name="${name}"]:checked`)?.value || '';
}
function setRadio(name, value) {
  for (const r of form.querySelectorAll(`input[name="${name}"]`)) r.checked = r.value === value;
}

function radioHtml(name, value, label) {
  return `<label><input type="radio" name="${name}" value="${esc(value)}"><span>${esc(label)}</span></label>`;
}

function renderStatusRadios(category, selected) {
  $('#ed-status').innerHTML = STATUSES.map((s) => radioHtml('status', s, statusLabel(s, category))).join('');
  setRadio('status', selected || 'completed');
  document.getElementById('lbl-date').textContent = `${verbOf(category)}完日期`;
}

function syncCategoryUI() {
  const cat = radioValue('category') || 'movie';
  const status = radioValue('status') || 'completed';
  renderStatusRadios(cat, status);
  $('#ed-sub-field').hidden = cat !== 'novel';
  if (cat === 'novel' && !radioValue('subCategory')) setRadio('subCategory', 'general-novel');
  updateCoverPreview();
}

function syncScoreUI() {
  const off = field('unrated').checked;
  $('.score-row').classList.toggle('is-off', off);
}

function updateCoverPreview() {
  const img = $('#ed-cover-preview img');
  const url = val('coverUrl');
  img.src = /^https?:\/\//i.test(url)
    ? url
    : fallbackCover({ title: val('title') || '未命名', category: radioValue('category') || 'movie', creator: val('creator') });
}

function setReviewMode(mode) {
  const preview = $('#ed-preview');
  const textarea = field('reviewMd');
  for (const b of form.querySelectorAll('[data-review-mode]')) b.setAttribute('aria-pressed', String(b.dataset.reviewMode === mode));
  if (mode === 'preview') {
    preview.innerHTML = compileMarkdown(textarea.value) || '<p class="prose-empty">还没有内容。</p>';
    preview.hidden = false;
    textarea.hidden = true;
  } else {
    preview.hidden = true;
    textarea.hidden = false;
  }
}

function resetDelete() {
  clearTimeout(deleteTimer);
  const btn = $('#ed-delete');
  btn.classList.remove('is-confirming');
  btn.textContent = '删除这条记录';
}

function fill(work) {
  form.reset();
  setRadio('category', work.category || 'movie');
  setRadio('subCategory', work.subCategory || 'general-novel');
  renderStatusRadios(work.category || 'movie', work.status || 'completed');
  $('#ed-sub-field').hidden = work.category !== 'novel';

  setVal('title', work.title);
  setVal('originalTitle', work.originalTitle);
  setVal('creator', work.creator);
  setVal('releaseYear', work.releaseYear ?? '');
  setVal('platform', work.platform);
  setVal('coverUrl', work.coverUrl);

  const hasScore = typeof work.score === 'number' && Number.isFinite(work.score);
  field('unrated').checked = !hasScore;
  const s = hasScore ? work.score : 8;
  setVal('score', s.toFixed(1));
  $('#ed-score-range').value = String(s);
  field('hallOfFame').checked = Boolean(work.hallOfFame);

  setVal('completedAt', work.completedAt);
  setVal('progressCurrent', work.progressCurrent ?? '');
  setVal('progressTotal', work.progressTotal ?? '');
  setVal('progressText', work.progressText);
  setVal('tags', (work.tags || []).join('，'));
  setVal('oneLiner', work.oneLiner);
  setVal('reviewMd', work.reviewMd);

  syncScoreUI();
  setReviewMode('write');
  updateCoverPreview();
}

function parseTags(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const parts = /[,，、;；]/.test(raw) ? raw.split(/[,，、;；]+/) : raw.split(/\s+/);
  const out = [];
  for (const p of parts) {
    const t = p.trim().replace(/^#/, '');
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 20);
}

function fail(name, message) {
  const el = typeof name === 'string' ? field(name) : name;
  el.setCustomValidity(message);
  el.reportValidity();
  el.addEventListener('input', () => el.setCustomValidity(''), { once: true });
  return null;
}

function intOrNull(name, { min = 0, max = 1e6, label }) {
  const raw = val(name);
  if (!raw) return { value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return { error: fail(name, `${label}需要是 ${min}–${max} 之间的整数`) ?? true };
  return { value: n };
}

function collect() {
  const title = val('title');
  if (!title) return fail('title', '请填写标题');

  const category = radioValue('category') || 'movie';
  const status = radioValue('status') || 'completed';

  let score = null;
  if (!field('unrated').checked) {
    const n = Number(val('score'));
    if (val('score') === '' || !Number.isFinite(n) || n < 0 || n > 10) return fail('score', '评分需要在 0.0 到 10.0 之间');
    score = Math.round(n * 10) / 10;
  }

  const year = intOrNull('releaseYear', { min: 1800, max: 2100, label: '发行年份' });
  if (year.error) return null;
  const cur = intOrNull('progressCurrent', { label: '当前进度' });
  if (cur.error) return null;
  const total = intOrNull('progressTotal', { label: '总进度' });
  if (total.error) return null;

  const cover = val('coverUrl');
  if (cover && !/^https?:\/\/\S+$/i.test(cover)) return fail('coverUrl', '封面链接需要以 http:// 或 https:// 开头');

  return {
    id: current?.id || `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    originalTitle: val('originalTitle'),
    category,
    subCategory: category === 'novel' ? (radioValue('subCategory') || 'general-novel') : '',
    status,
    score,
    hallOfFame: field('hallOfFame').checked,
    creator: val('creator'),
    releaseYear: year.value,
    coverUrl: cover,
    platform: val('platform'),
    progressText: val('progressText'),
    progressCurrent: cur.value,
    progressTotal: total.value,
    completedAt: val('completedAt'),
    updatedAt: todayISO(),
    tags: parseTags(val('tags')),
    oneLiner: val('oneLiner'),
    reviewMd: String(field('reviewMd').value || '').replace(/\s+$/, ''),
    isDemo: false
  };
}

function requestClose() {
  if (dirty && !window.confirm('有未保存的修改，确定放弃吗？')) return;
  dirty = false;
  dlg.close();
}

function snapshotForm() {
  const snap = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') snap[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) snap[el.name] = el.value; }
    else snap[el.name] = el.value;
  }
  return snap;
}

function restoreForm(snap) {
  const cat = snap.category || radioValue('category') || 'movie';
  setRadio('category', cat);
  renderStatusRadios(cat, snap.status);
  if (snap.subCategory) setRadio('subCategory', snap.subCategory);
  $('#ed-sub-field').hidden = cat !== 'novel';
  for (const [name, value] of Object.entries(snap)) {
    if (name === 'category' || name === 'subCategory' || name === 'status') continue;
    const el = field(name);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value;
  }
  const n = Number(val('score'));
  if (Number.isFinite(n)) $('#ed-score-range').value = String(n);
  syncScoreUI();
  updateCoverPreview();
}

// ---------- Lookup ----------

async function runLookup() {
  const input = document.getElementById('lookup-q');
  const status = document.getElementById('lookup-status');
  const list = document.getElementById('lookup-results');
  const q = input.value.trim();
  if (!q) { input.focus(); return; }
  const token = ++lookupToken;
  const category = radioValue('category') || 'movie';
  status.textContent = '搜索中…';
  list.replaceChildren();
  try {
    const rows = await searchMediaMetadata(q, category, document.getElementById('lookup-src').value);
    if (token !== lookupToken) return;
    lookupRows = rows;
    if (!rows.length) {
      status.textContent = '没有找到结果。换个关键词或来源试试，也可以直接手动填写。';
      return;
    }
    status.textContent = `找到 ${rows.length} 个结果，点一个即可填入：`;
    list.innerHTML = rows.map((r, i) => {
      const cover = r.thumbUrl || r.coverUrl || fallbackCover({ title: r.title, category });
      const sub = [r.originalTitle, r.releaseYear, r.platform].filter(Boolean).join(' · ');
      return `<li><button type="button" class="lookup-item" data-lookup-index="${i}">
        <span class="thumb"><img src="${esc(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>
        <span class="row-text"><strong>${esc(r.title)}</strong><small>${esc(sub)}</small></span>
        <span class="lookup-pick">填入</span>
      </button></li>`;
    }).join('');
  } catch (err) {
    if (token !== lookupToken) return;
    status.textContent = `搜索失败（${err?.message || err}）。可以换个来源，或手动填写。`;
  }
}

async function applyLookup(row) {
  const status = document.getElementById('lookup-status');
  document.getElementById('lookup-results').replaceChildren();
  setVal('title', row.title);
  setVal('originalTitle', row.originalTitle);
  if (row.releaseYear) setVal('releaseYear', row.releaseYear);
  if (row.coverUrl) setVal('coverUrl', row.coverUrl);
  if (row.platform) setVal('platform', row.platform);
  if (!val('tags') && row.tags?.length) setVal('tags', row.tags.slice(0, 3).join('，'));
  dirty = true;
  updateCoverPreview();

  if (row.source !== 'bangumi' || !row.sourceId) {
    status.textContent = '已填入，请检查一下。';
    return;
  }
  const token = ++lookupToken;
  status.textContent = '已填入，正在补全作者和集数…';
  try {
    const extra = await enrichBangumiSubject(row.sourceId);
    if (token !== lookupToken) return;
    if (extra.creator) setVal('creator', extra.creator);
    if (extra.progressTotal && !val('progressTotal')) setVal('progressTotal', extra.progressTotal);
    if (extra.progressText && !val('progressText')) setVal('progressText', extra.progressText);
    if (extra.coverUrl && !val('coverUrl')) setVal('coverUrl', extra.coverUrl);
    updateCoverPreview();
    status.textContent = '已填入，请检查一下。';
  } catch {
    if (token === lookupToken) status.textContent = '已填入基础信息（作者等详细资料没取到，可以手动补上）。';
  }
}

// ---------- Public ----------

export function setupEditor(options) {
  ctx = options;
  dlg = document.getElementById('editor-dialog');
  form = document.getElementById('editor-form');

  $('#ed-category').innerHTML = CATEGORIES.map((c) => radioHtml('category', c.id, c.label)).join('');
  $('#ed-sub').innerHTML = NOVEL_SUBTYPES.map((s) => radioHtml('subCategory', s.id, s.label)).join('');

  form.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'lookup-q' || id === 'lookup-src') return;
    dirty = true;
    const name = e.target.name;
    if (name === 'score') {
      scoreTouched = true;
      const n = Number(e.target.value);
      if (Number.isFinite(n)) $('#ed-score-range').value = String(Math.min(10, Math.max(0, n)));
      if (field('unrated').checked) { field('unrated').checked = false; syncScoreUI(); }
    } else if (id === 'ed-score-range') {
      scoreTouched = true;
      setVal('score', Number(e.target.value).toFixed(1));
      if (field('unrated').checked) { field('unrated').checked = false; syncScoreUI(); }
    } else if (name === 'coverUrl' || name === 'title' || name === 'creator') {
      updateCoverPreview();
    } else if (name === 'completedAt') {
      autoDate = false;
    }
  });

  form.addEventListener('change', (e) => {
    const name = e.target.name;
    if (e.target.id === 'lookup-src' || e.target.id === 'lookup-q') return;
    dirty = true;
    if (name === 'category') {
      syncCategoryUI();
    } else if (name === 'status') {
      const s = e.target.value;
      if (s === 'completed' && !val('completedAt')) {
        setVal('completedAt', todayISO());
        autoDate = true;
      } else if (s !== 'completed' && autoDate) {
        setVal('completedAt', '');
        autoDate = false;
      }
      if (s === 'planned' && !scoreTouched && !current) { field('unrated').checked = true; syncScoreUI(); }
    } else if (name === 'unrated') {
      scoreTouched = true;
      syncScoreUI();
    }
  });

  for (const b of form.querySelectorAll('[data-review-mode]')) {
    b.addEventListener('click', () => setReviewMode(b.dataset.reviewMode));
  }

  document.getElementById('lookup-go').addEventListener('click', runLookup);
  document.getElementById('lookup-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runLookup(); }
  });
  document.getElementById('lookup-results').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lookup-index]');
    if (btn) applyLookup(lookupRows[Number(btn.dataset.lookupIndex)]);
  });

  $('#ed-delete').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (!current) return;
    if (!btn.classList.contains('is-confirming')) {
      btn.classList.add('is-confirming');
      btn.textContent = '再点一次确认删除';
      deleteTimer = setTimeout(resetDelete, 4000);
      return;
    }
    resetDelete();
    const id = current.id;
    dirty = false;
    dlg.close();
    ctx.onDelete(id);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const work = collect();
    if (!work) return;
    const isNew = !current;
    dirty = false;
    dlg.close();
    ctx.onSave(work, isNew);
  });

  for (const b of dlg.querySelectorAll('[data-close]')) b.addEventListener('click', requestClose);
  // Handle Esc ourselves while there are unsaved edits: cancelling the keydown
  // stops the dialog's own close request, so the confirm answer is respected.
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !dirty) return;
    e.preventDefault();
    requestClose();
  });
  dlg.addEventListener('cancel', (e) => {
    if (!dirty) return;
    if (e.cancelable) {
      e.preventDefault();
      requestClose();
      return;
    }
    // e.g. a repeated Android back gesture: the browser closes the dialog regardless,
    // so keep the edits and offer them again next time this editor opens.
    stash = { id: current?.id ?? null, values: snapshotForm() };
    dirty = false;
  });
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg && downOnBackdrop) requestClose();
  });
  dlg.addEventListener('close', () => {
    resetDelete();
    lookupToken += 1;
    ctx.onClose?.();
  });
}

export function openEditor(work = null) {
  current = work;
  dirty = false;
  scoreTouched = false;
  autoDate = !work;
  lookupRows = [];
  const blank = {
    category: 'movie', status: 'completed', score: 8, completedAt: todayISO(), tags: []
  };
  fill(work || blank);
  document.getElementById('editor-title').textContent = work ? `编辑：${work.title}` : '记录新作品';
  document.getElementById('ed-delete').hidden = !work;
  document.getElementById('lookup-q').value = '';
  document.getElementById('lookup-status').textContent = '';
  document.getElementById('lookup-results').replaceChildren();
  if (stash && stash.id === (work?.id ?? null)) {
    restoreForm(stash.values);
    dirty = true;
    document.getElementById('lookup-status').textContent = '已恢复上次没保存的内容。';
  }
  stash = null;
  resetDelete();
  dlg.showModal();
  dlg.querySelector('.modal-scroll').scrollTop = 0;
  (work ? field('title') : document.getElementById('lookup-q')).focus();
}

export function isEditorOpen() {
  return dlg?.open === true;
}
