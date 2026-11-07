// Pins what the color block returns. fixtures/colors-sha256.json holds the SHA-256 of
// JSON.stringify(colors(t)) for every theme in the three fixture files: themes.json and
// captures.json, and stress.json, made-up themes that make the searches work hardest
// (mid-gray, all-gray, low-variety, translucent hovers, identical candidates, random).
// A change to the block that is meant to change colors records new hashes:
//
//   RECORD=1 node --test tools/colors-output.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { loadColors } from "./check-colors.mjs";

const here = (p) => new URL(p, import.meta.url);
const FILES = ["themes.json", "captures.json", "stress.json"];
const THEMES = Object.fromEntries(FILES.map((f) => [f, JSON.parse(fs.readFileSync(here(`fixtures/${f}`), "utf8"))]));
const HASHES = here("fixtures/colors-sha256.json");
const { colors } = await loadColors();

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

test("colors() returns the recorded output, byte for byte, on every fixture theme", () => {
  const now = Object.fromEntries(FILES.map((f) => [f, Object.fromEntries(Object.entries(THEMES[f]).map(([n, t]) => [n, sha(JSON.stringify(colors(t)))]))]));
  if (process.env.RECORD) fs.writeFileSync(HASHES, JSON.stringify(now, null, 2) + "\n");
  const want = JSON.parse(fs.readFileSync(HASHES, "utf8"));
  assert.deepEqual(Object.keys(want), FILES);
  for (const f of FILES) {
    assert.deepEqual(Object.keys(now[f]), Object.keys(want[f]), `${f}: the recorded themes`);
    for (const n of Object.keys(want[f])) assert.equal(now[f][n], want[f][n], `${f}: ${n}`);
  }
});

// The work colors() does, counted, since QuickJS (Herdr's engine, no JIT) interrupts a
// view whose render runs too long, and timing in a test would be flaky. Each counter is
// a builtin the block calls for one kind of work, totalled over every fixture theme:
// RegExp test, one per hex parsed; Math.cos, one per hue an adjustment tries (and in
// CIEDE2000); Math.round, one per byte made (a lightness try, a blend, a hex written);
// padStart, one per hex byte written; Math.max, one per contrast and per byte. The
// ceilings sit about 10% over the counts when they were set; the block before its
// searches were sped up made 2.4 to 66 times as many calls.
const CEILINGS = { test: 18_000, cos: 58_000, round: 500_000, padStart: 85_000, max: 1_000_000 };
const HOOKS = { test: RegExp.prototype, cos: Math, round: Math, padStart: String.prototype, max: Math };

test("colors() does no more work than its ceilings allow", () => {
  const count = Object.fromEntries(Object.keys(HOOKS).map((k) => [k, 0]));
  const saved = Object.fromEntries(Object.entries(HOOKS).map(([k, o]) => [k, o[k]]));
  for (const [k, o] of Object.entries(HOOKS)) o[k] = function (...a) { count[k]++; return saved[k].apply(this, a); };
  try {
    for (const f of FILES) for (const t of Object.values(THEMES[f])) colors(t);
  } finally {
    for (const [k, o] of Object.entries(HOOKS)) o[k] = saved[k];
  }
  const over = Object.keys(CEILINGS).filter((k) => count[k] > CEILINGS[k]);
  assert.deepEqual(over, [], over.map((k) => `${k}: ${count[k]} calls, ceiling ${CEILINGS[k]}`).join("; "));
});
