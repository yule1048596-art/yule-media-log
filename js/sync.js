// 余録 · YUROKU — local drafts, local file save, and GitHub Contents API sync
//
// Draft lifecycle (localStorage):
//   edit      → draft saved and marked dirty, together with the git blob sha of the
//               remote works.json it was based on ("base")
//   push      → PUT with that base sha, so GitHub refuses (409) if the file changed
//               elsewhere; on success the pushed text is kept as a "pushed" draft
//               (GitHub Pages needs ~1 min to rebuild, so the page keeps showing it)
//   on load   → a draft identical to data/works.json is dropped automatically

const DRAFT_KEY = 'yuroku_draft_payload_v1';
const DIRTY_KEY = 'yuroku_dirty_v1';
const PUSHED_AT_KEY = 'yuroku_pushed_at_v1';
const BASE_KEY = 'yuroku_base_sha_v1';
const GH_CFG_KEY = 'yuroku_gh_config_v1';
const PUSH_GRACE_MS = 15 * 60 * 1000;

const VALID_CATEGORIES = new Set(['movie', 'jdrama', 'manga', 'anime', 'novel', 'game']);
const VALID_SUBTYPES = new Set(['', 'light-novel', 'web-novel', 'general-novel']);
const VALID_STATUSES = new Set(['completed', 'watching', 'planned', 'dropped']);

let cachedFileHandle = null;

function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode / quota: the app still works for this session
  }
}

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Git blob sha of a text file — the same value GitHub uses as the file's `sha`. */
export async function gitBlobSha(text) {
  try {
    if (!globalThis.crypto?.subtle) return '';
    const body = new TextEncoder().encode(text);
    const head = new TextEncoder().encode(`blob ${body.length}\0`);
    const buf = new Uint8Array(head.length + body.length);
    buf.set(head, 0);
    buf.set(body, head.length);
    const digest = await crypto.subtle.digest('SHA-1', buf);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeWork(raw, index) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`第 ${index + 1} 条记录格式无效`);
  }
  const category = VALID_CATEGORIES.has(raw.category) ? raw.category : 'movie';
  const subCategory = VALID_SUBTYPES.has(raw.subCategory) ? raw.subCategory : '';
  const status = VALID_STATUSES.has(raw.status) ? raw.status : 'completed';
  const scoreNum = numOrNull(raw.score);
  const score = scoreNum === null ? null : Math.round(Math.min(10, Math.max(0, scoreNum)) * 10) / 10;
  const year = numOrNull(raw.releaseYear);

  return {
    id: String(raw.id || `w_import_${index}`),
    title: String(raw.title || '未命名作品').trim(),
    originalTitle: String(raw.originalTitle || '').trim(),
    category,
    subCategory: category === 'novel' ? (subCategory || 'general-novel') : '',
    status,
    score,
    hallOfFame: Boolean(raw.hallOfFame),
    creator: String(raw.creator || '').trim(),
    releaseYear: year ? Math.trunc(year) : null,
    coverUrl: String(raw.coverUrl || '').trim(),
    platform: String(raw.platform || '').trim(),
    progressText: String(raw.progressText || '').trim(),
    progressCurrent: numOrNull(raw.progressCurrent),
    progressTotal: numOrNull(raw.progressTotal),
    completedAt: String(raw.completedAt || '').trim(),
    updatedAt: String(raw.updatedAt || raw.completedAt || '').trim(),
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    oneLiner: String(raw.oneLiner || '').trim(),
    reviewMd: String(raw.reviewMd || ''),
    isDemo: Boolean(raw.isDemo)
  };
}

export function validateDataset(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.works)) {
    throw new Error('JSON 里需要有 works 数组');
  }
  const works = obj.works.map((item, idx) => normalizeWork(item, idx));
  const seen = new Set();
  for (const w of works) {
    while (seen.has(w.id)) w.id = `${w.id}_dup`;
    seen.add(w.id);
  }
  return {
    version: Number(obj.version) || 1,
    siteTitle: String(obj.siteTitle || '余録 · YUROKU'),
    siteSubtitle: String(obj.siteSubtitle || ''),
    works
  };
}

export function serializeDataset(data) {
  return `${JSON.stringify(validateDataset(data), null, 2)}\n`;
}

/** Local edits: keep them, remember which remote version they started from. */
export function saveDraft(data, baseSha) {
  store(DRAFT_KEY, JSON.stringify(data));
  store(DIRTY_KEY, '1');
  if (baseSha) store(BASE_KEY, baseSha);
}

/** After a successful push of exactly `text`, whose new blob sha is `sha`. */
export function markPushed(text, sha) {
  store(DRAFT_KEY, text);
  store(DIRTY_KEY, null);
  store(PUSHED_AT_KEY, String(Date.now()));
  store(BASE_KEY, sha || null);
}

export function clearDraft() {
  store(DRAFT_KEY, null);
  store(DIRTY_KEY, null);
  store(PUSHED_AT_KEY, null);
  store(BASE_KEY, null);
}

async function fetchWorksJson() {
  const res = await fetch('./data/works.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`读取 data/works.json 失败（HTTP ${res.status}）`);
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('data/works.json 不是有效的 JSON');
  }
  return { data: validateDataset(parsed), sha: await gitBlobSha(text) };
}

/**
 * @returns {Promise<{data: object, isDirty: boolean, pending: boolean, remoteOk: boolean,
 *   baseSha: string, conflict: boolean}>}
 */
export async function loadInitialData() {
  let remote = null;
  let remoteSha = '';
  try {
    ({ data: remote, sha: remoteSha } = await fetchWorksJson());
  } catch {
    remote = null;
  }

  let draft = null;
  try {
    const raw = read(DRAFT_KEY);
    if (raw) draft = validateDataset(JSON.parse(raw));
  } catch {
    clearDraft();
  }

  const empty = { version: 1, siteTitle: '余録 · YUROKU', siteSubtitle: '', works: [] };
  const base = read(BASE_KEY) || '';
  const dirty = read(DIRTY_KEY) === '1';
  const pushedAt = Number(read(PUSHED_AT_KEY)) || 0;
  const recentlyPushed = pushedAt > 0 && Date.now() - pushedAt < PUSH_GRACE_MS;
  const result = (data, extra) => ({ data, isDirty: false, pending: false, remoteOk: Boolean(remote), baseSha: '', conflict: false, ...extra });

  if (!draft) return result(remote || empty, { baseSha: remoteSha });
  if (!remote) return result(draft, { isDirty: dirty, baseSha: base });

  if (serializeDataset(draft) === serializeDataset(remote)) {
    clearDraft();
    return result(remote, { baseSha: remoteSha });
  }
  if (dirty) {
    // The deployed file is no longer the version these edits started from
    // (and not merely lagging behind our own recent push).
    const conflict = Boolean(base && remoteSha && base !== remoteSha && !recentlyPushed);
    return result(draft, { isDirty: true, baseSha: base, conflict });
  }
  if (recentlyPushed) return result(draft, { pending: true, baseSha: base });
  clearDraft();
  return result(remote, { baseSha: remoteSha });
}

/** Re-read the deployed data/works.json. */
export async function fetchRemoteDataset() {
  return fetchWorksJson();
}

/** Writes works.json through the File System Access API, or downloads it. Keeps the draft. */
export async function saveToLocalFile(data) {
  const jsonText = serializeDataset(data);
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      if (!cachedFileHandle) {
        cachedFileHandle = await window.showSaveFilePicker({
          suggestedName: 'works.json',
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
        });
      }
      const writable = await cachedFileHandle.createWritable();
      await writable.write(jsonText);
      await writable.close();
      return { method: 'picker' };
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      cachedFileHandle = null;
    }
  }
  const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'works.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { method: 'download' };
}

function inferDefaultOwnerRepo() {
  try {
    if (location.hostname.endsWith('.github.io')) {
      const owner = location.hostname.slice(0, -'.github.io'.length);
      const seg = location.pathname.split('/').filter(Boolean)[0];
      if (owner && seg) return `${owner}/${seg}`;
      if (owner) return `${owner}/${owner}.github.io`;
    }
  } catch {
    // Non-browser environment
  }
  return 'yule1048596-art/yule-media-log';
}

export function getGitHubConfig() {
  const fallback = { ownerRepo: inferDefaultOwnerRepo(), branch: 'main', filePath: 'data/works.json', token: '' };
  try {
    const parsed = JSON.parse(read(GH_CFG_KEY) || 'null');
    if (!parsed) return fallback;
    return {
      ownerRepo: String(parsed.ownerRepo || '').trim() || fallback.ownerRepo,
      branch: String(parsed.branch || '').trim() || 'main',
      filePath: String(parsed.filePath || '').trim() || 'data/works.json',
      token: String(parsed.token || '').trim()
    };
  } catch {
    return fallback;
  }
}

export function saveGitHubConfig(cfg) {
  const normalized = {
    ownerRepo: String(cfg?.ownerRepo || '').trim(),
    branch: String(cfg?.branch || '').trim() || 'main',
    filePath: String(cfg?.filePath || '').trim().replace(/^\/+/, '') || 'data/works.json',
    token: String(cfg?.token || '').trim()
  };
  store(GH_CFG_KEY, JSON.stringify(normalized));
  return normalized;
}

function assertGitHubConfig(cfg) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cfg.ownerRepo)) {
    throw new Error('仓库格式应为 owner/repo');
  }
  if (!cfg.token) throw new Error('还没有填写访问令牌');
}

function contentsUrl(cfg) {
  const path = cfg.filePath.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${cfg.ownerRepo}/contents/${path}`;
}

function ghHeaders(cfg) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${cfg.token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

export class ConflictError extends Error {
  constructor() {
    super('线上的数据文件已经在别处被修改过（比如另一台设备），为了不覆盖它，这次没有推送');
    this.name = 'ConflictError';
  }
}

async function ghError(res, fallback) {
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) return new Error('令牌无效或已过期（HTTP 401）');
  if (res.status === 403) return new Error('没有写入权限，请检查令牌的 Contents 权限（HTTP 403）');
  if (res.status === 404) return new Error('找不到仓库或文件，请检查仓库名、分支和路径（HTTP 404）');
  return new Error(body.message ? `${fallback}：${body.message}` : `${fallback}（HTTP ${res.status}）`);
}

async function currentRemoteSha(cfg) {
  const res = await fetch(`${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`, { headers: ghHeaders(cfg), cache: 'no-store' });
  if (res.ok) return (await res.json()).sha || '';
  if (res.status === 404) return '';
  throw await ghError(res, '读取远端文件失败');
}

/**
 * Push a snapshot of `data`. With `baseSha`, GitHub rejects the write if the file has
 * changed since that version (ConflictError). With `force`, overwrite whatever is there.
 * @returns {Promise<{text: string, sha: string}>} exactly what was written, and its new sha
 */
export async function pushToGitHub(data, cfg, { baseSha = '', force = false } = {}) {
  assertGitHubConfig(cfg);
  const text = serializeDataset(data);
  const sha = force || !baseSha ? await currentRemoteSha(cfg) : baseSha;

  const res = await fetch(contentsUrl(cfg), {
    method: 'PUT',
    headers: { ...ghHeaders(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `chore(data): update ${cfg.filePath} from Yuroku`,
      content: utf8ToBase64(text),
      branch: cfg.branch,
      ...(sha ? { sha } : {})
    })
  });
  if (res.status === 409) throw new ConflictError();
  if (res.status === 422) {
    const body = await res.json().catch(() => ({}));
    if (!force && /sha/i.test(body.message || '')) throw new ConflictError();
    throw new Error(body.message ? `推送失败：${body.message}` : '推送失败（HTTP 422）');
  }
  if (!res.ok) throw await ghError(res, '推送失败');
  const json = await res.json().catch(() => ({}));
  return { text, sha: json?.content?.sha || (await gitBlobSha(text)) };
}

/** Latest committed version straight from the GitHub API (not the Pages copy). */
export async function pullFromGitHub(cfg) {
  assertGitHubConfig(cfg);
  // The raw media type also works for files over 1 MB, where `content` would be empty.
  const res = await fetch(`${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`, {
    headers: { ...ghHeaders(cfg), Accept: 'application/vnd.github.raw+json' },
    cache: 'no-store'
  });
  if (!res.ok) throw await ghError(res, '拉取失败');
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('远端文件不是有效的 JSON');
  }
  return { data: validateDataset(parsed), sha: await gitBlobSha(text) };
}

export function serializedEquals(a, b) {
  try {
    return serializeDataset(a) === serializeDataset(b);
  } catch {
    return false;
  }
}
