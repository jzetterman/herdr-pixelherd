// Derived from Herdr 0.1.13's shipped `agents` mod (Apache-2.0).
// Changed by John Zetterman, 2026.
//
// Agents as pixel-art cards, grouped by machine (this one first), each machine in its
// own palette. Inside a machine: pinned first, then priority or agents() order.
// Parents take their most urgent sub-agent's place; sub-agents show inside the card.
// A viewed done agent keeps its Done rank until left.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, machines, terminals, panes, focused, spaces, run, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout } from "herdr";
import { PX, localLabel, isRail, find, sidebarWidth, machineOf, machineList, paletteIndex, machineIcon, dither, pxText, uiText, uiMax, nameFloor, machineHeader, machineName, ruleLine, headInks, card, PIN_ROOM, sectionHeaders, BOX } from "./look.js";
import { currentColors } from "./colors.js";

// This mod's folder. Herdr's rename on install rewrites this one literal, and every
// reference the mod makes to itself (sprite paths, its own overlay) derives from it.
const SELF = "mods/pixelherd-agents/";
const NAME = SELF.split("/")[1];

const narrow = () => isRail(sidebarWidth());

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// Animal sprites in SELF's sprites/ folder, written by tools/build-sprites.py.
const ANIMALS = ["duck", "frog", "cat", "penguin"];
// Spots for the scene's star pixels: the sky's corners, clear of the animal and the "z".
const STARS = [[4, 5], [24, 3], [40, 4], [9, 17], [3, 30], [6, 42], [64, 24], [67, 38]];
const WORD = { idle: "IDLE", working: "WORKING", blocked: "NEEDS YOU", done: "DONE" };
// A path's last folder, split at either slash (a Windows machine's panes use backslashes).
const base = (path) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop();

// A stable number from a string (FNV-1a): an agent keeps its animal and its stars.
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// The 76 x 76 picture on an agent's card: sky, two or three stars, a dock and the
// agent's animal on it, in palette `p`. Idle adds a boxed "z"; working bobs the animal
// (native loop).
function scene(a, p) {
  const r = p.roles;
  const h = hash(a.address);
  const first = h % STARS.length;
  const picks = [first, (first + 3) % STARS.length, (first + 6) % STARS.length].slice(0, 2 + ((h >> 8) & 1));
  const plank = (top) => div().absolute().left(0).right(0).top(top).h(3).bg(r.dock.ink);
  const post = (left, top, height) => div().absolute().left(left).top(top).w(3).h(height).bg(r.dock.ink);
  const ink = r.sub.ink;
  return div().relative().w(BOX.card.scene).h(BOX.card.scene).flex_none().bg(r.base.ink).border(1).border_color(r.line.ink)
    .children(picks.map((i) => div().absolute().left(STARS[i][0]).top(STARS[i][1]).size(2).bg(r.star.ink)))
    .child(plank(51)).child(plank(58)).child(plank(67))
    .child(post(6, 54, 4)).child(post(62, 54, 4)).child(post(18, 61, 6)).child(post(50, 61, 6))
    .child(post(9, 70, 4)).child(post(58, 70, 4))
    .child(div().absolute().left(13).top(6).size(48)
      .child(div().relative().size(48)
        .when(a.status === "working", (el) => el.loop("top", { from: 0, to: -3, period: 700 }))
        .child(image(`${SELF}sprites/${ANIMALS[h % ANIMALS.length]}.svg`).w(48).h(48))))
    .when(a.status === "idle", (el) => el.child(div().absolute().top(3).right(3).w(15).h(14).border(1).border_color(ink)
      .flex().items_center().justify_center().font_family(PX).text_size(11).line_height("12px").text_color(ink).child("z")));
}

// A card's status word in a 1 px box, on palette `p`. Idle takes the palette's own
// color; working and blocked pulse (native loop) down to the block's pulseLow.
function badge(a, p, c) {
  const r = p.roles;
  const color = ({ idle: r.badgeIdle, working: r.badgeWorking, blocked: r.badgeBlocked, done: r.badgeDone }[a.status] ?? r.badgeUnknown).ink;
  return div().self_start().flex_none().h(18).px(BOX.badge.px).flex().items_center().border(BOX.badge.border).border_color(color)
    .whitespace_nowrap().font_family(PX).text_size(BOX.badge.size).line_height("14px").text_color(color)
    .when(a.status === "working" || a.status === "blocked", (el) => el.loop("opacity", { from: c.pulseLow, to: 1, period: 1100 }))
    .child(WORD[a.status] ?? String(a.status ?? "").toUpperCase());
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
// The sort menu's two choices, with the shipped ids and labels (agents.sort is Herdr's
// own key too). Cards are grouped by machine either way. Priority sorts each machine's cards by
// urgency; "Grouped by space" keeps agents() order (space, tab, pane), so a space's
// agents sit together, with no space headers.
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  // The sort menu, drawn in its own overlay on the popover color (`m`: menu roles).
  sortMenu(m) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(m.base.ink)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(m.dim.ink).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .items_center()
        .text_color(m.text.ink)
        .hover((el) => el.bg(m.hoverBg.ink))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(m.muted.ink))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(m.text.ink)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  // A sub-agent inside its parent's card (palette `p`), 18 px: tree lines, its name,
  // its status mark. The one shown sits on the raised color, and hovers with raised's
  // hover. A click peeks at it without also focusing the parent's pane.
  subRow(c, s, shown, p) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const on = k.address === shown;
    const r = on ? c.raised : p.roles;
    const ink = on ? r.dim.ink : r.sub.ink;
    const stroke = (el) => el.absolute().bg(ink);
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(10)
      .pr(8)
      .h(18)
      .flex_none()
      .items_center()
      .text_size(12)
      .when(on, (el) => el.bg(p.roles.raisedBg.ink))
      .hover((s) => s.bg(r.hoverBg.ink))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.peek(k.address);
      })
      .children(s.lines.map((l) => div().relative().w(8).h(18).mr(3).flex_none()
        .when(l === "│" || l === "├", (el) => el.child(stroke(div()).left(0).top(0).w(1).h(18)))
        .when(l === "└", (el) => el.child(stroke(div()).left(0).top(0).w(1).h(9)))
        .when(l === "└" || l === "├", (el) => el.child(stroke(div()).left(0).top(9).w(7).h(1)))))
      .child(div().flex_1().min_w(0).truncate().text_color(on ? r.text.ink : ink).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(r, { status: st }));
  }

  // A small square status mark, at most BOX.mark.w wide, in role set `r` (the
  // background it sits on), for tight rows (sub-agents, the rail, a folded header):
  // working spins, blocked is a "!" on a tint.
  status(r, a) {
    const M = BOX.mark, side = (size) => (M.w - size) >> 1;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(M.spinner).mx(side(M.spinner)).flex_none().text_color(r.working.ink).spin(900);
    if (a.status === "blocked") return div().size(M.w).flex_none().bg(r.blockedTint.ink).text_size(10.5).font_bold().text_color(r.blockedMark.ink).flex().items_center().justify_center().child("!");
    // Idle: a square ring; done: a square dot; anything else: an empty square.
    if (a.status === "idle") return div().size(M.dot).mx(side(M.dot)).flex_none().border(1).border_color(r.idle.ink);
    return div().size(M.dot).mx(side(M.dot)).flex_none().when(a.status === "done", (el) => el.bg(r.done.ink));
  }

  render(cx) {
    const c = currentColors();
    if (props()?.sortMenu) return this.sortMenu(c.menu);
    // Host lists, read once: each read copies the whole list into JS.
    const width = sidebarWidth(), collapsed = isRail(width);
    const sp = spaces();
    // Whether cards keep their scenes at this width (look.js card()).
    const fit = card(width);
    const sort = sortOf();
    const listedAgents = agents();
    let list = listedAgents;
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];

    // One group per machine in palette order, members in list order (pinned first).
    // Cards and agent.next / agent.prev follow this flattened order.
    const ms = machines();
    const mlist = machineList(ms, sp, listedAgents);
    const groups = [];
    for (const m of mlist) {
      const members = list.filter((a) => machineOf(a) === m);
      // `off`: machines() can't reach its layout (offline, or it needs a login).
      const off = m !== null && ms.find((k) => k.name === m)?.layout === "unavailable";
      if (members.length) groups.push({ id: `m:${m ?? ""}`, label: m ?? localLabel, off, p: c.palettes[paletteIndex(m, mlist, c.palettes.length)], members });
    }
    const flat = groups.flatMap((g) => g.members);
    setAgentOrder(flat.map((a) => a.address));

    // The fold chevron on a card (role set `r`); folded, the count too, colored by the
    // most urgent one.
    const fold = (a, subs, r) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(BOX.fold.px)
        .gap(BOX.fold.gap)
        .flex()
        .flex_none()
        .items_center()
        .text_size(BOX.fold.size)
        .text_color((open ? r.dim : r[top] ?? r.dim).ink)
        .cursor_pointer()
        .hover((s) => s.bg(r.hoverBg.ink).text_color(r.hoverText.ink))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(BOX.fold.chevron).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    const ps = panes();
    const leads = leadPanes(ps);
    const cwdOf = new Map(ps.map((p) => [p.pane, p.cwd]));
    const tabLabels = new Map(sp.flatMap(s => s.tabs).map(tab => [tab.id, title(tab, leads.get(tab.id))]));
    const label = (a) => tabLabels.get(a.tab) ?? (a.title || a.program?.name || "");
    // A card's title: its space, or the pane's folder when the space is just "~".
    const cardTitle = (a) => (a.space_name === "~" ? base(cwdOf.get(a.pane) ?? "") || "~" : a.space_name || label(a));
    // Below it, the tab: a bare tab number reads "tab N".
    const subtitle = (a) => (/^\d+$/.test(label(a)) ? `tab ${label(a)}` : label(a));

    // The narrow rail's row: number and status mark.
    const railRow = (a, i) => h_flex()
      .id(`ag-${a.address}`)
      .h(26)
      .px(8)
      .flex_none()
      .items_center()
      .gap(4)
      .hover((s) => s.bg(c.roles.hoverBg.ink))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(c.roles.muted.ink).child(String(i + 1)))
      .child(h_flex().w(BOX.mark.w).flex_none().items_center().justify_center().child(this.status(c.roles, a)));

    // One agent's card in palette `p`: scene, badge, title, tab, and its open
    // sub-agents below a divider. Too narrow for its scene (look.js card()), it drops
    // the scene and the text takes the card. Click focuses its pane; the pin shows on
    // hover and while pinned, in room the badge row keeps free.
    const agentCard = (a, p) => {
      const r = p.roles;
      const subs = this.tree(all, a.address);
      const open = !this.folded.has(a.address);
      const isPinned = a.pinned;
      const name = cardTitle(a), tab = subtitle(a);
      const text = v_flex().flex_1().min_w(0)
        .when(fit.scene, (el) => el.h(BOX.card.scene).pt(1).pb(3).justify_between())
        .when(!fit.scene, (el) => el.gap(4))
        .child(h_flex().pr(PIN_ROOM).child(badge(a, p, c)))
        .child(div().min_w(nameFloor(name, BOX.card.title)).truncate().font_family(PX).text_size(BOX.card.title).line_height("20px").text_color(r.text.ink).child(name))
        .child(h_flex().h(18).gap(BOX.sub.gap).items_center()
          .child(div().flex_1().min_w(nameFloor(tab, BOX.sub.size, uiMax)).truncate().text_size(BOX.sub.size).text_color(r.sub.ink).child(tab))
          .when(subs.length > 0, (el) => el.child(fold(a, subs, r))));
      const pin = div()
        .id(`pin-${a.address}`)
        .absolute()
        .top(4)
        .right(4)
        .p(BOX.pin.p)
        .text_color(r.dim.ink)
        .cursor_pointer()
        .hover((s) => s.bg(r.hoverBg.ink).text_color(r.hoverText.ink))
        .tooltip(isPinned ? "Unpin" : "Pin to the top of its machine")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        // At rest a pinned card shows the pin; hovered, the button is Unpin.
        .child(svg(`mods/workspace-chrome/${isPinned && this.hovered === a.address ? "pin-off" : "pin"}.svg`).size(BOX.pin.icon));
      return v_flex()
        .id(`ag-${a.address}`)
        .relative()
        .ml(BOX.card.ml)
        .mr(BOX.card.mr)
        .mb(8)
        .flex_none()
        .border(BOX.card.border)
        .border_color(a.focused ? r.highlight.ink : r.line.ink)
        .bg(p.head.fill.ink)
        .cursor_pointer()
        .when(!a.focused, (el) => el.hover((s) => s.border_color(r.lineHover.ink)))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .child(h_flex().p(BOX.card.p).gap(BOX.card.gap).when(fit.scene, (el) => el.child(scene(a, p))).child(text))
        .when(subs.length > 0 && open, (el) => el
          .child(div().h(1).flex_none().bg(r.line.ink))
          .child(v_flex().py(2).children(subs.map((s) => this.subRow(c, s, shown, p)))))
        .when(isPinned || this.hovered === a.address, (el) => el.child(pin));
    };

    // A machine's header: icon, NAME, rule line, "working/total". It folds the group;
    // folded, it says so and shows the most urgent state. A machine out of reach dims
    // its icon, name and line and says "unavailable", as the spaces header shows its
    // state. Short of room it drops the line, then the state shrinks to "!" (the
    // text as its tooltip), then the gaps narrow (look.js machineHeader()).
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      const busy = g.members.filter((a) => a.status === "working").length;
      const name = g.label.toUpperCase();
      const mark = !open && top && top !== "idle";
      const count = `${busy}/${g.members.length}${open ? "" : "►"}`;
      const state = "unavailable";
      const tail = (compact) => [...(g.off ? [uiText(compact ? "!" : state, BOX.head.text)] : []), ...(mark ? [BOX.mark.w] : []), pxText(count, BOX.head.busy)];
      const form = machineHeader(width, name, tail(false), g.off ? tail(true) : undefined);
      const ink = headInks(c, g.p, !g.off);
      return h_flex()
        .id(g.id)
        .mt(4)
        .mb(8)
        .h(28)
        .pl(BOX.head.pl)
        .pr(BOX.head.pr)
        .flex_none()
        .gap(form.gap)
        .items_center()
        .cursor_pointer()
        .when(g.off && form.compact, (el) => el.tooltip(state))
        .hover((s) => s.bg(c.roles.hoverBg.ink))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        // Out of reach, the icon and the line dim with the name.
        .child(machineIcon(ink.top, ink.base))
        .child(machineName(name, ink.label, form))
        .when(form.line, (el) => el.child(ruleLine(ink.line)))
        .when(g.off, (el) => el.child(div().flex_none().text_size(BOX.head.text).text_color(c.roles.dim.ink).child(form.compact ? "!" : state)))
        .when(mark, (el) => el.child(this.status(c.roles, { status: top })))
        .child(div().flex_none().font_family(PX).text_size(BOX.head.busy).line_height("16px").text_color(g.p.head.count.ink).child(count));
    };
    const rows = collapsed
      ? flat.map(railRow)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.map((a) => agentCard(a, g.p)))]);
    const busy = list.filter((a) => a.status === "working").length;
    // The header's form at this width, the SPACES header's too.
    const head = sectionHeaders(width).agents;

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(c.roles.base.ink)
      .border_t(1)
      .border_color(c.roles.divider.ink)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .pl(head.pl)
            .pr(head.pr)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .gap(head.gap)
            .items_center()
            .when(head.dither, (el) => el.child(dither(c.roles.dim.ink)))
            .child(div().flex_1().font_family(PX).text_size(BOX.section.title).line_height("16px").text_color(c.roles.dim.ink).child("AGENTS"))
            .child(div().font_family(PX).text_size(BOX.section.title).line_height("16px").text_color((busy ? c.roles.working : c.roles.dim).ink).child(`${busy} BUSY`))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(c.roles.dim.ink)
                .hover((s) => s.text_color(c.roles.hoverText.ink))
                .on_click(() => openOverlay({ mod: NAME, kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(BOX.section.sort)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(c.roles.dim.ink).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : BOX.list.px).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(c.roles.dim.ink)
                .hover((s) => s.text_color(c.roles.hoverText.ink))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
