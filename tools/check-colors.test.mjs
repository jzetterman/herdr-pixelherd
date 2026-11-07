// Tests for tools/check-colors.mjs: it must pass the real color block on every fixture
// theme and catch blocks that break requirement 4. The fixtures: themes.json, four
// made-up themes, and captures.json, the 30 test-set themes as Herdr's theme() returned
// them.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkTheme, deltaE00, dE as deltaE, contrast, over, oklab, fromLch, candidates, loadColors, GENERIC, CARD, HEAD } from "./check-colors.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const FIXTURES = ["fixtures/themes.json", "fixtures/captures.json"];
const THEMES = JSON.parse(fs.readFileSync(here(FIXTURES[0]), "utf8"));
const CAPTURES = JSON.parse(fs.readFileSync(here(FIXTURES[1]), "utf8"));
const { colors } = await loadColors();

// A copy of colors(t) with `change` applied to it, as a broken block would return.
const broken = (change) => (t) => {
  const c = structuredClone(colors(t));
  change(c, t);
  return c;
};
// Give palette `p` a new label everywhere the label is drawn at full strength.
function setLabel(p, hex) {
  p.label = hex;
  Object.assign(p.head.label, { color: hex, ink: hex });
}

test("CIEDE2000 matches Sharma's published pairs", () => {
  assert.equal(deltaE00([50, 2.6772, -79.7751], [50, 0, -82.7485]).toFixed(4), "2.0425");
  assert.equal(deltaE00([50, 0, 0], [50, -1, 2]).toFixed(4), "2.3669");
  assert.equal(deltaE00([50, 2.5, 0], [73, 25, -18]).toFixed(4), "27.1492");
});

test("WCAG 2 contrast matches its known answers", () => {
  assert.equal(contrast("#767676", "#ffffff").toFixed(2), "4.54");
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#ffffff", "#000000"), 21);
  assert.equal(contrast("#777777", "#777777"), 1);
});

test("the real block passes every fixture theme", () => {
  for (const [name, t] of Object.entries({ ...THEMES, ...CAPTURES })) {
    assert.deepEqual(checkTheme(t, colors), [], name);
  }
});

test("a role that misses its tier lands at that tier, keeping the theme's dim-below-muted order", () => {
  // Adjusted to 5:1, a secondary dim role that missed 3:1 read stronger than the
  // theme's muted one (paper: dim 5.53:1, muted 4.84:1).
  const k = (r) => contrast(over(r.ink, r.on), r.on);
  for (const [name, t] of Object.entries({ ...THEMES, ...CAPTURES })) {
    const c = colors(t);
    for (const [where, set] of [["chrome", c.roles], ["menu", c.menu], ["raised", c.raised], ...c.palettes.map((p, i) => [`palette ${i}`, p.roles])]) {
      const dimFirst = contrast(over(t.dim, set.base.ink), set.base.ink) <= contrast(over(t.muted, set.base.ink), set.base.ink);
      if (dimFirst) assert.ok(k(set.dim) <= k(set.muted) + 0.05, `${name} ${where}: dim ${k(set.dim).toFixed(2)}, muted ${k(set.muted).toFixed(2)}`);
    }
  }
  // paper's dim misses 3:1 on its chrome's hover: it lands just above 3:1 on the
  // tighter of its two backgrounds, not at 5:1.
  const r = colors(CAPTURES.paper).roles.dim;
  const low = Math.min(...[r.on, r.hover].map((b) => contrast(over(r.ink, b), b)));
  assert.ok(low >= 3 && low < 3.1, `${low}`);
});

test("roles and the pulse clear their bars by 0.02, so byte rounding can't drop them below", () => {
  for (const [name, t] of Object.entries({ ...THEMES, ...CAPTURES })) {
    const c = colors(t);
    const sets = [[c.roles, GENERIC], [c.menu, GENERIC], [c.raised, GENERIC], ...c.palettes.flatMap((p) => [[p.roles, CARD], [p.head, HEAD]])];
    for (const [set, tiers] of sets) for (const [role, bar] of Object.entries(tiers)) {
      if (!bar) continue;
      const r = set[role];
      for (const b of [r.on, r.hover].filter(Boolean)) {
        const bg = r.under ? over(r.under, b) : b;
        const k = contrast(over(r.ink, bg), bg);
        assert.ok(k >= bar + 0.02 - 1e-9, `${name} ${role}: ${k.toFixed(3)} on ${bg}`);
      }
    }
    for (const p of c.palettes) for (const r of [p.roles.badgeWorking, p.roles.badgeBlocked]) {
      assert.ok(contrast(over(r.ink, r.on, c.pulseLow), r.on) >= 3.02, `${name} pulse`);
    }
  }
});

// The largest smallest pairwise CIEDE2000 any three of this script's candidates reach.
function maxMin(t) {
  const own = candidates(t);
  let best = 0;
  for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) for (let k = j + 1; k < own.length; k++) {
    best = Math.max(best, Math.min(deltaE00(own[i].lab, own[j].lab), deltaE00(own[i].lab, own[k].lab), deltaE00(own[j].lab, own[k].lab)));
  }
  return best;
}

test("the made-up themes reach the cases they exist for", () => {
  // Low variety: no three candidates reach 10, so the max-min exception applies.
  assert.ok(maxMin(THEMES["low-variety"]) < 10, `max-min triple ${maxMin(THEMES["low-variety"])}`);
  // Mid-gray chrome: every candidate goes to the black or white end, as captured too.
  for (const t of [THEMES["mid-gray"], CAPTURES["made-mid-gray"]]) {
    for (const c of candidates(t)) assert.match(c.hex, /^#(000000|ffffff)$/);
  }
});

// The theme file sets the panel foreground in "colors" as well as the terminal one;
// with only the top-level key, Herdr derives theme()'s foreground (#eeeeef), far from the grays.
test("the captured low-variety theme reaches the max-min exception", () => {
  const best = maxMin(CAPTURES["made-low-variety"]);
  assert.ok(best < 10, `max-min triple ${best}`);
});

test("the checker's candidates land where the block's do, well inside the 0.5 tolerance", () => {
  // A plain lightness scan overshot by up to a step: latte-like's #8c5600 came out
  // #8c5500, CIEDE2000 0.47 away, a hair from failing a correct label.
  for (const [name, t] of Object.entries({ ...THEMES, ...CAPTURES })) {
    const own = candidates(t);
    for (const p of colors(t).palettes) {
      const lab = candidates({ ...t, ansi1: p.label })[0].lab;
      const gap = Math.min(...own.map((x) => deltaE00(x.lab, lab)));
      assert.ok(gap < 0.25, `${name} ${p.label}: ${gap.toFixed(3)}`);
    }
  }
});

test("a block that gives every palette one label fails", () => {
  const one = broken((c) => { for (const p of c.palettes) setLabel(p, c.palettes[0].label); });
  const failures = checkTheme(THEMES["mocha-like"], one);
  assert.ok(failures.some((f) => /distance/.test(f)), failures.join("\n"));
});

// Swap two palettes' labels everywhere they are drawn at full strength.
function swapLabels(c, i, j) {
  const [a, b] = [c.palettes[i].label, c.palettes[j].label];
  setLabel(c.palettes[i], b);
  setLabel(c.palettes[j], a);
}

test("a block whose palette 0 is not the one farthest from the blocked color fails", () => {
  // atom-one-dark's blocked color is its ansi1, the first candidate.
  const t = CAPTURES["atom-one-dark"];
  const blocked = candidates({ ...t, ansi1: t.blocked })[0].lab;
  const c = colors(t);
  const near = [0, 1, 2].reduce((m, i) => (deltaE00(candidates({ ...t, ansi1: c.palettes[i].label })[0].lab, blocked) < deltaE00(candidates({ ...t, ansi1: c.palettes[m].label })[0].lab, blocked) ? i : m), 0);
  assert.notEqual(near, 0);
  const failures = checkTheme(t, broken((x) => swapLabels(x, 0, near)));
  assert.ok(failures.some((f) => /palette 0 .*blocked/.test(f)), failures.join("\n"));
});

// Every triple of this script's candidates for `t`: its colors in candidate order, the
// smallest pairwise CIEDE2000 (`spread`) and its member nearest the blocked color
// (`nearest`), with that color brought to 5:1 as the block does.
function triples(t) {
  const own = candidates(t);
  const blocked = candidates({ ...t, ansi1: t.blocked })[0].lab;
  const out = [];
  for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) for (let k = j + 1; k < own.length; k++) {
    const m = [own[i], own[j], own[k]];
    const spread = Math.min(deltaE00(m[0].lab, m[1].lab), deltaE00(m[0].lab, m[2].lab), deltaE00(m[1].lab, m[2].lab));
    const away = m.map((x) => deltaE00(x.lab, blocked));
    out.push({ hexes: m.map((x) => x.hex), away, spread, nearest: Math.min(...away) });
  }
  return out;
}
// Palettes 0..2 given triple `x`: 0 its member farthest from the blocked color, then
// the other two in candidate order.
function useTriple(c, x) {
  const first = x.away.indexOf(Math.max(...x.away));
  [x.hexes[first], ...x.hexes.filter((_, i) => i !== first)].forEach((hex, i) => setLabel(c.palettes[i], hex));
}

test("a block that keeps the max-min triple when a triple 10 apart sits clear of the blocked color fails", () => {
  // atom-one-dark: the max-min triple holds ansi1, which is also its blocked color.
  const t = CAPTURES["atom-one-dark"];
  const all = triples(t);
  const maxmin = all.reduce((m, x) => (x.spread > m.spread ? x : m));
  assert.ok(maxmin.nearest < 0.5 && all.some((x) => x.spread >= 10 && x.nearest > 10));
  const failures = checkTheme(t, broken((c) => useTriple(c, maxmin)));
  assert.ok(failures.some((f) => /^palettes 0-2: nearest label .*blocked color.*a triple 10 apart keeps/.test(f)), failures.join("\n"));
});

test("a block that breaks a tie on the blocked distance toward the narrower triple fails", () => {
  // Most triples tie with another that shares their member nearest the blocked color.
  const t = CAPTURES.graphite;
  const clear = triples(t).filter((x) => x.spread >= 10);
  const far = Math.max(...clear.map((x) => x.nearest));
  const tied = clear.filter((x) => x.nearest === far);
  const narrow = tied.reduce((m, x) => (x.spread < m.spread ? x : m));
  assert.ok(Math.max(...tied.map((x) => x.spread)) - narrow.spread > 0.5, JSON.stringify(tied));
  const failures = checkTheme(t, broken((c) => useTriple(c, narrow)));
  assert.ok(failures.some((f) => /^palettes 0-2: .*a triple as far from the blocked color reaches/.test(f)), failures.join("\n"));
});

test("with no triple 10 apart the max-min triple stands, even on the blocked color", () => {
  // low-variety: the exception, where the alarm rule does not apply.
  const t = THEMES["low-variety"];
  assert.ok(triples(t).every((x) => x.spread < 10));
  assert.deepEqual(checkTheme(t, colors), []);
  const all = triples(t);
  const maxmin = all.reduce((m, x) => (x.spread > m.spread ? x : m));
  const failures = checkTheme(t, broken((c) => useTriple(c, all.find((x) => x.spread < maxmin.spread - 1))));
  assert.ok(failures.some((f) => /max-min triple/.test(f)), failures.join("\n"));
});

test("a block whose palettes 3 to 5 keep candidate order, not farthest from the blocked color first, fails", () => {
  // atom-one-dark: its blocked color is ansi1, which candidate order puts in palette 3.
  const t = CAPTURES["atom-one-dark"];
  const own = candidates(t);
  const blocked = candidates({ ...t, ansi1: t.blocked })[0].lab;
  const c = colors(t);
  const used = c.palettes.slice(0, 3).map((p) => candidates({ ...t, ansi1: p.label })[0].hex);
  const rest = [...new Set(own.map((x) => x.hex))].filter((h) => !used.some((u) => deltaE(u, h) < 0.5));
  assert.ok(rest.length >= 3 && deltaE00(candidates({ ...t, ansi1: rest[0] })[0].lab, blocked) < 0.5, rest.join(" "));
  const failures = checkTheme(t, broken((x) => rest.slice(0, 3).forEach((hex, i) => setLabel(x.palettes[3 + i], hex))));
  assert.ok(failures.some((f) => /^palette 3 label .*blocked color.*is .* from it/.test(f)), failures.join("\n"));
});

test("a block whose palettes 1 and 2 leave candidate order fails", () => {
  const failures = checkTheme(THEMES["mocha-like"], broken((x) => swapLabels(x, 1, 2)));
  assert.ok(failures.some((f) => /palettes 1 and 2 .*candidate order/.test(f)), failures.join("\n"));
});

test("a block whose label misses 4.5:1 fails", () => {
  const t = THEMES["mocha-like"];
  const dim = broken((c) => setLabel(c.palettes[1], "#3a3a50"));
  assert.ok(contrast("#3a3a50", t.chrome) < 4.5);
  const failures = checkTheme(t, dim);
  assert.ok(failures.some((f) => /palette 1 .*label.*4\.5/.test(f)), failures.join("\n"));
});

test("a block with well spread labels that are not candidates fails", () => {
  const t = THEMES["mocha-like"];
  const own = ["#ff8800", "#00ff88", "#ff00ff", "#00ffff", "#ffff00", "#88ff00"];
  // The case is real: each passes 5:1, the first three are 10 apart, none is a candidate.
  const cands = candidates(t);
  const labOf = (hex) => candidates({ ...t, ansi1: hex }).find((c) => c.key === "ansi1").lab;
  for (const hex of own) {
    assert.ok(contrast(hex, t.chrome) >= 5, hex);
    assert.ok(cands.every((c) => deltaE00(c.lab, labOf(hex)) > 2), hex);
  }
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) assert.ok(deltaE00(labOf(own[a]), labOf(own[b])) >= 10);
  const spread = broken((c) => c.palettes.forEach((p, i) => setLabel(p, own[i])));
  const failures = checkTheme(t, spread);
  assert.ok(failures.some((f) => /candidate/.test(f)), failures.join("\n"));
});

test("a block whose pulse dips too low fails", () => {
  const low = broken((c) => { c.pulseLow = 0.1; });
  const failures = checkTheme(THEMES["mocha-like"], low);
  assert.ok(failures.some((f) => /pulse/.test(f)), failures.join("\n"));
});

test("a block whose pulse dips less than it may fails", () => {
  // The pulse must reach as low as the bar allows: a flat 1 is no pulse.
  const flat = broken((c) => { c.pulseLow = 1; });
  const failures = checkTheme(THEMES["mocha-like"], flat);
  assert.ok(failures.some((f) => /^pulse low opacity 1 is not the lowest that passes/.test(f)), failures.join("\n"));
});

test("a block that leaves out a role fails", () => {
  const gone = broken((c) => { delete c.palettes[2].roles.sub; });
  const failures = checkTheme(THEMES["latte-like"], gone);
  assert.ok(failures.some((f) => /palette 2 .*sub.*missing/.test(f)), failures.join("\n"));
});

test("a role the tier tables do not name fails", () => {
  // A new role at 1.3:1 would escape a check that reads only the roles it knows.
  for (const [where, set] of [["chrome roles", (c) => c.roles], ["palette 3 card roles", (c) => c.palettes[3].roles], ["palette 1 header roles", (c) => c.palettes[1].head]]) {
    const extra = broken((c) => { const r = set(c); r.faint = { ...r.base, opacity: 0.1 }; });
    const failures = checkTheme(THEMES["mocha-like"], extra);
    assert.ok(failures.some((f) => f.startsWith(`${where} faint: not a role`)), failures.join("\n"));
  }
});

test("a header role that declares no hover background fails", () => {
  const bare = broken((c) => { delete c.palettes[0].head.count.hover; });
  const failures = checkTheme(THEMES["mocha-like"], bare);
  assert.ok(failures.some((f) => /palette 0 header roles count: .*hover/.test(f)), failures.join("\n"));
});

// Give role set `set` the hover background `hex`, as every role it draws hovered declares.
function setHover(set, hex) {
  for (const r of Object.values(set)) if (r.hover !== undefined) r.hover = hex;
  Object.assign(set.hoverBg, { color: hex, ink: hex, opacity: 1 });
}

test("each surface's hover is the theme's hover drawn over that surface", () => {
  // graphite: the hover is translucent white. Drawn over chrome and reused on the
  // lighter popover, it hovers darker than the popover itself.
  const t = CAPTURES.graphite;
  const reused = broken((c) => setHover(c.menu, c.roles.hoverBg.ink));
  assert.ok(contrast(colors(t).roles.hoverBg.ink, "#000000") < contrast(t.popover, "#000000"));
  let failures = checkTheme(t, reused);
  assert.ok(failures.some((f) => /^menu roles hoverBg .*not the theme's hover/.test(f)), failures.join("\n"));
  // lumon: chrome's hover reused on palette 0's card fill is the fill itself.
  const lumon = CAPTURES["omarchy-lumon"];
  failures = checkTheme(lumon, broken((c) => setHover(c.palettes[0].roles, c.roles.hoverBg.ink)));
  assert.ok(failures.some((f) => /^palette 0 card roles hoverBg .*not the theme's hover/.test(f)), failures.join("\n"));
});

test("a hover weakened further than its labels need fails", () => {
  // On a card fill nothing forces paper's hover below full strength: a half one fails.
  const t = CAPTURES.paper;
  const weak = broken((c) => { const r = c.palettes[2].roles; setHover(r, over(t.hover, r.base.ink, 0.5)); });
  const failures = checkTheme(t, weak);
  assert.ok(failures.some((f) => /^palette 2 card roles hoverBg .*not the theme's hover/.test(f)), failures.join("\n"));
});

test("a role drawn on a card's hovered rows declares that card's hover, not chrome's", () => {
  const t = CAPTURES["omarchy-lumon"];
  const wrong = broken((c) => { c.palettes[0].roles.sub.hover = c.roles.hoverBg.ink; });
  const failures = checkTheme(t, wrong);
  assert.ok(failures.some((f) => /^palette 0 card roles sub: hover .*drawn on hovered rows/.test(f)), failures.join("\n"));
});

test("the checker notes each hover under CIEDE2000 2 from its surface, and why", () => {
  // mocha-like's opaque hover is its raised color: the theme's own hover is invisible there.
  const notes = [];
  assert.deepEqual(checkTheme(THEMES["mocha-like"], colors, notes), []);
  assert.ok(notes.some((n) => /^raised roles hoverBg .* the theme's own hover/.test(n)), notes.join("\n"));
  // A hover under 2 that neither the labels nor the theme explain fails.
  const flat = broken((c) => setHover(c.menu, c.menu.base.ink));
  const failures = checkTheme(CAPTURES.paper, flat);
  assert.ok(failures.some((f) => /^menu roles hoverBg .*CIEDE2000/.test(f)), failures.join("\n"));
});

test("a header line that misses 3:1 on the hover background fails", () => {
  // The line solved on chrome alone (the least opacity at 3:1 there): too faint hovered.
  const t = THEMES["mocha-like"];
  const c = colors(t), hover = c.roles.hoverBg.ink, color = c.palettes[0].head.line.color;
  const at = (a) => color + a.toString(16).padStart(2, "0");
  let a = 0;
  while (contrast(over(at(a), t.chrome), t.chrome) < 3) a++;
  assert.ok(contrast(over(at(a), hover), hover) < 3);
  const weak = broken((x) => Object.assign(x.palettes[0].head.line, { ink: at(a), opacity: a / 255 }));
  const failures = checkTheme(t, weak);
  assert.ok(failures.some((f) => /palette 0 header roles line: .*hover/.test(f)), failures.join("\n"));
});

test("a card hover border that misses 3:1 on its fill fails", () => {
  // The hover border is a border, so secondary: label at the least opacity under 3:1.
  const t = THEMES["latte-like"];
  const r = colors(t).palettes[0].roles.lineHover;
  const at = (a) => r.color + a.toString(16).padStart(2, "0");
  let a = 255;
  while (contrast(over(at(a), r.on), r.on) >= 3) a--;
  const weak = broken((x) => Object.assign(x.palettes[0].roles.lineHover, { ink: at(a), opacity: a / 255 }));
  const failures = checkTheme(t, weak);
  assert.ok(failures.some((f) => /palette 0 card roles lineHover: .*needs 3:1/.test(f)), failures.join("\n"));
});

test("a card hover border fainter than the resting border fails", () => {
  const t = THEMES["mocha-like"];
  const faint = broken((x) => {
    const r = x.palettes[0].roles;
    Object.assign(r.line, { color: r.lineHover.color, ink: r.lineHover.color, opacity: 1 });
  });
  const failures = checkTheme(t, faint);
  assert.ok(failures.some((f) => /palette 0 .*lineHover.*fainter/.test(f)), failures.join("\n"));
});

test("a card hover border that looks like the focused border fails", () => {
  const t = THEMES["mocha-like"];
  const same = broken((x) => { const r = x.palettes[0].roles; Object.assign(r.lineHover, { color: r.highlight.color, ink: r.highlight.ink, opacity: 1 }); });
  const failures = checkTheme(t, same);
  assert.ok(failures.some((f) => /palette 0 card roles lineHover: .*focused border/.test(f)), failures.join("\n"));
});

test("a card hover border nearer the focused border than half the resting one's gap fails", () => {
  // paper's accent is a palette label: rest, hover and focus are near one color in
  // three alphas. A hover 2 or more from focus, but nearer than half the rest's gap, fails.
  const t = CAPTURES.paper, c = colors(t);
  const near = (p) => deltaE(over(p.roles.lineHover.ink, p.fill), over(p.roles.highlight.ink, p.fill));
  const i = c.palettes.reduce((m, p, k) => (near(p) < near(c.palettes[m]) ? k : m), 0);
  const r = c.palettes[i].roles, on = r.line.on;
  const focus = over(r.highlight.ink, on), half = deltaE(over(r.line.ink, on), focus) / 2;
  const at = (a) => r.line.color + a.toString(16).padStart(2, "0");
  let a = 255;
  while (deltaE(over(at(a), on), focus) < 2.1) a--;
  assert.ok(deltaE(over(at(a), on), focus) < half - 0.5, `${half}`);
  const close = broken((x) => Object.assign(x.palettes[i].roles.lineHover, { ink: at(a), opacity: a / 255 }));
  const failures = checkTheme(t, close);
  assert.ok(failures.some((f) => new RegExp(`^palette ${i} card roles lineHover: .*focused border.*needs`).test(f)), failures.join("\n"));
});

test("a card's hover border stays fainter than the focused border", () => {
  // vantablack, palette 0: rest 4.08:1, focus 5.73:1, and a hover 0.25 stronger at 8.39:1.
  const k = (r) => contrast(over(r.ink, r.on), r.on);
  for (const [name, t] of Object.entries({ ...THEMES, ...CAPTURES })) {
    colors(t).palettes.forEach((p, i) => {
      const { line, lineHover, highlight } = p.roles;
      assert.ok(k(lineHover) < k(highlight) || lineHover.opacity === line.opacity, `${name} palette ${i}: hover ${k(lineHover).toFixed(2)}, focus ${k(highlight).toFixed(2)}`);
    });
  }
});

test("a card hover border as strong as the focused border fails", () => {
  // The hover 0.25 stronger than rest, uncapped.
  const t = CAPTURES["omarchy-vantablack"];
  fails(t, (c) => {
    const r = c.palettes[0].roles, a = Math.round(Math.min(1, r.line.opacity + 0.25) * 255);
    Object.assign(r.lineHover, { ink: a === 255 ? r.line.color : r.line.color + a.toString(16).padStart(2, "0"), opacity: a / 255 });
  }, /^palette 0 card roles lineHover: [\d.]+:1 is not fainter than the focused border's [\d.]+:1/);
});

// mocha-like with a hover of white at 0x50: drawn in full on the popover or a raised
// row, the theme's foreground drops under 4.5:1.
const BRIGHT = { ...THEMES["mocha-like"], hover: "#ffffff50" };

test("the menu and raised hovers weaken only as far as the foreground keeps 4.5:1", () => {
  for (const [t, hover] of [[BRIGHT, "#ffffff50"], [{ ...THEMES["latte-like"], hover: "#00000050" }, "#00000050"]]) {
    const c = colors(t);
    for (const [set, surface] of [[c.menu, t.popover], [c.raised, t.raised]]) {
      assert.ok(contrast(t.foreground, over(hover, surface)) < 4.5, surface);
      const k = contrast(t.foreground, set.hoverBg.ink);
      assert.ok(k >= 4.52 && k < 4.7, `${surface}: ${k}`);
    }
    assert.deepEqual(checkTheme(t, colors), []);
  }
});

test("a hover is drawn in full where its foreground misses 4.5:1 on the surface itself", () => {
  // mid-gray: the foreground reads under 4.5:1 on the popover and raised rows with no
  // hover at all, so weakening the hover can't keep it there (the text role adjusts).
  for (const t of [THEMES["mid-gray"], CAPTURES["made-mid-gray"]]) {
    const c = colors(t);
    for (const [set, surface] of [[c.menu, t.popover], [c.raised, t.raised]]) {
      assert.ok(contrast(t.foreground, surface) < 4.5, surface);
      assert.equal(set.hoverBg.ink, over(t.hover, surface), surface);
    }
  }
});

test("a menu hover drawn in full where it drops the foreground under 4.5:1 fails", () => {
  fails(BRIGHT, (c) => setHover(c.menu, over(BRIGHT.hover, BRIGHT.popover)), /^menu roles hoverBg .*not the theme's hover .*the most its labels allow/);
});

test("a block whose fills move less than the largest amount that passes fails", () => {
  // mocha-like's fills pass at about 4.5%; chrome itself, an amount of 0, falls short.
  const t = THEMES["mocha-like"];
  const flat = broken((c) => { for (const p of c.palettes) p.fill = t.chrome; });
  const failures = checkTheme(t, flat);
  assert.ok(failures.some((f) => /fill amount 0\.000 .*largest/.test(f)), failures.join("\n"));
});

test("two palettes that are the same fail", () => {
  const twins = broken((c) => { c.palettes[5] = structuredClone(c.palettes[4]); });
  const failures = checkTheme(THEMES["mocha-like"], twins);
  assert.ok(failures.some((f) => /identical/.test(f)), failures.join("\n"));
});

// One broken block per check below, each failing with that check's own message.
const fails = (t, change, re) => {
  const failures = checkTheme(t, broken(change));
  assert.ok(failures.some((f) => re.test(f)), `${re}\n${failures.join("\n")}`);
};
// `hex` drawn over chrome at amount `f`: chrome moved toward `hex` by f.
const toward = (hex, chrome, f) => over(hex, chrome, f);

test("a fill that is not chrome mixed toward its own label fails", () => {
  const t = THEMES["mocha-like"];
  fails(t, (c) => { c.palettes[1].fill = toward(c.palettes[2].label, t.chrome, 0.08); }, /^palette 1 fill .* is not chrome mixed toward its label/);
});

test("a fill amount above 10% fails", () => {
  const t = THEMES["mocha-like"];
  fails(t, (c) => { for (const p of c.palettes) p.fill = toward(p.label, t.chrome, 0.2); }, /^palette 0 fill amount 0\.2\d\d is outside \[0, 0\.10\]/);
});

test("fills that move by different amounts fail", () => {
  const t = THEMES["mocha-like"];
  fails(t, (c) => { c.palettes[0].fill = toward(c.palettes[0].label, t.chrome, 0.01); }, /^fill amounts differ across palettes/);
});

test("a label under 4.5:1 on its fill fails, though it passes on chrome", () => {
  const t = THEMES["mocha-like"];
  fails(t, (c) => { c.palettes[1].fill = toward(c.palettes[1].label, t.chrome, 0.6); }, /^palette 1 label .*on its fill, needs 4\.5:1/);
});

// A role whose translucent `under` sits between it and its background: here almost its
// own color, so it passes only if `under` is left out.
const muddy = (c) => { const r = c.roles.blockedMark; r.under = r.ink.slice(0, 7) + "e6"; };

test("a role is measured on its translucent under, composited over its background", () => {
  fails(THEMES["mocha-like"], muddy, /^chrome roles blockedMark: [\d.]+:1 on #[0-9a-f]{6}, needs 3:1/);
});

test("a role is measured on its translucent under, composited over its hover background", () => {
  fails(THEMES["mocha-like"], muddy, /^chrome roles blockedMark: [\d.]+:1 on the hover background #[0-9a-f]{6}, needs 3:1/);
});

test("an ink that does not carry its role's opacity fails", () => {
  fails(THEMES["mocha-like"], (c) => { c.roles.dim.opacity = 0.5; }, /^chrome roles dim: ink #[0-9a-f]{6} does not carry opacity 0\.5/);
});

test("a role whose background is not opaque fails", () => {
  fails(THEMES["mocha-like"], (c) => { c.roles.dim.on += "80"; }, /^chrome roles dim: on #[0-9a-f]{8} is not opaque/);
});

test("a header label that is not its palette's label fails", () => {
  fails(THEMES["mocha-like"], (c) => { const l = c.palettes[2].label; Object.assign(c.palettes[0].head.label, { color: l, ink: l }); }, /^palette 0 head label .* is not the palette label/);
});

test("a pulse low opacity outside [0.45, 1] fails", () => {
  fails(THEMES["mocha-like"], (c) => { c.pulseLow = 0.3; }, /^pulse low opacity 0\.3 is outside \[0\.45, 1\]/);
});

test("a hover background that is not opaque fails", () => {
  fails(THEMES["mocha-like"], (c) => { c.menu.hoverBg.ink += "80"; }, /^menu roles hoverBg #[0-9a-f]{8} is not opaque/);
});

test("palettes 1 and 2 are ranked by their nearest candidate, not the first one near them", () => {
  // ansi9 a byte off ansi1: a near-duplicate candidate earlier in the order than
  // palette 2's own must not rank it first.
  const t = { ...THEMES["mocha-like"] };
  t.ansi9 = t.ansi1.slice(0, 5) + (parseInt(t.ansi1.slice(5, 7), 16) ^ 1).toString(16).padStart(2, "0") + t.ansi1.slice(7);
  const own = candidates(t);
  const [a1, a2, a9] = ["ansi1", "ansi2", "ansi9"].map((k) => own.find((x) => x.key === k).hex);
  assert.ok(a1 !== a9 && deltaE(a1, a9) < 0.5, `${a1} ${a9}`);
  const failures = checkTheme(t, broken((c) => { setLabel(c.palettes[1], a2); setLabel(c.palettes[2], a9); }));
  assert.ok(!failures.some((f) => /candidate order/.test(f)), failures.join("\n"));
});

test("a translucent chrome, or an opaque color written with ff, follows the block's one rule", () => {
  // The block drops chrome's alpha; the checker must too, and read "#rrggbbff" as "#rrggbb".
  const t = THEMES["mocha-like"];
  assert.deepEqual(checkTheme({ ...t, chrome: t.chrome + "80" }, colors), []);
  const ff = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, /^#[0-9a-f]{6}$/i.test(v) ? v + "ff" : v]));
  assert.deepEqual(checkTheme(ff, colors), []);
});

// Ottosson's published OKLCH for the sRGB primaries: L, C and the hue in degrees.
// Each uses one column of the forward matrices; together they use all three.
const PRIMARIES = { "#ff0000": [0.627955, 0.257683, 29.2339], "#00ff00": [0.86644, 0.294827, 142.4953], "#0000ff": [0.452014, 0.313214, 264.052] };
const deg = (h) => (((h * 180) / Math.PI) % 360 + 360) % 360;

test("both OKLab conversions give the sRGB primaries their published OKLCH", async () => {
  const { oklch } = await loadColors();
  const checker = (hex) => { const [L, A, B] = oklab(hex); return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) }; };
  for (const [hex, [L, C, h]] of Object.entries(PRIMARIES)) {
    for (const [who, x] of [["colors.js", oklch(hex)], ["check-colors.mjs", checker(hex)]]) {
      assert.ok(Math.abs(x.L - L) < 5e-4 && Math.abs(x.C - C) < 5e-4 && Math.abs(deg(x.h) - h) < 0.05, `${who} ${hex}: ${x.L} ${x.C} ${deg(x.h)}`);
    }
  }
});

test("both OKLab conversions come back to the color they started from", async () => {
  // The forward known answers above never touch the inverse matrices; a round trip does.
  const { oklch, fromOklch } = await loadColors();
  for (const hex of [...Object.keys(PRIMARIES), "#3a7bd5", "#f0c674", "#b4637a", "#2e3440", "#a6e3a1"]) {
    const x = oklch(hex), [L, A, B] = oklab(hex);
    assert.equal(fromOklch(x.L, x.C, x.h), hex, `colors.js ${hex}`);
    assert.equal(fromLch(L, Math.hypot(A, B), Math.atan2(B, A)), hex, `check-colors.mjs ${hex}`);
  }
});

const cli = (...args) => spawnSync(process.execPath, [here("check-colors.mjs"), ...args], { encoding: "utf8" });

test("the script fails when the two color blocks differ", () => {
  const r = cli("--root", here("fixtures/mismatch"), here("fixtures/themes.json"));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /differ/);
});

test("the script passes both fixture files and reports each theme", () => {
  for (const [file, themes] of [[FIXTURES[0], THEMES], [FIXTURES[1], CAPTURES]]) {
    const r = cli(here(file));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const name of Object.keys(themes)) assert.match(r.stdout, new RegExp(`^${name}: pass`, "m"));
  }
});
