// A stand-in for gpui-kit: every element records the builder calls made on it and its
// children, so tests can read back what a mod drew. `hover` styles are recorded on a
// detached element kept in `hovers`.

export const called = new Set();

function el(kind, arg) {
  const node = { kind, arg, calls: [], kids: [], hovers: [] };
  const p = new Proxy(node, {
    get(_target, name) {
      if (name === "__node") return node;
      // Not a promise: without this, returning an element from an async function hangs.
      if (typeof name === "symbol" || name === "then") return undefined;
      return (...args) => {
        called.add(name);
        node.calls.push([name, args]);
        if (name === "when") return args[0] ? (args[1](p) ?? p) : p;
        if (["hover", "active", "focus"].includes(name)) {
          const d = el("detached");
          args[0](d);
          node.hovers.push(d.__node);
          return p;
        }
        if (name === "child") { node.kids.push(args[0]); return p; }
        if (name === "children") { node.kids.push(...args[0]); return p; }
        return p;
      };
    },
  });
  return p;
}

export const div = () => el("div");
export const svg = (path) => el("svg", path);
export const image = (path) => el("image", path);
export class View {}
