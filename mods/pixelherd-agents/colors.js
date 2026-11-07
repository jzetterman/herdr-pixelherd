// The sidebar's one color block. This file is byte-identical in both sidebar mods
// (tools/search.sh and tools/check-colors.mjs compare the copies). Every color the mods
// draw comes from here, computed from the current theme(): a theme color as is, or one
// moved in OKLCH lightness, or a mix of two theme colors. Nothing else in the mods reads
// theme() or writes a color.
//
// colors(t) returns role sets. A role is { color, opacity, ink, on, under?, hover? }:
// `ink` is what to draw (color plus alpha), `on` the opaque background it sits on,
// `under` a translucent background between them, `hover` the opaque hover background
// it also sits on when its row is hovered (`under` stays between). Its contrast meets
// its tier on each: primary 4.5:1, secondary 3:1, decorative none. Each set's surface
// has its own hover, its `hoverBg`: the theme's hover drawn over that surface.
//   roles      on chrome (the sidebar)        menu   on popover (the sort menu)
//   raised     on raised (a selected row)     clear  a transparent color
//   palettes   six machine palettes: { label, line, fill, dock, head, roles }, where
//              head sits on chrome (machine headers, space rows) and roles on the fill
//              (cards, the active space row)
//   pulseLow   the pulsing badges' lowest opacity
// currentColors() is colors(theme()), worked out again only when the theme changes.

import { theme } from "herdr";

// ---- sRGB and WCAG 2.

// "#rgb", "#rgba", "#rrggbb" or "#rrggbbaa" to [r, g, b] (0..255) and alpha (0..1); null if not a color.
function parse(hex) {
  let s = typeof hex === "string" && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex) ? hex.slice(1) : null;
  if (!s) return null;
  if (s.length <= 4) s = [...s].map((d) => d + d).join("");
  const n = (i) => parseInt(s.slice(i, i + 2), 16);
  return { rgb: [n(0), n(2), n(4)], a: s.length === 8 ? n(6) / 255 : 1 };
}
// Answers remembered within one colors() call, which asks the same questions many
// times over: read() per color string, role() per argument list, and adjust()'s
// tries per color and lightness. Each is a pure function of its key, so a remembered
// answer is the one a fresh call would give. colors() empties them at its start.
// Callers never change what these return (role() hands out copies).
const parsed = new Map(), roles = new Map(), tries = new Map();
// parse(), remembered.
function read(hex) {
  let c = parsed.get(hex);
  if (c === undefined) parsed.set(hex, (c = parse(hex)));
  return c;
}
// A channel value as the whole byte write() spells.
const round = (v) => Math.round(Math.min(255, Math.max(0, v)));
const byte = (v) => round(v).toString(16).padStart(2, "0");
const write = (rgb) => "#" + rgb.map(byte).join("");
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const enc = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
// WCAG 2 relative luminance of whole bytes [r, g, b], and of a color. LIN is lin() of
// each byte, worked out once. (Indexed, not destructured: QuickJS destructures an
// array through its iterator, slowly.)
const LIN = Array.from({ length: 256 }, (_, v) => lin(v));
const lumOf = (rgb) => 0.2126 * LIN[rgb[0]] + 0.7152 * LIN[rgb[1]] + 0.0722 * LIN[rgb[2]];
const lum = (hex) => lumOf(read(hex).rgb);
// Math.min(...xs.map(f)), with no arrays built: the searches below need it thousands of times.
function worst(xs, f) {
  let m = Infinity;
  for (let i = 0; i < xs.length; i++) m = Math.min(m, f(xs[i], i));
  return m;
}
// WCAG 2 contrast of two luminances, and of two opaque colors.
const ratio = (x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
const contrast = (a, b) => ratio(lum(a), lum(b));
// The bytes `p` moved toward the bytes `q` by `t` (0..1), in sRGB, rounded as write() rounds.
const blend = (p, q, t) => [round(p[0] + (q[0] - p[0]) * t), round(p[1] + (q[1] - p[1]) * t), round(p[2] + (q[2] - p[2]) * t)];
// `a` moved toward `b` by `t`.
const mix = (a, b, t) => write(blend(read(a).rgb, read(b).rgb, t));
// `ink` (with its alpha, times `extra`) drawn over the opaque `bg`.
function over(ink, bg, extra = 1) {
  const { rgb, a } = read(ink);
  return write(blend(read(bg).rgb, rgb, a * extra));
}

// ---- OKLCH (Ottosson's OKLab, in polar form).

// oklch() and fromOklch() are exported for the known-answer and round-trip tests only
// (tools/check-colors.test.mjs).
export function oklch(hex) {
  const [r, g, b] = read(hex).rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const [R, G, Bl] = read(hex).rgb;
  return { L, C: R === G && G === Bl ? 0 : Math.hypot(A, B), h: Math.atan2(B, A) };
}
// Linear sRGB at OKLCH (L, C, h), given h as its cosine and sine (worked out once per
// hue by the callers, which try many L and C at one h).
function linearAt(L, C, cos, sin) {
  const A = C * cos, B = C * sin;
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const TOP = 1 + 1e-6;
// Whether linearAt(L, C, cos, sin) is in sRGB (each channel in -1e-6..1+1e-6): the same
// sums in the same order, with no array and an early out, since the chroma search
// below asks it up to 25 times per color it makes.
function fits(L, C, cos, sin) {
  const A = C * cos, B = C * sin;
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  if (!(r >= -1e-6 && r <= TOP)) return false;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  if (!(g >= -1e-6 && g <= TOP)) return false;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return b >= -1e-6 && b <= TOP;
}
// fromOklch() as whole bytes [r, g, b], the bytes write() would spell. A caller that
// tries many L at one h passes its cosine and sine.
function oklchBytes(L, C, h, cos = Math.cos(h), sin = Math.sin(h)) {
  let c = C;
  if (!fits(L, c, cos, sin)) {
    let lo = 0, hi = c;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(L, mid, cos, sin)) lo = mid; else hi = mid; }
    c = lo;
  }
  return linearAt(L, c, cos, sin).map((v) => round(enc(Math.min(1, Math.max(0, v)))));
}
// The color at OKLCH (L, C, h), its chroma lowered only as far as sRGB needs.
export const fromOklch = (L, C, h) => write(oklchBytes(L, C, h));

// `hex` made to reach `target`:1 on `bg` (or on each of an array of backgrounds),
// keeping its hue: OKLCH lightness moves by the least amount that does it (up or down);
// a color already there stays. If no lightness does, black or white, whichever
// contrasts more.
function adjust(hex, bg, target = 5) {
  const bgs = [].concat(bg);
  const low = (x) => Math.min(...bgs.map((b) => contrast(x, b)));
  if (low(hex) >= target) return hex;
  const { L, C, h } = oklch(hex), cos = Math.cos(h), sin = Math.sin(h);
  // A try works in bytes, not hex: the same bytes and luminance its hex would give,
  // with no string to build and parse. Tries are kept per color and lightness: a try
  // depends on nothing else, and solves of one color on other backgrounds take the
  // same bisection steps until their answers part.
  let tried = tries.get(hex);
  if (!tried) tries.set(hex, (tried = new Map()));
  const at = (l) => {
    l = Math.min(1, Math.max(0, l));
    let x = tried.get(l);
    if (!x) { const rgb = oklchBytes(l, C, h, cos, sin); tried.set(l, (x = { rgb, y: lumOf(rgb) })); }
    return x;
  };
  const ys = bgs.map(lum);
  const passes = (dir, d) => { const { y } = at(L + dir * d); return worst(ys, (b) => ratio(y, b)) >= target; };
  // Each direction (up first) that reaches the target at its far end bisects 24 times
  // for the least move that does; its answer is its final `hi`. The two bisect side by
  // side. The nearer answer wins, up on a tie. A search's `lo` only rises, its `hi` only
  // falls, and lo <= hi, so its answer stays in [lo, hi]: once up.lo > down.hi, down
  // wins whatever the remaining steps find, and once down.lo >= up.hi, up does. The
  // loser then stops, which leaves the result as if both had taken all 24 steps.
  let searches = [1, -1].map((dir) => ({ dir, lo: 0, hi: dir > 0 ? 1 - L : L })).filter((r) => r.hi > 0 && passes(r.dir, r.hi));
  for (let i = 0; i < 24; i++) {
    for (const r of searches) { const mid = (r.lo + r.hi) / 2; if (passes(r.dir, mid)) r.hi = mid; else r.lo = mid; }
    if (searches.length === 2) {
      const [up, down] = searches;
      if (up.lo > down.hi) searches = [down];
      else if (down.lo >= up.hi) searches = [up];
    }
  }
  if (searches.length) {
    const best = searches.length === 2 && searches[1].hi < searches[0].hi ? searches[1] : searches[0];
    return write(at(L + best.dir * best.hi).rgb);
  }
  const black = fromOklch(0, 0, 0), white = fromOklch(1, 0, 0);
  return low(white) > low(black) ? white : black;
}

// ---- CIEDE2000, for telling labels apart.

function cielab(hex) {
  const [r, g, b] = read(hex).rgb.map(lin);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function ciede2000(p, q) {
  const deg = 180 / Math.PI;
  const c7 = (c) => Math.sqrt(c ** 7 / (c ** 7 + 6103515625));
  const g = 0.5 * (1 - c7((Math.hypot(p[1], p[2]) + Math.hypot(q[1], q[2])) / 2));
  const polar = ([L, a, b]) => { const a1 = a * (1 + g); return [L, Math.hypot(a1, b), a1 === 0 && b === 0 ? 0 : (Math.atan2(b, a1) * deg + 360) % 360]; };
  const [L1, C1, h1] = polar(p), [L2, C2, h2] = polar(q);
  let dh = C1 * C2 === 0 ? 0 : h2 - h1;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin(dh / 2 / deg);
  const L = (L1 + L2) / 2, C = (C1 + C2) / 2;
  let h = h1 + h2;
  if (C1 * C2 !== 0) h = Math.abs(h1 - h2) <= 180 ? h / 2 : (h < 360 ? h + 360 : h - 360) / 2;
  const T = 1 - 0.17 * Math.cos((h - 30) / deg) + 0.24 * Math.cos((2 * h) / deg) + 0.32 * Math.cos((3 * h + 6) / deg) - 0.2 * Math.cos((4 * h - 63) / deg);
  const sl = 1 + (0.015 * (L - 50) ** 2) / Math.sqrt(20 + (L - 50) ** 2), sc = 1 + 0.045 * C, sh = 1 + 0.015 * C * T;
  const rt = -2 * c7(C) * Math.sin((60 * Math.exp(-(((h - 275) / 25) ** 2))) / deg);
  const dl = (L2 - L1) / sl, dc = (C2 - C1) / sc, dhh = dH / sh;
  return Math.sqrt(dl * dl + dc * dc + dhh * dhh + rt * dc * dhh);
}

// ---- Roles.

const PRIMARY = 4.5, SECONDARY = 3, DECOR = 0;
// What roles and the pulse solve for: their bar and this much more, so a color rounded
// to whole bytes never lands a hair under the bar.
const MARGIN = 0.02;

// `color` at `opacity` on the opaque `on`, and on `hover` if given (through the
// translucent `under`, if any). If the color misses `bar` (plus MARGIN) at full
// strength on either, it is first adjusted to reach it (its tier, not the candidates'
// 5:1, so a secondary role stays fainter than a primary one); then its opacity rises
// as far as the worse of the two needs.
function role(color, opacity, bar, on, under = null, hover = null) {
  const key = [color, opacity, bar, on, under, hover].join(" ");
  let r = roles.get(key);
  if (r === undefined) roles.set(key, (r = solveRole(color, opacity, bar, on, under, hover)));
  return { ...r };
}
function solveRole(color, opacity, bar, on, under, hover) {
  const bgs = [on, hover].filter(Boolean).map((b) => (under ? over(under, b) : b));
  // The worst contrast of the opaque color `x` at alpha `a` (a byte) over the
  // backgrounds: over() and contrast() in bytes, with no strings to build and parse.
  // Every role color is "#rrggbb", so `x + byte(a)` reads back as alpha a / 255.
  const ys = bgs.map(lum), rgbs = bgs.map((b) => read(b).rgb);
  const low = (x, a) => { const rgb = read(x).rgb; return worst(rgbs, (p, i) => ratio(lumOf(blend(p, rgb, a / 255)), ys[i])); };
  const need = bar && bar + MARGIN;
  const c = bar && low(color, 255) < need ? adjust(color, bgs, need) : color;
  let a = Math.ceil(opacity * 255 - 1e-9);
  const passes = (x) => !bar || low(c, x) >= need;
  if (!passes(a)) {
    let lo = a, hi = 255;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (passes(mid)) hi = mid; else lo = mid; }
    a = hi;
  }
  return { color: c, opacity: a / 255, ink: a === 255 ? c : c + byte(a), on, ...(under ? { under } : {}), ...(hover ? { hover } : {}) };
}

// The roles every background needs. `pre` holds the colors to start from (on a card
// fill, the primary ones already brought to 5:1 on chrome). Every role but the
// background, the divider and the raised color can sit on a hovered row too, so it
// also meets its tier on `hover`, the hover of the background `on`.
function generic(T, on, pre, hover) {
  const fg = (color, opacity, bar, under = null) => role(color, opacity, bar, on, under, hover);
  const r = {
    base: role(on, 1, DECOR, on),
    text: fg(pre.foreground, 1, PRIMARY),
    offline: fg(pre.muted, 1, PRIMARY),
    dim: fg(T.dim, 1, SECONDARY),
    muted: fg(T.muted, 1, SECONDARY),
    ahead: fg(T.ansi2, 1, SECONDARY),
    behind: fg(T.ansi1, 1, SECONDARY),
    divider: role(T.border, 0.35, SECONDARY, on),
    highlight: fg(pre.highlight, 1, SECONDARY),
    hoverBg: fg(hover, 1, DECOR),
    hoverText: fg(T.foreground, 1, SECONDARY),
    raisedBg: role(T.raised, 1, DECOR, on),
  };
  for (const s of ["working", "blocked", "done", "idle", "unknown"]) r[s] = fg(T[s], 1, SECONDARY);
  r.blockedTint = fg(r.blocked.color, 0x26 / 255, DECOR);
  r.blockedMark = fg(r.blocked.color, 1, SECONDARY, r.blockedTint.ink);
  return r;
}

const CANDIDATES = ["ansi1", "ansi2", "ansi3", "ansi4", "ansi5", "ansi6", "ansi9", "ansi10", "ansi11", "ansi12", "ansi13", "ansi14", "accent", "foreground"];

// The theme as opaque lowercase "#rrggbb", a translucent color drawn on chrome. Herdr's
// theme() names every color this block reads (herdr.d.ts), so none needs a fallback.
function opaque(t) {
  const chrome = write(read(t.chrome).rgb);
  const T = { chrome };
  for (const [k, v] of Object.entries(t)) {
    const c = read(v);
    if (k !== "chrome" && c) T[k] = c.a < 1 ? over(v, chrome) : write(c.rgb);
  }
  return T;
}

// Every color the sidebar draws, for the theme() object `t`. Pure: the check script
// calls it on captured themes.
export function colors(t) {
  for (const m of [parsed, roles, tries]) m.clear();
  const T = opaque(t);
  const chrome = T.chrome;
  // What the roles on chrome, the menu and raised rows start from: the theme's
  // foreground and muted as they are, and the accent at 5:1 as the highlight.
  const start = { foreground: T.foreground, muted: T.muted, highlight: adjust(T.accent, chrome) };

  // Labels: the candidates, each brought to 5:1 on chrome. Palettes 0..2 take three
  // that keep clear of the alarm color, the blocked color (brought to 5:1, as its badge
  // is): of the triples at least CIEDE2000 10 apart pairwise, the one whose member
  // nearest the blocked color is farthest from it, a tie going to the larger smallest
  // pairwise distance. With no such triple, the three farthest apart (by that smallest
  // distance). Palette 0, this computer's, is the one of the three farthest from the
  // blocked color, so an IDLE badge never reads as NEEDS YOU; 1 and 2 keep candidate
  // order. 3..5 take the remaining distinct candidates, farthest from the blocked color
  // first (ties in candidate order).
  const blocked = adjust(T.blocked, chrome);
  const cands = CANDIDATES.map((k) => adjust(T[k], chrome));
  const labs = cands.map(cielab);
  // Only d[i][j] with i < j is read.
  const d = cands.map((_, i) => cands.map((_, j) => (i < j ? ciede2000(labs[i], labs[j]) : 0)));
  const away = labs.map((l) => ciede2000(l, cielab(blocked)));
  let spread = [0, 1, 2], far = -1, clear = null, clearAway = -1, clearFar = -1;
  for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) for (let k = j + 1; k < cands.length; k++) {
    const m = Math.min(d[i][j], d[i][k], d[j][k]);
    if (m > far) { far = m; spread = [i, j, k]; }
    const n = Math.min(away[i], away[j], away[k]);
    if (m >= 10 && (n > clearAway || (n === clearAway && m > clearFar))) { clear = [i, j, k]; clearAway = n; clearFar = m; }
  }
  const triple = clear ?? spread;
  const first = triple.reduce((m, i) => (away[i] > away[m] ? i : m));
  const labels = [first, ...triple.filter((i) => i !== first)].map((i) => cands[i]);
  const rest = cands.map((_, i) => i).filter((i) => !labels.includes(cands[i]) && cands.indexOf(cands[i]) === i);
  for (const i of rest.sort((i, j) => away[j] - away[i] || i - j)) if (labels.length < 6) labels.push(cands[i]);
  const distinct = new Set(labels).size;
  // Fewer than six distinct labels: wrap around them, so palette i reuses i % distinct.
  while (labels.length < 6) labels.push(labels[labels.length % distinct]);

  // Primary items drawn on a card fill start from 5:1 on chrome.
  const pre = { ...start, foreground: adjust(T.foreground, chrome), muted: adjust(T.muted, chrome) };
  const badge = { blocked, ...Object.fromEntries(["working", "done", "unknown"].map((s) => [s, adjust(T[s], chrome)])) };

  // The fill: chrome moved toward each label by the largest amount up to 10% at which
  // every label, title and badge word keeps 4.5:1 (and the highlight 3:1) on every fill,
  // each plus MARGIN.
  const ok = (f) => labels.every((l) => {
    const fill = mix(chrome, l, f);
    return contrast(l, fill) >= PRIMARY + MARGIN && contrast(pre.highlight, fill) >= SECONDARY + MARGIN
      && [pre.foreground, ...Object.values(badge)].every((x) => contrast(x, fill) >= PRIMARY + MARGIN);
  });
  let f = 0;
  for (let i = 40; i > 0; i--) if (ok(i / 400)) { f = i / 400; break; }

  // Hovers, one per opaque surface: the theme's hover drawn over that surface, as
  // Herdr draws it (it is often translucent), at the largest amount (in hundredths) at
  // which each label drawn on it keeps its tier (plus MARGIN), since a label's color is
  // fixed. On chrome: every label at 4.5:1 (machine names sit on hovered headers). On a
  // card fill: its own label at 3:1 (sub-agent names, in the label color). On the
  // popover and raised rows: the foreground at 4.5:1 (their text). `fixed`
  // lists them as [color, bar]; one that misses its bar on the surface itself can't be
  // kept by any hover and is left out. Roles drawn on a hovered surface solve against
  // its hover.
  const hoverOn = (base, all) => {
    const full = over(t.hover, base);
    const fixed = all.filter(([l, bar]) => contrast(l, base) >= bar);
    for (let i = 100; i > 0; i--) {
      const h = mix(base, full, i / 100);
      if (fixed.every(([l, bar]) => contrast(l, h) >= bar)) return h;
    }
    return base;
  };
  const hover = hoverOn(chrome, labels.map((l) => [l, PRIMARY + MARGIN]));

  const palettes = labels.map((label, i) => {
    const fill = mix(chrome, label, f);
    const fillHover = hoverOn(fill, [[label, SECONDARY + MARGIN]]);
    // With fewer than six labels, two palettes share a label and so a fill: a dock
    // amount that grows with i keeps all six palettes distinct.
    const dock = mix(fill, label, distinct >= 6 ? 0.35 : 0.25 + 0.05 * i);
    // The card border, and on hover the same border 0.25 stronger, though no nearer to
    // a focused card's border (the highlight) than half the resting border's distance
    // from it, nor than CIEDE2000 2 (plus a little, for rounding), and below the focused
    // border's contrast. When the accent is this label, all three are one color: the
    // hover then sits about halfway. Both are borders, so both meet 3:1 on the fill.
    const line = role(label, 0.45, SECONDARY, fill);
    const base = generic(T, fill, pre, fillHover);
    const focusInk = over(base.highlight.ink, fill), focus = cielab(focusInk);
    const apart = Math.max(2.1, ciede2000(cielab(over(line.ink, fill)), focus) / 2);
    const near = (a) => { const x = over(label + byte(a), fill); return ciede2000(cielab(x), focus) < apart || contrast(x, fill) >= contrast(focusInk, fill); };
    let strong = Math.round(Math.min(1, line.opacity + 0.25) * 255);
    while (strong > Math.round(line.opacity * 255) && near(strong)) strong--;
    const roles = {
      ...base,
      // Card titles and the active row's name never sit on a hovered fill.
      text: role(pre.foreground, 1, PRIMARY, fill),
      line,
      sub: role(label, 0.6, SECONDARY, fill, null, fillHover),
      badgeIdle: role(label, 0.8, PRIMARY, fill),
      badgeWorking: role(badge.working, 1, PRIMARY, fill),
      badgeBlocked: role(badge.blocked, 1, PRIMARY, fill),
      badgeDone: role(badge.done, 1, PRIMARY, fill),
      badgeUnknown: role(badge.unknown, 1, PRIMARY, fill),
      star: role(label, 0.6, DECOR, fill),
      dock: role(dock, 1, DECOR, fill),
      lineHover: role(label, strong / 255, SECONDARY, fill),
    };
    // Headers and space rows are hovered: all but the fill also sit on chrome's hover.
    const hh = (opacity, bar) => role(label, opacity, bar, chrome, null, hover);
    const head = {
      label: hh(1, PRIMARY),
      line: hh(0.45, SECONDARY),
      count: hh(0.6, SECONDARY),
      spaceName: hh(0.7, SECONDARY),
      iconTop: hh(1, SECONDARY),
      iconBase: hh(0.55, SECONDARY),
      fill: role(fill, 1, DECOR, chrome),
    };
    return { label, line: roles.line.ink, fill, dock, head, roles };
  });

  // The pulse: the lowest opacity from 0.45 at which every pulsing badge keeps 3:1
  // (plus MARGIN).
  const pulses = palettes.flatMap((p) => [p.roles.badgeWorking, p.roles.badgeBlocked]);
  let pulseLow = 1;
  for (let i = 45; i <= 100; i++) {
    if (pulses.every((r) => contrast(over(r.ink, r.on, i / 100), r.on) >= SECONDARY + MARGIN)) { pulseLow = i / 100; break; }
  }

  return {
    roles: generic(T, chrome, start, hover),
    // The popover's and raised rows' text is the theme's foreground: their hovers keep it at 4.5:1.
    menu: generic(T, T.popover, start, hoverOn(T.popover, [[start.foreground, PRIMARY + MARGIN]])),
    raised: generic(T, T.raised, start, hoverOn(T.raised, [[start.foreground, PRIMARY + MARGIN]])),
    palettes,
    pulseLow,
    clear: "#00000000",
  };
}

let cache = null;
// colors(theme()), kept until the theme changes: a render comes with every hover and
// status change, and the full computation is too heavy to repeat each time.
export function currentColors() {
  const t = theme();
  const key = JSON.stringify(t);
  if (cache?.key !== key) cache = { key, value: colors(t) };
  return cache.value;
}
