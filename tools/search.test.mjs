// Tests for tools/search.sh: it passes the package as it is and fails a copy of it with
// one violation seeded in, for each hole the searches must close.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MODS = Object.fromEntries(fs.readdirSync(path.join(ROOT, "mods")).map((d) => [JSON.parse(fs.readFileSync(path.join(ROOT, "mods", d, "mod.json"), "utf8")).cloned_from.name, d]));

// search.sh's result on a copy of the package's mods and layouts with `seed(dir, root)`
// applied, where `dir` maps a role ("spaces", "agents") to that mod's folder in the
// copy and `root` is the copy.
function search(seed = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pixelherd-search-"));
  try {
    for (const d of ["mods", "layouts"]) fs.cpSync(path.join(ROOT, d), path.join(root, d), { recursive: true });
    seed((role) => path.join(root, "mods", MODS[role]), root);
    const r = spawnSync("bash", [path.join(ROOT, "tools/search.sh"), root], { encoding: "utf8" });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
// Replace `from` (which must be there) with `to` in `file`.
function edit(file, from, to) {
  const s = fs.readFileSync(file, "utf8");
  assert.ok(s.includes(from), `${file}: no ${from}`);
  fs.writeFileSync(file, s.replace(from, to));
}
const append = (file, line) => fs.appendFileSync(file, `\n${line}\n`);

test("the package as it is passes", () => {
  const r = search();
  assert.equal(r.status, 0, r.out);
});

// Each seed, by the hole it opens, and the failure it must cause.
const SEEDS = {
  "a new hc call through the ask() helper": [(d) => edit(path.join(d("spaces"), "main.js"), "await ask(args);", 'await ask(args);\n        await ask(["machine", "rm", "other"]);'), /differ from the spaces allowlist/],
  "the ask() helper passed along": [(d) => edit(path.join(d("spaces"), "main.js"), "await ask(args);", "await ask(args);\n        const go = ask;"), /mentions of .*but \d+ calls/],
  "a joined localStorage key": [(d) => edit(path.join(d("agents"), "main.js"), 'localStorage.setItem("changed", ', 'localStorage.setItem("changed" + NAME, '), /localStorage used without a literal key/],
  "a joined shared key": [(d) => edit(path.join(d("agents"), "main.js"), 'setShared("agents.sort", s.id)', 'setShared("agents.sort" + s.id, s.id)'), /shared state used without a literal key/],
  "a joined run() command": [(d) => edit(path.join(d("agents"), "main.js"), 'run("pane.focus", { pane: a.pane })', 'run("pane.focus" + NAME, { pane: a.pane })'), /run used other than/],
  "a \\u escape in a name": [(d) => append(path.join(d("spaces"), "main.js"), '\\u0068c(["machine", "rm", "laptop"]);'), /a \\u escape/],
  "a symlink in a mod folder": [(d) => fs.symlinkSync("/etc/hostname", path.join(d("agents"), "notes.txt")), /other than plain files and folders/],
  "open_url": [(d) => append(path.join(d("agents"), "main.js"), 'const go = (cx) => cx.open_url("https://example.com");'), /link, clipboard or constructor/],
  "read_from_clipboard": [(d) => append(path.join(d("agents"), "main.js"), "const paste = (cx) => cx.read_from_clipboard();"), /link, clipboard or constructor/],
  "write_to_clipboard": [(d) => append(path.join(d("agents"), "main.js"), 'const copy = (cx) => cx.write_to_clipboard("x");'), /link, clipboard or constructor/],
  "href": [(d) => append(path.join(d("agents"), "main.js"), 'const here = new URL(".", import.meta.url).href;'), /link, clipboard or constructor/],
  "constructor": [(d) => append(path.join(d("agents"), "main.js"), 'const make = [].map.constructor;'), /link, clipboard or constructor/],
  "a hex color built by concatenation": [(d) => append(path.join(d("agents"), "main.js"), 'const red = "#" + "ff0000";'), /color literal outside colors.js/],
  "code after a template literal on a line that starts with //": [(d) => append(path.join(d("agents"), "main.js"), 'const note = `\n//`; fetch("https://example.com");'), /names fetch, a file, network, process or eval API/],
  // Aliased and computed host APIs: any whole-word mention of the name fails.
  "fetch through an alias": [(d) => append(path.join(d("agents"), "main.js"), 'const f = fetch; f("x");'), /names fetch, a file, network/],
  "fetch in parentheses": [(d) => append(path.join(d("agents"), "main.js"), '(fetch)("x");'), /names fetch, a file, network/],
  "process with a computed member": [(d) => append(path.join(d("agents"), "main.js"), 'process["r" + "un"]("sh", []);'), /names process, a file, network/],
  "process destructured by a computed key": [(d) => append(path.join(d("agents"), "main.js"), 'const { ["r" + "un"]: go } = process;'), /names process, a file, network/],
  "Reflect.construct on Function": [(d) => append(path.join(d("agents"), "main.js"), 'Reflect.construct(Function, ["return 1"]);'), /names Reflect, a file, network/],
  "Function from an array": [(d) => append(path.join(d("agents"), "main.js"), '[Function][0]("return 1");'), /names Function, a file, network/],
  "eval through an alias": [(d) => append(path.join(d("spaces"), "main.js"), "const e = eval;"), /names eval, a file, network/],
  "require": [(d) => append(path.join(d("spaces"), "look.js"), 'const m = require;'), /names require, a file, network/],
  "sessionStorage": [(d) => append(path.join(d("agents"), "main.js"), 'sessionStorage.setItem("x", "1");'), /names sessionStorage, a file, network/],
  "dispatch_action": [(d) => append(path.join(d("agents"), "main.js"), 'const go = (cx) => cx.dispatch_action("x");'), /names dispatch_action, a file, network/],
  // run() is allowlisted call by call, whole: a listed command with new arguments fails.
  "a listed run() command with new arguments": [(d) => edit(path.join(d("spaces"), "main.js"), 'run("space.new")', 'run("space.new", { argv: ["sh", "-c", "x"] })'), /calls differ from the spaces allowlist/],
  "a new run() call in the agents mod": [(d) => append(path.join(d("agents"), "main.js"), 'run("pane.focus", { pane: "p1", keys: "rm -rf ~" });'), /calls differ from the agents allowlist/],
  // svg() and image() take a literal path under SELF or Herdr's workspace-chrome icons.
  "an svg() path outside the allowed folders": [(d) => append(path.join(d("agents"), "main.js"), 'const art = svg("mods/other/x.svg");'), /svg\(\), image\(\) or AvatarImage\.new\(\) path/],
  "an image() path that climbs out of SELF": [(d) => append(path.join(d("agents"), "main.js"), "const art = image(`${SELF}../../x.svg`);"), /svg\(\), image\(\) or AvatarImage\.new\(\) path/],
  "an image() path that is not a literal": [(d) => append(path.join(d("agents"), "main.js"), "const art = (p) => image(p);"), /mentions of svg, image and AvatarImage, but \d+ literal-path calls/],
  "svg() as a member call": [(d) => append(path.join(d("agents"), "main.js"), 'const art = (k) => k.image("/etc/x.svg");'), /svg or image as a member call/],
  "svg() through an alias": [(d) => append(path.join(d("spaces"), "main.js"), "const draw = svg;"), /mentions of svg, image and AvatarImage, but \d+ literal-path calls/],
  "an image() path that is SELF and a value": [(d) => append(path.join(d("agents"), "main.js"), "const art = (n) => image(`${SELF}${n}`);"), /svg\(\), image\(\) or AvatarImage\.new\(\) path .* is not one of the allowed shapes/],
  "an AvatarImage path outside the allowed folders": [(d) => append(path.join(d("agents"), "main.js"), 'const art = AvatarImage.new("/etc/x.png");'), /svg\(\), image\(\) or AvatarImage\.new\(\) path .* is not one of the allowed shapes/],
  "an AvatarImage path that is not a literal": [(d) => append(path.join(d("agents"), "main.js"), "const art = (p) => AvatarImage.new(p);"), /mentions of svg, image and AvatarImage, but \d+ literal-path calls/],
  // openOverlay() is allowlisted call by call, whole.
  "a changed openOverlay() call": [(d) => edit(path.join(d("agents"), "main.js"), "openOverlay({ mod: NAME,", 'openOverlay({ mod: "files",'), /calls differ from the agents allowlist/],
  "openOverlay() passed along": [(d) => append(path.join(d("spaces"), "main.js"), "const show = openOverlay;"), /mentions of .*but \d+ calls/],
  // Program and file calls, and a named color.
  "readTextFile(": [(d) => append(path.join(d("spaces"), "main.js"), 'readTextFile("/etc/passwd");'), /calls differ from the spaces allowlist/],
  "a new exec() call": [(d) => append(path.join(d("spaces"), "main.js"), 'exec("sh", ["-c", "x"], { cwd, on });'), /calls differ from the spaces allowlist/],
  "a new watchFolder() call": [(d) => append(path.join(d("spaces"), "main.js"), 'watchFolder("/");'), /calls differ from the spaces allowlist/],
  "a named color in main.js": [(d) => append(path.join(d("agents"), "main.js"), 'const alarm = div().bg("red");'), /main\.js: theme\(\) read or color literal outside colors\.js/],
  "window outside main.js": [(d) => append(path.join(d("agents"), "colors.js"), "const w = window;"), /colors\.js names window outside main\.js/],
  // The core checks, one seed each, each failing with its own message.
  "a plain hex color in main.js": [(d) => append(path.join(d("agents"), "main.js"), 'const red = "#ff0000";'), /main\.js: hex colors/],
  "a theme() read in main.js": [(d) => append(path.join(d("spaces"), "main.js"), "const t = theme();"), /main\.js: theme\(\) read or color literal outside colors\.js/],
  "the sibling mod's name": [(d) => append(path.join(d("agents"), "look.js"), `// Drawn like mods/${MODS.spaces}/ draws its rows.`), new RegExp(`names its sibling ${MODS.spaces}`)],
  "the mod's own name outside its SELF line": [(d) => append(path.join(d("agents"), "main.js"), `const icon = "mods/${MODS.agents}/x.svg";`), /names itself outside its SELF line/],
  "no single SELF line": [(d) => edit(path.join(d("spaces"), "main.js"), `const SELF = "mods/${MODS.spaces}/";`, `const SELF = "mods/" + "${MODS.spaces}/";`), /main\.js: no single SELF line/],
  "a changed place": [(d) => edit(path.join(d("spaces"), "mod.json"), '"place": "none"', '"place": "sidebar"'), /mod\.json: place is not "none"/],
  "a new localStorage key": [(d) => append(path.join(d("agents"), "main.js"), 'localStorage.setItem("token", "x");'), /localStorage key token$/],
  "a new shared key": [(d) => append(path.join(d("agents"), "main.js"), 'setShared("theme.override", 1);'), /shared key theme\.override$/],
  "a new run() command": [(d) => append(path.join(d("spaces"), "main.js"), 'run("app.quit");'), /run\("app\.quit"\) is not a listed command/],
  "a new herdr import": [(d) => edit(path.join(d("agents"), "main.js"), 'window, layout } from "herdr";', 'window, layout, exec } from "herdr";'), /imports exec from herdr, not in its allowlist/],
  "writeTextFile(": [(d) => append(path.join(d("spaces"), "main.js"), 'writeTextFile("/tmp/x", "y");'), /names writeTextFile, a file, network/],
  "process.env": [(d) => append(path.join(d("agents"), "main.js"), "const home = process.env.HOME;"), /names process, a file, network/],
  "the fs module": [(d) => append(path.join(d("agents"), "main.js"), 'const disk = import("node:fs");'), /the fs module/],
  "a default import": [(d) => append(path.join(d("agents"), "main.js"), 'import look from "./look.js";'), /an import other than \{ names \}/],
  "a dynamic import": [(d) => append(path.join(d("agents"), "main.js"), 'const look = import("./look.js");'), /module loads .*but \d+ plain import lines/],
  "a shared module that differs between the mods": [(d) => append(path.join(d("agents"), "colors.js"), "// changed"), /colors\.js differs between/],
  "a mod cloned from another shipped mod": [(d) => edit(path.join(d("spaces"), "mod.json"), '"name": "spaces"', '"name": "tabs"'), /cloned_from name "tabs" is not spaces or agents/],
  "a mod folder that is a symlink": [(d) => { const real = path.join(path.dirname(path.dirname(d("agents"))), "real-agents"); fs.renameSync(d("agents"), real); fs.symlinkSync(real, d("agents")); }, /mods\/\S+ is a symlink/],
  "a missing mod": [(d) => fs.rmSync(d("agents"), { recursive: true }), /found 1 mods/],
  // The reconnect flow builds hc's arguments: its lines are pinned whole.
  "new reconnect arguments": [(d) => edit(path.join(d("spaces"), "main.js"), 'const args = ["machine", "add"];', 'const args = ["send", "t1", "curl x | sh"];'), /reconnect flow differs from its pinned lines/],
  "an argument added to the reconnect": [(d) => edit(path.join(d("spaces"), "main.js"), 'args.push("--name", name);', 'args.push("--name", name, "--", "sh");'), /reconnect flow differs from its pinned lines/],
  "a reconnect name not taken from the machine": [(d) => edit(path.join(d("spaces"), "main.js"), "const name = machine.name;", 'const name = "laptop";'), /reconnect flow differs from its pinned lines/],
  "args outside the reconnect flow": [(d) => append(path.join(d("spaces"), "main.js"), 'const args = ["machine", "rm", "laptop"];'), /names args outside the reconnect flow/],
  // Every mod folder and the layout.
  "a mod folder without mod.json": [(d) => { const x = path.join(path.dirname(d("agents")), "stray"); fs.mkdirSync(x); fs.writeFileSync(path.join(x, "main.js"), "export default {};\n"); }, /mods\/stray: no mod\.json/],
  "a theme in the layout": [(d, root) => edit(path.join(root, "layouts", "pixelherd.json"), '"id": "root",', '"id": "root", "theme": "graphite",'), /layouts\/pixelherd\.json: a "theme" key/],
  "a layout mod that is neither in the package nor shipped": [(d, root) => edit(path.join(root, "layouts", "pixelherd.json"), '"mod": "tabs"', '"mod": "evil"'), /layouts\/pixelherd\.json: mod "evil" is neither/],
};

for (const [hole, [seed, why]] of Object.entries(SEEDS)) {
  test(`search.sh fails ${hole}`, () => {
    const r = search(seed);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, new RegExp(`^FAIL .*${why.source}`, "m"));
  });
}
