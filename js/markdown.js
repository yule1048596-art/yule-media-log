// 余録 · YUROKU — safe Markdown subset with spoilers, and generated fallback covers
//
// The compiler escapes the whole input first and only ever emits its own tags,
// so the output is safe to assign to innerHTML without a sanitizer.

import { esc, CATEGORY_BY_ID } from './meta.js';

export { esc as escapeHtml };

// URL characters: no whitespace, no placeholder marks; one level of balanced
// parentheses is allowed so links like …/Love_Letter_(1995_film) survive.
const LINK = /\[([^\]]+)\]\((https?:\/\/(?:[^\s()\u0000]|\([^\s()\u0000]*\))+)\)/g;

function formatInline(escaped) {
  // Code spans and links are parked as placeholders so no later rule
  // (bold, italic, spoilers) can rewrite text inside them.
  const parked = [];
  const park = (html) => {
    parked.push(html);
    return `\u0000${parked.length - 1}\u0000`;
  };
  let text = escaped.replace(/`([^`]+)`/g, (_, code) => park(`<code>${code}</code>`));
  text = text.replace(LINK, (_, label, url) => park(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`));
  text = text.replace(
    /\|\|([^|\n]+?)\|\|/g,
    (_, secret) => `<button type="button" class="spoiler" aria-pressed="false" title="剧透，点击显示"><span class="visually-hidden">剧透：</span>${secret}</button>`
  );
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
  // A link label may itself hold a parked code span, so unpark until stable.
  for (let pass = 0; pass < 3 && text.includes('\u0000'); pass += 1) {
    text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => parked[Number(i)]);
  }
  return text;
}

const BLOCK_START = /^(#{1,4}\s+|[-*]\s+|\d+[.)]\s+|&gt;|```|-{3,}$|\*{3,}$|:::\s*spoiler)/;

function compileBlocks(escaped) {
  const lines = escaped.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) { i += 1; continue; }

    if (trimmed.startsWith('```')) {
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { code.push(lines[i]); i += 1; }
      i += 1;
      out.push(`<pre><code>${code.join('\n')}</code></pre>`);
      continue;
    }

    const spoiler = trimmed.match(/^:::\s*spoiler(?:\s+(.*))?$/);
    if (spoiler) {
      const inner = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== ':::') { inner.push(lines[i]); i += 1; }
      i += 1;
      const title = spoiler[1]?.trim() ? formatInline(spoiler[1].trim()) : '点击展开';
      out.push(
        `<details class="spoiler-block"><summary><span class="spoiler-tag">剧透</span>${title}</summary>` +
        `<div class="spoiler-body prose">${compileBlocks(inner.join('\n'))}</div></details>`
      );
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) { out.push('<hr>'); i += 1; continue; }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const tag = heading[1].length >= 4 ? 'h4' : 'h3';
      out.push(`<${tag}>${formatInline(heading[2])}</${tag}>`);
      i += 1;
      continue;
    }

    if (trimmed.startsWith('&gt;')) {
      const quote = [];
      while (i < lines.length && lines[i].trim().startsWith('&gt;')) {
        quote.push(formatInline(lines[i].trim().replace(/^&gt;\s?/, '')));
        i += 1;
      }
      out.push(`<blockquote><p>${quote.join('<br>')}</p></blockquote>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(`<li>${formatInline(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(`<li>${formatInline(lines[i].trim().replace(/^\d+[.)]\s+/, ''))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i].trim())) {
      para.push(formatInline(lines[i].trim()));
      i += 1;
    }
    if (para.length) out.push(`<p>${para.join('<br>')}</p>`);
    else { out.push(`<p>${formatInline(trimmed)}</p>`); i += 1; }
  }
  return out.join('');
}

export function compileMarkdown(md) {
  const text = String(md ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return '';
  return compileBlocks(esc(text));
}

// ---------- Fallback covers ----------

const COVER_TONES = {
  movie: { bg: '#34506e', en: 'FILM' },
  jdrama: { bg: '#7a4536', en: 'DRAMA' },
  manga: { bg: '#3c6150', en: 'MANGA' },
  anime: { bg: '#534a7e', en: 'ANIME' },
  novel: { bg: '#7c6230', en: 'NOVEL' },
  game: { bg: '#3d4756', en: 'GAME' }
};

function wrapTitle(title, maxWeight = 8.6, maxLines = 4) {
  const tokens = String(title).match(/\([^)]{1,12}\)|（[^）]{1,12}）|[A-Za-z0-9.'+-]+|\s+|./gu) || [];
  const weight = (s) => [...s].reduce((acc, ch) => acc + (/[ -~]/.test(ch) ? 0.56 : 1), 0);
  const lines = [];
  let line = '';
  let w = 0;
  for (const tok of tokens) {
    const tw = weight(tok);
    if (w > 0 && w + tw > maxWeight) {
      lines.push(line.trim());
      if (lines.length === maxLines) {
        lines[maxLines - 1] = lines[maxLines - 1].replace(/[，、。·\s]+$/, '') + '…';
        return lines;
      }
      line = tok.trimStart();
      w = weight(line);
    } else {
      line += tok;
      w += tw;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

export function fallbackCover(work) {
  const tone = COVER_TONES[work?.category] || COVER_TONES.novel;
  const label = CATEGORY_BY_ID[work?.category]?.label || '作品';
  const lines = wrapTitle(work?.title || '未命名');
  const fontSize = lines.length > 3 ? 20 : 22;
  const lineH = fontSize * 1.32;
  const startY = 172 - ((lines.length - 1) * lineH) / 2;
  const tspans = lines
    .map((l, idx) => `<tspan x="120" y="${(startY + idx * lineH).toFixed(1)}">${esc(l)}</tspan>`)
    .join('');
  const byline = String(work?.creator || work?.platform || '').split('/')[0].trim().slice(0, 16);
  const year = work?.releaseYear ? String(work.releaseYear) : '';
  const font = "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360" viewBox="0 0 240 360">` +
    `<rect width="240" height="360" fill="${tone.bg}"/>` +
    `<rect x="14" y="14" width="212" height="332" fill="none" stroke="#fff" stroke-opacity=".2"/>` +
    `<text x="120" y="52" text-anchor="middle" fill="#fff" fill-opacity=".72" font-family="${font}" font-size="11" letter-spacing="3">${esc(label)} · ${tone.en}</text>` +
    `<text text-anchor="middle" fill="#fff" font-family="${font}" font-size="${fontSize}" font-weight="700">${tspans}</text>` +
    (byline ? `<text x="120" y="300" text-anchor="middle" fill="#fff" fill-opacity=".78" font-family="${font}" font-size="12">${esc(byline)}</text>` : '') +
    (year ? `<text x="120" y="322" text-anchor="middle" fill="#fff" fill-opacity=".55" font-family="${font}" font-size="11" letter-spacing="2">${year}</text>` : '') +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function coverSrc(work) {
  const url = String(work?.coverUrl || '').trim();
  return /^https?:\/\//i.test(url) ? url : fallbackCover(work);
}
