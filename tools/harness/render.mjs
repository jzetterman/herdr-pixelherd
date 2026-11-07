// Renders this package's mods in Node through the stubs, and reads back what they drew.
// `render(role, opts)` takes a mod by its role ("spaces" or "agents", from its mod.json
// `cloned_from`), so the harness works after a rename too.

import "./hooks.mjs";
import fs from "node:fs";
import * as herdr from "./herdr.mjs";
import * as kit from "./gpui-kit.mjs";

export const ROOT = new URL("../../", import.meta.url);
export { herdr, kit };

// Each mod folder under mods/, keyed by the shipped mod it was cloned from.
export const MODS = Object.fromEntries(fs.readdirSync(new URL("mods/", ROOT)).flatMap((name) => {
  const json = new URL(`mods/${name}/mod.json`, ROOT);
  if (!fs.existsSync(json)) return [];
  return [[JSON.parse(fs.readFileSync(json, "utf8")).cloned_from?.name ?? name, name]];
}));
export const modUrl = (role, file = "") => new URL(`mods/${MODS[role]}/${file}`, ROOT);

const cx = { timer: { every() {} }, spawn() {}, notify() {} };

// One render of a mod. `setup(view)` runs after init (to fill state a real run fetches).
// `view`, a view from an earlier render's setup, renders that one again, with no init.
// `cwds` sets pane folders by pane id; the rest keep the stub's folder. `machines`,
// `agents`, `terminals` and `focused` replace what those return. `role` may instead be
// the URL of a mod's main.js.
export async function render(role, { width = 268, theme = {}, props = {}, cwds = {}, machines = null, agents = null, terminals = null, focused = null, setup, view = null } = {}) {
  herdr.state.width = width;
  herdr.state.machines = machines;
  herdr.state.agents = agents;
  herdr.state.terminals = terminals;
  herdr.state.focused = focused;
  herdr.state.theme = theme;
  herdr.state.props = props;
  herdr.state.cwds = cwds;
  if (view) return view.render(cx);
  const { default: V } = await import((role instanceof URL ? role : modUrl(role, "main.js")).href);
  const v = new V();
  v.init(props, cx);
  setup?.(v);
  return v.render(cx);
}

// The spaces mod learns machines from `hc machine ls`; the stub world has one other.
export const withMachines = (list = [{ name: "laptop", state: "connected" }]) => (v) => { v.machines = list; };

export const nodeOf = (p) => p?.__node ?? null;

// Every string a tree shows, in order.
export function texts(p, out = []) {
  const n = nodeOf(p);
  if (typeof p === "string") out.push(p);
  else if (n) for (const k of n.kids) texts(k, out);
  return out;
}

// Every element in a tree that `test(node)` accepts.
export function findAll(p, test, out = []) {
  const n = nodeOf(p);
  if (!n) return out;
  if (test(n)) out.push(n);
  for (const k of n.kids) findAll(k, test, out);
  return out;
}

// The last value passed to builder `name` on a node, or undefined.
export const last = (n, name) => n.calls.filter(([k]) => k === name).at(-1)?.[1];

const alphaOf = (ink) => (/^#[0-9a-f]{8}$/i.test(ink) ? parseInt(ink.slice(7), 16) : 255);
const lastArg = (n, name) => n.calls.filter(([k]) => k === name).at(-1)?.[1][0];

// Every color a tree draws, with the opaque background under it (`on`) and the
// translucent background between, if any (`under`). A text or border color sits on its
// element's own background; a background sits on its parent's. Text leaves (strings,
// svg icons) record the text color they inherit. An element with hover styles is drawn
// twice, plain and hovered (its hover styles over its own); everything inside a hovered
// element records `hover: true`. A hover style's background is a "hover bg": the hover
// of the surface it hovers, which is the element's own opaque background if it has one
// (a raised row), else its parent's. Elements inside a plain one are never hovered,
// since the pointer is not over them. An element's opacity() multiplies the alpha of
// every color drawn in it, its own background included; each record keeps that factor
// (`alpha`, 1 when nothing fades it) and its color before it (`plain`). A background
// record says whether its element is a line (`line`): 2 px or thinner one way and
// longer the other, as a rule line, a divider, a tree stroke or the drop line is; a
// dot (a star) or a wider bar (the dock's planks) is not. A record's `path` names the
// elements it sits in by kind, index and id ("div3#space-s1"), and a hovered state as
// ":hover". `base` is the opaque color the root sits on (the layout paints the sidebar).
export function colorRecords(p, base) {
  const out = [];
  // `free`: the pointer may be over n. Each hover style is its own hovered state.
  const walk = (n, ctx, hover, free, path) => {
    if (free) for (const h of n.hovers) draw(n, h, ctx, true, true, `${path}:hover`);
    draw(n, null, ctx, hover, free && !n.hovers.length, path);
  };
  // n with hover style `h` (or none) applied.
  const draw = (n, h, ctx, hover, free, path) => {
    const alpha = ctx.alpha * ((h ? lastArg(h, "opacity") : undefined) ?? lastArg(n, "opacity") ?? 1);
    const fade = (ink) => (typeof ink === "string" && alpha < 1 ? ink.slice(0, 7) + Math.round(alphaOf(ink) * alpha).toString(16).padStart(2, "0") : ink);
    const raw = (name) => (h ? lastArg(h, name) : undefined) ?? lastArg(n, name);
    const push = (r, plain) => out.push({ ...r, alpha, plain });
    const w = lastArg(n, "w") ?? lastArg(n, "size"), ht = lastArg(n, "h") ?? lastArg(n, "size");
    const sides = [w, ht].filter((v) => typeof v === "number");
    const line = sides.some((v) => v <= 2) && !(sides.length === 2 && sides.every((v) => v <= 2));
    const bg = fade(raw("bg"));
    const plain = fade(lastArg(n, "bg"));
    if (h && lastArg(h, "bg") !== undefined) {
      const surface = plain !== undefined && alphaOf(plain) === 255 ? plain : ctx.on;
      push({ what: "hover bg", ink: bg, on: surface, under: surface === plain ? null : ctx.under, hover, path }, raw("bg"));
    } else if (bg !== undefined) push({ what: "bg", ink: bg, on: ctx.on, under: ctx.under, hover, path, line }, raw("bg"));
    let own = ctx;
    if (bg !== undefined && alphaOf(bg) > 0) {
      if (alphaOf(bg) === 255) own = { on: bg, under: null, text: ctx.text };
      else if (ctx.under) push({ what: "nested translucent background", ink: bg, on: ctx.on, under: ctx.under, path }, raw("bg"));
      else own = { on: ctx.on, under: bg, text: ctx.text };
    }
    own = { ...own, alpha };
    for (const what of ["text_color", "border_color"]) {
      if (raw(what) !== undefined) push({ what, ink: fade(raw(what)), on: own.on, under: own.under, hover, path }, raw(what));
    }
    // Text inherits its color unfaded and fades by the opacity where it is drawn.
    own = { ...own, text: raw("text_color") ?? own.text };
    if (n.kind === "svg") push({ what: "icon", ink: fade(own.text), on: own.on, under: own.under, hover, path }, own.text);
    n.kids.forEach((k, i) => {
      if (typeof k === "string" && k.trim()) push({ what: "text", ink: fade(own.text), on: own.on, under: own.under, hover, path: `${path}/${JSON.stringify(k)}` }, own.text);
      else if (nodeOf(k)) {
        const id = lastArg(nodeOf(k), "id");
        walk(nodeOf(k), own, hover, free, `${path}/${nodeOf(k).kind}${i}${id === undefined ? "" : `#${id}`}`);
      }
    });
  };
  walk(nodeOf(p), { on: base, under: null, text: null, alpha: 1 }, false, true, "root");
  return out;
}

// The role sets colors(t) draws on an opaque surface of their own, each with its hover.
export const surfaces = (c) => [c.roles, c.menu, c.raised, ...(c.palettes ?? []).map((p) => p.roles)].filter((s) => s?.base && s?.hoverBg);

// The "hover bg" records that are not the hover of the surface they hover (or, nested
// in a row already hovered, that same hover).
export function wrongHovers(records, c) {
  const sets = surfaces(c);
  return records.filter((r) => r.what === "hover bg" && !sets.some((s) => s.hoverBg.ink === r.ink && (s.base.ink === r.on || s.hoverBg.ink === r.on)));
}

// Every role colors(t) declares, with its name and the tier table its set uses
// (`tiers`: { generic, card, head }, as tools/check-colors.mjs exports them).
export function namedRoles(c, tiers) {
  const sets = [[c.roles, tiers.generic], [c.menu, tiers.generic], [c.raised, tiers.generic], ...(c.palettes ?? []).flatMap((p) => [[p.roles, tiers.card], [p.head, tiers.head]])];
  return sets.filter(([set]) => set).flatMap(([set, table]) => Object.entries(set).map(([name, role]) => ({ name, role, bar: table[name] })));
}

// Does `role` account for record `r`: its ink, on the background it names (or, hovered,
// on the hover it declares)?
const accounts = (x, r) => x.ink === r.ink && (x.under ?? null) === r.under && (x.on === r.on || (r.hover && x.hover === r.on));

// Every role colors(t) declares, wherever it sits in the result.
export function allRoles(c) {
  const sets = [c.roles, c.menu, c.raised, ...(c.palettes ?? []).flatMap((p) => [p.roles, p.head])];
  return sets.filter(Boolean).flatMap((set) => Object.values(set)).filter((r) => r && typeof r.ink === "string");
}

// The records no declared role accounts for: a color the block did not make, or one
// drawn on a background other than the one its role names. Inside a hovered element a
// role may also sit on the hover background it declares (`hover`). Fully transparent
// colors draw nothing and always pass.
export function unmatched(records, c) {
  const roles = allRoles(c);
  return records.filter((r) => {
    if (r.what === "nested translucent background") return true;
    if (typeof r.ink !== "string") return true;
    if (alphaOf(r.ink) === 0) return false;
    return !roles.some((x) => accounts(x, r));
  });
}

// The text, icon, border and line records that no role of tier 3:1 or above accounts
// for: requirement 4 puts everything drawn in the secondary tier at least (lines, the
// active-row bar and tinted icons by name), so a decorative role (no bar) may only fill
// a background that is not a line. Fully transparent colors draw nothing.
export function untiered(records, c, tiers) {
  const strong = namedRoles(c, tiers).filter((x) => x.bar >= 3).map((x) => x.role);
  const drawn = (r) => ["text", "icon", "border_color"].includes(r.what) || (r.what === "bg" && r.line);
  return records.filter((r) => drawn(r) && typeof r.ink === "string" && alphaOf(r.ink) > 0 && !strong.some((x) => accounts(x, r)));
}

// The records for text `s` that no role of tier `bar` or above accounts for, and how
// many records show it at all. Two roles can share an ink: one of the right tier is enough.
export function belowTier(records, c, tiers, s, bar) {
  const strong = namedRoles(c, tiers).filter((x) => x.bar >= bar).map((x) => x.role);
  const shown = records.filter((r) => r.what === "text" && r.path.endsWith(`/${JSON.stringify(s)}`));
  return { shown: shown.length, below: shown.filter((r) => !strong.some((x) => accounts(x, r))) };
}
