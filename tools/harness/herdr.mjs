// A stand-in for Herdr's "herdr" module: a fixed small world of spaces, agents and
// machines. Tests set `state` (sidebar width, theme, props, pane folders by pane id, and
// optionally what machines(), agents(), terminals() and focused() return) before each
// render.

export const state = { width: 268, theme: {}, props: {}, cwds: {}, machines: null, agents: null, terminals: null, focused: null };

const prog = { key: "claude", name: "Claude Code", icon: null, tint: false, shell: false, agent: true };
const ag = (address, status, space, space_name, tab, extra = {}) => ({ address, pane: "p" + address, space, space_name, tab, tab_index: 1, tab_name: "2", status, app: "claude", program: prog, title: "", seq: 1, pinned: false, focused: false, ...extra });
export const agents = () => state.agents ?? [
  ag("t1", "working", "s1", "a-rather-long-space-name-here", "tab1", { focused: true }),
  ag("t2", "idle", "s2", "~", "tab2"),
  ag("t3", "blocked", "s1", "a-rather-long-space-name-here", "tab3", { pinned: true }),
  ag("laptop/t4", "done", "s3", "side-project", "tab4"),
];
export const terminals = () => state.terminals ?? [...agents().map((a) => ({ address: a.address, state: "live", labels: {} })), { address: "t9", parent: "t2", state: "live", name: "test-child", status: "working" }];
export const panes = () => agents().map((a) => ({ pane: a.pane, terminal: a.address, tab: a.tab, title: "x", cwd: state.cwds[a.pane] ?? "/home/user/Development/foo", program: prog, focused: a.focused }));
export const spaces = () => [
  { id: "s1", name: "a-rather-long-space-name-here", machine: null, active: true, status: "working", folder: "/x", tabs: [{ id: "tab1", name: "1", named: false }, { id: "tab3", name: "build", named: true }] },
  { id: "s2", name: "~", machine: null, active: false, status: "idle", folder: "", tabs: [{ id: "tab2", name: "2", named: false }] },
  { id: "s3", name: "side-project", machine: "laptop", active: false, status: "done", folder: "", tabs: [{ id: "tab4", name: "2", named: false }] },
];
export const machines = () => state.machines ?? [{ name: null, layout: "ready" }, { name: "laptop", layout: "ready" }];
export const focused = () => state.focused ?? { agent: "t9" };
export const layout = () => ({ id: "root", children: [{ id: "sidebar", size: { px: state.width } }] });
export const window = () => ({ active: true, platform: "linux" });
export const theme = () => ({ ...state.theme });
const sh = {};
export const shared = (k) => sh[k];
export const setShared = (k, v) => { sh[k] = v; };
export const orders = [];
export const setAgentOrder = (o) => { orders.push(o); return null; };
export const overlays = [];
export const run = () => {};
export const openOverlay = (o) => { overlays.push(o); return 1; };
export const closeOverlay = () => {};
export const props = () => state.props;
export const exec = async () => ({ code: 1, stdout: "", stderr: "" });
export const hc = async () => ({ code: 0, stdout: '{"machines":[{"name":"laptop","state":"connected"}]}' });
export const watchFolder = () => new Promise(() => {});
