// 余録 · YUROKU — "数据与同步" dialog

import { icon } from './icons.js';
import {
  getGitHubConfig, saveGitHubConfig, pushToGitHub, pullFromGitHub, saveToLocalFile,
  validateDataset, clearDraft, saveDraft, markPushed, fetchRemoteDataset,
  serializeDataset, ConflictError
} from './sync.js';

let dlg;
let ctx;
let busy = false;
let lastConflict = false;

const byId = (id) => document.getElementById(id);
const ACTION_IDS = ['gh-push', 'gh-force', 'gh-pull', 'gh-save', 'gh-forget', 'file-save', 'file-import', 'clear-demos', 'discard-draft'];

function readForm() {
  return {
    ownerRepo: byId('gh-repo').value,
    branch: byId('gh-branch').value,
    filePath: byId('gh-path').value,
    token: byId('gh-token').value
  };
}

function fillForm() {
  const cfg = getGitHubConfig();
  byId('gh-repo').value = cfg.ownerRepo;
  byId('gh-branch').value = cfg.branch;
  byId('gh-path').value = cfg.filePath;
  byId('gh-token').value = cfg.token;
  byId('gh-summary-state').textContent = cfg.token ? `${cfg.ownerRepo} · 已设置令牌` : '未设置令牌';
  return cfg;
}

function renderState() {
  const { dirty, pending, conflict } = ctx.getSyncState();
  const el = byId('sync-state');
  const demos = ctx.getData().works.filter((w) => w.isDemo).length;
  if (lastConflict || conflict) {
    el.dataset.state = 'dirty';
    el.innerHTML = `${icon('alert')}<span>线上的数据在你编辑之后被别处更新过（比如另一台设备）。直接推送会覆盖那些改动：建议先「保存为 works.json」备份本地修改，再「拉取线上数据」。</span>`;
  } else if (dirty) {
    el.dataset.state = 'dirty';
    el.innerHTML = `${icon('alert')}<span>这台设备上有<b>还没同步</b>的修改。推送到 GitHub，或保存成文件提交到仓库，别人才能看到。</span>`;
  } else if (pending) {
    el.dataset.state = 'clean';
    el.innerHTML = `${icon('check')}<span>已推送。GitHub Pages 更新期间，这里先显示刚推送的版本。</span>`;
  } else {
    el.dataset.state = 'clean';
    el.innerHTML = `${icon('check')}<span>和线上数据一致，没有未同步的修改。</span>`;
  }
  byId('gh-force').hidden = !lastConflict;
  byId('clear-demos').hidden = demos === 0;
  if (!byId('clear-demos').classList.contains('is-confirming')) {
    byId('clear-demos').textContent = demos ? `清除 ${demos} 条示例作品` : '清除示例作品';
  }
  byId('discard-draft').hidden = !dirty;
  byId('sync-tidy').hidden = demos === 0 && !dirty;
}

function setBusy(on) {
  busy = on;
  for (const id of ACTION_IDS) {
    const el = byId(id);
    if (el) el.disabled = on;
  }
  byId('file-import').closest('.btn')?.classList.toggle('is-disabled', on);
}

async function run(btn, label, task) {
  if (busy) return;
  const original = btn?.innerHTML;
  setBusy(true);
  if (btn) btn.textContent = label;
  try {
    await task();
  } finally {
    if (btn) btn.innerHTML = original;
    setBusy(false);
    renderState();
  }
}

function confirmStep(btn, prompt, action) {
  if (btn.dataset.armed === '1') {
    clearTimeout(Number(btn.dataset.timer));
    btn.dataset.armed = '';
    btn.classList.remove('is-confirming');
    btn.innerHTML = btn.dataset.label;
    action();
    return;
  }
  btn.dataset.label = btn.innerHTML;
  btn.dataset.armed = '1';
  btn.classList.add('is-confirming');
  btn.textContent = prompt;
  btn.dataset.timer = String(setTimeout(() => {
    btn.dataset.armed = '';
    btn.classList.remove('is-confirming');
    btn.innerHTML = btn.dataset.label;
  }, 4000));
}

function requireToken() {
  const cfg = saveGitHubConfig(readForm());
  fillForm();
  if (!cfg.token) {
    byId('gh-settings').open = true;
    byId('gh-token').focus();
    ctx.toast('先在「连接设置」里填写访问令牌', 'error');
    return null;
  }
  return cfg;
}

async function doPush(cfg, { force }) {
  const snapshot = ctx.getData();
  const { baseSha } = ctx.getSyncState();
  try {
    const { text, sha } = await pushToGitHub(snapshot, cfg, { baseSha, force });
    lastConflict = false;
    // Anything changed while the request was in flight stays unsynced.
    if (serializeDataset(ctx.getData()) === text) {
      markPushed(text, sha);
      ctx.setSyncState({ dirty: false, pending: true, baseSha: sha, conflict: false });
      ctx.toast('已推送到 GitHub，网站约一分钟后更新');
    } else {
      saveDraft(ctx.getData(), sha);
      ctx.setSyncState({ dirty: true, pending: false, baseSha: sha, conflict: false });
      ctx.toast('已推送；推送期间的新修改还没同步', 'error');
    }
  } catch (err) {
    if (err instanceof ConflictError) {
      lastConflict = true;
      ctx.toast(err.message, 'error');
    } else {
      ctx.toast(err.message || '推送失败', 'error');
    }
  }
}

export function setupSyncDialog(options) {
  ctx = options;
  dlg = byId('sync-dialog');

  for (const b of dlg.querySelectorAll('[data-close]')) b.addEventListener('click', () => dlg.close());
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && downOnBackdrop) dlg.close(); });

  byId('gh-save').addEventListener('click', () => {
    const cfg = saveGitHubConfig(readForm());
    fillForm();
    ctx.toast(cfg.token ? '设置已保存' : '设置已保存（还没有令牌）');
  });

  byId('gh-forget').addEventListener('click', () => {
    saveGitHubConfig({ ...readForm(), token: '' });
    fillForm();
    ctx.toast('令牌已从这台设备清除');
  });

  byId('gh-push').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const cfg = requireToken();
    if (!cfg) return;
    if (!ctx.getSyncState().baseSha) {
      // Unknown base version (e.g. works.json could not be read): pushing may overwrite.
      confirmStep(btn, '无法确认线上版本，再点一次仍然推送', () => run(btn, '推送中…', () => doPush(cfg, { force: true })));
      return;
    }
    run(btn, '推送中…', () => doPush(cfg, { force: false }));
  });

  byId('gh-force').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const cfg = requireToken();
    if (!cfg) return;
    confirmStep(btn, '会覆盖线上改动，再点一次确认', () => run(btn, '推送中…', () => doPush(cfg, { force: true })));
  });

  byId('gh-pull').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const cfg = saveGitHubConfig(readForm());
    fillForm();
    const pull = () => run(btn, '拉取中…', async () => {
      try {
        const { data, sha } = cfg.token ? await pullFromGitHub(cfg) : await fetchRemoteDataset();
        clearDraft();
        lastConflict = false;
        ctx.replaceData(data, { dirty: false, baseSha: sha });
        ctx.toast(`已载入线上数据，共 ${data.works.length} 部`);
      } catch (err) {
        ctx.toast(err.message || '拉取失败', 'error');
      }
    });
    if (ctx.getSyncState().dirty) confirmStep(btn, '会覆盖本地修改，再点一次确认', pull);
    else pull();
  });

  byId('file-save').addEventListener('click', (e) => {
    run(e.currentTarget, '保存中…', async () => {
      try {
        const res = await saveToLocalFile(ctx.getData());
        ctx.toast(res.method === 'picker' ? '已写入文件。提交到仓库后会自动识别为已同步' : '已下载 works.json，用它覆盖仓库里的 data/works.json');
      } catch (err) {
        if (err?.name !== 'AbortError') ctx.toast(`保存失败：${err.message || err}`, 'error');
      }
    });
  });

  byId('file-import').addEventListener('change', async (e) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file || busy) return;
    if (ctx.getSyncState().dirty && !window.confirm('导入会替换掉这台设备上还没同步的修改，确定导入吗？')) return;
    try {
      const data = validateDataset(JSON.parse(await file.text()));
      ctx.replaceData(data, { dirty: true });
      renderState();
      ctx.toast(`已导入 ${data.works.length} 部作品（尚未同步）`);
    } catch (err) {
      ctx.toast(`导入失败：${err.message || '文件不是有效的 JSON'}`, 'error');
    }
  });

  byId('clear-demos').addEventListener('click', (e) => {
    const n = ctx.getData().works.filter((w) => w.isDemo).length;
    confirmStep(e.currentTarget, `确认清除 ${n} 条示例？`, () => {
      const data = ctx.getData();
      ctx.replaceData({ ...data, works: data.works.filter((w) => !w.isDemo) }, { dirty: true });
      renderState();
      ctx.toast('示例作品已清除（尚未同步）');
    });
  });

  byId('discard-draft').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    confirmStep(btn, '确认放弃全部本地修改？', () => run(btn, '恢复中…', async () => {
      try {
        const { data, sha } = await fetchRemoteDataset();
        clearDraft();
        lastConflict = false;
        ctx.replaceData(data, { dirty: false, baseSha: sha });
        ctx.toast('已恢复为线上数据');
      } catch (err) {
        ctx.toast(err.message || '读取线上数据失败', 'error');
      }
    }));
  });
}

export function openSyncDialog() {
  const cfg = fillForm();
  byId('gh-settings').open = !cfg.token;
  renderState();
  dlg.showModal();
}
