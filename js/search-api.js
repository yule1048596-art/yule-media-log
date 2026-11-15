// 余録 · YUROKU — Metadata Auto-Complete (Bangumi v0 + Wikipedia zh/ja Fallback)

const CATEGORY_TO_BGM_TYPES = {
  anime: [2],
  manga: [1],
  novel: [1],
  game: [4],
  jdrama: [6],
  movie: [6, 2]
};

function formatInfoboxVal(val) {
  if (Array.isArray(val)) {
    return val
      .map((item) => (typeof item === 'object' && item !== null ? item.v : item))
      .filter(Boolean)
      .slice(0, 3)
      .join(' / ');
  }
  return String(val ?? '').trim();
}

function createTimeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    return AbortSignal.timeout(ms);
  }
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

/** Prefer Bangumi's 400px rendition: sharp enough for posters, far lighter than the original. */
function bangumiCover(images, fallback = '') {
  const pick = images?.common || images?.medium || images?.large || fallback || '';
  return String(pick).replace(/^(https?:\/\/lain\.bgm\.tv)\/pic\//, '$1/r/400/pic/');
}

async function searchBangumi(query, category) {
  const types = CATEGORY_TO_BGM_TYPES[category] || [1, 2, 4, 6];
  const res = await fetch('https://api.bgm.tv/v0/search/subjects?limit=8', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      keyword: query,
      filter: { type: types }
    }),
    signal: createTimeoutSignal(8000)
  });
  if (!res.ok) throw new Error(`Bangumi HTTP ${res.status}`);
  const payload = await res.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  return rows.map((item) => {
    const cn = String(item.name_cn || '').trim();
    const raw = String(item.name || '').trim();
    const title = cn || raw || '未命名';
    const originalTitle = cn && raw && cn !== raw ? raw : '';
    const yearMatch = String(item.date || '').match(/^(\d{4})/);
    const coverUrl = bangumiCover(item.images, item.image);
    return {
      source: 'bangumi',
      sourceId: item.id,
      title,
      originalTitle,
      releaseYear: yearMatch ? Number(yearMatch[1]) : null,
      coverUrl,
      thumbUrl: item.images?.small || item.images?.grid || coverUrl,
      platform: String(item.platform || '').trim(),
      creator: '',
      progressTotal: null,
      progressText: '',
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 4).map((t) => t.name).filter(Boolean) : []
    };
  });
}

async function searchWikipediaLang(query, lang) {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.searchParams.set('action', 'query');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', query);
  url.searchParams.set('gsrlimit', '6');
  url.searchParams.set('prop', 'pageimages|extracts');
  url.searchParams.set('piprop', 'original|thumbnail');
  url.searchParams.set('pithumbsize', '480');
  url.searchParams.set('exintro', '1');
  url.searchParams.set('explaintext', '1');
  url.searchParams.set('exchars', '120');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  const res = await fetch(url.toString(), { signal: createTimeoutSignal(8000) });
  if (!res.ok) throw new Error(`Wikipedia(${lang}) HTTP ${res.status}`);
  const payload = await res.json();
  const pages = Object.values(payload?.query?.pages || {}).sort((a, b) => (a.index ?? 99) - (b.index ?? 99));

  return pages.map((p) => {
    const extract = String(p.extract || '');
    const yr = extract.match(/(19\d{2}|20\d{2})年?/);
    return {
      source: `wiki-${lang}`,
      sourceId: p.pageid,
      title: String(p.title || ''),
      originalTitle: '',
      releaseYear: yr ? Number(yr[1]) : null,
      coverUrl: p.thumbnail?.source || p.original?.source || '',
      thumbUrl: p.thumbnail?.source || '',
      platform: lang === 'ja' ? 'Wikipedia JA' : '维基百科',
      creator: '',
      progressTotal: null,
      progressText: '',
      tags: []
    };
  });
}

export async function searchMediaMetadata(query, category, source = 'bangumi') {
  const q = String(query || '').trim();
  if (!q) return [];
  if (source === 'wiki') {
    const hasKana = /[\u3040-\u30ff]/.test(q);
    const primary = await searchWikipediaLang(q, hasKana ? 'ja' : 'zh');
    if (primary.length > 0) return primary;
    return searchWikipediaLang(q, hasKana ? 'zh' : 'ja');
  }
  return searchBangumi(q, category);
}

export async function enrichBangumiSubject(subjectId) {
  const res = await fetch(`https://api.bgm.tv/v0/subjects/${encodeURIComponent(subjectId)}`, {
    headers: { Accept: 'application/json' },
    signal: createTimeoutSignal(8000)
  });
  if (!res.ok) throw new Error(`Bangumi detail HTTP ${res.status}`);
  const item = await res.json();

  const infobox = Array.isArray(item.infobox) ? item.infobox : [];
  const creatorKeys = ['导演', '监督', '作者', '原作', '开发', '开发商', '制作', '脚本'];
  let creator = '';
  for (const key of creatorKeys) {
    const found = infobox.find((row) => row?.key === key);
    if (found) {
      creator = formatInfoboxVal(found.value);
      if (creator) break;
    }
  }

  const totalEps = Number(item.eps || item.total_episodes || 0) || null;
  const totalVols = Number(item.volumes || 0) || null;
  const progressTotal = totalEps || totalVols || null;
  const unit = totalEps ? '话' : totalVols ? '卷' : '';
  const progressText = progressTotal && unit ? `全 ${progressTotal} ${unit}` : '';
  const coverUrl = bangumiCover(item.images, item.image);

  return { creator, progressTotal, progressText, coverUrl };
}
