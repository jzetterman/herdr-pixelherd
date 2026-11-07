// Tests for the width budget in look.js (requirement 11): what each part of the
// sidebar needs at a given sidebar width, and what the mods draw at 160 px, the
// narrowest wide width. The stub harness has no layout, so the budget is the model.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { render, withMachines, modUrl, findAll, texts, last } from "./harness/render.mjs";
import { loadColors } from "./check-colors.mjs";

const look = await import(modUrl("spaces", "look.js").href);
const { pxText, uiText, uiMax, nameFloor, machineHeader, RULE_MIN, ruleLine, card, SCENE_MIN_WIDTH, PIN_ROOM, spaceRow, sectionHeaders, sectionHeaderNeed } = look;
const THEME = JSON.parse(fs.readFileSync(new URL("fixtures/themes.json", import.meta.url), "utf8"))["mocha-like"];
const NARROW = 160;
// Geist Regular advances, in em, as Herdr 0.1.13 embeds the font in its binary (hmtx,
// 1000 units per em): W is the widest ASCII glyph; 8 and 0 make "80", the widest
// two-digit count.
const GEIST = { W: 0.945, "…": 0.571, 8: 0.604, 0: 0.663 };
const geist = (s, size) => [...s].reduce((w, c) => w + GEIST[c] * size, 0);

// Measured in Herdr 0.1.13 shots at sidebar width 229 px: a card's outer edges run
// from x=14 (the list's px(8), the card's ml(6)) to x=219 (the card's mr(2), the list's
// px(8)), whether or not the list overflows. Herdr draws its 6 px scrollbar over that
// right gap, so the bar takes no width. These offsets hold at any sidebar width.
const LEFT = 14, RIGHT = 10;

const error = "Couldn't connect: the host key changed since the last pairing";
// The full reconnect-error header: the error text, which may truncate to six
// characters, then Connect.
const fullError = [nameFloor(error, 11, uiMax) + 3 + uiText("Connect", 11), pxText("1", 14)];
const compactError = [uiText("!", 11) + 3 + 12, pxText("1", 14)];
// Between them: the error as "!", and the word Connect kept.
const markError = (word = "Connect", count = "1") => [uiText("!", 11) + 3 + uiText(word, 11), pxText(count, 14)];

test("a subtitle of six Ws keeps them beside an open fold, with or without the scene", () => {
  // The fold after the subtitle (4 px gap): px(3), the chevron (11), a gap (3), "80".
  const fold = 4 + 6 + 11 + 3 + geist("80", 11);
  for (const w of [SCENE_MIN_WIDTH, SCENE_MIN_WIDTH - 1, NARROW]) {
    assert.ok(card(w).text - fold >= geist("WWWWWW…", 12), `${w}: ${card(w).text - fold}`);
  }
});

test("the old reconnect-error header does not fit at 160 px; the compact one does", () => {
  assert.equal(machineHeader(NARROW, "LAPTOP", fullError).fits, false);
  assert.equal(machineHeader(NARROW, "LAPTOP", compactError).fits, true);
  const form = machineHeader(NARROW, "LAPTOP", fullError, compactError);
  assert.equal(form.compact, true);
  assert.ok(form.fits);
  assert.equal(machineHeader(480, "LAPTOP", fullError, compactError).compact, false);
});

test("a reconnect header keeps the word Connect unless the name would drop below six characters", () => {
  // At 160 px, LAPTOP keeps the word once the error is a "!" and the gaps narrow.
  const at160 = machineHeader(NARROW, "LAPTOP", fullError, markError(), compactError);
  assert.deepEqual([at160.fits, at160.level, at160.gap], [true, 1, 3]);
  // A long name with a two-digit count, or the longer "Connecting…", needs the icon.
  const long = machineHeader(NARROW, "BUILD-SERVER", fullError, markError("Connect", "12"), compactError);
  assert.deepEqual([long.fits, long.level], [true, 2]);
  const busy = machineHeader(NARROW, "LAPTOP", fullError, markError("Connecting…"), compactError);
  assert.deepEqual([busy.fits, busy.level], [true, 2]);
  // Wide, the whole error and the word.
  assert.equal(machineHeader(480, "LAPTOP", fullError, markError(), compactError).level, 0);
});

test("a machine header drops its rule line before it shortens the name", () => {
  const tail = [pxText("12", 14), 13];
  const name = "THIS MACHINE";
  const shape = (f) => [f.line, f.fits, f.compact];
  // Wide: name in full and the line.
  assert.deepEqual(shape(machineHeader(268, name, tail)), [true, true, false]);
  // With the whole name and no room for the line's 7 px gap and its RULE_MIN: no line,
  // gaps still 7. That much more brings the line back, and the drawn line keeps it.
  const whole = LEFT + 13 + 7 + pxText(name, 14) + tail.reduce((s, w) => s + 7 + w, 0) + RIGHT;
  assert.deepEqual(shape(machineHeader(whole, name, tail)), [false, true, false]);
  assert.equal(machineHeader(whole, name, tail).gap, 7);
  assert.equal(machineHeader(whole + 7 + RULE_MIN - 1, name, tail).line, false);
  assert.equal(machineHeader(whole + 7 + RULE_MIN, name, tail).line, true);
  assert.equal(last(ruleLine("#000000").__node, "min_w")[0], RULE_MIN);
  // At 160 px it shortens, but keeps six characters.
  assert.deepEqual(shape(machineHeader(NARROW, name, tail)), [false, true, false]);
});

test("an offline machine's state shrinks to a mark at 160 px", () => {
  const full = [uiText("unreachable", 11), pxText("3", 14)];
  const compact = [uiText("!", 11), pxText("3", 14)];
  assert.equal(machineHeader(NARROW, "LAPTOP", full, compact).compact, true);
  assert.equal(machineHeader(NARROW, "LAPTOP", full, compact).fits, true);
  assert.equal(machineHeader(268, "LAPTOP", full, compact).compact, false);
});

test("an agent group header keeps six characters at 160 px", () => {
  const tail = [14, pxText("12/34►", 13)];
  assert.equal(machineHeader(NARROW, "THIS MACHINE", tail).fits, true);
});

test("a card's text fits with or without its scene", () => {
  for (const w of [NARROW, SCENE_MIN_WIDTH - 1, SCENE_MIN_WIDTH, 268]) {
    // The badge (px(4) and a 1 px border on each side) with the pin's room, and a
    // 6-character title.
    assert.ok(card(w).text >= pxText("NEEDS YOU", 12) + 2 * 4 + 2 * 1 + PIN_ROOM, `${w}`);
    assert.ok(card(w).text >= nameFloor("a-long-title", 16), `${w}`);
  }
});

test("the budget matches Herdr's measured list geometry", () => {
  // A card: inside its 2 px border and p(6); with its scene, less 76 px and a 10 px gap.
  const inner = (w) => w - LEFT - RIGHT - 2 * 2 - 2 * 6;
  assert.deepEqual(card(268), { scene: true, text: inner(268) - 76 - 10 });
  assert.deepEqual(card(229), { scene: false, text: inner(229) });
  assert.deepEqual(card(NARROW), { scene: false, text: inner(NARROW) });
  // A space row sits at the same left edge as a card (px(8), ml(6)) and has no right
  // margin: right of its 3 px bar, pl(8) and pr(6), its content runs to x = width - 8.
  // The name has all of it but the 9 px gap before the filler.
  assert.equal(spaceRow(229, { tree: false, tail: [] }).nameMax, 229 - LEFT - 3 - 8 - 6 - 8 - 9);
  // A machine header: px(8) and its pl(6) on the left, pr(2) and px(8) on the right;
  // the icon (13), then six characters of the name and one tail part, each after a
  // 7 px gap. One px less and the gaps narrow to 3.
  const tail = [pxText("3", 14)];
  const need = LEFT + 13 + 7 + nameFloor("LAPTOP", 14) + 7 + tail[0] + RIGHT;
  assert.deepEqual([machineHeader(need, "LAPTOP", tail).gap, machineHeader(need - 1, "LAPTOP", tail).gap], [7, 3]);
});

test("a space row keeps six characters of its name at 160 px", () => {
  const name = "pixel-test-a-long-space-name";
  for (const opts of [{ tree: false, tail: [] }, { tree: true, tail: [uiText("↑2", 11.5), uiText("↓1", 11.5)] }, { tree: true, tail: [uiText("↑128", 11.5), uiText("↓64", 11.5)] }]) {
    const row = spaceRow(NARROW, opts);
    assert.ok(row.nameMax >= nameFloor(name, 14), JSON.stringify([opts, row]));
  }
  // Wide, a worktree row keeps its indent and its git tail.
  const wide = spaceRow(268, { tree: true, tail: [uiText("↑2", 11.5)] });
  assert.equal(wide.tight, false);
  assert.equal(wide.tail, true);
});

test("a space row keeps about six characters of its repo and branch before the name takes the rest", () => {
  const where = "pixelherd · spike";
  const floor = uiText("x".repeat(6) + "…", 11.5);
  const row = spaceRow(268, { tree: false, tail: [], where });
  assert.equal(row.whereMin, floor);
  assert.equal(row.nameMax, 268 - LEFT - 3 - 8 - 6 - 8 - 9 - floor);
  // A short one keeps all of itself; none keeps nothing.
  assert.equal(spaceRow(268, { tree: false, tail: [], where: "foo" }).whereMin, uiText("foo", 11.5));
  assert.equal(spaceRow(268, { tree: false, tail: [] }).whereMin, 0);
  // At 160 px the name keeps its six characters: the tail goes first.
  const tight = spaceRow(NARROW, { tree: true, tail: [uiText("↑2", 11.5)], where });
  assert.ok(tight.nameMax >= nameFloor("x".repeat(9), 14), JSON.stringify(tight));
});

// The stub world with space s2 a worktree of s1's repo, so it draws as a tree row.
const worktree = (v) => {
  v.machines = [{ name: "laptop", state: "connected" }];
  const repo = JSON.stringify([null, "/home/user/Development/foo/.git"]);
  v.git[JSON.stringify([null, "/home/user/Development/foo"])] = { name: "foo", branch: "main", ahead: 0, behind: 0, repo, linked: false };
  v.git[JSON.stringify([null, "/home/user/Development/foo-wt"])] = { name: "foo", branch: "wt", ahead: 128, behind: 64, repo, linked: true };
};

test("a drawn space row uses spaceRow()'s gap and indent", async () => {
  for (const width of [268, NARROW]) {
    const tree = await render("spaces", { width, theme: THEME, cwds: { pt2: "/home/user/Development/foo-wt" }, setup: worktree });
    const rowOf = (name) => findAll(tree, (n) => n.kids.some((k) => k?.__node?.kids?.includes(name)))[0];
    const plain = rowOf("a-rather-long-space-name-here"), nested = rowOf("~");
    assert.ok(plain && nested, `${width}`);
    const fitPlain = spaceRow(width, { tree: false, tail: [] });
    const fitTree = spaceRow(width, { tree: true, tail: [uiText("↑128", 11.5), uiText("↓64", 11.5)] });
    assert.equal(last(plain, "gap")[0], fitPlain.gap, `${width}`);
    assert.equal(last(nested, "gap")[0], fitTree.gap, `${width}`);
    assert.equal(last(nested, "pl")[0], fitTree.indent, `${width}`);
  }
});

test("the SPACES and AGENTS headers take one form at every width, which both fit", async () => {
  const spaces = [pxText("SPACES", 14), 26], agents = [pxText("AGENTS", 14), pxText("99 BUSY", 14), 14];
  for (let w = NARROW; w <= 300; w++) {
    const f = sectionHeaders(w);
    assert.deepEqual([f.spaces.dither, f.spaces.gap], [f.agents.dither, f.agents.gap], `${w}`);
    assert.ok(sectionHeaderNeed(spaces, f.spaces) <= w && sectionHeaderNeed(agents, f.agents) <= w, `${w}`);
  }
  // Drawn: at 165 px, where AGENTS has no room for its dither, SPACES drops it too.
  const dither = async (role) => texts(await render(role, { width: 165, theme: THEME, setup: role === "spaces" ? withMachines() : undefined })).includes("▓▒");
  assert.deepEqual([await dither("spaces"), await dither("agents")], [false, false]);
  assert.deepEqual([sectionHeaders(268).spaces.dither, sectionHeaders(268).agents.dither], [true, true]);
});

test("the paddings the mods draw are the ones the budget counts (look.js BOX)", async () => {
  const { BOX } = look;
  const byId = (tree, id) => findAll(tree, (n) => last(n, "id")?.[0] === id)[0];
  const one = (n, name) => last(n, name)?.[0];
  for (const width of [268, NARROW]) {
    const agents = await render("agents", { width, theme: THEME });
    // A card: its margins and border, and p and gap on the row inside it.
    const cardNode = byId(agents, "ag-t1");
    assert.deepEqual([one(cardNode, "ml"), one(cardNode, "mr"), one(cardNode, "border")], [BOX.card.ml, BOX.card.mr, BOX.card.border], `${width}`);
    const inner = cardNode.kids[0].__node;
    assert.deepEqual([one(inner, "p"), one(inner, "gap")], [BOX.card.p, BOX.card.gap], `${width}`);
    if (card(width).scene) {
      const scene = inner.kids[0].__node;
      assert.deepEqual([one(scene, "w"), one(scene, "h")], [BOX.card.scene, BOX.card.scene]);
    }
    // The pin, the badge and the fold.
    const pin = byId(agents, "pin-t3");
    assert.equal(one(pin, "p"), BOX.pin.p);
    assert.equal(one(findAll({ __node: pin }, (n) => n.kind === "svg")[0], "size"), BOX.pin.icon);
    const [badge] = findAll(agents, (n) => n.kids.includes("WORKING"));
    assert.deepEqual([one(badge, "px"), one(badge, "border")], [BOX.badge.px, BOX.badge.border]);
    const fold = byId(agents, "fold-t2");
    assert.deepEqual([one(fold, "px"), one(fold, "gap"), one(findAll({ __node: fold }, (n) => n.kind === "svg")[0], "size")], [BOX.fold.px, BOX.fold.gap, BOX.fold.chevron]);
    // Machine headers in both mods, and their icon.
    const spaces = await render("spaces", { width, theme: THEME, setup: withMachines() });
    for (const head of [byId(agents, "m:"), byId(spaces, "machine-local")]) {
      assert.deepEqual([one(head, "pl"), one(head, "pr")], [BOX.head.pl, BOX.head.pr], `${width}`);
      assert.equal(one(head.kids[0].__node, "w"), BOX.head.icon);
    }
    // A space row: ml, the bar (its left border), pl and pr.
    const row = byId(spaces, "space-s1");
    assert.deepEqual([one(row, "ml"), one(row, "border_l"), one(row, "pl"), one(row, "pr")], [BOX.row.ml, BOX.row.bar, BOX.row.pl, BOX.row.pr], `${width}`);
  }
});

test("every gap and size the budget counts is the one the mods draw (look.js BOX)", async () => {
  const { BOX, ADD_W } = look;
  const byId = (tree, id) => findAll(tree, (n) => last(n, "id")?.[0] === id)[0];
  const one = (n, name) => last(n, name)?.[0];
  const holding = (tree, s) => findAll(tree, (n) => n.kids.includes(s))[0];
  const parentOf = (tree, node) => findAll(tree, (n) => n.kids.some((k) => k?.__node === node))[0];
  const scroller = (tree) => findAll(tree, (n) => n.calls.some(([k]) => k === "overflow_y_scrollbar"))[0];
  for (const width of [268, NARROW]) {
    // Both lists' sides.
    const spaces = await render("spaces", { width, theme: THEME, cwds: { pt2: "/home/user/Development/foo-wt" }, setup: (v) => { worktree(v); v.machines.push({ name: "desk", state: "asleep" }); } });
    const agents = await render("agents", { width, theme: THEME });
    assert.deepEqual([one(scroller(spaces), "px"), one(scroller(agents), "px")], [BOX.list.px, BOX.list.px], `${width}`);
    // A machine header: its text, the name, the count and the + (ADD_W in the budget).
    const head = byId(spaces, "machine-local");
    assert.equal(one(head, "text_size"), BOX.head.text);
    assert.equal(one(holding({ __node: head }, "THIS MACHINE"), "text_size"), BOX.head.name);
    assert.equal(one(holding({ __node: head }, "2"), "text_size"), BOX.head.count);
    const add = byId(spaces, "machine-add-local");
    assert.deepEqual([one(add, "px"), one(add, "text_size")], [BOX.add.px, BOX.add.size]);
    assert.equal(2 * one(add, "px") + pxText(add.kids[0], one(add, "text_size")), ADD_W);
    // A space row: its name, a worktree's branch icon, the git tail's gap and text.
    assert.equal(one(holding(spaces, "a-rather-long-space-name-here"), "text_size"), BOX.row.name);
    assert.equal(one(findAll(spaces, (n) => n.kind === "svg" && /branch\.svg$/.test(n.arg))[0], "size"), BOX.row.branch);
    // (At 160 px the worktree row drops its git tail.)
    if (width === 268) {
      const git = parentOf(spaces, holding(spaces, "↑128"));
      assert.deepEqual([one(git, "gap"), one(git, "text_size")], [BOX.row.gap, BOX.row.git]);
    }
    // The empty machine's row sits where a space row does.
    assert.equal(one(byId(spaces, "machine-new-desk"), "ml"), BOX.row.ml);
    // Section headers: the titles, SPACES's + and AGENTS's sort icon.
    assert.equal(one(byId(spaces, "space-new"), "size"), BOX.section.add);
    assert.equal(one(findAll({ __node: byId(agents, "ag-sort") }, (n) => n.kind === "svg")[0], "size"), BOX.section.sort);
    for (const [tree, title] of [[spaces, "SPACES"], [agents, "AGENTS"], [agents, "1 BUSY"]]) assert.equal(one(holding(tree, title), "text_size"), BOX.section.title, title);
    // A card: its text column as tall as the scene, the badge, title, subtitle and fold.
    if (card(width).scene) assert.equal(one(byId(agents, "ag-t1").kids[0].__node.kids[1].__node, "h"), BOX.card.scene);
    assert.equal(one(holding(agents, "WORKING"), "text_size"), BOX.badge.size);
    assert.equal(one(holding(agents, "a-rather-long-space-name-here"), "text_size"), BOX.card.title);
    const sub = holding(agents, "build");
    assert.equal(one(sub, "text_size"), BOX.sub.size);
    assert.equal(one(parentOf(agents, sub), "gap"), BOX.sub.gap);
    assert.equal(one(byId(agents, "fold-t2"), "text_size"), BOX.fold.size);
    // The agents header's count.
    assert.equal(one(holding({ __node: byId(agents, "m:") }, "1/3"), "text_size"), BOX.head.busy);
  }
  // A rebuilt header's problem and Connect, with the icon once it is short of room.
  const machine = { name: "laptop", state: "unreachable", why: 'a different core answers there ("new-core")', target: "laptop" };
  const busy = await render("spaces", { width: NARROW, theme: THEME, setup: (v) => { v.machines = [machine]; v.reconnecting = { laptop: { machine, removed: true, busy: true, error: null } }; } });
  const connect = byId(busy, "machine-connect-laptop");
  assert.equal(one(parentOf(busy, connect), "gap"), BOX.connect.gap);
  assert.equal(one(findAll({ __node: connect }, (n) => n.kind === "svg")[0], "size"), BOX.connect.icon);
  // An out-of-reach agents header's state.
  const off = await render("agents", { width: 268, theme: THEME, machines: [{ name: null, layout: "ready" }, { name: "laptop", layout: "unavailable" }] });
  assert.equal(one(holding(off, "unavailable"), "text_size"), BOX.head.text);
  // A connected machine whose spaces have not loaded: its row sits where a space row does.
  const loading = await render("spaces", { width: 268, theme: THEME, setup: withMachines([{ name: "laptop", state: "connected" }, { name: "desk", state: "connected" }]) });
  assert.equal(one(byId(loading, "machine-loading-desk"), "ml"), BOX.row.ml);
  // Status marks: none wider than the BOX.mark.w a folded header counts; the spinner
  // and the blocked mark fill it.
  const { default: Agents } = await import(modUrl("agents", "main.js").href);
  const roles = (await loadColors()).colors(THEME).roles;
  for (const status of ["working", "blocked", "idle", "done", "waking"]) {
    const n = new Agents().status(roles, { status }).__node;
    const w = one(n, "size") + 2 * (one(n, "mx") ?? 0);
    assert.ok(w <= BOX.mark.w && (w === BOX.mark.w || !["working", "blocked"].includes(status)), `${status}: ${w}`);
  }
});

// The narrowest sidebar width from 160 px at which `ok(width)` holds.
const threshold = (ok) => { let w = NARROW; while (w < 600 && !ok(w)) w++; return w; };
// Whether a drawn machine header shows its rule line.
const hasLine = (head) => head.kids.some((k) => last(k.__node ?? { calls: [] }, "h")?.[0] === 2);
const headIn = (tree, id) => findAll(tree, (n) => last(n, "id")?.[0] === id)[0];

test("each header draws its next form at the width its budgeted tail predicts", async () => {
  const { BOX, ADD_W } = look;
  // This computer's spaces header: the count "2" and the +.
  const local = threshold((w) => machineHeader(w, "THIS MACHINE", [pxText("2", BOX.head.count), ADD_W]).line);
  const spaces = async (width, setup = withMachines()) => render("spaces", { width, theme: THEME, setup });
  assert.deepEqual([hasLine(headIn(await spaces(local - 1), "machine-local")), hasLine(headIn(await spaces(local), "machine-local"))], [false, true], `${local}`);
  // A rebuilt machine's header, with the count "1": the problem (an error at its
  // floor), then Connect; then "!" and Connect; then "!" and the icon.
  const machine = { name: "laptop", state: "unreachable", why: 'a different core answers there ("new-core")', target: "laptop" };
  const repair = (busy) => (v) => { v.machines = [machine]; v.reconnecting = { laptop: { machine, removed: true, busy, error: busy ? null : error } }; };
  const T = BOX.head.text, K = BOX.connect, n = pxText("1", BOX.head.count);
  const tails = (problem, word) => [[problem + K.gap + uiText(word, T), n], [uiText("!", T) + K.gap + uiText(word, T), n], [uiText("!", T) + K.gap + K.icon, n]];
  // Mid-reconnect, "Connecting…" needs the icon at 160 px.
  const icon = (tree) => findAll(tree, (x) => x.kind === "svg" && /reconnect\.svg$/.test(x.arg)).length > 0;
  const busy = tails(uiText("rebuilt ·", T), "Connecting…");
  const word = threshold((w) => machineHeader(w, "LAPTOP", ...busy).level < 2);
  assert.ok(word > NARROW, `${word}`);
  assert.deepEqual([icon(await spaces(word - 1, repair(true))), icon(await spaces(word, repair(true)))], [true, false], `${word}`);
  // At 160 px the drawn icon form takes the budget's gaps.
  const narrow = machineHeader(NARROW, "LAPTOP", ...busy);
  assert.equal(narrow.level, 2);
  assert.equal(last(headIn(await spaces(NARROW, repair(true)), "machine-laptop"), "gap")[0], narrow.gap);
  // Failed, the whole error comes back once its floor fits.
  const full = threshold((w) => machineHeader(w, "LAPTOP", ...tails(nameFloor(error, T, uiMax), "Connect")).level === 0);
  const mark = async (w) => texts({ __node: headIn(await spaces(w, repair(false)), "machine-laptop") }).includes("!");
  assert.deepEqual([await mark(full - 1), await mark(full)], [true, false], `${full}`);
  // Folded agents headers show the most urgent mark and "working/total►". This
  // computer's: the blocked mark and "1/3►".
  const machines = [{ name: null, layout: "ready" }, { name: "laptop", layout: "unavailable" }];
  const agents = async (width, id) => headIn(await render("agents", { width, theme: THEME, machines, setup: (v) => v.folded.add(id) }), id);
  const own = threshold((w) => machineHeader(w, "THIS MACHINE", [BOX.mark.w, pxText("1/3►", BOX.head.busy)]).line);
  assert.deepEqual([hasLine(await agents(own - 1, "m:")), hasLine(await agents(own, "m:"))], [false, true], `${own}`);
  // Out of reach: "unavailable" (or "!"), the done mark and "0/1►".
  const count = pxText("0/1►", BOX.head.busy);
  const off = threshold((w) => !machineHeader(w, "LAPTOP", [uiText("unavailable", T), BOX.mark.w, count], [uiText("!", T), BOX.mark.w, count]).compact);
  assert.ok(off > NARROW, `${off}`);
  assert.deepEqual([texts({ __node: await agents(off - 1, "m:laptop") }).includes("!"), texts({ __node: await agents(off, "m:laptop") }).includes("!")], [true, false], `${off}`);
});

test("159 px is the rail and 160 px is not, in look.js and in both mods", async () => {
  assert.deepEqual([look.isRail(159), look.isRail(160)], [true, false]);
  // Wide, each list shows its section title; the rail shows none.
  for (const [role, title] of [["spaces", "SPACES"], ["agents", "AGENTS"]]) {
    const shows = async (width) => texts(await render(role, { width, theme: THEME, setup: role === "spaces" ? withMachines() : undefined })).includes(title);
    assert.deepEqual([await shows(159), await shows(160)], [false, true], role);
  }
});

// What the mods draw at 160 px, through the harness.
test("at 160 px the cards drop their scenes; wide they keep them", async () => {
  const at = async (width) => findAll(await render("agents", { width, theme: THEME }), (n) => n.kind === "image").length;
  assert.equal(await at(NARROW), 0);
  assert.ok((await at(268)) > 0);
});

test("at 160 px a failed reconnect shows a mark and keeps Connect; reconnecting, an icon button", async () => {
  const machine = { name: "laptop", state: "unreachable", why: 'a different core answers there ("new-core")', target: "laptop" };
  const setup = (busy) => (v) => { v.machines = [machine]; v.reconnecting = { laptop: { machine, removed: true, busy, error: busy ? null : error } }; };
  const icons = (tree) => findAll(tree, (n) => n.kind === "svg" && /reconnect\.svg$/.test(n.arg));
  const narrow = await render("spaces", { width: NARROW, theme: THEME, setup: setup(false) });
  const shown = texts(narrow);
  assert.ok(shown.includes("!") && shown.includes("Connect"), JSON.stringify(shown));
  assert.ok(!shown.includes(error), JSON.stringify(shown));
  assert.equal(icons(narrow).length, 0);
  const busy = await render("spaces", { width: NARROW, theme: THEME, setup: setup(true) });
  assert.ok(!texts(busy).includes("Connecting…"), JSON.stringify(texts(busy)));
  assert.equal(icons(busy).length, 1);
  assert.ok(icons(busy)[0].arg.startsWith("mods/"));
  const wide = texts(await render("spaces", { width: 480, theme: THEME, setup: setup(false) }));
  assert.ok(wide.includes(error) && wide.includes("Connect"), JSON.stringify(wide));
});

test("a reconnect header stays full at 268 and 300 px: the error truncates, the rule line stays", async () => {
  const machine = { name: "laptop", state: "unreachable", why: 'a different core answers there ("new-core")', target: "laptop" };
  const header = (tree) => ({ __node: findAll(tree, (n) => last(n, "id")?.[0] === "machine-laptop")[0] });
  const line = (head) => head.__node.kids.some((k) => last(k.__node ?? { calls: [] }, "h")?.[0] === 2);
  for (const width of [268, 300]) {
    // A failed reconnect: the whole error (truncating down to six characters) and Connect.
    const failed = header(await render("spaces", { width, theme: THEME, setup: (v) => { v.machines = [machine]; v.reconnecting = { laptop: { machine, removed: true, busy: false, error } }; } }));
    const shown = texts(failed);
    assert.ok(shown.includes(error) && shown.includes("Connect") && !shown.includes("!"), `${width}: ${JSON.stringify(shown)}`);
    const [text] = findAll(failed, (n) => n.kids.includes(error));
    assert.equal(last(text, "min_w")?.[0], nameFloor(error, 11, uiMax), `${width}`);
    assert.ok(text.calls.some(([k]) => k === "truncate"), `${width}`);
    // Rebuilt, not yet tried: "rebuilt ·", Connect and the rule line.
    const fresh = header(await render("spaces", { width, theme: THEME, setup: (v) => { v.machines = [machine]; } }));
    assert.ok(texts(fresh).includes("rebuilt ·") && line(fresh), `${width}: ${JSON.stringify(texts(fresh))}`);
  }
});

test("a failed reconnect's header keeps the whole name while its rule line shows", async () => {
  // The error truncates beside the name; with the line there the name must not shrink
  // with it (requirement 11: the line goes before the name shortens).
  const name = "build-server";
  const machine = { name, state: "unreachable", why: 'a different core answers there ("new-core")', target: name };
  const setup = (v) => { v.machines = [machine]; v.reconnecting = { [name]: { machine, removed: true, busy: false, error } }; };
  let lines = 0;
  for (const width of [268, 300, 360, 480]) {
    const tree = await render("spaces", { width, theme: THEME, setup });
    const head = findAll(tree, (n) => last(n, "id")?.[0] === `machine-${name}`)[0];
    const line = head.kids.some((k) => last(k.__node ?? { calls: [] }, "h")?.[0] === 2);
    const [label] = findAll({ __node: head }, (n) => n.kids.includes(name.toUpperCase()));
    if (line) lines++;
    assert.equal(last(label, "flex_shrink")?.[0], line ? 0 : undefined, `${width}`);
  }
  assert.ok(lines > 0, "no width showed the rule line");
});

test("a machine name that keeps its width is capped at the room the budget left it", async () => {
  // Wider glyphs than the budget counts (a fallback font's) must not push the rule
  // line and the count off the edge: the name stops at its room, less the line's gap
  // and RULE_MIN.
  for (const width of [268, 480]) {
    const tree = await render("spaces", { width, theme: THEME, setup: withMachines() });
    const head = findAll(tree, (n) => last(n, "id")?.[0] === "machine-local")[0];
    const [name] = findAll({ __node: head }, (n) => n.kids.includes("THIS MACHINE"));
    const form = machineHeader(width, "THIS MACHINE", [pxText("2", look.BOX.head.count), look.ADD_W]);
    assert.ok(form.line, `${width}`);
    // The header's room for its name: the list's sides, pl, the icon, pr, and a gap
    // before each of the name, the count and the +.
    const { list, head: h } = look.BOX;
    const room = width - 2 * list.px - h.pl - h.icon - h.pr - 3 * form.gap - pxText("2", h.count) - look.ADD_W;
    assert.equal(last(name, "max_w")?.[0], room - form.gap - RULE_MIN, `${width}`);
    assert.ok(last(name, "max_w")[0] >= pxText("THIS MACHINE", 14), `${width}`);
  }
});

test("a long space name leaves its git tail the tail's floor", async () => {
  const tree = await render("spaces", { width: 268, theme: THEME, cwds: { pt2: "/home/user/Development/foo-wt" }, setup: worktree });
  const [name] = findAll(tree, (n) => n.kids.includes("a-rather-long-space-name-here"));
  const [where] = findAll(tree, (n) => n.kids.includes("foo"));
  const row = spaceRow(268, { tree: false, tail: [], where: "foo" });
  assert.equal(last(name, "max_w")[0], row.nameMax);
  assert.equal(last(where, "min_w")[0], row.whereMin);
  assert.ok(row.whereMin > 0);
});

test("at 160 px a space name gets the row's real width", async () => {
  const tree = await render("spaces", { width: NARROW, theme: THEME, setup: withMachines() });
  const names = findAll(tree, (n) => n.kids.includes("a-rather-long-space-name-here"));
  assert.equal(names.length, 1);
  const max = last(names[0], "max_w")?.[0];
  const row = spaceRow(NARROW, { tree: false, tail: [] });
  assert.ok(max <= row.nameMax && max >= nameFloor("a-rather-long-space-name-here", 14), `${max}`);
  assert.equal(last(names[0], "min_w")?.[0], nameFloor("a-rather-long-space-name-here", 14));
});

test("at 160 px the width rules are wired into what the mods draw", async () => {
  const has = (n, name) => n.calls.some(([k]) => k === name);
  const holding = (tree, s) => findAll(tree, (n) => n.kids.includes(s));
  const spaces = await render("spaces", { width: NARROW, theme: THEME, setup: withMachines() });
  const agents = await render("agents", { width: NARROW, theme: THEME });
  // Machine headers: no rule line, and the name takes the rest down to its floor.
  for (const [tree, id] of [[spaces, "machine-local"], [agents, "m:"]]) {
    const head = findAll(tree, (n) => last(n, "id")?.[0] === id)[0];
    assert.ok(!head.kids.some((k) => last(k.__node ?? { calls: [] }, "h")?.[0] === 2), id);
    const [name] = holding({ __node: head }, "THIS MACHINE");
    assert.equal(last(name, "min_w")[0], nameFloor("THIS MACHINE", 14), id);
    assert.ok(has(name, "truncate") && has(name, "flex_1"), id);
  }
  // The AGENTS header takes sectionHeaders()'s form: no dither at 160 px.
  const form = sectionHeaders(NARROW).agents;
  const row = findAll(agents, (n) => n.kids.some((k) => k.__node?.kids.includes("AGENTS")))[0];
  assert.deepEqual([last(row, "gap")[0], last(row, "pl")[0], last(row, "pr")[0], texts({ __node: row }).includes("▓▒")], [form.gap, form.pl, form.pr, form.dither]);
  // Card titles keep their floor; badges never wrap or shrink.
  for (const title of ["a-rather-long-space-name-here", "foo", "side-project"]) {
    for (const n of holding(agents, title)) assert.ok(last(n, "min_w")[0] === nameFloor(title, 16) && has(n, "truncate"), title);
  }
  for (const word of ["WORKING", "NEEDS YOU", "IDLE", "DONE"]) {
    const [n] = holding(agents, word);
    assert.ok(has(n, "whitespace_nowrap") && has(n, "flex_none"), word);
  }
});

test("a card's subtitle keeps the UI font's floor for any text", async () => {
  for (const width of [NARROW, SCENE_MIN_WIDTH]) {
    const tree = await render("agents", { width, theme: THEME });
    const subs = findAll(tree, (n) => last(n, "text_size")?.[0] === 12 && n.calls.some(([k]) => k === "truncate") && typeof n.kids[0] === "string");
    assert.ok(subs.length > 0);
    for (const n of subs) assert.equal(last(n, "min_w")?.[0], nameFloor(n.kids[0], 12, uiMax), `${width}: ${n.kids[0]}`);
  }
});
