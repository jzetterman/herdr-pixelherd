// A quick look at what both mods draw in the stub world, for debugging by eye:
//   node tools/harness/run.mjs [themes.json [theme name]]
// Prints each mod's text at a wide, a 160 px and a rail width, then the agent order.

import fs from "node:fs";
import { render, texts, withMachines, herdr } from "./render.mjs";

const file = process.argv[2] ?? new URL("../fixtures/themes.json", import.meta.url);
const themes = JSON.parse(fs.readFileSync(file, "utf8"));
const name = process.argv[3] ?? Object.keys(themes)[0];
const theme = themes[name];
for (const width of [268, 160, 44]) {
  for (const role of ["spaces", "agents"]) {
    const tree = await render(role, { width, theme, setup: role === "spaces" ? withMachines() : undefined });
    console.log(`${role} @${width}px:`, JSON.stringify(texts(tree)));
  }
}
console.log("agent order:", JSON.stringify(herdr.orders.at(-1)));
