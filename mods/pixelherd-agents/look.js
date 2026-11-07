// The pixel look both sidebar mods share. This file is byte-identical in both mod
// folders (a mod can't import another mod's file); tools/search.sh checks that.
// It reads no theme and holds no color: callers pass colors in from colors.js. Its one
// host read is layout(), for the sidebar's width.

import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { layout } from "herdr";

// The DOS font Herdr ships in mods/win98/fonts/. Regular face only: no weight methods.
export const PX = "PxPlus IBM VGA 8x16";
export const localLabel = "This machine";

// Below 160 px the sidebar is Herdr's rail. It goes by the width, not a flag:
// dragging the sidebar's edge narrows it too.
export const isRail = (width) => width < 160;

// The node with `id` in a layout() tree, depth first; null if there is none.
export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's width in px, which each list fills: the width budget's input and the
// rail's (isRail()). With no sidebar in the layout, 480 px, the widest the layout lets
// it grow: never the rail.
export const sidebarWidth = () => find(layout(), "sidebar")?.size?.px ?? 480;

// An agent's machine, from its address ("laptop/t4"); null for this computer.
export const machineOf = (a) => (a.address.includes("/") ? a.address.split("/")[0] : null);

// Every machine in palette order: this computer (null), then the other names from
// machines(), spaces() and agent addresses, sorted. Call once per render and pass it
// down: each host read copies a whole list.
export function machineList(machines, spaces, agents) {
  const names = new Set();
  for (const m of machines) if (m.name) names.add(m.name);
  for (const s of spaces) if (s.machine) names.add(s.machine);
  for (const a of agents) if (machineOf(a)) names.add(machineOf(a));
  return [null, ...[...names].sort()];
}

// A machine's palette index by its place in machineList(), wrapped to `count`
// palettes; a machine not listed takes the next place.
export function paletteIndex(machine, list, count) {
  const i = list.indexOf(machine ?? null);
  return (i === -1 ? list.length : i) % count;
}

// Every padding, gap and size the mods draw and the width budget below counts, each in
// one place: change one here and both the drawing and the budget follow. Text sizes
// are in px.
//   list     each list: px on both sides
//   head     a machine header: pl, pr, its icon's width, the name's size, the size of
//            its state and Connect text, of the spaces count and of the agents
//            "working/total"
//   add      a machine header's +: px and the glyph's size
//   connect  a rebuilt header's problem and Connect: the gap between, the icon's size
//   mark     an agents status mark: its width, the spinner's size, the square's size
//   card     an agent card: ml, mr, its border, p inside it, the scene's size and its
//            gap, the title's size
//   pin      a card's pin button: p around its icon
//   badge    a card's status word: px, its border, its size
//   sub      a card's subtitle: its size and the gap before the fold
//   fold     a card's sub-agent fold: px, the chevron's size, the gap after it, the
//            count's size
//   row      a space row: ml, the active bar (its left border), pl, pr, the name's
//            size, a worktree's branch icon, the git tail's text size and its gap
//   section  the SPACES and AGENTS headers: the title's size, the SPACES + button,
//            the AGENTS sort icon
export const BOX = {
  list: { px: 8 },
  head: { pl: 6, pr: 2, icon: 13, name: 14, text: 11, count: 14, busy: 13 },
  add: { px: 3, size: 14 },
  connect: { gap: 3, icon: 12 },
  mark: { w: 14, spinner: 12, dot: 7 },
  card: { ml: 6, mr: 2, border: 2, p: 6, scene: 76, gap: 10, title: 16 },
  pin: { p: 2, icon: 13 },
  badge: { px: 4, border: 1, size: 12 },
  sub: { size: 12, gap: 4 },
  fold: { px: 3, chevron: 11, gap: 3, size: 11 },
  row: { ml: 6, bar: 3, pl: 8, pr: 6, name: 14, branch: 13, git: 11.5, gap: 5 },
  section: { title: 14, add: 26, sort: 14 },
};

// A machine header's inks, from colors.js's `c` and the machine's palette `p`: its
// icon's top and base, its name and its rule line. Out of reach (`reach` false), they
// dim to the chrome roles.
export const headInks = (c, p, reach) => (reach
  ? { top: p.head.iconTop.ink, base: p.head.iconBase.ink, label: p.head.label.ink, line: p.head.line.ink }
  : { top: c.roles.muted.ink, base: c.roles.dim.ink, label: c.roles.offline.ink, line: c.roles.dim.ink });

// A BOX.head.icon x 10 px machine glyph: a dome in `top` over a base in `base`.
export function machineIcon(top, base) {
  const bar = (w, h, c) => div().w(w).h(h).flex_none().bg(c);
  return v_flex().w(BOX.head.icon).h(10).flex_none().items_center()
    .child(bar(5, 1, top)).child(bar(9, 2, top)).child(bar(11, 2, top))
    .child(bar(13, 3, base)).child(bar(11, 2, base));
}

// The section icon beside SPACES and AGENTS: two CP437 shade blocks in `ink`, at the
// titles' size.
const DITHER = "▓▒";
export function dither(ink) {
  return div().flex_none().font_family(PX).text_size(BOX.section.title).line_height("16px").text_color(ink).child(DITHER);
}

// ---- Width budget (requirement 11). Each part's width is added up from the code's own
// sizes, since nothing here can measure a layout. PxPlus glyphs are size / 2 px wide.
// The UI font is Geist Regular. Its advances below come from the copy Herdr 0.1.13
// embeds in its binary (hmtx table, 1000 units per em).

export const pxText = (s, size) => [...String(s)].length * size / 2;
// Typical UI text, for layout: 0.6 * size per character ("unreachable" averages 0.52
// em). An estimate, not a bound: digits reach 0.66 em and the ↑ arrow is 0.71 em.
export const uiText = (s, size) => [...String(s)].length * size * 0.6;
// Any UI text, for floors and for text the budget can't know: 1 * size per character
// and 0.6 * size for the ellipsis (0.571 em). Every ASCII glyph is narrower (W, the
// widest, is 0.945 em); seven rare Geist glyphs are wider, up to 1.17 em (‰ № Љ Њ Œ ↔ Щ),
// as can glyphs from a fallback font.
export const uiMax = (s, size) => [...String(s)].reduce((w, c) => w + (c === "…" ? 0.6 : 1) * size, 0);
// A list's px on both sides. The always-on scrollbar adds nothing: measured in Herdr
// 0.1.13, it draws over the list's right padding and takes no width.
const LIST = 2 * BOX.list.px;
// Names keep this many characters, plus the ellipsis, before they shorten further:
// keepWidth() wide, which is the floor of any name longer than that.
const KEEP = 6;
const keepWidth = (size, measure = pxText) => measure("x".repeat(KEEP) + "…", size);
const KEEP_PX = keepWidth(BOX.row.name);

// The least width a name may shrink to: six characters and "…", or all of a short name.
// UI-font names measure with uiMax, so the floor holds whatever the characters.
export const nameFloor = (s, size, measure = pxText) => Math.min(measure(s, size), keepWidth(size, measure));

// A machine header's fixed parts: its pl, the icon and its gap, each tail part with its
// gap, and its pr. The rule line takes one more gap and at least RULE_MIN px.
const headFixed = (tail, gap) => BOX.head.pl + BOX.head.icon + gap + BOX.head.pr + tail.reduce((s, w) => s + gap + w, 0);
export const RULE_MIN = 8;
// A machine header's +, as a tail part: its px on both sides and the glyph.
export const ADD_W = 2 * BOX.add.px + pxText("+", BOX.add.size);

// The fullest machine header form that keeps six characters of `name` at sidebar
// `width`. `tails` go from the full tail to the most compact (undefined ones are
// skipped). The rule line goes first, then the full tail gives way to the next; each
// later tail narrows its gaps from 7 to 3 before it gives way in turn.
// Returns { line, fits, level, compact, gap, nameMax }: `level` is the tail's index
// (0: full), `compact` that it is above 0, `nameMax` the most the name may take while
// the line shows (its room less the line's gap and RULE_MIN).
export function machineHeader(width, name, ...tails) {
  const list = tails.filter(Boolean);
  const forms = list.flatMap((tail, level) => (level === 0 && list.length > 1 ? [[tail, 7, 0]] : [[tail, 7, level], [tail, 3, level]]));
  let form;
  for (const [tail, gap, level] of forms) {
    const room = width - LIST - headFixed(tail, gap);
    form = { line: room >= pxText(name, BOX.head.name) + gap + RULE_MIN, fits: room >= nameFloor(name, BOX.head.name), level, compact: level > 0, gap, nameMax: room - gap - RULE_MIN };
    if (form.fits) break;
  }
  return form;
}

// A machine header's name in pixel type, in `ink`, in machineHeader()'s `form`. While
// the rule line shows it keeps its whole width, which machineHeader() counted, so a
// truncating part beside it (a reconnect error) shrinks alone; it stops at
// form.nameMax, so glyphs wider than counted can't push the line and tail off the
// edge. Once the line drops it takes the spare room and shortens to its floor.
export function machineName(name, ink, form) {
  return div().min_w(nameFloor(name, BOX.head.name)).truncate().font_family(PX).text_size(BOX.head.name).line_height("16px")
    .when(form.line, (el) => el.flex_shrink(0).max_w(form.nameMax)).when(!form.line, (el) => el.flex_1()).text_color(ink).child(name);
}

// A machine header's 2 px rule line in `ink`, at least the RULE_MIN machineHeader() counts.
export const ruleLine = (ink) => div().flex_1().min_w(RULE_MIN).h(2).bg(ink);

// An agent card: its ml and mr, its border and p on both sides; the scene takes its
// size and a gap.
const { card: C } = BOX;
const CARD = C.ml + C.mr + 2 * C.border + 2 * C.p, SCENE = C.scene + C.gap;
// The room the pin button keeps at a card's top right, beside the badge: the icon with
// its p on both sides.
export const PIN_ROOM = 2 * BOX.pin.p + BOX.pin.icon;
// The fold control after a subtitle: px on both sides, the chevron, a gap, a 2-digit count.
const FOLD = 2 * BOX.fold.px + BOX.fold.chevron + BOX.fold.gap + uiText("99", BOX.fold.size);
// What a card's text column needs: the widest badge (px and border on both sides) and
// the pin's room; six characters of the title; six of the subtitle with the fold beside it.
const CARD_TEXT = Math.max(pxText("NEEDS YOU", BOX.badge.size) + 2 * (BOX.badge.px + BOX.badge.border) + PIN_ROOM, keepWidth(BOX.card.title), keepWidth(BOX.sub.size, uiMax) + BOX.sub.gap + FOLD);
// Below this sidebar width a card drops its scene and gives the text the full width.
export const SCENE_MIN_WIDTH = Math.ceil(LIST + CARD + SCENE + CARD_TEXT);

// A card at sidebar `width`: whether it keeps its scene, and its text column's width.
export function card(width) {
  const text = width - LIST - CARD;
  return width >= SCENE_MIN_WIDTH ? { scene: true, text: text - SCENE } : { scene: false, text };
}

// A space row at sidebar `width`: the list's sides (LIST), the row's ml, its bar, pl
// and pr leave the row's content. A worktree row adds its indent, the branch icon and
// a gap; the git tail takes a gap, about six characters of its repo and branch text
// (`where`), and its fixed parts (`tail`: the ahead/behind counts, each after the
// tail's own gap). Tight first narrows the indent and gaps, then drops the tail.
// Returns { nameMax, whereMin, tight, tail, gap, indent }: the name shows at most
// nameMax, the repo and branch text at least whereMin, and the row draws with `gap`
// between its parts and a worktree's `indent`.
export function spaceRow(width, { tree, tail, where = "" }) {
  const room = width - LIST - BOX.row.ml - BOX.row.bar - BOX.row.pl - BOX.row.pr;
  const whereMin = where ? nameFloor(where, BOX.row.git, uiText) : 0;
  let row;
  for (const [tight, keep] of [[false, true], [true, true], [true, false]]) {
    const gap = tight ? 4 : 9, indent = tight ? 2 : 10;
    const fixed = (tree ? indent + BOX.row.branch + gap : 0) + gap + (keep ? whereMin + tail.reduce((s, w) => s + BOX.row.gap + w, 0) : 0);
    row = { nameMax: room - fixed, whereMin, tight, tail: keep, gap, indent };
    if (row.nameMax >= KEEP_PX) break;
  }
  return row;
}

// A section header's need: pl and pr, the dither icon and its gap, then `parts` (their
// widths) with a gap between each.
export const sectionHeaderNeed = (parts, f) => f.pl + f.pr + (f.dither ? pxText(DITHER, BOX.section.title) + f.gap : 0) + parts.reduce((s, w) => s + w, 0) + f.gap * (parts.length - 1);

// A section header's forms, fullest first: first it drops the dither icon, then it
// narrows its gaps and sides.
const sectionForms = (pl, pr) => [{ dither: true, gap: 8, pl, pr }, { dither: false, gap: 8, pl, pr }, { dither: false, gap: 4, pl: 10, pr: 10 }];
const formAt = (width, parts, forms) => {
  const i = forms.findIndex((f) => sectionHeaderNeed(parts, f) <= width);
  return i === -1 ? forms.length - 1 : i;
};

// The SPACES and AGENTS headers at sidebar `width`, in one form so they agree: the
// fullest that both fit. SPACES: its name and the + button, sides 16 and 10. AGENTS:
// its name, a two-digit "99 BUSY" (the widest it plans for) and the sort icon, sides
// 16 and 16. The rail's SPACES header keeps the shipped sides with no dither (it shows
// only the +). Returns { spaces, agents, rail }, each { dither, gap, pl, pr }.
export function sectionHeaders(width) {
  const spaces = sectionForms(16, 10), agents = sectionForms(16, 16), t = BOX.section.title;
  const i = Math.max(formAt(width, [pxText("SPACES", t), BOX.section.add], spaces), formAt(width, [pxText("AGENTS", t), pxText("99 BUSY", t), BOX.section.sort], agents));
  return { spaces: spaces[i], agents: agents[i], rail: spaces[1] };
}
