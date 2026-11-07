// Derived from Herdr 0.1.13's shipped `spaces` mod (Apache-2.0).
// Changed by John Zetterman, 2026.
//
// Workspace spaces in a pixel look: worktrees under their checkout, grouped under
// a header per machine (this one first), each machine in its own palette. After a
// space's name, the repo its first terminal is in now, only where unusual: branch,
// ahead/behind. Agent state lives in the agents list, not here. Click to switch,
// right-click for its menu, drag to reorder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, agents, panes, run, openOverlay, exec, hc, shared, setShared, watchFolder, window } from "herdr";
import { PX, localLabel, isRail, sidebarWidth, machineList, paletteIndex, machineIcon, dither, pxText, uiText, uiMax, nameFloor, machineHeader, machineName, ruleLine, headInks, spaceRow, sectionHeaders, ADD_W, BOX } from "./look.js";
import { currentColors } from "./colors.js";

// This mod's folder. Herdr's rename on install rewrites this one literal, and every
// reference the mod makes to itself (its reconnect icon) derives from it.
const SELF = "mods/pixelherd-spaces/";

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 22 : 24);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

// A status's color from a role set of colors.js (`r`), as an ink to draw.
export function tone(r, status) {
  return (r[status] ?? r.unknown).ink;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a command there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // No answer (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's. `sp`, `ms`:
  // spaces() and machines(), read once by the caller.
  ordered(sp, ms) {
    const ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, ms]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows under a header per machine, this computer first, even when it is the
  // only one. Headers: this computer, the machine list from Herdr's CLI, the rows'
  // machines and those mid-reconnect. Each draws in its palette from paletteIndex().
  // A header that runs out of room drops its rule line, then shows a state or an
  // error as a "!" with the text as its tooltip; Connect keeps its word until the name
  // would drop below six characters, then becomes an icon (look.js machineHeader()).
  // `width`, `sp` and `ms`: the sidebar's width, spaces() and machines(), read once
  // per render.
  grouped(c, collapsed, width, sp, ms) {
    const rows = this.ordered(sp, ms);
    const list = machineList(ms, sp, agents());
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = ms.find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || sp.some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(24).flex_none().ml(collapsed ? 0 : BOX.row.ml).px(8).text_size(12).text_color(c.roles.dim.ink).child(collapsed ? "…" : "Loading…");
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const p = c.palettes[paletteIndex(m, list, c.palettes.length)];
      const draw = (r) => (collapsed ? this.compact(r, c) : this.row(r, c, p, width, sp));
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = this.folded.has(m);
      const name = (m ?? localLabel).toUpperCase();
      const state = (machine?.state ?? "asleep").replace(/_/g, " ");
      const problem = repair?.error || "rebuilt ·";
      const count = folded ? `${mine.length}►` : String(mine.length);
      // The parts after the name, as widths, at `level` 0 (full), 1 (the state or the
      // problem as a "!") or 2 (Connect as the icon too): any state, or the problem and
      // Connect; the count; the + when connected. An error counts at its six-character
      // floor, since it truncates; "rebuilt ·" at its width.
      const word = repair?.busy ? "Connecting…" : "Connect";
      const T = BOX.head.text, K = BOX.connect;
      const problemFloor = nameFloor(problem, T, uiMax);
      const tail = (level) => [
        ...(!connected && !rebuilt ? [uiText(level ? "!" : state, T)] : []),
        ...(rebuilt ? [(level ? uiText("!", T) : repair?.error ? problemFloor : uiText(problem, T)) + K.gap + (level > 1 ? K.icon : uiText(word, T))] : []),
        pxText(count, BOX.head.count),
        ...(connected ? [ADD_W] : []),
      ];
      const form = machineHeader(width, name, tail(0), ...(rebuilt ? [tail(1), tail(2)] : connected ? [] : [tail(1)]));
      const ink = headInks(c, p, connected);
      // Wide: icon, NAME, a rule line, any state, the count (N► when folded), +.
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().gap(form.gap).items_center().text_size(T).text_color(c.roles.dim.ink)
        .when(collapsed, el => el.justify_center())
        .when(!collapsed, el => el.pl(BOX.head.pl).pr(BOX.head.pr))
        .when(!collapsed && form.compact, el => el.tooltip(rebuilt ? repair?.error || "rebuilt" : state))
        .cursor_pointer().hover(s => s.bg(c.roles.hoverBg.ink))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        // Out of reach, the icon and the line dim with the name.
        .child(machineIcon(ink.top, ink.base))
        .when(!collapsed, el => el
          .child(machineName(name, ink.label, form))
          .when(form.line, el => el.child(ruleLine(ink.line)))
          .when(!connected && !rebuilt, el => el.child(div().flex_none().child(form.compact ? "!" : state)))
          .when(rebuilt, el => el.child(h_flex().gap(K.gap).items_center()
            .child(form.level || !repair?.error ? div().flex_none().child(form.level ? "!" : problem) : div().min_w(problemFloor).max_w(140).truncate().child(problem))
            .child(div().id(`machine-connect-${m}`).text_color((repair?.error ? c.roles.blocked : c.roles.muted).ink)
              .hover(s => s.text_color(c.roles.hoverText.ink))
              .tooltip(repair?.error || `${m} was rebuilt or replaced. Click to forget it and pair again under the same name.`)
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(form.level > 1
                ? svg(`${SELF}reconnect.svg`).size(K.icon).when(Boolean(repair?.busy), el => el.spin(900))
                : word))))
          .child(div().flex_none().font_family(PX).text_size(BOX.head.count).line_height("16px").text_color(p.head.count.ink)
            .child(count))
          // The + hovers inside the hovered header, on the same background: its text lights.
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(BOX.add.px).font_family(PX).text_size(BOX.add.size).line_height("16px")
            .hover(s => s.text_color(c.roles.hoverText.ink))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+"))));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(24).flex_none().ml(collapsed ? 0 : BOX.row.ml).px(8).gap(7).items_center()
        .text_size(12).text_color(c.roles.dim.ink).hover(s => s.bg(c.roles.hoverBg.ink).text_color(c.roles.hoverText.ink))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).when(!collapsed, el => el.child("New space there"));
      if (!collapsed && rebuilt) return [head];
      return [head, ...(folded ? [] : mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  // Only what's unusual, after the name: "herdr · spike ↑2 ↓1". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one. gitWhere() is its text part;
  // gitTail() draws it with the counts, the text at least `whereMin` wide. `r`: the
  // role set for the row's background.
  gitWhere(g, tree, name) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    return [repo, branch].filter(Boolean).join(" · ");
  }

  gitTail(g, where, whereMin, r) {
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(BOX.row.gap)
      .justify_end()
      .items_center()
      .text_size(BOX.row.git)
      .text_color(r.dim.ink)
      .when(Boolean(where), (el) => el.child(div().min_w(whereMin).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(r.ahead.ink).child(`↑${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(r.behind.ink).child(`↓${g.behind}`)));
  }

  // One space: its name in pixel type, tinted with its machine's palette (`p`). The
  // active one sits on the palette's fill behind the highlight bar. At sidebar `width`
  // the name gets the row's real room (look.js spaceRow()). `sp`: spaces() this render.
  row({ w, i, g, tree }, c, p, width, sp) {
    const on = w.active;
    const r = on ? p.roles : c.roles;
    const counts = g ? [g.ahead > 0 && `↑${g.ahead}`, g.behind > 0 && `↓${g.behind}`].filter(Boolean).map((x) => uiText(x, BOX.row.git)) : [];
    const where = g ? this.gitWhere(g, tree, w.name) : "";
    const fit = spaceRow(width, { tree: Boolean(tree), tail: counts, where });
    const fromIndex = this.pressed === null ? -1 : sp.findIndex(s => s.id === this.pressed);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .ml(BOX.row.ml)
      .pl(BOX.row.pl)
      .pr(BOX.row.pr)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .border_l(BOX.row.bar)
      .border_color(on ? p.roles.highlight.ink : c.clear)
      .when(on, (el) => el.bg(p.head.fill.ink))
      .when(!on, (el) => el.hover((s) => s.bg(c.roles.hoverBg.ink)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(r.highlight.ink)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(fit.gap)
          .items_center()
          .when(Boolean(tree), el => el.pl(fit.indent).child(svg("mods/workspace-chrome/branch.svg").size(BOX.row.branch).text_color(r.dim.ink)))
          .child(div().flex_shrink(0).min_w(nameFloor(w.name, BOX.row.name)).max_w(fit.nameMax).truncate().font_family(PX).text_size(BOX.row.name).line_height("16px")
            .text_color(on ? r.text.ink : p.head.spaceName.ink).child(w.name))
          .child(g && fit.tail ? this.gitTail(g, where, fit.whereMin, r) : div().flex_1()),
      );
  }

  // A space in the narrow rail: its number and a status mark. The active one sits on
  // the raised color and hovers with raised's hover.
  compact({ w, i }, c) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) => el.bg(c.roles.raisedBg.ink))
      .hover((s) => s.bg((w.active ? c.raised : c.roles).hoverBg.ink))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? c.raised.text.ink : c.roles.muted.ink).child(String(i + 1)))
      .child(div().text_color(tone(w.active ? c.raised : c.roles, w.status)).child(glyph(w.status)));
  }

  render() {
    const c = currentColors();
    // Host lists, read once: each read copies the whole list into JS.
    const width = sidebarWidth(), collapsed = isRail(width);
    const sp = spaces(), ms = machines();
    // The header's form at this width, the AGENTS header's too, or the rail's.
    const forms = sectionHeaders(width), form = collapsed ? forms.rail : forms.spaces;
    // Herdr's other mods (the picker, its own spaces) color each space by its entry in
    // space.colors and give a new space the least used name the same way, so this
    // writer keeps their avatars stable. This sidebar draws none of these colors.
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = name => Object.values(kept).filter(v => v === name).length;
      kept[p.id] = palette.reduce((best, name) => uses(name) < uses(best) ? name : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    return v_flex().size_full().min_h(0).bg(c.roles.base.ink).text_size(13)
      .child(h_flex().h(31).pl(form.pl).pr(form.pr).items_center().justify_between().text_color(c.roles.dim.ink)
        .when(!collapsed, el => el.child(h_flex().gap(form.gap).items_center().when(form.dither, el => el.child(dither(c.roles.dim.ink)))
          .child(div().font_family(PX).text_size(BOX.section.title).line_height("16px").child("SPACES"))))
        .child(div().id("space-new").size(BOX.section.add).flex_none().flex().items_center().justify_center().hover(s => s.bg(c.roles.hoverBg.ink).text_color(c.roles.hoverText.ink))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(BOX.list.px).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(c, collapsed, width, sp, ms)));
  }
}
