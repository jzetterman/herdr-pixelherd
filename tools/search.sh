#!/usr/bin/env bash
# The layout spec's code searches (requirements 1, 2, 3, 7 and 9) over the package's mods
# and layouts:
#
#   bash tools/search.sh [package folder]
#
# It needs bash 4 or newer and GNU grep with -P (stock macOS has neither; install them).
# Each search runs against a literal allowlist below and prints FAIL for anything
# outside it; the script exits non-zero on any failure. It reads no git history, so it
# works on a squashed, shallow or recipe-built copy. It scans every folder under mods/
# (Herdr needs only a main.js, so one without a mod.json fails) and every file in it
# except SVG art and the two editor files `herdr-app check` writes (gpui-kit.d.ts,
# jsconfig.json), which no mod can import, and fails anything in a mod folder that is
# not a plain file or folder (a symlink). It scans whole files, comments included:
# blanking comments could hide code, such as a line after a template literal that
# starts with //. Allowed host calls are matched by their text as written, with any
# space before "(", and every other mention of their names fails; banned names fail
# on any mention. A call's text fixes its literals, not what its variables hold: the
# reconnect flow, where `name` and `args` become hc's arguments, is pinned line by
# line. A \u escape fails anywhere, since it can spell a name in code. Each layout
# file must name no theme and place only this package's mods and the shipped mods the
# recipe lists.
#
# Its limit: this is the author's regression check, not a guard against a hostile
# fork. Code that builds a name at run time (cx["open" + "_url"], a name taken from
# a host list) can beat any pattern scan, and `node --test tools/` runs the mods' code
# in Node with no sandbox. The real guard is Herdr's install step: read every file.

set -uo pipefail
cd "${1:-$(dirname "$0")/..}" || exit 2

fail=0
bad() { echo "FAIL $*"; fail=1; }
# A file's text, all of it: comments are not blanked (see above).
code() { cat "$1"; }
norm() { tr -s '[:space:]' ' ' | sed -E 's/^ //; s/ $//; s/^([[:alnum:]_$]+) \(/\1(/'; }

# ---- Allowlists, by each mod's role (its mod.json cloned_from name), so a renamed
# mod keeps its own.

# What each file may import from "herdr" (a file not listed: nothing).
herdr_names() {
  case "$1/$2" in
    spaces/main.js) echo "agents exec hc machines openOverlay panes run setShared shared spaces watchFolder window" ;;
    agents/main.js) echo "agents closeOverlay focused layout machines openOverlay panes props run setAgentOrder setShared shared spaces terminals window" ;;
    */colors.js) echo "theme" ;;
    */look.js) echo "layout" ;;
  esac
}
# The only import form: named imports, no aliases, on one line, from these sources.
IMPORT='^\s*import\s*\{\s*[\w$]+(\s*,\s*[\w$]+)*\s*,?\s*\}\s*from\s*"(gpui-kit|gpui-base|herdr|\./look\.js|\./colors\.js)"\s*;?\s*$'

# The exact host calls each mod makes, one per line, whitespace-normalized, once for
# each time the code makes it. The program and file calls all come from Herdr's shipped
# spaces mod. Each call is listed as written, so a new or changed literal argument
# fails; what a variable in it holds is not checked here (RECONNECT below pins the
# variables that build hc's arguments).
calls() {
  case "$1" in
    spaces) cat <<'EOF'
exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on })
exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on })
exec("git", ["rev-parse", "--show-toplevel"], { cwd, on })
hc(["machine", "ls", "--json"])
hc([...args, "--json"])
watchFolder(repo)
ask(["machine", "rm", name])
ask(args)
run("space.move", { id: out[i].w.id, index: i + 1 })
run("space.move", { id: from, index: index + 1 })
run("space.new", { machine: m ?? "" })
run("space.new", { machine: m ?? "" })
run("space.new")
run("space.select", { id: w.id })
run("space.select", { id: w.id })
openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } })
EOF
    ;;
    agents) cat <<'EOF'
run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 })
run("terminal.pin", { terminal: address, pinned: true })
run("terminal.pin", { terminal: a.address, pinned: !isPinned })
run("terminal.peek", { terminal: addr })
run("pane.focus", { pane: a.pane })
run("pane.focus", { pane: a.pane })
openOverlay({ mod: NAME, kind: "popup", width: 200, height: 140, props: { sortMenu: true } })
EOF
    ;;
  esac
}
# The reconnect flow, where the spaces mod builds hc's arguments: pinned whole, each
# line trimmed, from reconnect()'s first line to its last ask(). The allowlist above
# fixes the hc() and ask() calls; this fixes what `name` and `args` hold. `args` may
# appear nowhere else in any mod.
RECONNECT=$(cat <<'EOF'
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
EOF
)
reconnect() { sed -n '/^\s*reconnect(machine, cx) {$/,/^\s*await ask(args);$/p' "$1" | sed -E 's/^\s+//; s/\s+$//'; }
# ask() is the spaces mod's one hc helper (the reconnect flow): its calls are listed
# above, and it may be defined only by this line.
CALLED='exec|hc|watchFolder|readTextFile|ask|run|openOverlay'
# Names no mod file may mention at all, comments included.
BANNED='writeTextFile|fetch|process|Function|eval|require|Reflect|globalThis|sessionStorage|dispatch_action'
ASK_DEF='^\s*const ask = async args => \{$'
# The commands run() may run, always as a literal.
COMMANDS="space.select space.new space.move pane.focus terminal.pin terminal.peek layout.resize"
LOCAL_KEYS="machines.folded machines.reconnecting pins changed"
SHARED_KEYS="sidebar.width sidebar.collapsed agents.sort space.colors"
in_list() { [[ " $2 " == *" $1 "* ]]; }

# Every folder under mods/ is a mod to Herdr (it needs only a main.js), so every one is
# scanned, and one without a mod.json fails.
mods=()
for d in mods/*/; do [ -d "$d" ] && mods+=("$(basename "$d")"); done
[ "${#mods[@]}" -ge 2 ] || bad "found ${#mods[@]} mods, expected the two sidebar mods"

# Shared modules: byte-identical in every mod.
for f in colors.js look.js; do
  for m in "${mods[@]:1}"; do
    cmp -s "mods/${mods[0]}/$f" "mods/$m/$f" || bad "$f differs between mods/${mods[0]} and mods/$m"
  done
done

for m in "${mods[@]}"; do
  dir="mods/$m"
  mapfile -t files < <(find "$dir" -type f ! -name '*.svg' ! -path "$dir/gpui-kit.d.ts" ! -path "$dir/jsconfig.json" | sort)

  [ ! -L "mods/$m" ] || bad "mods/$m is a symlink"
  odd=$(find "$dir" ! -type f ! -type d | sed 's/^/  /')
  [ -z "$odd" ] || bad "$dir holds something other than plain files and folders:"$'\n'"$odd"
  # With no mod.json there is no role, so no allowlist: any host call fails.
  role=""
  if [ ! -f "$dir/mod.json" ]; then bad "$dir: no mod.json"
  else
    grep -qP '"place"\s*:\s*"none"' "$dir/mod.json" || bad "$dir/mod.json: place is not \"none\""
    role=$(grep -ozP '"cloned_from"\s*:\s*\{[^}]*?"name"\s*:\s*"\K[^"]+' "$dir/mod.json" | tr -d '\0')
    case "$role" in spaces|agents) ;; *) bad "$dir/mod.json: cloned_from name \"$role\" is not spaces or agents" ;; esac
  fi

  found=()
  for f in "${files[@]}"; do
    rel=${f#"$dir/"}

    # Imports: the one form, from the listed sources; from "herdr" only listed names.
    hits=$(code "$f" | grep -nP '^\s*import\b' | grep -vP "${IMPORT#^}" | sed 's/^/  /')
    [ -z "$hits" ] || bad "$f: an import other than { names } from gpui-kit, gpui-base, herdr, ./look.js or ./colors.js:"$'\n'"$hits"
    total=$(code "$f" | grep -oP '(?<![\w$])(from\s*["'"'"'`]|import\s*["'"'"'`(*])' | wc -l)
    plain=$(code "$f" | grep -cP "$IMPORT")
    [ "$total" = "$plain" ] || bad "$f: $total module loads (from, import(, import \"…\", import *), but $plain plain import lines"
    for name in $(code "$f" | grep -P "$IMPORT" | grep -P '"herdr"' | grep -oP '\{\K[^}]*' | tr ',' ' '); do
      in_list "$name" "$(herdr_names "$role" "$rel")" || bad "$f imports $name from herdr, not in its allowlist"
    done
    body() { code "$f" | grep -vP "$IMPORT"; }

    # Host calls: each is collected whole (nested brackets and strings
    # too); any other mention of the names is an alias or a pass-along, and fails.
    while IFS= read -r -d '' c; do found+=("$(printf '%s' "$c" | norm)"); done < <(body | grep -zoP "(?<![\\w\$])($CALLED)\\s*(\\((?:[^()\"]|\"(?:[^\"\\\\]|\\\\.)*\"|(?2))*\\))")
    words=$(( $(body | grep -oP "(?<![\\w\$])($CALLED)(?![\\w\$])" | wc -l) - $(body | grep -cP "$ASK_DEF") ))
    made=$(body | grep -zoP "(?<![\\w\$])($CALLED)\\s*(\\((?:[^()\"]|\"(?:[^\"\\\\]|\\\\.)*\"|(?2))*\\))" | tr -cd '\0' | wc -c)
    [ "$words" = "$made" ] || bad "$f: $words mentions of ${CALLED//|//}, but $made calls (ask's one definition aside)"
    pinned=0
    if [ "$role/$rel" = spaces/main.js ]; then
      [ "$(reconnect "$f")" = "$RECONNECT" ] || bad "$f: the reconnect flow differs from its pinned lines:"$'\n'"$(diff <(printf '%s\n' "$RECONNECT") <(reconnect "$f") | sed 's/^/  /')"
      pinned=$(printf '%s\n' "$RECONNECT" | grep -oP '(?<![\w$])args(?![\w$])' | wc -l)
    fi
    [ "$(body | grep -oP '(?<![\w$])args(?![\w$])' | wc -l)" = "$pinned" ] || bad "$f names args outside the reconnect flow:"$'\n'"$(body | grep -nP '(?<![\w$])args(?![\w$])' | sed 's/^/  /')"
    # Host APIs no mod may touch: any whole-word mention fails, so an alias, a
    # parenthesized name or a computed member (process["r" + "un"]) fails too.
    for name in $(body | grep -oP "(?<![\\w\$])($BANNED)(?![\\w\$])" | sort -u); do
      bad "$f names $name, a file, network, process or eval API:"$'\n'"$(body | grep -nP "(?<![\\w\$])$name(?![\\w\$])" | sed 's/^/  /')"
    done
    hits=$(body | grep -nP '["'"'"'`](node:)?fs(/promises)?["'"'"'`]' | sed 's/^/  /')
    [ -z "$hits" ] || bad "$f: the fs module:"$'\n'"$hits"
    # window() is a herdr import, and only the main files import it.
    if [ "$rel" != main.js ]; then
      hits=$(body | grep -nP '(?<![\w$])window(?![\w$])' | sed 's/^/  /')
      [ -z "$hits" ] || bad "$f names window outside main.js:"$'\n'"$hits"
    fi
    # Links, the clipboard, and ways to reach a constructor: any mention fails.
    hits=$(body | grep -nP '(?<![\w$])(open_url|read_from_clipboard|write_to_clipboard|href|constructor)(?![\w$])' | sed 's/^/  /')
    [ -z "$hits" ] || bad "$f: link, clipboard or constructor API:"$'\n'"$hits"
    hits=$(grep -nF '\u' "$f" | sed 's/^/  /')
    [ -z "$hits" ] || bad "$f: a \\u escape (write the character itself):"$'\n'"$hits"

    # Commands: run() only with a listed literal name as its whole first argument.
    for k in $(body | grep -oP '(?<![\w$])run\s*\(\s*"\K[^"]+(?="\s*[,)])'); do
      in_list "$k" "$COMMANDS" || bad "$f: run(\"$k\") is not a listed command"
    done
    [ "$(body | grep -oP '(?<![\w$])run(?![\w$])' | wc -l)" = "$(body | grep -oP '(?<![\w$])run\s*\(\s*"[^"]+"\s*[,)]' | wc -l)" ] || bad "$f: run used other than as run(\"<command>\", …)"

    # Art: svg(), image() and AvatarImage.new() take a literal path in one of the shapes
    # the mods use, with no "..": a Herdr workspace-chrome icon ("mods/workspace-chrome/
    # <name>.svg", or one `${…}` inside the name), or a file in this mod's folder
    # (`${SELF}<name>.svg`, or `${SELF}sprites/${…}.svg`). Every other mention fails, so
    # a path can't be passed in; a member call (.svg(, .image() fails too.
    paths=$(body | grep -oP '(?<![\w$.])(svg|image|AvatarImage\s*\.\s*new)\s*\(\s*\K("[^"]*"|`[^`]*`)')
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      printf '%s' "$p" | grep -qP '^("mods/workspace-chrome/[\w-]+\.svg"|`mods/workspace-chrome/[\w-]*(\$\{[^`}]*\}[\w-]*)?\.svg`|`\$\{SELF\}([\w-]+\.svg|sprites/\$\{[^`}]*\}\.svg)`)$' && [[ "$p" != *..* ]] \
        || bad "$f: svg(), image() or AvatarImage.new() path $p is not one of the allowed shapes"
    done <<< "$paths"
    words=$(body | grep -oP '(?<![\w$.])(svg|image|AvatarImage)(?![\w$])' | wc -l)
    made=$(printf '%s' "$paths" | grep -c .)
    [ "$words" = "$made" ] || bad "$f: $words mentions of svg, image and AvatarImage, but $made literal-path calls"
    hits=$(body | grep -nP '\.\s*(svg|image)\s*\(' | sed 's/^/  /')
    [ -z "$hits" ] || bad "$f: svg or image as a member call:"$'\n'"$hits"

    # Stores: only the listed localStorage and shared keys, each a literal that is the
    # whole first argument (so no "key" + more).
    for k in $(body | grep -oP 'localStorage\s*\.\s*(getItem|setItem|removeItem)\s*\(\s*"\K[^"]+(?="\s*[,)])'); do
      in_list "$k" "$LOCAL_KEYS" || bad "$f: localStorage key $k"
    done
    hits=$(body | grep -nP 'localStorage(?!\s*\.\s*(getItem|setItem|removeItem)\s*\(\s*"[^"]+"\s*[,)])' | sed 's/^/  /')
    [ -z "$hits" ] || bad "$f: localStorage used without a literal key:"$'\n'"$hits"
    for k in $(body | grep -oP '(?<![\w$])(shared|setShared)\s*\(\s*"\K[^"]+(?="\s*[,)])'); do
      in_list "$k" "$SHARED_KEYS" || bad "$f: shared key $k"
    done
    [ "$(body | grep -oP '(?<![\w$])(shared|setShared)(?![\w$])' | wc -l)" = "$(body | grep -oP '(?<![\w$])(shared|setShared)\s*\(\s*"[^"]+"\s*[,)]' | wc -l)" ] || bad "$f: shared state used without a literal key"

    # Colors: no hex anywhere but a transparent #00000000; outside colors.js, no
    # theme() read, no other color literal and no hex built from a "#" string.
    hits=$(grep -noP '#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])' "$f" | grep -vP ':#00000000$' | sed 's/^/  /')
    [ -z "$hits" ] || bad "$f: hex colors:"$'\n'"$hits"
    if [ "$rel" != colors.js ]; then
      hits=$(body | grep -nP '(?<![\w$])theme\s*\(|(?<![\w$])(rgba?|hsla?|oklch)\s*\(|\.(bg|text_color|border_color)\s*\(\s*["'"'"'`]|["'"'"'`]#["'"'"'`]|#\$\{' | sed 's/^/  /')
      [ -z "$hits" ] || bad "$f: theme() read or color literal outside colors.js:"$'\n'"$hits"
    fi
  done

  extra=$(comm -3 <(printf '%s\n' "${found[@]}" | grep -v '^$' | sort) <(calls "$role" | sort) | sed 's/^\t/  allowlisted, not found: /; s/^\([^ ]\)/  not allowlisted: \1/')
  [ -z "$extra" ] || bad "$dir: host calls differ from the $role allowlist:"$'\n'"$extra"

  # Names: a mod names itself only in its SELF line, and never names its sibling.
  for o in "${mods[@]}"; do
    hits=$(grep -nP "(?<![\\w-])${o//./\\.}(?![\\w-])" "${files[@]}")
    if [ "$o" = "$m" ]; then
      hits=$(printf '%s\n' "$hits" | grep -vP "^$dir/main\\.js:\\d+:const SELF = \"mods/$m/\";$" | grep -v '^$')
      [ -z "$hits" ] || bad "$dir names itself outside its SELF line: $hits"
      [ "$(grep -cP "^const SELF = \"mods/$m/\";$" "$dir/main.js")" = 1 ] || bad "$dir/main.js: no single SELF line"
    else
      [ -z "$hits" ] || bad "$dir names its sibling $o: $hits"
    fi
  done
done

# ---- The layout: it names no theme (requirement 3), and each mod it places is one of
# this package's or a shipped mod the recipe lists (requirement 9).
SHIPPED="workspace-chrome tabs pane files changes workspace-status menu"
layouts=()
for l in layouts/*.json; do [ -f "$l" ] && layouts+=("$l"); done
[ "${#layouts[@]}" -ge 1 ] || bad "found no layouts/*.json"
for l in "${layouts[@]}"; do
  hits=$(grep -nF '\u' "$l" | sed 's/^/  /')
  [ -z "$hits" ] || bad "$l: a \\u escape (write the character itself):"$'\n'"$hits"
  hits=$(grep -nP '"theme"\s*:' "$l" | sed 's/^/  /')
  [ -z "$hits" ] || bad "$l: a \"theme\" key (the layout names no theme):"$'\n'"$hits"
  [ "$(grep -oP '"mod"\s*:' "$l" | wc -l)" = "$(grep -oP '"mod"\s*:\s*"[^"]*"' "$l" | wc -l)" ] || bad "$l: a \"mod\" that is not a plain string"
  for k in $(grep -oP '"mod"\s*:\s*"\K[^"]*' "$l"); do
    in_list "$k" "${mods[*]} $SHIPPED" || bad "$l: mod \"$k\" is neither a mod in this package nor a shipped mod the recipe lists"
  done
done

if [ "$fail" = 0 ]; then echo "search: pass (${mods[*]}; ${layouts[*]})"; fi
exit "$fail"
