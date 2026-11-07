// Times the color block's colors(t) under QuickJS, the engine Herdr runs mods in (no
// JIT), and fails any theme slower than LIMIT_MS:
//
//   node tools/bench-qjs.mjs [themes.json ...]
//
// With no files it reads the three fixture files. It needs `qjs` (QuickJS or
// QuickJS-ng) on PATH. Each theme runs RUNS times and its median counts. It also
// checks that QuickJS returns exactly what Node does for every theme. Timings depend
// on the machine: on the author's, Herdr cut off a render at about 49 ms (47 ms passed),
// so the limit is half that; Herdr's own limit is not documented. This is not part of `node --test tools/`, since timing
// varies by machine.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadColors } from "./check-colors.mjs";

const LIMIT_MS = 25, RUNS = 5;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const files = process.argv.length > 2 ? process.argv.slice(2) : ["themes.json", "captures.json", "stress.json"].map((f) => path.join(HERE, "fixtures", f));
const themes = {};
for (const f of files) for (const [name, t] of Object.entries(JSON.parse(fs.readFileSync(f, "utf8")))) themes[`${path.basename(f)}:${name}`] = t;
const block = path.join(HERE, "../mods/pixelherd-spaces/colors.js");

// QuickJS resolves the block's bare `import ... from "herdr"` as a file named herdr in
// its working folder, so the stub goes there.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelherd-bench-"));
let out;
try {
  fs.writeFileSync(path.join(dir, "herdr"), "export const theme = () => globalThis.THEME;\n");
  fs.writeFileSync(path.join(dir, "themes.js"), `export default ${JSON.stringify(themes)};\n`);
  fs.writeFileSync(path.join(dir, "run.js"), `import THEMES from "./themes.js";
import { colors } from ${JSON.stringify(block)};
const result = {};
for (const [name, t] of Object.entries(THEMES)) {
  globalThis.THEME = t;
  const ms = [];
  let c;
  for (let i = 0; i < ${RUNS}; i++) { const a = performance.now(); c = colors(t); ms.push(performance.now() - a); }
  ms.sort((x, y) => x - y);
  result[name] = { ms: ms[${RUNS >> 1}], out: JSON.stringify(c) };
}
print(JSON.stringify(result));
`);
  const r = spawnSync("qjs", ["--module", "run.js"], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.error || r.status !== 0) { console.error(`qjs failed: ${r.error?.message ?? r.stderr}`); process.exit(2); }
  out = JSON.parse(r.stdout);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

const { colors } = await loadColors();
let fail = 0;
for (const [name, t] of Object.entries(themes)) {
  if (out[name].out !== JSON.stringify(colors(t))) { console.log(`FAIL ${name}: QuickJS and Node disagree`); fail = 1; }
}
const rows = Object.entries(out).map(([name, r]) => [r.ms, name]).sort((a, b) => b[0] - a[0]);
for (const [ms, name] of rows) console.log(`${ms.toFixed(1).padStart(6)} ms  ${name}${ms > LIMIT_MS ? "  FAIL over " + LIMIT_MS + " ms" : ""}`);
const slow = rows.filter(([ms]) => ms > LIMIT_MS).length;
console.log(`median ${rows[rows.length >> 1][0].toFixed(1)} ms, worst ${rows[0][0].toFixed(1)} ms; ${slow} of ${rows.length} themes over ${LIMIT_MS} ms; QuickJS matches Node on ${fail ? "not all" : "all " + rows.length} themes`);
process.exitCode = slow || fail ? 1 : 0;
