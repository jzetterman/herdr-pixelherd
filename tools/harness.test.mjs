// Renders both mods through the stub harness on every fixture theme and checks that
// every color they draw comes from the color block, on the background its role names.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { render, withMachines, colorRecords, unmatched, untiered, wrongHovers, surfaces, belowTier, allRoles, modUrl, MODS, findAll, last, kit, herdr, texts } from "./harness/render.mjs";
import { P, GENERIC, CARD, HEAD, dE, over } from "./check-colors.mjs";
import { div, svg } from "./harness/gpui-kit.mjs";

const fixture = (f) => JSON.parse(fs.readFileSync(new URL(`fixtures/${f}`, import.meta.url), "utf8"));
const THEMES = fixture("themes.json");
// The made-up themes and the 30 captured test-set themes.
const ALL = { ...THEMES, ...fixture("captures.json") };
const { colors } = await import(modUrl("agents", "colors.js").href);
const look = await import(modUrl("agents", "look.js").href);

// A remote machine that was rebuilt, with a failed reconnect, and one that is offline.
const why = 'a different core answers there ("new-core")';
const rebuilt = { name: "laptop", state: "unreachable", why, target: "laptop" };
const failed = (v) => {
  v.machines = [rebuilt];
  v.reconnecting = { laptop: { machine: rebuilt, removed: true, busy: false, error: "Couldn't connect: the host key changed since the last pairing" } };
};
const offline = withMachines([{ name: "laptop", state: "unreachable", why: "timed out" }]);
// Rebuilt and not yet tried; and mid-reconnect, with no error yet.
const fresh = (v) => { v.machines = [rebuilt]; };
const reconnecting = (v) => {
  v.machines = [rebuilt];
  v.reconnecting = { laptop: { machine: rebuilt, removed: true, busy: true, error: null } };
};
// The stub world's terminals with its sub-agent t9 blocked; and its agents with one
// whose status the mod has no word for.
const blockedKid = herdr.terminals().map((t) => (t.address === "t9" ? { ...t, status: "blocked" } : t));
const waking = [...herdr.agents(), { ...herdr.agents()[1], address: "t5", pane: "pt5", status: "waking" }];

// Git for the stub world's spaces: s1 on a branch, ahead and behind; s2 a worktree of
// its repo (so it draws as a tree row with the branch icon); s3's repo on the laptop.
const DEV = "/home/user/Development";
const withGit = (v) => {
  v.machines = [{ name: "laptop", state: "connected" }];
  const repo = JSON.stringify([null, `${DEV}/foo/.git`]);
  v.git[JSON.stringify([null, `${DEV}/foo`])] = { name: "foo", branch: "spike", ahead: 2, behind: 1, repo, linked: false };
  v.git[JSON.stringify([null, `${DEV}/foo-wt`])] = { name: "foo", branch: "wt", ahead: 3, behind: 4, repo, linked: true };
  v.git[JSON.stringify(["laptop", `${DEV}/foo`])] = { name: "side", branch: "fix", ahead: 1, behind: 0, repo: JSON.stringify(["laptop", "/x/.git"]), linked: false };
};
// Mid-drag: the mouse went down on space `pressed` and is over space `over`.
const drag = (pressed, over) => (v) => { withMachines()(v); v.pressed = pressed; v.over = over; };
// Machines with no spaces: "server" is ready (an empty row), "build" has no layout yet
// (a loading row).
const bare = {
  machines: [{ name: null, layout: "ready" }, { name: "laptop", layout: "ready" }, { name: "server", layout: "ready" }],
  setup: withMachines(["laptop", "server", "build"].map((name) => ({ name, state: "connected" }))),
};

// The stub world's terminals with its sub-agent t9 idle: its mark sits on a card fill.
const idleKid = herdr.terminals().map((t) => (t.address === "t9" ? { ...t, status: "idle" } : t));

// What each render shows: the mod, its props, and state a live run would fetch. Flags:
// `drag`, the id of the space being dragged: its row fades to half opacity, which
// requirement 4 exempts from the bars (its colors must still come from declared
// roles), and nothing else may fade; `quiet`, a scene that may draw few colors and
// nothing on a hover background.
const SCENES = {
  spaces: ["spaces", { setup: withMachines() }],
  "spaces, git tails and a worktree": ["spaces", { cwds: { pt2: `${DEV}/foo-wt` }, setup: withGit }],
  "spaces, reconnect failed": ["spaces", { setup: failed }],
  "spaces, offline machine": ["spaces", { setup: offline }],
  "spaces, rebuilt machine": ["spaces", { setup: fresh }],
  "spaces, reconnecting": ["spaces", { setup: reconnecting }],
  "spaces, empty and loading machines": ["spaces", bare],
  "spaces, pressed": ["spaces", { setup: drag("s2", "s2") }],
  "spaces, dragging onto the active row": ["spaces", { setup: drag("s2", "s1") }, { drag: "s2" }],
  "spaces, dragging the active row": ["spaces", { setup: drag("s1", "s2") }, { drag: "s1" }],
  agents: ["agents", {}],
  "agents, sub-agent not in view": ["agents", { focused: { agent: "t1" } }],
  "agents, blocked sub-agent not in view": ["agents", { terminals: blockedKid, focused: { agent: "t1" } }],
  "agents, blocked sub-agent in view": ["agents", { terminals: blockedKid, focused: { agent: "t9" } }],
  "agents, idle sub-agent": ["agents", { terminals: idleKid, focused: { agent: "t1" } }],
  "agents, unknown status": ["agents", { agents: waking }],
  "agents, unavailable machine": ["agents", { machines: [{ name: null, layout: "ready" }, { name: "laptop", layout: "unavailable" }] }],
  "agents, folded groups": ["agents", { setup: (v) => { v.folded.add("m:"); v.folded.add("m:laptop"); v.folded.add("t2"); } }],
  "agents, none yet": ["agents", { agents: [] }, { quiet: true }],
  "sort menu": ["agents", { props: { sortMenu: true } }],
};
// Each declared role's ink, for colors exempt from the bars.
const inks = (c) => new Set(allRoles(c).map((r) => r.ink));

test("every color both mods draw comes from colors(t), on the background its role names, at its tier", async () => {
  const tiers = { generic: GENERIC, card: CARD, head: HEAD };
  for (const [name, t] of Object.entries(ALL)) {
    const c = colors(t);
    for (const width of [268, 220, 160, 44]) {
      for (const [scene, [role, opts, flags = {}]] of Object.entries(SCENES)) {
        const tree = await render(role, { ...opts, width, theme: t });
        const base = opts.props?.sortMenu ? c.menu.base.ink : c.roles.base.ink;
        const all = colorRecords(tree, base);
        // The dragged row's colors: exempt from the bars, but each a declared role's.
        // Anything else faded is checked as drawn, so it fails.
        const under = new RegExp(`#space-${flags.drag}(?=[/:]|$)`);
        const faded = flags.drag ? all.filter((r) => r.alpha < 1 && under.test(r.path)) : [];
        if (flags.drag) {
          // The rail's rows don't drag.
          assert.ok(faded.length > 0 || width < 160, `${scene} @${width}px: no row faded`);
          assert.deepEqual(faded.filter((r) => !inks(c).has(r.plain) && r.plain !== c.clear), [], `${name} @${width}px, ${scene}`);
        }
        const records = all.filter((r) => !faded.includes(r));
        if (!flags.quiet) {
          assert.ok(records.length > 10, `${scene}: drew no colors`);
          // Hovered rows are checked too: their foregrounds sit on a hover background.
          const hovers = new Set(surfaces(c).map((s) => s.hoverBg.ink));
          assert.ok(records.some((r) => r.hover && r.what !== "bg" && hovers.has(r.on)), `${scene}: drew nothing on a hover background`);
        }
        assert.deepEqual(unmatched(records, c), [], `${name} @${width}px, ${scene}`);
        assert.deepEqual(wrongHovers(records, c), [], `${name} @${width}px, ${scene}`);
        // Text, icons and borders at 3:1 or above; decorative roles only as backgrounds.
        assert.deepEqual(untiered(records, c, tiers), [], `${name} @${width}px, ${scene}`);
      }
    }
  }
});

// Requirement 4's primary items, as the stub world shows them, by the mod that draws
// them: machine names (THIS MACHINE included), the active space's name, card titles and
// badge words.
const PRIMARY_ITEMS = {
  spaces: ["THIS MACHINE", "LAPTOP", "a-rather-long-space-name-here"],
  agents: ["THIS MACHINE", "LAPTOP", "a-rather-long-space-name-here", "foo", "side-project", "WORKING", "NEEDS YOU", "IDLE", "DONE"],
};

test("primary items are drawn with primary-tier roles, plain and hovered", async () => {
  const tiers = { generic: GENERIC, card: CARD, head: HEAD };
  for (const [name, t] of Object.entries(ALL)) {
    const c = colors(t);
    for (const width of [268, 160]) {
      for (const [scene, [role, opts, flags = {}]] of Object.entries(SCENES)) {
        // Skipped: scenes that hide some primary items (the menu, folded groups, no
        // agents), and drags, where the faded row is exempt.
        if (opts.props?.sortMenu || /folded/.test(scene) || flags.quiet || flags.drag) continue;
        const records = colorRecords(await render(role, { ...opts, width, theme: t }), c.roles.base.ink);
        for (const s of PRIMARY_ITEMS[role]) {
          const { shown, below } = belowTier(records, c, tiers, s, P);
          assert.ok(shown > 0, `${scene} @${width}px: ${s} not drawn`);
          assert.deepEqual(below, [], `${name} @${width}px, ${scene}: ${s}`);
        }
      }
    }
  }
});

test("each scene draws what it exists for", async () => {
  const t = THEMES["mocha-like"], c = colors(t);
  const at = async (scene, width = 268) => {
    const [role, opts] = SCENES[scene];
    const tree = await render(role, { ...opts, width, theme: t });
    return { tree, shown: texts(tree), records: colorRecords(tree, c.roles.base.ink) };
  };
  const git = await at("spaces, git tails and a worktree");
  for (const s of ["↑2", "↓1", "↑3", "↓4", "wt"]) assert.ok(git.shown.includes(s), `${s}: ${JSON.stringify(git.shown)}`);
  assert.equal(findAll(git.tree, (n) => n.kind === "svg" && /branch\.svg$/.test(n.arg)).length, 1);
  // The active row's tail sits on its palette's fill, in that fill's roles.
  const fill = c.palettes[0].roles;
  assert.ok(git.records.some((r) => r.what === "text" && r.path.endsWith('"↑2"') && r.ink === fill.ahead.ink && r.on === fill.base.ink));
  // Not in view, the sub-agent row sits on its card's fill and hovers with the fill's hover.
  const sub = (await at("agents, sub-agent not in view")).records.filter((r) => r.path.endsWith('"test-child"'));
  const card = c.palettes[0].roles;
  assert.ok(sub.some((r) => r.ink === card.sub.ink && r.on === card.base.ink) && sub.some((r) => r.on === card.hoverBg.ink), JSON.stringify(sub));
  for (const [scene, line] of [["spaces, dragging onto the active row", card.highlight], ["spaces, dragging the active row", c.roles.highlight]]) {
    const { records } = await at(scene);
    assert.ok(records.some((r) => r.alpha === 0.5), scene);
    assert.ok(records.some((r) => r.what === "bg" && r.ink === line.ink && r.on === line.on && r.alpha === 1), `${scene}: no drop line`);
  }
  assert.ok(!(await at("spaces, pressed")).records.some((r) => r.alpha < 1));
  const bareShown = (await at("spaces, empty and loading machines")).shown;
  assert.ok(bareShown.includes("Loading…") && bareShown.includes("New space there"), JSON.stringify(bareShown));
  assert.ok((await at("agents, none yet")).shown.some((s) => s.startsWith("No agent status yet")));
  // Rebuilt and reconnecting headers: Connect in muted; at 160 px, reconnecting, the
  // reconnect icon in muted.
  for (const [scene, word] of [["spaces, rebuilt machine", "Connect"], ["spaces, reconnecting", "Connecting…"]]) {
    const { shown, records } = await at(scene);
    assert.ok(shown.includes(word), `${scene}: ${JSON.stringify(shown)}`);
    assert.ok(records.some((r) => r.what === "text" && r.path.endsWith(JSON.stringify(word)) && r.ink === c.roles.muted.ink), scene);
  }
  const spin = await at("spaces, reconnecting", 160);
  const [icon] = findAll(spin.tree, (n) => n.kind === "svg" && /reconnect\.svg$/.test(n.arg));
  assert.ok(icon && last(icon, "spin"), "no spinning reconnect icon at 160 px");
  assert.ok(spin.records.some((r) => r.what === "icon" && r.path.includes("svg") && r.ink === c.roles.muted.ink), "no muted icon at 160 px");
  // A blocked sub-agent's mark: on its card's fill, and on raised when it is in view.
  for (const [scene, set] of [["agents, blocked sub-agent not in view", c.palettes[0].roles], ["agents, blocked sub-agent in view", c.raised]]) {
    const { records } = await at(scene);
    assert.ok(records.some((r) => r.what === "bg" && r.ink === set.blockedTint.ink && r.on === set.base.ink), `${scene}: no tint`);
    assert.ok(records.some((r) => r.what === "text" && r.path.endsWith('"!"') && r.ink === set.blockedMark.ink), `${scene}: no mark`);
  }
  // An idle sub-agent's square ring, on its card's fill.
  const idle = (await at("agents, idle sub-agent")).records;
  assert.ok(idle.some((r) => r.what === "border_color" && r.ink === card.idle.ink && r.on === card.base.ink), "no idle mark on the fill");
  // A status with no word: its own upper-case word in the unknown badge.
  const odd = (await at("agents, unknown status")).records.filter((r) => r.path.endsWith('"WAKING"'));
  assert.ok(odd.some((r) => r.ink === c.palettes[0].roles.badgeUnknown.ink), JSON.stringify(odd));
});

test("an agents header shows an unavailable machine's state, as a mark when short of room", async () => {
  const t = THEMES["mocha-like"], c = colors(t);
  const opts = SCENES["agents, unavailable machine"][1];
  // findAll() returns plain nodes; texts() and findAll() take an element.
  const header = (tree, id = "m:laptop") => ({ __node: findAll(tree, (n) => last(n, "id")?.[0] === id)[0] });
  const wide = await render("agents", { ...opts, width: 268, theme: t });
  assert.ok(texts(header(wide)).includes("unavailable"), JSON.stringify(texts(header(wide))));
  const name = findAll(header(wide), (n) => n.kids.includes("LAPTOP"))[0];
  assert.equal(last(name, "text_color")[0], c.roles.offline.ink);
  // This computer's header is ready: no state.
  assert.ok(!texts(header(wide, "m:")).includes("unavailable"));
  const narrow = header(await render("agents", { ...opts, width: 160, theme: t }));
  assert.ok(texts(narrow).includes("!") && !texts(narrow).includes("unavailable"), JSON.stringify(texts(narrow)));
  assert.equal(last(narrow.__node, "tooltip")?.[0], "unavailable");
});

test("text, icons, borders and lines need a role of 3:1 or above; decorative roles only fill backgrounds", () => {
  const chrome = "#181825", star = "#4a4a60", sub = "#9a8fb0";
  const c = { roles: { base: { ink: chrome, on: chrome }, star: { ink: star, on: chrome }, sub: { ink: sub, on: chrome } } };
  const tiers = { generic: { base: 0, star: 0, sub: 3 }, card: {}, head: {} };
  const draws = (el) => untiered(colorRecords(div().bg(chrome).child(el), chrome), c, tiers);
  assert.deepEqual(draws(div().bg(star)), []);
  assert.deepEqual(draws(div().text_color(sub).child("ok").child(svg("x.svg")).border_color(sub)), []);
  // A decorative ink as text, as an icon and as a border: each record is flagged.
  assert.deepEqual(draws(div().text_color(star).child("faint")).map((r) => r.what), ["text"]);
  assert.deepEqual(draws(div().text_color(star).child(svg("x.svg"))).map((r) => r.what), ["icon"]);
  assert.deepEqual(draws(div().border_color(star)).map((r) => r.what), ["border_color"]);
  // A bar 2 px or thinner is a line (a rule line, a divider, a tree stroke, the drop
  // line), so secondary; a dot (a star) or a wider bar (the dock's planks) is not.
  for (const bar of [div().h(1), div().h(2).flex_1(), div().w(1).h(18), div().w(7).h(1)]) {
    assert.deepEqual(draws(bar.bg(star)).map((r) => r.what), ["bg"]);
    assert.deepEqual(draws(div().h(1).bg(sub)), []);
  }
  for (const art of [div().size(2), div().w(2).h(2), div().h(3), div().w(3).h(6)]) assert.deepEqual(draws(art.bg(star)), []);
});

test("a machine header's + shows its hover on the hovered header", async () => {
  // The header and its + would hover to the same background, so the + shows its hover
  // in its text alone, which must stand apart from the header's.
  for (const [name, t] of Object.entries(ALL)) {
    const c = colors(t);
    const tree = await render("spaces", { theme: t, setup: withMachines() });
    const head = findAll(tree, (n) => last(n, "id")?.[0] === "machine-local")[0];
    const [plus] = findAll(tree, (n) => last(n, "id")?.[0] === "machine-add-local");
    assert.equal(plus.hovers.length, 1);
    const hovered = plus.hovers[0];
    assert.equal(last(hovered, "bg"), undefined, name);
    const rest = last(plus, "text_color")?.[0] ?? last(head, "text_color")[0];
    const lit = last(hovered, "text_color")[0];
    const on = c.roles.hoverBg.ink;
    assert.ok(dE(over(rest, on), over(lit, on)) >= 2, `${name}: ${rest} -> ${lit}`);
  }
});

test("Connect's tooltip names the machine, and says it forgets it and pairs again", async () => {
  for (const width of [160, 268]) {
    const tree = await render("spaces", { width, theme: THEMES["mocha-like"], setup: (v) => { v.machines = [rebuilt]; } });
    const [connect] = findAll(tree, (n) => last(n, "id")?.[0] === "machine-connect-laptop");
    const tip = last(connect, "tooltip")[0];
    assert.match(tip, /forget.*pair.*again/i, `${width}`);
    // "This machine" is the local header's label, so the tooltip names the remote one.
    assert.ok(tip.includes("laptop") && !/this machine/i.test(tip), tip);
  }
});

test("a compact rebuilt header's tooltip says rebuilt, with no trailing dot", async () => {
  const tree = await render("spaces", { width: 160, theme: THEMES["mocha-like"], setup: (v) => { v.machines = [rebuilt]; } });
  const head = findAll(tree, (n) => last(n, "id")?.[0] === "machine-laptop")[0];
  assert.ok(texts({ __node: head }).includes("!"), JSON.stringify(texts({ __node: head })));
  assert.equal(last(head, "tooltip")?.[0], "rebuilt");
});

test("the pin's tooltip pins to the top of the card's machine", async () => {
  const tip = async (id, hovered) => {
    const tree = await render("agents", { theme: THEMES["mocha-like"], setup: (v) => { v.hovered = hovered; } });
    return last(findAll(tree, (n) => last(n, "id")?.[0] === id)[0], "tooltip")[0];
  };
  assert.equal(await tip("pin-t1", "t1"), "Pin to the top of its machine");
  assert.equal(await tip("pin-t3", "t3"), "Unpin");
});

test("a machine out of reach dims its header's icon and rule line, not only its name", async () => {
  const t = THEMES["mocha-like"], c = colors(t);
  // The icon's bars and the 2 px rule line: every background drawn in the header.
  const fills = (tree, id) => findAll(tree, (n) => last(n, "id")?.[0] === id)[0];
  for (const [scene, id] of [["spaces, offline machine", "machine-laptop"], ["agents, unavailable machine", "m:laptop"]]) {
    const [role, opts] = SCENES[scene];
    const head = fills(await render(role, { ...opts, width: 300, theme: t }), id);
    const bgs = new Set(findAll({ __node: head }, (n) => n !== head && last(n, "bg")).map((n) => last(n, "bg")[0]));
    assert.ok(bgs.size > 0, scene);
    for (const ink of bgs) assert.ok([c.roles.muted.ink, c.roles.dim.ink].includes(ink), `${scene}: ${ink}`);
    // The rule line is the 2 px bar that takes the spare room (the icon's are fixed).
    assert.equal(findAll({ __node: head }, (n) => last(n, "h")?.[0] === 2 && n.calls.some(([k]) => k === "flex_1")).length, 1, `${scene}: no rule line at 300 px`);
  }
});

test("a row's hover is the hover of the surface it hovers, not chrome's", () => {
  const chrome = "#181825", fill = "#211c2e", raised = "#313244";
  const set = (base, hover) => ({ base: { ink: base, on: base }, hoverBg: { ink: hover, on: base, hover } });
  const c = { roles: set(chrome, "#222233"), raised: set(raised, "#3a3b4d"), palettes: [{ roles: set(fill, "#2b2638") }] };
  const card = (rowBg, hover) => div().bg(chrome).child(div().bg(fill).child(div().when(Boolean(rowBg), (el) => el.bg(rowBg)).hover((s) => s.bg(hover)).child("row")));
  assert.deepEqual(wrongHovers(colorRecords(card(null, "#2b2638"), chrome), c), []);
  assert.deepEqual(wrongHovers(colorRecords(card(raised, "#3a3b4d"), chrome), c), []);
  // Chrome's hover on a card fill, and the fill's hover on a raised row, are wrong.
  for (const [rowBg, hover] of [[null, "#222233"], [raised, "#2b2638"]]) {
    const bad = wrongHovers(colorRecords(card(rowBg, hover), chrome), c);
    assert.equal(bad.length, 1, JSON.stringify(bad));
    assert.equal(bad[0].on, rowBg ?? fill);
  }
});

test("a role declared on chrome but drawn on a card fill fails the check", () => {
  const chrome = "#181825", fill = "#211c2e", ink = "#9a8fb0";
  const c = {
    roles: { base: { ink: chrome, on: chrome }, sub: { ink, on: chrome } },
    palettes: [{ head: { fill: { ink: fill, on: chrome } }, roles: { base: { ink: fill, on: fill } } }],
  };
  const onChrome = div().bg(chrome).child(div().text_color(ink).child("fine"));
  assert.deepEqual(unmatched(colorRecords(onChrome, chrome), c), []);
  const onFill = div().bg(chrome).child(div().bg(fill).child(div().text_color(ink).child("wrong")));
  // Both the color call and the text it colors are flagged, each on the fill.
  const bad = unmatched(colorRecords(onFill, chrome), c);
  assert.ok(bad.length >= 1);
  for (const r of bad) assert.equal(r.on, fill);
});

test("a role drawn on a hovered row's background must declare that background", () => {
  const chrome = "#181825", hover = "#313244", ink = "#9a8fb0";
  const row = () => div().bg(chrome).child(div().hover((s) => s.bg(hover)).child(div().text_color(ink).child("name")));
  const block = (extra) => ({ roles: { base: { ink: chrome, on: chrome }, hoverBg: { ink: hover, on: chrome }, name: { ink, on: chrome, ...extra } } });
  // Declared on chrome only: the name, drawn on the hovered row, is flagged there.
  const bad = unmatched(colorRecords(row(), chrome), block({}));
  assert.ok(bad.length >= 1);
  for (const r of bad) assert.equal(r.on, hover);
  assert.deepEqual(unmatched(colorRecords(row(), chrome), block({ hover })), []);
});

test("an element's opacity is composited into every color drawn inside it", () => {
  const chrome = "#181825";
  const tree = div().bg(chrome).child(div().opacity(0.5).bg("#313244").child(div().text_color("#cdd6f480").child("x")));
  const records = colorRecords(tree, chrome);
  const [, row] = records.filter((r) => r.what === "bg");
  const text = records.find((r) => r.what === "text");
  assert.equal(row.ink, "#31324480");
  assert.equal(text.ink, "#cdd6f440");
  // Half-transparent, the row's background lies between the text and chrome.
  assert.deepEqual([text.on, text.under], [chrome, "#31324480"]);
});

test("a row under one the pointer is not over is never drawn hovered", () => {
  const chrome = "#181825", hover = "#313244", ink = "#9a8fb0";
  const tree = div().bg(chrome).child(div().hover((s) => s.text_color(ink)).child(div().hover((s) => s.bg(hover)).child("x")));
  const states = colorRecords(tree, chrome).filter((r) => r.what === "text").map((r) => [r.ink, r.on]);
  // The inner row hovered implies the outer one is: no record of it with the outer's plain text.
  assert.deepEqual(states.filter(([i, on]) => on === hover && i !== ink), []);
  assert.ok(states.some(([i, on]) => on === hover && i === ink));
});

test("a card in a home space takes its title from the pane's folder, Windows paths too", async () => {
  const cases = [["/home/user/Development/foo/", "foo"], ["C:\\Users\\guest", "guest"], ["C:\\Users\\guest\\", "guest"], ["C:/Users/guest/proj", "proj"]];
  for (const [cwd, want] of cases) {
    const shown = texts(await render("agents", { theme: THEMES["mocha-like"], cwds: { pt2: cwd } }));
    assert.ok(shown.includes(want), `${cwd}: ${JSON.stringify(shown)}`);
    assert.ok(!shown.some((s) => s.includes("\\") || s.includes("Users")), `${cwd}: ${JSON.stringify(shown)}`);
  }
});

test("a pinned card shows the pin at rest and the unpin glyph only while hovered", async () => {
  // t3 is pinned. Hovered, its button is the Unpin action, as in the shipped mod.
  const glyph = async (setup) => {
    const tree = await render("agents", { theme: THEMES["mocha-like"], setup });
    const [pin] = findAll(tree, (n) => last(n, "id")?.[0] === "pin-t3");
    return findAll({ __node: pin }, (n) => n.kind === "svg")[0].arg.split("/").pop();
  };
  assert.equal(await glyph(), "pin.svg");
  assert.equal(await glyph((v) => { v.hovered = "t3"; }), "pin-off.svg");
});

test("only WORKING and NEEDS YOU pulse, from the block's low opacity up to 1", async () => {
  // The stub world's agents, plus one whose status the mod has no word for.
  const list = [...herdr.agents(), { ...herdr.agents()[1], address: "t5", pane: "pt5", status: "waking" }];
  for (const [name, t] of Object.entries(ALL)) {
    const tree = await render("agents", { theme: t, agents: list });
    for (const word of ["WORKING", "NEEDS YOU", "IDLE", "DONE", "WAKING"]) {
      const [badge] = findAll(tree, (n) => n.kids.includes(word));
      assert.ok(badge, `${name}: no ${word} badge`);
      const loop = last(badge, "loop");
      if (word === "WORKING" || word === "NEEDS YOU") assert.deepEqual([loop?.[0], loop?.[1].from, loop?.[1].to], ["opacity", colors(t).pulseLow, 1], `${name} ${word}`);
      else assert.equal(loop, undefined, `${name} ${word}`);
    }
  }
});

test("after an install rename, each mod's self-references follow the new folder name", async () => {
  // Herdr's install renames a taken mod and rewrites its mods/<name>/ paths: here, a
  // copy of each mod as mods/renamed-<role>/, its SELF line rewritten.
  const busy = (v) => { v.machines = [rebuilt]; v.reconnecting = { laptop: { machine: rebuilt, removed: true, busy: true, error: null } }; };
  const checks = {
    // The sprites, and the sort menu's overlay.
    agents: [{}, (tree, to) => {
      const sprites = findAll(tree, (n) => n.kind === "image").map((n) => n.arg);
      assert.ok(sprites.length > 0);
      for (const p of sprites) assert.ok(p.startsWith(`mods/${to}/sprites/`), p);
      last(findAll(tree, (n) => last(n, "id")?.[0] === "ag-sort")[0], "on_click")[0]();
      assert.equal(herdr.overlays.at(-1).mod, to);
    }],
    // Reconnecting at 160 px, Connect is the reconnect icon.
    spaces: [{ width: 160, setup: busy }, (tree, to) => {
      assert.deepEqual(findAll(tree, (n) => n.kind === "svg" && /reconnect\.svg$/.test(n.arg)).map((n) => n.arg), [`mods/${to}/reconnect.svg`]);
    }],
  };
  for (const [role, [opts, check]] of Object.entries(checks)) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pixelherd-rename-"));
    try {
      const to = `renamed-${role}`, dir = path.join(root, "mods", to);
      fs.cpSync(modUrl(role), dir, { recursive: true });
      const main = path.join(dir, "main.js");
      fs.writeFileSync(main, fs.readFileSync(main, "utf8").replaceAll(`mods/${MODS[role]}/`, `mods/${to}/`));
      check(await render(pathToFileURL(main), { ...opts, theme: THEMES["mocha-like"] }), to);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("one view rendered again after a theme change recolors", async () => {
  // currentColors() caches by theme: a view that lives across the change must not keep
  // the old colors.
  const [a, b] = [THEMES["mocha-like"], THEMES["latte-like"]];
  for (const [role, opts] of [SCENES.spaces, SCENES.agents]) {
    const inks = (tree, t) => colorRecords(tree, colors(t).roles.base.ink).map((r) => r.ink).join();
    let view;
    const first = await render(role, { ...opts, theme: a, setup: (v) => { opts.setup?.(v); view = v; } });
    const again = await render(role, { ...opts, theme: b, view });
    const fresh = await render(role, { ...opts, theme: b });
    assert.notEqual(inks(first, a), inks(again, b), role);
    assert.equal(inks(again, b), inks(fresh, b), role);
  }
});

test("agent.next order: machines in palette order, pinned first, then by the sort", async () => {
  const prog = { key: "claude", name: "Claude Code", agent: true };
  const ag = (address, status, extra = {}) => ({ address, pane: `p${address}`, space: "s1", space_name: "a-rather-long-space-name-here", tab: "tab1", status, program: prog, title: "", seq: 1, pinned: false, focused: false, ...extra });
  const list = [ag("a1", "idle"), ag("a2", "blocked"), ag("a3", "working", { pinned: true }), ag("box/a4", "working"), ag("a5", "done")];
  const order = async () => { await render("agents", { theme: THEMES["mocha-like"], agents: list }); return herdr.orders.at(-1); };
  try {
    assert.deepEqual(await order(), ["a3", "a2", "a5", "a1", "box/a4"]);
    herdr.setShared("agents.sort", "grouped");
    assert.deepEqual(await order(), ["a3", "a1", "a2", "a5", "box/a4"]);
  } finally {
    herdr.setShared("agents.sort", undefined);
  }
});

test("a machine's palette is its place in the machine list, wrapped to the palettes", () => {
  const list = look.machineList([{ name: null }, { name: "zeta" }], [{ machine: "alpha" }], [{ address: "mid/t1" }, { address: "t2" }]);
  assert.deepEqual(list, [null, "alpha", "mid", "zeta"]);
  assert.deepEqual([null, undefined, "alpha", "zeta"].map((m) => look.paletteIndex(m, list, 6)), [0, 0, 1, 3]);
  // A machine not listed takes the next place; past the last palette, the count wraps.
  assert.equal(look.paletteIndex("new", list, 6), 4);
  assert.equal(look.paletteIndex("zeta", list, 3), 0);
});

test("every builder method the mods call is in gpui-kit.d.ts", async (t) => {
  const dts = modUrl("agents", "gpui-kit.d.ts");
  if (!fs.existsSync(dts)) {
    // Loud: a skip here means no builder call is checked against Herdr's API.
    console.warn(`\nWARNING: SKIPPED the gpui-kit.d.ts method check: ${dts.pathname} is missing. Run herdr-app check on the mod first.\n`);
    return t.skip("no gpui-kit.d.ts: run herdr-app check on the mod first");
  }
  const text = fs.readFileSync(dts, "utf8");
  for (const [name, [role, opts]] of Object.entries(SCENES)) await render(role, { ...opts, theme: THEMES["mocha-like"], width: 160 });
  const missing = [...kit.called].filter((m) => !new RegExp(`\\b${m}\\s*[<(]`).test(text));
  assert.deepEqual(missing, []);
});
