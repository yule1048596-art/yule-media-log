// 余録 · YUROKU — Safe Markdown + Spoiler Compiler & Procedural Bunkobon Covers

const SAFE_ELEMENTS = [
  'h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'em', 'del',
  'blockquote', 'ul', 'ol', 'li', 'code', 'pre', 'a',
  'details', 'summary', 'div', 'span', 'button'
];

const SAFE_ATTRS = ['href', 'target', 'rel', 'class', 'type', 'title'];

let domPurifyPromise = null;

export function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatInline(escapedLine) {
  const codeTokens = [];
  let text = escapedLine.replace(/`([^`]+)`/g, (_, code) => {
    const idx = codeTokens.push(`<code>${code}</code>`) - 1;
    return `\u0000CODE${idx}\u0000`;
  });

  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  text = text.replace(/\|\|([^|\n]+?)\|\|/g, (_, secret) => {
    return `<button type="button" class="spoiler-inline" title="点击显示/隐藏剧透">${secret}</button>`;
  });
  text = text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  text = text.replace(/~~([^~]+?)~~/g, '<del>$1</del>');

  return text.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeTokens[Number(i)]);
}

function compileBlocks(escapedText) {
  const lines = escapedText.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
      continue;
    }

    if (/^:::\s*spoiler(?:\s+(.*))?$/.test(trimmed)) {
      const titleMatch = trimmed.match(/^:::\s*spoiler(?:\s+(.*))?$/);
      const spoilerTitle = titleMatch?.[1]?.trim() || '点击展开剧透内容';
      const innerLines = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== ':::') {
        innerLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      const innerHtml = compileBlocks(innerLines.join('\n'));
      out.push(
        `<details class="spoiler-block"><summary class="spoiler-summary">剧透折叠 · ${spoilerTitle}</summary><div class="spoiler-content">${innerHtml}</div></details>`
      );
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (trimmed.startsWith('&gt; ')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('&gt; ')) {
        quoteLines.push(formatInline(lines[i].trim().slice(5)));
        i += 1;
      }
      out.push(`<blockquote><p>${quoteLines.join('<br>')}</p></blockquote>`);
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

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(`<li>${formatInline(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{2,4}\s+|[-*]\s+|\d+\.\s+|&gt;\s+|```|---+$|:::\s*spoiler)/.test(lines[i].trim())
    ) {
      paraLines.push(formatInline(lines[i].trim()));
      i += 1;
    }
    out.push(`<p>${paraLines.join('<br>')}</p>`);
  }

  return out.join('\n');
}

export function compileMarkdown(mdText) {
  const normalized = String(mdText ?? '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return '<p class="field-hint">暂无长篇观后感，点击下方“编辑评价”即可记录。</p>';
  }
  return compileBlocks(escapeHtml(normalized));
}

function loadDOMPurify() {
  domPurifyPromise ??= Promise.race([
    import('https://esm.run/dompurify').then((mod) => mod.default ?? mod),
    new Promise((resolve) => setTimeout(() => resolve(null), 800))
  ]).catch(() => null);
  return domPurifyPromise;
}

function scrubNodeFallback(node, doc) {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.tagName.toLowerCase();
  if (!SAFE_ELEMENTS.includes(tag)) return null;
  const clean = doc.createElement(tag);
  for (const attr of SAFE_ATTRS) {
    if (!node.hasAttribute(attr)) continue;
    const val = node.getAttribute(attr) ?? '';
    if (attr === 'href' && !/^https?:\/\//i.test(val)) continue;
    clean.setAttribute(attr, val);
  }
  for (const child of node.childNodes) {
    const cleanChild = scrubNodeFallback(child, doc);
    if (cleanChild) clean.appendChild(cleanChild);
  }
  return clean;
}

export async function safeSetHTML(el, html) {
  let inserted = false;
  if ('setHTML' in Element.prototype) {
    try {
      el.setHTML(html, { sanitizer: { elements: SAFE_ELEMENTS, attributes: SAFE_ATTRS } });
      inserted = true;
    } catch {
      inserted = false;
    }
  }
  if (!inserted) {
    const DOMPurify = await loadDOMPurify();
    if (DOMPurify?.sanitize) {
      el.innerHTML = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [...SAFE_ELEMENTS, '#text'],
        ALLOWED_ATTR: SAFE_ATTRS,
        ALLOW_ARIA_ATTR: false,
        ALLOW_DATA_ATTR: false,
        KEEP_CONTENT: false
      });
    } else {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const frag = document.createDocumentFragment();
      for (const child of parsed.body.childNodes) {
        const clean = scrubNodeFallback(child, document);
        if (clean) frag.appendChild(clean);
      }
      el.replaceChildren(frag);
    }
  }
  for (const btn of el.querySelectorAll('.spoiler-inline')) {
    btn.setAttribute('aria-expanded', 'false');
  }
}

const CATEGORY_PALETTES = {
  movie: { band: '#23476e', label: '映画 / MOVIE' },
  jdrama: { band: '#8c3b2b', label: '日劇 / J-DRAMA' },
  manga: { band: '#2f5e46', label: '漫画 / MANGA' },
  anime: { band: '#534375', label: '動画 / ANIME' },
  novel: { band: '#9e6514', label: '小説 / NOVEL' },
  game: { band: '#3a4956', label: '遊戯 / GAME' }
};

export function buildFallbackCoverDataUrl(work) {
  const palette = CATEGORY_PALETTES[work?.category] || CATEGORY_PALETTES.novel;
  const title = String(work?.title || '未命名作品');
  const creator = String(work?.creator || work?.platform || '余録私蔵');
  const year = work?.releaseYear ? String(work.releaseYear) : 'ARCHIVE';
  const lines = [];
  for (let idx = 0; idx < title.length && lines.length < 4; idx += 7) {
    lines.push(title.slice(idx, idx + 7));
  }
  const tspans = lines
    .map((line, idx) => `<tspan x="120" dy="${idx === 0 ? 0 : 28}">${escapeHtml(line)}</tspan>`)
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360" viewBox="0 0 240 360">
    <rect width="240" height="360" fill="#f5efe3"/>
    <rect x="12" y="12" width="216" height="336" fill="none" stroke="#c8beab" stroke-width="1.5"/>
    <rect x="12" y="254" width="216" height="94" fill="${palette.band}"/>
    <text x="26" y="42" fill="${palette.band}" font-size="11" font-family="monospace" letter-spacing="1.5">${escapeHtml(palette.label)}</text>
    <text x="120" y="126" text-anchor="middle" fill="#1c1917" font-size="21" font-weight="700" font-family="serif">${tspans}</text>
    <text x="120" y="294" text-anchor="middle" fill="#fcf9f2" font-size="13" font-family="sans-serif">${escapeHtml(creator.slice(0, 18))}</text>
    <text x="120" y="322" text-anchor="middle" fill="#e6dccb" font-size="11" font-family="monospace">${escapeHtml(year)}</text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
