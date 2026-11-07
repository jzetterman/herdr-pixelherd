// Checks the mods' color block against requirement 4 of the layout spec, for every
// theme in a JSON file of captured theme() objects keyed by theme name:
//
//   node tools/check-colors.mjs [--root <package folder>] <themes.json>
//
// First it confirms each shared module (colors.js, look.js) is byte-identical in every
// mod folder. Then it runs the block's colors(t) on each theme and checks the result
// with its own color math: its own candidate set, label distances, each label's
// distance from the blocked color (palettes 0-2 as a triple, 3-5 farthest first), palette identity, fills, each surface's hover (the theme's
// hover over that surface, weakened only as its labels need, and at least CIEDE2000 2
// from it otherwise), every role's contrast on its background and on its surface's
// hover (and no role outside its tier tables), a card's hover border no fainter than
// its resting border, fainter than the focused one and at least halfway from it, and the pulse's lowest phase. It prints one line per theme, a
// note for each hover under CIEDE2000 2 and why, and exits non-zero on any failure.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---- Color math, written apart from colors.js. A typo in one copy alone shows up
// where the two disagree; a typo copied into both shows up only in the known answers
// and round trips of tools/check-colors.test.mjs.

const parse = (hex) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex ?? "");
  if (!m) throw new Error(`not a color: ${hex}`);
  const n = parseInt(m[1], 16);
  return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
};
const hexOf = (rgb) => "#" + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
const toLinear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const toByte = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

// `top` (any alpha, times `extra`) drawn over the opaque `bottom`, blended in sRGB.
export function over(top, bottom, extra = 1) {
  const t = parse(top), b = parse(bottom), a = t.a * extra;
  return hexOf(t.rgb.map((v, i) => v * a + b.rgb[i] * (1 - a)));
}
const luminance = (hex) => { const [r, g, b] = parse(hex).rgb.map(toLinear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
// WCAG 2 contrast of two opaque colors.
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// OKLab from linear sRGB and back (Ottosson's matrices).
export function oklab(hex) {
  const [r, g, b] = parse(hex).rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function linearFromOklab([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inside = (lin) => lin.every((v) => v >= -1e-7 && v <= 1 + 1e-7);
// The sRGB color at OKLCH (L, C, h), with C lowered only as far as sRGB needs.
export function fromLch(L, C, h) {
  const at = (c) => linearFromOklab([L, c * Math.cos(h), c * Math.sin(h)]);
  let c = C;
  if (!inside(at(c))) {
    let ok = 0, bad = C;
    while (bad - ok > 1e-6) { const mid = (ok + bad) / 2; if (inside(at(mid))) ok = mid; else bad = mid; }
    c = ok;
  }
  return hexOf(at(c).map((v) => toByte(Math.min(1, Math.max(0, v)))));
}

// CIE L*a*b* (D65) and CIEDE2000.
function cielab(hex) {
  const [r, g, b] = parse(hex).rgb.map(toLinear);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
export function deltaE00([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + G), ap2 = a2 * (1 + G);
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hue = (b, a) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const hp1 = hue(b1, ap1), hp2 = hue(b2, ap2);
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = hp2 - hp1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2, Cb = (Cp1 + Cp2) / 2;
  let hb = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) hb = Math.abs(hp1 - hp2) <= 180 ? hb / 2 : hb < 360 ? (hb + 360) / 2 : (hb - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cb, SH = 1 + 0.015 * Cb * T;
  const RT = -2 * Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
// CIEDE2000 between two opaque hex colors.
export const dE = (a, b) => deltaE00(cielab(a), cielab(b));

// A theme color as drawn on the opaque chrome when it carries alpha, else as "#rrggbb".
const solid = (hex, chrome) => (parse(hex).a < 1 ? over(hex, chrome) : hex.slice(0, 7).toLowerCase());
// The chrome itself is the bottom surface: a translucent one is drawn opaque, its alpha
// dropped, as the block does.
const opaqueChrome = (t) => parse(t.chrome) && t.chrome.slice(0, 7).toLowerCase();

// Requirement 4's candidate rule, by a scan of OKLCH lightness in small steps, then a
// bisection inside the first step that passes: the least move that reaches 5:1 on
// chrome, hue kept, chroma lowered only for sRGB; a gray stays gray; with no lightness
// reaching 5:1, black or white, whichever contrasts more.
const KEYS = ["ansi1", "ansi2", "ansi3", "ansi4", "ansi5", "ansi6", "ansi9", "ansi10", "ansi11", "ansi12", "ansi13", "ansi14", "accent", "foreground"];
function reference(hex, bg) {
  if (contrast(hex, bg) >= 5) return hex;
  const [L, A, B] = oklab(hex);
  const [r, g, b] = parse(hex).rgb;
  const C = r === g && g === b ? 0 : Math.hypot(A, B), h = Math.atan2(B, A);
  let best = null;
  for (const dir of [1, -1]) {
    for (let d = 0.0005; L + dir * d >= 0 && L + dir * d <= 1; d += 0.0005) {
      if (contrast(fromLch(L + dir * d, C, h), bg) < 5) continue;
      let lo = d - 0.0005, hi = d;
      for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (contrast(fromLch(L + dir * mid, C, h), bg) >= 5) hi = mid; else lo = mid; }
      if (!best || hi < best.d) best = { d: hi, x: fromLch(L + dir * hi, C, h) };
      break;
    }
  }
  if (best) return best.x;
  return contrast("#ffffff", bg) > contrast("#000000", bg) ? "#ffffff" : "#000000";
}
export function candidates(t) {
  const chrome = opaqueChrome(t);
  return KEYS.map((key) => {
    const hex = reference(solid(t[key], chrome), chrome);
    return { key, hex, lab: cielab(hex) };
  });
}

// ---- What requirement 4 asks of each role. P: 4.5:1, S: 3:1, N: no bar. Every role
// a set holds must be named here: the check fails any other.
export const P = 4.5, S = 3, N = 0;
export const GENERIC = {
  base: N, text: P, offline: P, dim: S, muted: S, ahead: S, behind: S, working: S, blocked: S, done: S,
  idle: S, unknown: S, divider: S, highlight: S, blockedMark: S, blockedTint: N, hoverBg: N, hoverText: S, raisedBg: N,
};
export const CARD = {
  ...GENERIC, line: S, sub: S, badgeIdle: P, badgeWorking: P, badgeBlocked: P, badgeDone: P, badgeUnknown: P,
  star: N, dock: N, lineHover: S,
};
export const HEAD = { label: P, line: S, count: S, spaceName: S, iconTop: S, iconBase: S, fill: N };
const PULSING = new Set(["badgeWorking", "badgeBlocked"]);
// The roles the mods draw inside hovered rows (menu items, machine headers, space and
// rail rows, sub-agent rows, fold and pin buttons): each must declare its surface's
// hover (a header's: chrome's) and meet its tier there too.
const ALL_BUT = (tiers, ...not) => new Set(Object.keys(tiers).filter((k) => !not.includes(k)));
const HOVERED_GENERIC = ALL_BUT(GENERIC, "base", "divider", "raisedBg");
// Card titles and the active row's name (text) never sit on a hovered card fill.
const HOVERED_CARD = new Set([...HOVERED_GENERIC, "sub"].filter((k) => k !== "text"));
const HOVERED_HEAD = ALL_BUT(HEAD, "fill");

// The block solves each fixed label's surfaces to its bar plus this much, so byte
// rounding never leaves one a hair under it.
const MARGIN = 0.02;
// Each opaque surface draws its own hover: the theme's hover (often translucent) over
// that surface, as Herdr draws it, weakened only as far as the labels drawn on it need
// to keep their tier plus MARGIN (`labels`: [color, bar]); a label under that on the
// surface itself is left out, since no hover keeps it. The largest such amount in
// hundredths, and the full hover.
const mixed = (a, b, t) => { const p = parse(a).rgb, q = parse(b).rgb; return hexOf(p.map((v, i) => v + (q[i] - v) * t)); };
function expectedHover(hover, base, all) {
  const full = over(hover, base);
  const labels = all.filter(([l, bar]) => contrast(l, base) >= bar + MARGIN);
  let k = 100;
  while (k > 0 && !labels.every(([l, bar]) => contrast(l, mixed(base, full, k / 100)) >= bar + MARGIN)) k--;
  return { full, k };
}
// The least CIEDE2000 a hover keeps from its surface, unless its labels or the theme's
// own hover keep it closer.
const HOVER_FLOOR = 2;

// Every failure of colors(t) on one theme, as readable lines; empty when it passes.
// `notes` collects the hovers under HOVER_FLOOR from their surface, with the reason.
export function checkTheme(t, colorsFn, notes = []) {
  const fail = [];
  let c;
  try { c = colorsFn(t); } catch (e) { return [`colors(t) threw: ${e.stack ?? e}`]; }
  const chrome = opaqueChrome(t);
  const pulse = c.pulseLow;
  if (!(pulse >= 0.45 && pulse <= 1)) fail.push(`pulse low opacity ${pulse} is outside [0.45, 1]`);
  const pals = c.palettes ?? [];
  // It is the lowest in hundredths from 0.45 at which every pulsing badge keeps 3:1
  // (plus MARGIN): one step lower must miss somewhere.
  try {
    const pulsing = pals.flatMap((p) => [...PULSING].map((k) => p.roles?.[k])).filter(Boolean);
    const lower = Math.round(pulse * 100 - 1) / 100;
    if (pulsing.length && lower >= 0.45 && pulsing.every((r) => contrast(over(r.ink, r.on, lower), r.on) >= S + MARGIN)) {
      fail.push(`pulse low opacity ${pulse} is not the lowest that passes: ${lower} keeps 3:1`);
    }
  } catch (e) { fail.push(`pulse: ${e.message}`); }

  // Each set's hover, on its own surface. Labels on hovered chrome: every machine
  // name, at 4.5:1; on a hovered card fill: its palette's label (sub-agent names), at
  // 3:1; on the popover and raised rows: the theme's foreground, at 4.5:1.
  const hovers = {};
  const fg = solid(t.foreground, chrome);
  const surfaces = [
    ["chrome roles", c.roles, chrome, pals.map((p) => [p.label, P])],
    ["menu roles", c.menu, solid(t.popover, chrome), [[fg, P]]],
    ["raised roles", c.raised, solid(t.raised, chrome), [[fg, P]]],
    ...pals.map((p, i) => [`palette ${i} card roles`, p.roles, p.fill, [[p.label, S]]]),
  ];
  for (const [where, set, base, labels] of surfaces) {
    const h = set?.hoverBg?.ink;
    hovers[where] = h;
    try {
      if (parse(h).a !== 1) { fail.push(`${where} hoverBg ${h} is not opaque`); continue; }
      const { full, k } = expectedHover(t.hover, base, labels);
      const near = (x) => parse(x).rgb.every((v, i) => Math.abs(v - parse(h).rgb[i]) <= 1.5);
      if (![k - 1, k, k + 1].some((j) => j >= 0 && j <= 100 && near(mixed(base, full, j / 100)))) {
        fail.push(`${where} hoverBg ${h} is not the theme's hover over ${base} (${full}) at ${k}%, the most its labels allow`);
      }
      const gap = dE(h, base);
      if (gap < HOVER_FLOOR) {
        if (k < 100) notes.push(`${where} hoverBg ${h}: CIEDE2000 ${gap.toFixed(2)} from ${base}, held to ${k}% by its labels`);
        else if (dE(full, base) < HOVER_FLOOR) notes.push(`${where} hoverBg ${h}: CIEDE2000 ${gap.toFixed(2)} from ${base}, the theme's own hover there`);
        else fail.push(`${where} hoverBg ${h}: CIEDE2000 ${gap.toFixed(2)} from its surface ${base}, needs ${HOVER_FLOOR}`);
      }
    } catch (e) { fail.push(`${where} hoverBg: ${e.message}`); }
  }

  // Each role's composited contrast on the background it names, and on the hover
  // background when it is drawn on hovered rows.
  const roles = (where, set, tiers, base, hovered, hover) => {
    if (!set) return fail.push(`${where}: missing`);
    // Closed world: a role outside the tables has no tier, so nothing would check it.
    for (const name of Object.keys(set)) if (!(name in tiers)) fail.push(`${where} ${name}: not a role the tier tables name`);
    for (const [name, bar] of Object.entries(tiers)) {
      const r = set[name];
      if (!r) { fail.push(`${where} ${name}: missing`); continue; }
      try {
        if (r.on !== base) fail.push(`${where} ${name}: on ${r.on}, but it sits on ${base}`);
        if (parse(r.on).a !== 1) fail.push(`${where} ${name}: on ${r.on} is not opaque`);
        const bg = r.under ? over(r.under, r.on) : r.on;
        const a = parse(r.ink).a;
        if (Math.abs(a - r.opacity) > 1 / 255 + 1e-9) fail.push(`${where} ${name}: ink ${r.ink} does not carry opacity ${r.opacity}`);
        const k = contrast(over(r.ink, bg), bg);
        if (k < bar) fail.push(`${where} ${name}: ${k.toFixed(2)}:1 on ${bg}, needs ${bar}:1`);
        if (PULSING.has(name)) {
          const low = contrast(over(r.ink, bg, pulse), bg);
          if (low < S) fail.push(`${where} ${name}: pulse low phase ${low.toFixed(2)}:1 on ${bg}, needs 3:1`);
        }
        if (hovered.has(name) && r.hover !== hover) fail.push(`${where} ${name}: hover ${r.hover}, but it is drawn on hovered rows, on ${hover}`);
        if (r.hover !== undefined) {
          const hb = r.under ? over(r.under, r.hover) : r.hover;
          const kh = contrast(over(r.ink, hb), hb);
          if (kh < bar) fail.push(`${where} ${name}: ${kh.toFixed(2)}:1 on the hover background ${hb}, needs ${bar}:1`);
        }
      } catch (e) { fail.push(`${where} ${name}: ${e.message}`); }
    }
  };
  for (const [where, set, base] of surfaces.slice(0, 3)) roles(where, set, GENERIC, base, HOVERED_GENERIC, hovers[where]);

  if (pals.length < 6) fail.push(`${pals.length} palettes, needs at least 6`);
  const own = candidates(t);
  pals.forEach((p, i) => {
    const where = `palette ${i}`;
    try {
      if (contrast(p.label, chrome) < P) fail.push(`${where} label ${p.label}: ${contrast(p.label, chrome).toFixed(2)}:1 on chrome, needs 4.5:1`);
      if (contrast(p.label, p.fill) < P) fail.push(`${where} label ${p.label}: ${contrast(p.label, p.fill).toFixed(2)}:1 on its fill, needs 4.5:1`);
      const near = Math.min(...own.map((x) => dE(x.hex, p.label)));
      if (near > 0.5) fail.push(`${where} label ${p.label} is not a candidate (nearest at CIEDE2000 ${near.toFixed(2)})`);
      if (p.head?.label?.color !== p.label) fail.push(`${where} head label ${p.head?.label?.color} is not the palette label ${p.label}`);
    } catch (e) { fail.push(`${where}: ${e.message}`); }
    roles(`${where} card roles`, p.roles, CARD, p.fill, HOVERED_CARD, hovers[`${where} card roles`]);
    // A hovered card's border must not fade below its resting border, nor look like a
    // focused card's (the highlight): at least half as far from it as the resting
    // border is, and never under CIEDE2000 2 (0.05 of slack for the block's own math);
    // and, once stronger than the resting border, fainter than the focused one.
    try {
      const { line, lineHover, highlight } = p.roles ?? {};
      const k = (r) => contrast(over(r.ink, r.on), r.on);
      if (line && lineHover) {
        if (k(lineHover) < k(line) - 1e-9) fail.push(`${where} card roles lineHover: ${k(lineHover).toFixed(2)}:1 is fainter than line's ${k(line).toFixed(2)}:1`);
      }
      if (line && lineHover && highlight && lineHover.opacity > line.opacity + 1e-9 && k(lineHover) >= k(highlight)) {
        fail.push(`${where} card roles lineHover: ${k(lineHover).toFixed(2)}:1 is not fainter than the focused border's ${k(highlight).toFixed(2)}:1`);
      }
      if (line && lineHover && highlight) {
        const focus = over(highlight.ink, highlight.on);
        const gap = dE(over(lineHover.ink, lineHover.on), focus);
        const need = Math.max(2, dE(over(line.ink, line.on), focus) / 2 - 0.05);
        if (gap < need) fail.push(`${where} card roles lineHover: CIEDE2000 ${gap.toFixed(2)} from the focused border (highlight), needs ${need.toFixed(2)}`);
      }
    } catch (e) { fail.push(`${where} lineHover: ${e.message}`); }
    // Headers and space rows sit on chrome, so they hover with chrome's hover.
    roles(`${where} header roles`, p.head, HEAD, chrome, HOVERED_HEAD, hovers["chrome roles"]);
  });

  // Labels 0..2. With a triple of candidates 10 apart pairwise: 10 apart, and clear of
  // the alarm color (the blocked color, brought to 5:1 as its badge is): of those
  // triples, the one whose member nearest the blocked color is farthest from it, ties
  // to the larger smallest pairwise distance. With none: as far apart as any three
  // candidates can be (the max-min triple). Either way palette 0, this computer's, is
  // the one of the three farthest from the blocked color, so an IDLE badge never reads
  // as NEEDS YOU, and palettes 1 and 2 keep candidate order.
  if (pals.length >= 3) {
    try {
      const blocked = reference(solid(t.blocked, chrome), chrome);
      const from = (hex) => dE(hex, blocked);
      const spread = (x, y, z) => Math.min(dE(x, y), dE(x, z), dE(y, z));
      const nearest = (...xs) => Math.min(...xs.map(from));
      let best = 0;
      const clear = [];
      for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) for (let k = j + 1; k < own.length; k++) {
        const m = spread(own[i].hex, own[j].hex, own[k].hex);
        best = Math.max(best, m);
        if (m >= 10) clear.push({ spread: m, nearest: nearest(own[i].hex, own[j].hex, own[k].hex) });
      }
      const [a, b, d] = pals;
      const near = spread(a.label, b.label, d.label);
      if (best >= 10 && near < 10) fail.push(`palettes 0-2: smallest label distance ${near.toFixed(2)}, needs 10`);
      if (best < 10 && Math.abs(near - best) > 0.5) fail.push(`palettes 0-2: smallest label distance ${near.toFixed(2)}, needs the max-min triple's ${best.toFixed(2)} (within 0.5)`);
      if (clear.length && near >= 10) {
        const mine = nearest(a.label, b.label, d.label);
        const farthest = Math.max(...clear.map((x) => x.nearest));
        if (mine < farthest - 0.5) fail.push(`palettes 0-2: nearest label CIEDE2000 ${mine.toFixed(2)} from the blocked color ${blocked}, but a triple 10 apart keeps ${farthest.toFixed(2)} from it`);
        // A tie on that distance (the same member nearest) goes to the wider spread.
        // Measured on this script's own candidates, so a tie here is a tie there.
        const [x, y, z] = [a, b, d].map((p) => own.reduce((m, o) => (dE(o.hex, p.label) < dE(m.hex, p.label) ? o : m)).hex);
        const tied = clear.filter((o) => Math.abs(o.nearest - nearest(x, y, z)) < 1e-9);
        const wider = Math.max(...tied.map((o) => o.spread));
        if (tied.length && spread(x, y, z) < wider - 0.5) fail.push(`palettes 0-2: smallest label distance ${near.toFixed(2)}, but a triple as far from the blocked color reaches ${wider.toFixed(2)}`);
      }
      if (from(a.label) < Math.max(from(b.label), from(d.label)) - 0.5) fail.push(`palette 0 label ${a.label}: CIEDE2000 ${from(a.label).toFixed(2)} from the blocked color ${blocked}, but palette ${from(b.label) > from(d.label) ? 1 : 2} is ${Math.max(from(b.label), from(d.label)).toFixed(2)} from it`);
      // Each label's place in candidate order: its nearest candidate's.
      const rank = (p) => own.reduce((m, x, k) => (dE(x.hex, p.label) < dE(own[m].hex, p.label) ? k : m), 0);
      if (rank(b) > rank(d)) fail.push(`palettes 1 and 2 (${b.label}, ${d.label}) are not in candidate order`);
      // Palettes 3..5: the remaining distinct candidates (not palettes 0-2's, one per
      // color), farthest from the blocked color first, while any remain; past that the
      // palettes wrap, which the identity check below covers. Ties within 0.5 pass.
      const taken = new Set([a, b, d].map((p) => own[rank(p)].hex));
      const left = own.filter((x, k) => !taken.has(x.hex) && own.findIndex((y) => y.hex === x.hex) === k);
      for (let i = 3; i < Math.min(6, pals.length) && left.length; i++) {
        const k = rank(pals[i]);
        const at = left.findIndex((x) => x.hex === own[k].hex);
        if (at === -1) { fail.push(`palette ${i} label ${pals[i].label} is not one of the candidates palettes 0 to ${i - 1} left`); break; }
        const top = left.reduce((m, x) => (from(x.hex) > from(m.hex) ? x : m));
        if (from(own[k].hex) < from(top.hex) - 0.5) fail.push(`palette ${i} label ${pals[i].label}: CIEDE2000 ${from(own[k].hex).toFixed(2)} from the blocked color ${blocked}, but the remaining candidate ${top.hex} is ${from(top.hex).toFixed(2)} from it`);
        left.splice(at, 1);
      }
    } catch (e) { fail.push(`palettes 0-5: ${e.message}`); }
  }

  // No two palettes alike; each fill is chrome moved toward its label by one small
  // amount, the largest that passes.
  const keyOf = (p) => JSON.stringify([p.label, p.line, p.fill, p.dock]);
  for (let i = 0; i < pals.length; i++) for (let j = i + 1; j < pals.length; j++) {
    if (keyOf(pals[i]) === keyOf(pals[j])) fail.push(`palettes ${i} and ${j} are identical`);
  }
  try {
    const amounts = pals.map((p, i) => {
      const [c0, l, f] = [chrome, p.label, p.fill].map((x) => parse(x).rgb);
      const d = l.map((v, k) => v - c0[k]);
      const amount = d.reduce((s, v, k) => s + v * (f[k] - c0[k]), 0) / d.reduce((s, v) => s + v * v, 0);
      const off = Math.max(...f.map((v, k) => Math.abs(v - (c0[k] + amount * d[k]))));
      if (off > 1.5) fail.push(`palette ${i} fill ${p.fill} is not chrome mixed toward its label`);
      if (amount < -0.005 || amount > 0.105) fail.push(`palette ${i} fill amount ${amount.toFixed(3)} is outside [0, 0.10]`);
      return amount;
    });
    if (amounts.length && Math.max(...amounts) - Math.min(...amounts) > 0.012) fail.push(`fill amounts differ across palettes: ${amounts.map((a) => a.toFixed(3)).join(", ")}`);
    // The amount is the largest, in steps of 1/400 up to 10%, at which every label,
    // card title (the foreground) and badge word (each brought to 5:1 on chrome) keeps
    // 4.5:1 on every fill, and the highlight 3:1, each plus MARGIN. One step of slack,
    // since this script's 5:1 colors can differ from the block's by a byte.
    const keep = ["foreground", "working", "blocked", "done", "unknown"].map((k) => reference(solid(t[k], chrome), chrome));
    const lit = reference(solid(t.accent, chrome), chrome);
    const passes = (f) => pals.every((p) => {
      const fill = mixed(chrome, p.label, f);
      return contrast(p.label, fill) >= P + MARGIN && contrast(lit, fill) >= S + MARGIN && keep.every((x) => contrast(x, fill) >= P + MARGIN);
    });
    let largest = 0;
    for (let i = 40; i > 0; i--) if (passes(i / 400)) { largest = i / 400; break; }
    if (amounts.length && Math.min(...amounts) < largest - 1 / 400 - 0.003) fail.push(`fill amount ${Math.min(...amounts).toFixed(3)} is below ${largest.toFixed(3)}, the largest that passes`);
  } catch (e) { fail.push(`fills: ${e.message}`); }
  return fail;
}

// ---- Shared modules and the block itself.

const SHARED = ["colors.js", "look.js"];
// Failures for each shared module that is not byte-identical in every mod under `root`.
export function sameBlocks(root) {
  const mods = path.join(root, "mods");
  const fail = [];
  const dirs = fs.readdirSync(mods).filter((d) => fs.existsSync(path.join(mods, d, "colors.js")));
  if (dirs.length < 2) fail.push(`found colors.js in ${dirs.length} mod folder(s) under ${mods}, needs 2`);
  for (const file of SHARED) {
    const copies = dirs.filter((d) => fs.existsSync(path.join(mods, d, file)));
    if (!copies.length) continue;
    if (copies.length !== dirs.length) fail.push(`${file} is missing from some mod folders`);
    const first = fs.readFileSync(path.join(mods, copies[0], file));
    for (const d of copies.slice(1)) if (!first.equals(fs.readFileSync(path.join(mods, d, file)))) fail.push(`${file} copies differ: mods/${copies[0]} and mods/${d}`);
  }
  return { fail, dirs: dirs.map((d) => path.join(mods, d)) };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The block's exports, loaded through the harness so its "herdr" import resolves.
export async function loadColors(modDir) {
  await import("./harness/hooks.mjs");
  const dir = modDir ?? sameBlocks(path.join(HERE, "..")).dirs[0];
  return import(pathToFileURL(path.join(dir, "colors.js")).href);
}

async function main(argv) {
  let root = path.join(HERE, "..");
  const args = [...argv];
  const at = args.indexOf("--root");
  if (at !== -1) { root = path.resolve(args[at + 1]); args.splice(at, 2); }
  if (args.length !== 1) { console.error("usage: node tools/check-colors.mjs [--root <package folder>] <themes.json>"); return 2; }
  const blocks = sameBlocks(root);
  if (blocks.fail.length) { for (const f of blocks.fail) console.log(`FAIL ${f}`); return 1; }
  const { colors } = await loadColors(blocks.dirs[0]);
  const themes = JSON.parse(fs.readFileSync(args[0], "utf8"));
  let bad = 0;
  const near = { themes: 0, labels: 0, own: 0 };
  for (const [name, t] of Object.entries(themes)) {
    const notes = [];
    const fail = checkTheme(t, colors, notes);
    if (fail.length) { bad++; console.log(`${name}: FAIL`); for (const f of fail) console.log(`  ${f}`); }
    else {
      const c = colors(t);
      console.log(`${name}: pass (labels ${c.palettes.slice(0, 3).map((p) => p.label).join(" ")}, pulse ${c.pulseLow})`);
    }
    for (const n of notes) console.log(`  note: ${n}`);
    if (notes.length) near.themes++;
    near.labels += notes.filter((n) => n.includes("by its labels")).length;
    near.own += notes.filter((n) => n.includes("theme's own")).length;
  }
  console.log(`hovers under CIEDE2000 ${HOVER_FLOOR} from their surface: ${near.labels + near.own} in ${near.themes} themes (${near.labels} held by labels, ${near.own} the theme's own hover)`);
  console.log(`${Object.keys(themes).length - bad} of ${Object.keys(themes).length} themes pass`);
  return bad ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
