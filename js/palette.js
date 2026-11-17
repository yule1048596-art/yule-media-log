// 余録 · YUROKU — colours from cover art for the work page header (Apple Music–style)
//
// extractPalette() samples a cover (Bangumi and Wikimedia allow cross-origin reads)
// and returns its dominant and most vivid colours. bandScheme() turns them into a set
// of design tokens whose text colours always clear WCAG contrast on the header colour.

const STORE_KEY = 'yuroku_palettes_v2';
const MAX_STORED = 300;
const memory = new Map();
let stored = null;

const WHITE = [251, 250, 247];
const BLACK = [22, 21, 19];

// ---------- colour maths ----------

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
export const toHex = (c) => `#${c.map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;
export function fromHex(hex) {
  const m = String(hex).replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgba = (c, a) => `rgba(${c.map(clamp255).join(', ')}, ${a})`;

function luminance(c) {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Move `color` toward `toward` until it reaches `target` contrast against `against`.
 * Works on whole RGB values, so the colour that is finally written as hex still clears the target.
 */
function ensureContrast(color, against, target, toward) {
  for (let i = 0; i <= 50; i += 1) {
    const c = mix(color, toward, i / 50).map(clamp255);
    if (contrast(c, against) >= target) return c;
  }
  return toward.map(clamp255);
}

function chroma(c) {
  return (Math.max(...c) - Math.min(...c)) / 255;
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------- extraction ----------

function analyse(data) {
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // 3 bits per channel: coarse enough that one colour area lands in one bucket
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const s = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    s.n += 1;
    s.r += r;
    s.g += g;
    s.b += b;
    buckets.set(key, s);
  }
  const ranked = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 24)
    .map((s) => ({ n: s.n, c: [s.r / s.n, s.g / s.n, s.b / s.n] }));
  if (!ranked.length) return null;

  // The base is the most prominent colour, favouring colourful areas over large neutral ones
  // (a yellow poster with white figures should read as yellow, a black-and-white one stays neutral).
  let dominant = ranked[0].c;
  let bestBase = 0;
  for (const { n, c } of ranked) {
    const score = n * (0.22 + chroma(c));
    if (score > bestBase) {
      bestBase = score;
      dominant = c;
    }
  }
  // The accent is the most vivid colour that covers a meaningful area and differs from the base.
  let accent = null;
  let best = 0;
  for (const { n, c } of ranked) {
    const ch = chroma(c);
    if (ch < 0.18) continue;
    const score = ch * Math.sqrt(n) * (distance(c, dominant) > 70 ? 1 : 0.35);
    if (score > best) {
      best = score;
      accent = c;
    }
  }
  return { dominant: toHex(dominant), accent: accent ? toHex(accent) : null };
}

function loadStore() {
  if (stored) return stored;
  try {
    stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    stored = {};
  }
  return stored;
}

function remember(url, palette) {
  memory.set(url, palette);
  const all = loadStore();
  all[url] = palette;
  const keys = Object.keys(all);
  if (keys.length > MAX_STORED) for (const k of keys.slice(0, keys.length - MAX_STORED)) delete all[k];
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked: the in-memory copy still serves this visit
  }
}

/** A palette already known for this cover URL, or null. */
export function cachedPalette(url) {
  if (memory.has(url)) return memory.get(url);
  const hit = loadStore()[url];
  if (hit) memory.set(url, hit);
  return hit || null;
}

const inflight = new Map();
// Covers that failed to load or whose host forbids reading them: not retried during this visit,
// so opening such a work never waits on a request that is bound to fail again.
const unreadable = new Set();

/** Sample a cover image; resolves to { dominant, accent } or null if it cannot be read. */
export function extractPalette(url, timeout = 4000) {
  const hit = cachedPalette(url);
  if (hit) return Promise.resolve(hit);
  if (unreadable.has(url)) return Promise.resolve(null);
  if (inflight.has(url)) return inflight.get(url);
  const job = new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      inflight.delete(url);
      resolve(value);
    };
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 36;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const palette = analyse(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
        if (palette) remember(url, palette);
        finish(palette);
      } catch {
        unreadable.add(url); // tainted canvas: the host does not allow cross-origin reads
        finish(null);
      }
    };
    img.onerror = () => {
      unreadable.add(url);
      finish(null);
    };
    setTimeout(() => finish(null), timeout);
    img.src = url;
  });
  inflight.set(url, job);
  return job;
}

// ---------- schemes ----------

/**
 * Design tokens for the coloured header of a work page.
 * @param {{dominant: string, accent: string|null}} palette
 * @param {{dark: boolean}} opts dark: the site is in dark mode, so the header stays dark too
 */
export function bandScheme(palette, { dark = false } = {}) {
  const base = fromHex(palette.dominant) || [128, 128, 128];
  let tone = contrast(WHITE, base) >= contrast(BLACK, base) ? 'dark' : 'light';
  if (dark) tone = 'dark';
  const ink = tone === 'dark' ? WHITE : BLACK;
  const away = tone === 'dark' ? BLACK : WHITE;

  // Body text on the header must clear 7:1 (dark headers a little more, for a deeper, cinema-like tone;
  // a near-grey one deeper still, so it reads as calm charcoal rather than a flat grey slab);
  // deepen or lighten the cover colour until it does. Light headers are softened a touch.
  const start = tone === 'light' ? mix(base, WHITE, 0.14) : base;
  const target = tone === 'light' ? 7 : chroma(base) < 0.08 ? 12 : 8.5;
  const bg = ensureContrast(start, ink, target, away);
  const glow = mix(bg, tone === 'dark' ? WHITE : base, tone === 'dark' ? 0.1 : 0.35).map(clamp255);
  // The glow in the header's corner (drawn at up to 80% in components.css) always lowers contrast,
  // so secondary text and the accent are measured against its strongest point.
  const under = mix(bg, glow, 0.8).map(clamp255);

  // Pills in the cover's accent must stand out from the header (3:1) and carry a readable label
  // (4.5:1). Of a light label on a deepened accent and a dark label on a lightened one, take the
  // option that stays closest to the cover; moving away from the header keeps the 3:1, so one always fits.
  const raw = ensureContrast(fromHex(palette.accent || '') || mix(base, ink, 0.35), under, 3, ink);
  const { fill: accent, label: onAccent } = [WHITE, BLACK]
    .map((label) => {
      const fill = ensureContrast(raw, label, 4.5, label === WHITE ? BLACK : WHITE);
      return { fill, label, fits: contrast(fill, under) >= 3, shift: distance(fill, raw) };
    })
    .filter((option) => option.fits)
    .sort((a, b) => a.shift - b.shift)[0];

  return {
    tone,
    bg: toHex(bg),
    vars: {
      '--bg': toHex(bg),
      '--band-glow': toHex(glow),
      '--surface': toHex(mix(bg, ink, 0.08)),
      '--surface-2': toHex(mix(bg, ink, 0.12)),
      '--surface-3': toHex(mix(bg, ink, 0.18)),
      '--ink': toHex(ink),
      // Secondary text keeps 4.5:1; tertiary labels 3.5:1, the level of the site's own --ink-3
      '--ink-2': toHex(ensureContrast(mix(ink, bg, 0.3), under, 4.5, ink)),
      '--ink-3': toHex(ensureContrast(mix(ink, bg, 0.48), under, 3.5, ink)),
      '--line': toHex(mix(bg, ink, 0.16)),
      '--line-strong': toHex(mix(bg, ink, 0.26)),
      '--ring': rgba(ink, 0.12),
      // Focus rings (drawn in --accent) take the cover accent too, so they keep 3:1 on the header
      '--accent': toHex(accent),
      '--band-accent': toHex(accent),
      '--band-on-accent': toHex(onAccent),
      // Tags: a wash of the accent, held back where needed so their text keeps 4.5:1
      '--band-tag': toHex(ensureContrast(mix(bg, accent, 0.2), ink, 4.5, away)),
      '--band-tag-hover': toHex(ensureContrast(mix(bg, accent, 0.32), ink, 4.5, away))
    }
  };
}

/** The cover's accent, adjusted so links and marks read on the page background below the header. */
export function pageAccent(palette, pageBgHex, pageInkHex) {
  const pageBg = fromHex(pageBgHex) || WHITE;
  const pageInk = fromHex(pageInkHex) || BLACK;
  const accent = fromHex(palette.accent || '') || fromHex(palette.dominant) || pageInk;
  return {
    mark: toHex(ensureContrast(accent, pageBg, 3, pageInk)),
    text: toHex(ensureContrast(accent, pageBg, 4.5, pageInk))
  };
}
