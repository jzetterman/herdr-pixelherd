// Loads a mod in Node from its own folder. The host modules ("herdr", "gpui-kit",
// "gpui-base") resolve to the stubs in this folder; a mod's own relative imports
// ("./look.js") stay in the mod's folder, so no copies are written. Import this file
// before any mod: `await import("./harness/hooks.mjs")`, then import the mod.

import { registerHooks } from "node:module";

const STUBS = { herdr: "herdr.mjs", "gpui-kit": "gpui-kit.mjs", "gpui-base": "gpui-base.mjs" };

registerHooks({
  resolve(specifier, context, next) {
    if (STUBS[specifier]) return { url: new URL(STUBS[specifier], import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    // Mods are ES modules in plain .js files, with no package.json to say so.
    if (url.startsWith("file:") && url.includes("/mods/") && url.endsWith(".js")) {
      return { ...next(url, { ...context, format: "module" }), format: "module" };
    }
    return next(url, context);
  },
});

// Herdr gives each mod copy a localStorage; Node's own needs a flag. A plain map stands in.
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  },
});
