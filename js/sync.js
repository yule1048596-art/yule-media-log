// 余録 · YUROKU — Local Drafts, File System Access Write, and GitHub REST Sync

const DRAFT_KEY = 'yuroku_draft_payload_v1';
const DIRTY_KEY = 'yuroku_dirty_v1';
const GH_CFG_KEY = 'yuroku_gh_config_v1';

const VALID_CATEGORIES = new Set(['movie', 'jdrama', 'manga', 'anime', 'novel', 'game']);
const VALID_SUBTYPES = new Set(['', 'light-novel', 'web-novel', 'general-novel']);
const VALID_STATUSES = new Set(['completed', 'watching', 'planned', 'dropped']);

let cachedFileHandle = null;

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

function normalizeWork(raw, index) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`第 ${index + 1} 条记录格式无效`);
  }
  const category = VALID_CATEGORIES.has(raw.category) ? raw.category : 'movie';
  const subCategory = VALID_SUBTYPES.has(raw.subCategory) ? raw.subCategory : '';
  const status = VALID_STATUSES.has(raw.status) ? raw.status : 'completed';

  let score = null;
  if (raw.score !== null && raw.score !== '' && raw.score !== undefined) {
    const n = Number(raw.score);
    if (!Number.isNaN(n)) {
      score = Math.round(Math.min(10, Math.max(0, n)) * 10) / 10;
    }
  }

  return {
    id: String(raw.id || `w_${Date.now()}_${index}`),
    title: String(raw.title || '未命名作品').trim(),
    originalTitle: String(raw.originalTitle || '').trim(),
    category,
    subCategory: category === 'novel' ? (subCategory || 'general-novel') : '',
    status,
    score,
    hallOfFame: Boolean(raw.hallOfFame),
    creator: String(raw.creator || '').trim(),
    releaseYear: raw.releaseYear ? Number(raw.releaseYear) || null : null,
    coverUrl: String(raw.coverUrl || '').trim(),
    platform: String(raw.platform || '').trim(),
    progressText: String(raw.progressText || '').trim(),
    progressCurrent: raw.progressCurrent !== null && raw.progressCurrent !== '' && raw.progressCurrent !== undefined
      ? Number(raw.progressCurrent)
      : null,
    progressTotal: raw.progressTotal !== null && raw.progressTotal !== '' && raw.progressTotal !== undefined
      ? Number(raw.progressTotal)
      : null,
    completedAt: String(raw.completedAt || '').trim(),
    updatedAt: String(raw.updatedAt || new Date().toISOString().slice(0, 10)).trim(),
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((t) => String(t).trim()).filter(Boolean)
      : [],
    oneLiner: String(raw.oneLiner || '').trim(),
    reviewMd: String(raw.reviewMd || ''),
    isDemo: Boolean(raw.isDemo)
  };
}

export function validateDataset(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.works)) {
    throw new Error('JSON 须包含 works 数组');
  }
  return {
    version: Number(obj.version) || 1,
    siteTitle: String(obj.siteTitle || '余録 · YUROKU'),
    siteSubtitle: String(obj.siteSubtitle || '个人书影游私藏与批注录'),
    works: obj.works.map((item, idx) => normalizeWork(item, idx))
  };
}

export function hasDirtyDraft() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DIRTY_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveDraft(data) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    localStorage.setItem(DIRTY_KEY, '1');
  } catch {
    // Ignore storage quota errors silently
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(DIRTY_KEY);
  } catch {
    // Ignore
  }
}

export async function loadInitialData() {
  let remoteData = { version: 1, siteTitle: '余録 · YUROKU', siteSubtitle: '个人书影游私藏与批注录', works: [] };
  try {
    const res = await fetch('./data/works.json', { cache: 'no-cache' });
    if (res.ok) {
      remoteData = validateDataset(await res.json());
    }
  } catch {
    // Fallback if offline or missing file
  }

  try {
    if (localStorage.getItem(DIRTY_KEY) === '1') {
      const rawDraft = localStorage.getItem(DRAFT_KEY);
      if (rawDraft) {
        return { data: validateDataset(JSON.parse(rawDraft)), isDirty: true };
      }
    }
  } catch {
    clearDraft();
  }
  return { data: remoteData, isDirty: false };
}

export function serializeDataset(data) {
  const cleaned = validateDataset(data);
  return `${JSON.stringify(cleaned, null, 2)}\n`;
}

export async function saveToLocalRepoFile(data, forcePick = false) {
  const jsonText = serializeDataset(data);

  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      if (!cachedFileHandle || forcePick) {
        cachedFileHandle = await window.showSaveFilePicker({
          suggestedName: 'works.json',
          types: [{ description: 'JSON Data', accept: { 'application/json': ['.json'] } }]
        });
      }
      const writable = await cachedFileHandle.createWritable();
      await writable.write(jsonText);
      await writable.close();
      clearDraft();
      return { method: 'picker', message: '已直接写入本地 works.json' };
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
  URL.revokeObjectURL(url);
  clearDraft();
  return { method: 'download', message: '已下载 works.json，请覆盖仓库 data/works.json' };
}

function inferDefaultOwnerRepo() {
  try {
    if (typeof location !== 'undefined' && location.hostname.endsWith('.github.io')) {
      const owner = location.hostname.slice(0, -'.github.io'.length);
      const seg = location.pathname.split('/').filter(Boolean)[0];
      if (owner && seg) return `${owner}/${seg}`;
      if (owner) return `${owner}/${owner}.github.io`;
    }
  } catch {
    // Ignore environments without location
  }
  return 'yule1048596-art/yule-media-log';
}

export function getGitHubConfig() {
  const defaultRepo = inferDefaultOwnerRepo();
  try {
    const raw = localStorage.getItem(GH_CFG_KEY);
    if (!raw) return { ownerRepo: defaultRepo, branch: 'main', filePath: 'data/works.json', token: '' };
    const parsed = JSON.parse(raw);
    return {
      ownerRepo: String(parsed.ownerRepo || defaultRepo).trim() || defaultRepo,
      branch: String(parsed.branch || 'main').trim() || 'main',
      filePath: String(parsed.filePath || 'data/works.json').trim() || 'data/works.json',
      token: String(parsed.token || '').trim()
    };
  } catch {
    return { ownerRepo: defaultRepo, branch: 'main', filePath: 'data/works.json', token: '' };
  }
}

export function saveGitHubConfig(cfg) {
  const normalized = {
    ownerRepo: String(cfg?.ownerRepo || '').trim(),
    branch: String(cfg?.branch || 'main').trim() || 'main',
    filePath: String(cfg?.filePath || 'data/works.json').trim() || 'data/works.json',
    token: String(cfg?.token || '').trim()
  };
  localStorage.setItem(GH_CFG_KEY, JSON.stringify(normalized));
  return normalized;
}

function assertGitHubConfig(cfg) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cfg.ownerRepo)) {
    throw new Error('仓库格式须为 owner/repo（例如 yule1048596-art/yule-media-log）');
  }
  if (!cfg.token) {
    throw new Error('请先填写 GitHub Personal Access Token');
  }
}

function buildContentsEndpoint(cfg) {
  const cleanPath = cfg.filePath.replace(/^\/+/, '');
  return `https://api.github.com/repos/${cfg.ownerRepo}/contents/${cleanPath}`;
}

export async function pushToGitHub(data, cfg) {
  assertGitHubConfig(cfg);
  const endpoint = buildContentsEndpoint(cfg);
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${cfg.token}`,
    'Content-Type': 'application/json'
  };

  let sha = '';
  const getRes = await fetch(`${endpoint}?ref=${encodeURIComponent(cfg.branch)}`, { headers });
  if (getRes.ok) {
    const info = await getRes.json();
    sha = info.sha || '';
  } else if (getRes.status !== 404) {
    const err = await getRes.json().catch(() => ({}));
    throw new Error(err.message || `读取远端 SHA 失败 (HTTP ${getRes.status})`);
  }

  const jsonText = serializeDataset(data);
  const putBody = {
    message: `chore(media): update ${cfg.filePath} via Yuroku web editor`,
    content: utf8ToBase64(jsonText),
    branch: cfg.branch,
    ...(sha ? { sha } : {})
  };

  const putRes = await fetch(endpoint, {
    method: 'PUT',
    headers,
    body: JSON.stringify(putBody)
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(err.message || `提交 GitHub 失败 (HTTP ${putRes.status})`);
  }

  clearDraft();
  return putRes.json();
}

export async function pullFromGitHub(cfg) {
  assertGitHubConfig(cfg);
  const endpoint = `${buildContentsEndpoint(cfg)}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await fetch(endpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `拉取远端数据失败 (HTTP ${res.status})`);
  }
  const info = await res.json();
  const decoded = base64ToUtf8(info.content || '');
  const dataset = validateDataset(JSON.parse(decoded));
  clearDraft();
  return dataset;
}
