import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { language, tokens, wrapTokens } from "./highlight.js";
import { spaces, panes, focused, agents, exec, hc, run, readTextFile, watchFolder, nextCommand, theme, settings } from "herdr";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
// personal: Branch scope shows everything since the merge-base with a base branch, committed or not.
const SCOPES = [["work", "Uncommitted"], ["branch", "Branch"]];
const stored = (name, fallback) => { try { return JSON.parse(localStorage.getItem(name) ?? "null") ?? fallback; } catch { return fallback; } };
const store = (name, value) => { try { localStorage.setItem(name, JSON.stringify(value)); } catch {} };
let scope = stored("scope2", "work");
const BASES = ["refs/remotes/origin/main", "refs/remotes/origin/master", "refs/heads/main", "refs/heads/master"];
// personal: a base picked per repo (else the default) and a counter that resets the view when it changes.
let picked = stored("bases", {});
let pickVer = 0;
const key = () => JSON.stringify({ ...location(), scope, pickVer });
const ROW = 22, HEAD = 32, GUTTER = 111, CHAR = 7.6, MAX_ROWS = 30000, MAX_FILE = 3000, MAX_FRESH = 40;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const HINT = "j/k move · J/K extend · c comment · n/p file · a all files · b sidebar · w wrap · tab scope";

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "core.quotePath=false"];
const DIFF = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames"];
function addStats(result, stats) {
  if (result.code !== 0) throw new Error(result.stderr);
  for (const entry of result.stdout.split("\0")) {
    const [a, d, ...parts] = entry.split("\t");
    if (!parts.length) continue;
    const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
    stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
  }
}
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));
const clip = (line) => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line;

// personal: one `git diff` for every file, split per file by its "diff --git a/<p> b/<p>" header.
function splitDiff(stdout, paths) {
  const byHeader = new Map(paths.map((p) => [`diff --git a/${p} b/${p}`, p])), out = new Map();
  let lines = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("diff --git ")) { const p = byHeader.get(line); lines = p === undefined ? null : []; if (lines) out.set(p, lines); }
    else if (lines) lines.push(line);
  }
  return out;
}

// Numbers each diff line once (old and new side), so a frame only draws the rows on screen.
function hunkRows(path, lines) {
  let old = 0, next = 0, started = false;
  const rows = [];
  for (const line of lines) {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; started = true; rows.push({ kind: "@", path, text: line, context: match[3], at: next }); continue; }
    if (!started) continue;
    const kind = line[0], text = clip(untab(line.slice(1))) || " ";
    if (kind === "-") { const o = old++; rows.push({ kind, path, number: o, old: o, text }); }
    else if (kind === "+") { const n = next++; rows.push({ kind, path, number: n, next: n, text }); }
    else if (kind === " ") { const o = old++, n = next++; rows.push({ kind, path, number: n, old: o, next: n, text }); }
  }
  return rows;
}

// personal: lines of a HEAD diff (-U0): added line numbers on the working tree side, and removed texts.
function uncommitted(lines) {
  const added = new Set(), removed = new Set();
  let next = 0;
  for (const line of lines) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
    if (m) next = +m[1];
    else if (line.startsWith("+") && !line.startsWith("+++")) added.add(next++);
    else if (line.startsWith("-") && !line.startsWith("---")) removed.add(untab(line.slice(1)) || " ");
  }
  return { added, removed };
}

// personal: line comments go to the agent in the focused pane, else in the focused tab, else in the space.
function target() {
  const f = focused();
  if (!f) return null;
  const all = agents();
  return all.find((a) => a.pane === f.pane || a.address === f.terminal || a.address === f.agent) ?? all.find((a) => a.tab === f.tab) ?? all.find((a) => a.space === f.space) ?? null;
}

const lineId = (row) => ({ path: row.path, kind: row.kind, number: row.number });
const sameLine = (a, b) => Boolean(a && b) && a.path === b.path && a.kind === b.kind && a.number === b.number;
const span = (a, b) => a === b ? String(a) : `${a}-${b}`;
const base = (path) => path.split("/").pop();

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.rows = []; this.shown = []; this.diffWidth = 0; this.handle = cx.focus_handle();
    this.comments = []; this.sel = null; this.refs = null; this.composing = false; this.tray = false;
    this.side = stored("side", true); this.wrap = stored("wrap", false); this.width = 500; this.sideW = stored("sideWidth", 230); this.only = null;
    this.scroll = VirtualListScrollHandle.new();
    this.input = TextareaState.new({ placeholder: "Leave a comment" });
    this.input.set_auto_grow(2, 8);
    this.input.on("submit", (_e, cx) => this.addComment(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => { for (;;) { if (await nextCommand() === "focus") this.handle.focus(); cx.notify(); } });
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.rows = []; this.picking = false;
      if (!this.composing) this.sel = null;
      this.error = null; this.note = null; this.info = null; this.since = null; this.watched = null; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.rows = []; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const found = scope === "branch" ? await this.branchFiles(git, root) : await this.workFiles(git);
        if (key() !== context) return;
        const rows = await this.diffs(git, root, on, found);
        if (key() !== context) return;
        if (this.commentRoot !== root) { this.comments = []; this.commentRoot = root; }
        this.root = root; this.on = on; this.since = found.since; this.info = found.info; this.base = found.base; this.branch = found.branch;
        this.files = found.files; this.limited = found.entries > 1000; this.error = null;
        this.rows = rows;
        if (this.only && !found.files.some((f) => f.path === this.only)) this.only = null;
        this.diffWidth = Math.max(300, ...rows.map((row) => (row.text?.length ?? 0) * 7.5 + 130));
        this.watch(root, cx);
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async workFiles(git) {
    const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
    if (status.code !== 0) throw new Error(status.stderr);
    const head = await git(["rev-parse", "--verify", "HEAD"]);
    const stats = {};
    const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
    for (const result of results) addStats(result, stats);
    const files = [];
    const entries = status.stdout.split("\0").filter(Boolean);
    for (const entry of entries.slice(0, 1000)) {
      const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
      const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
      const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
      files.push({ path, status: s, fresh: fresh || (head.code !== 0 && s === "A"), ...(stats[path] ?? { add: 0, del: 0 }) });
    }
    return { files, entries: entries.length, since: head.code === 0 ? "HEAD" : null };
  }

  // personal: files changed since the merge-base with the picked base (else origin's default branch, else main/master), plus untracked ones.
  async branchFiles(git, root) {
    const refs = await git(["for-each-ref", "--format=%(refname)%09%(symref)", "refs/remotes/origin/HEAD", ...BASES]);
    const found = new Map(refs.stdout.split("\n").filter(Boolean).map((l) => l.split("\t")));
    const ref = found.get("refs/remotes/origin/HEAD") || BASES.find((r) => found.has(r));
    this.defaultBase = ref ? ref.replace(/^refs\/(remotes|heads)\//, "") : null;
    const base = picked[root] || this.defaultBase;
    if (!base) throw new Error("No main or master branch to compare with");
    const [mb, branch, untracked, dirty] = await Promise.all([git(["merge-base", "HEAD", base]), git(["rev-parse", "--abbrev-ref", "HEAD"]), git(["ls-files", "--others", "--exclude-standard", "-z"]), git(["diff", "HEAD", "--name-only", "-z", "--no-renames"])]);
    if (mb.code !== 0) throw new Error(`No common history with ${base}`);
    const since = mb.stdout.trim(), touched = new Set(dirty.stdout.split("\0").filter(Boolean));
    const [names, numstat, count] = await Promise.all([git(["diff", since, "--name-status", "-z", "--no-renames"]), git(["diff", since, "--numstat", "-z", "--no-renames"]), git(["rev-list", "--count", `${since}..HEAD`])]);
    if (names.code !== 0) throw new Error(names.stderr);
    const stats = {};
    addStats(numstat, stats);
    const parts = names.stdout.split("\0"), list = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const s = parts[i][0];
      list.push({ path: parts[i + 1], status: s === "A" || s === "D" || s === "U" ? s : "M", fresh: false, dirty: touched.has(parts[i + 1]) });
    }
    for (const path of untracked.stdout.split("\0").filter(Boolean)) list.push({ path, status: "A", fresh: true, dirty: true });
    const files = list.slice(0, 1000).map((f) => ({ ...f, ...(stats[f.path] ?? { add: 0, del: 0 }) }));
    return { files, entries: list.length, since, base, branch: branch.stdout.trim(), info: `${branch.stdout.trim()} · ${plural(Number(count.stdout.trim()) || 0, "commit")}` };
  }

  // personal: every file's diff in one list, each under a file header row.
  async diffs(git, root, on, { files, since }) {
    const tracked = files.filter((f) => !f.fresh).map((f) => f.path);
    const [all, head] = await Promise.all([
      tracked.length ? git(["diff", ...(since ? [since] : []), ...DIFF]) : null,
      scope === "branch" && files.some((f) => f.dirty && !f.fresh) ? git(["diff", "HEAD", "-U0", ...DIFF]) : null,
    ]);
    if (all && all.code !== 0) throw new Error(all.stderr);
    const parts = all ? splitDiff(all.stdout, tracked) : new Map(), dirt = head?.code === 0 ? splitDiff(head.stdout, tracked) : new Map();
    const rows = [];
    let fresh = 0;
    for (const file of files) {
      rows.push({ kind: "f", path: file.path, file });
      if (rows.length > MAX_ROWS) { rows.push({ kind: "", path: file.path, text: "Not shown: the diff is too large" }); continue; }
      let body;
      if (file.fresh) {
        if (++fresh > MAX_FRESH) { rows.push({ kind: "", path: file.path, text: "New file · not shown (too many new files)" }); continue; }
        const text = await readTextFile(`${root}/${file.path}`, { on }).catch(() => null);
        if (text === null) { rows.push({ kind: "", path: file.path, text: "Cannot preview this file (binary, too large, or unreadable)" }); continue; }
        if (text.includes("\0")) { rows.push({ kind: "", path: file.path, text: "Binary file · no text diff" }); continue; }
        file.add = countLines(text);
        body = hunkRows(file.path, [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").map((l) => `+${l}`)]);
        if (scope === "branch") for (const row of body) row.dirty = true;
      } else {
        body = hunkRows(file.path, parts.get(file.path) ?? []);
        if (!body.length) { rows.push({ kind: "", path: file.path, text: file.binary ? "Binary file changed" : "No text diff (mode change, or empty)" }); continue; }
        const marks = dirt.has(file.path) ? uncommitted(dirt.get(file.path)) : null;
        if (marks) for (const row of body) row.dirty = row.kind === "+" ? marks.added.has(row.next) : row.kind === "-" && marks.removed.has(row.text);
      }
      if (body.length > MAX_FILE) { body = body.slice(0, MAX_FILE); body.push({ kind: "", path: file.path, text: `… ${plural(MAX_FILE, "line")} shown` }); }
      for (const row of body) rows.push(row);
    }
    return rows;
  }

  setScope(next, cx) {
    if (scope === next) return;
    scope = next; store("scope2", next);
    this.refresh(cx); cx.notify();
  }

  togglePicker(cx) {
    this.picking = !this.picking;
    if (this.picking && this.root) {
      const root = this.root, on = this.on;
      cx.spawn(async (cx) => {
        const r = await exec("git", [...READ, "for-each-ref", "--sort=-committerdate", "--count=80", "--format=%(refname:short)", "refs/remotes", "refs/heads"], { cwd: root, on }).catch(() => null);
        this.refs = (r?.stdout ?? "").split("\n").filter((b) => b && !b.endsWith("/HEAD") && b !== "origin");
        cx.notify();
      });
    }
    cx.notify();
  }

  pickBase(base, cx) {
    if (base) picked[this.root] = base; else delete picked[this.root];
    store("bases", picked);
    this.picking = false; pickVer++;
    this.refresh(cx); cx.notify();
  }

  endDrag(cx) { this.drag = null; store("sideWidth", this.sideW); cx.notify(); }

  toggleWrap(cx) { this.wrap = !this.wrap; store("wrap", this.wrap); cx.notify(); }

  // personal: wrapped rows split their text at a column count from the diff's width, so heights are known up front.
  cols() {
    const w = this.width - 2 - (this.side ? this.sideW : 0) - GUTTER - 14;
    return Math.max(20, Math.floor(w / CHAR));
  }

  // Herdr takes at most 10,000 per-row sizes: longer lists get one uniform height (no wrap, short file headers).
  height(row, cols) {
    if (this.uniform) return ROW;
    if (row.kind === "f") return HEAD;
    if (!this.wrap || row.number === undefined) return ROW;
    return ROW * Math.max(1, Math.ceil(row.text.length / cols));
  }

  toggleSide(cx) { this.side = !this.side; store("side", this.side); cx.notify(); }

  // The rows drawn: every file's, or the one picked in the sidebar, with each comment under the last line it covers.
  shownRows() {
    const rows = this.only ? this.rows.filter((r) => r.path === this.only) : this.rows;
    if (!this.comments.some((c) => c.end)) return rows;
    return rows.flatMap((row) => {
      const notes = row.number === undefined ? [] : this.comments.filter((c) => sameLine(c.end, row));
      return notes.length ? [row, ...notes.map((comment) => ({ kind: "c", path: row.path, comment }))] : [row];
    });
  }

  // The selected range's [first, last] indexes in `shown` (the anchor and head may be in either order).
  range() {
    if (!this.sel) return null;
    const a = this.shown.findIndex((r) => sameLine(r, this.sel.a)), b = this.shown.findIndex((r) => sameLine(r, this.sel.b));
    if (a < 0 || b < 0) return null;
    return [Math.min(a, b), Math.max(a, b)];
  }

  // What a range covers: working tree line numbers, else (only removed lines) the base side's.
  where(first, last) {
    const rows = this.shown.slice(first, last + 1).filter((r) => r.number !== undefined && r.path === this.sel.path);
    const next = rows.filter((r) => r.next !== undefined).map((r) => r.next), old = rows.map((r) => r.old).filter((n) => n !== undefined);
    const end = rows.at(-1);
    return next.length ? { path: this.sel.path, lines: span(Math.min(...next), Math.max(...next)), removed: false, end: end && lineId(end) }
      : { path: this.sel.path, lines: span(Math.min(...old), Math.max(...old)), removed: true, end: end && lineId(end) };
  }

  // Shows one file (null: all of them).
  showFile(path, cx) {
    this.only = path; this.current = path;
    if (this.sel && path && this.sel.path !== path) this.sel = null;
    this.scroll.scroll_to_item(0, "top"); cx.notify();
  }

  jumpFile(path, cx) {
    if (this.only) return this.showFile(path, cx);
    const i = this.shown.findIndex((r) => r.kind === "f" && r.path === path);
    if (i < 0) return;
    this.current = path;
    this.scroll.scroll_to_item(i, "top"); cx.notify();
  }

  // j/k move the cursor (one line selected); J/K stretch the selection within its file; n/p jump files.
  move(step, cx, { file = false, extend = false } = {}) {
    const shown = this.shown, r = this.range();
    let i = r ? (extend ? shown.findIndex((x) => sameLine(x, this.sel.b)) : step > 0 ? r[1] : r[0]) : shown.findIndex((x) => x.kind === "f" && x.path === this.current);
    const dir = Math.sign(step);
    if (file && this.only) {
      const at = this.files.findIndex((f) => f.path === this.only), next = this.files[at + dir];
      if (next) this.showFile(next.path, cx);
      return;
    }
    if (file) {
      do i += dir; while (i >= 0 && i < shown.length && shown[i].kind !== "f");
      if (i >= 0 && i < shown.length) this.jumpFile(shown[i].path, cx);
      return;
    }
    let left = Math.abs(step), moved = false;
    while (left > 0) {
      let j = i + dir;
      while (j >= 0 && j < shown.length && shown[j].number === undefined) j += dir;
      if (j < 0 || j >= shown.length || (extend && shown[j].path !== this.sel.path)) break;
      i = j; left--; moved = true;
    }
    if (!moved && this.sel) return;
    if (i < 0 || shown[i]?.number === undefined) return;
    const id = lineId(shown[i]);
    this.sel = extend && this.sel ? { ...this.sel, b: id } : { path: id.path, a: id, b: id };
    this.current = id.path;
    this.scroll.scroll_to_item(i, "center"); cx.notify();
  }

  compose(cx, text = "", editing = null) {
    this.composing = true; this.editing = editing; this.tray = false;
    this.input.set_value(text); this.input.focus(); cx.notify();
  }

  closeComposer(cx) {
    if (this.editing) this.comments.push(this.editing);
    this.composing = false; this.editing = null; this.input.set_value(""); this.handle.focus(); cx.notify();
  }

  // Click a line to select it and comment; shift-click stretches the selection in that file.
  clickRow(row, cx) {
    if (!row) return;
    if (row.kind === "c") return this.edit(row.comment, cx);
    if (row.kind === "f") { this.current = row.path; cx.notify(); return; }
    if (row.number === undefined) return;
    const id = lineId(row);
    if (this.shift && this.sel && this.sel.path === row.path) this.sel = { ...this.sel, b: id };
    else this.sel = { path: row.path, a: id, b: id };
    this.current = row.path;
    this.compose(cx, this.composing ? this.input.value() : "", this.editing);
  }

  edit(comment, cx) {
    this.comments = this.comments.filter((c) => c !== comment);
    this.sel = comment.a ? { path: comment.path, a: comment.a, b: comment.b } : null;
    if (comment.path) this.jumpFile(comment.path, cx);
    this.compose(cx, comment.text, comment);
  }

  addComment(cx) {
    const text = this.input.value().trim();
    if (!text) return;
    const r = this.range();
    const at = r && this.sel ? { ...this.where(r[0], r[1]), a: this.sel.a, b: this.sel.b } : this.editing?.a ? { ...this.editing } : { path: null };
    this.comments.push({ ...at, text });
    this.editing = null; this.composing = false; this.sel = null; this.note = null; this.sent = null;
    this.input.set_value(""); this.handle.focus(); cx.notify();
  }

  // Only places and words go to the agent, never the code: it can read the files itself.
  prompt() {
    const what = scope === "branch" && this.base ? `on ${this.branch ?? "this branch"} vs ${this.base}` : "(uncommitted)";
    const lines = this.comments.map((c) => {
      const text = c.text.replace(/\n/g, "\n  ");
      if (!c.path) return `- ${text}`;
      return c.removed ? `- ${c.path}, removed lines ${c.lines} (${scope === "branch" ? this.base : "HEAD"} side): ${text}` : `- ${c.path}:${c.lines}: ${text}`;
    });
    return [`Review comments on my changes ${what}. Line numbers are the current files':`, ...lines].join("\n");
  }

  send(cx) {
    const agent = target();
    if (!this.comments.length || !agent || this.sending) return;
    const text = this.prompt(), count = this.comments.length;
    this.sending = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["send", agent.address, text, "--json"]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        this.comments = []; this.sel = null; this.tray = false; this.sent = `Sent ${plural(count, "comment")} to ${agent.title || agent.program.name}`;
        run("agent.focus", { terminal: agent.address });
      } catch (e) { this.note = `Send failed: ${e}`; }
      finally { this.sending = false; cx.notify(); }
    });
    cx.notify();
  }

  keyDown(e, cx) {
    const k = e.keystroke, m = e.modifiers;
    if (this.typing) {
      if (k === "escape") { this.closeComposer(cx); cx.stop_propagation(); }
      else if (k === "ctrl-enter" || k === "cmd-enter") { this.addComment(cx); cx.stop_propagation(); }
      return;
    }
    const act = {
      "j": () => this.move(1, cx), "down": () => this.move(1, cx), "k": () => this.move(-1, cx), "up": () => this.move(-1, cx),
      "shift-j": () => this.move(1, cx, { extend: true }), "shift-down": () => this.move(1, cx, { extend: true }),
      "shift-k": () => this.move(-1, cx, { extend: true }), "shift-up": () => this.move(-1, cx, { extend: true }),
      "ctrl-d": () => this.move(20, cx), "ctrl-u": () => this.move(-20, cx), "pagedown": () => this.move(20, cx), "pageup": () => this.move(-20, cx),
      "n": () => this.move(1, cx, { file: true }), "]": () => this.move(1, cx, { file: true }),
      "p": () => this.move(-1, cx, { file: true }), "[": () => this.move(-1, cx, { file: true }),
      "g": () => { this.scroll.scroll_to_item(0, "top"); cx.notify(); },
      "shift-g": () => { this.scroll.scroll_to_bottom(); cx.notify(); },
      "c": () => this.compose(cx), "enter": () => this.compose(cx),
      "b": () => this.toggleSide(cx), "w": () => this.toggleWrap(cx), "a": () => this.showFile(null, cx),
      "tab": () => this.setScope(scope === "work" ? "branch" : "work", cx),
      "ctrl-enter": () => this.send(cx), "s": () => this.send(cx),
      "escape": () => { if (this.picking) this.picking = false; else if (this.tray) this.tray = false; else if (this.sel) this.sel = null; else return false; cx.notify(); },
    }[k];
    if (!act || m.alt || m.platform) return;
    if (act() !== false) cx.stop_propagation();
  }

  fileName(f, t, size = 13) {
    const parts = f.path.split("/"), name = parts.pop();
    return h_flex().flex_1().min_w(0).text_size(size).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().flex_none().max_w(320).truncate().child(name));
  }

  statusLetter(f, t) {
    return div().w(14).flex_none().text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" || f.status === "U" ? t.ansi1 : t.blocked).child(f.status);
  }

  counts(f, t, counts) {
    return h_flex().flex_none().gap(6).items_center().text_size(11)
      .when(scope === "branch" && Boolean(f.dirty), (e) => e.child(div().w(7).h(7).rounded(4).bg(t.working)))
      .when(Boolean(counts[f.path]), (e) => e.child(div().px(5).rounded(4).text_size(10).bg(t.accent + "26").text_color(t.accent).child(`› ${counts[f.path]}`)))
      .when(f.add > 0, (e) => e.child(div().text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_color(t.ansi1).child(`−${f.del}`)));
  }

  diffRow(row, i, t, counts, range, cols) {
    const { kind, number, text } = row;
    if (kind === "f") return h_flex().w_full().h(this.uniform ? ROW : HEAD).flex_none().gap(8).px(12).items_center().bg(t.raised).border_t(1).border_b(1).border_color(t.border).font_family(settings().ui_font_family ?? "Inter").font_semibold()
      .child(this.statusLetter(row.file, t)).child(this.fileName(row.file, t)).child(this.counts(row.file, t, counts));
    if (kind === "c") return h_flex().w_full().h(ROW).flex_none().gap(8).pl(112).pr(10).bg(t.accent + "26").cursor_pointer().font_family(settings().ui_font_family ?? "Inter")
      .child(div().text_color(t.accent).child("›")).child(div().flex_1().min_w(0).truncate().child(row.comment.text.replace(/\n/g, " ⏎ ")))
      .child(div().px(4).text_size(11).text_color(t.dim).child("edit"));
    if (kind === "@") return h_flex().w_full().h(ROW).flex_none().gap(10).px(12).items_center().text_color(t.dim)
      .child(div().flex_none().text_color(t.accent).child(`⋯ line ${row.at}`)).child(div().flex_1().min_w(0).truncate().child(row.context || ""));
    if (number === undefined) return div().w_full().h(ROW).flex_none().px(12).truncate().text_color(t.dim).child(text);
    const sel = Boolean(range) && i >= range[0] && i <= range[1] && row.path === this.sel.path;
    const tone = kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : null;
    row.toks ??= tokens(text, language(row.path));
    const colors = { keyword: t.ansi5, string: t.ansi2, number: t.ansi3, comment: t.dim, function: t.ansi4, type: t.ansi3, key: t.ansi4 };
    const paint = (toks) => h_flex().overflow_hidden().children(toks.map((tok) => div().flex_none().whitespace_nowrap().when(Boolean(tok.kind), (e) => e.text_color(colors[tok.kind])).when(tok.kind === "comment", (e) => e.italic()).child(tok.text)));
    const chunks = this.wrap && !this.uniform ? wrapTokens(row.toks, cols) : null;
    return h_flex().w_full().h(this.height(row, cols)).flex_none().items_start().cursor_pointer().when(Boolean(tone), (e) => e.bg(tone + "1f")).when(sel, (e) => e.bg(t.accent + "40"))
      .child(div().w(3).self_stretch().flex_none().when(Boolean(row.dirty), (e) => e.bg(t.working)).when(sel, (e) => e.bg(t.accent)))
      .child(div().w(40).h(ROW).flex().items_center().justify_end().flex_none().pr(6).text_color(sel ? t.accent : t.dim).child(row.old === undefined ? "" : String(row.old)))
      .child(div().w(40).h(ROW).flex().items_center().justify_end().flex_none().pr(6).text_color(sel ? t.accent : t.dim).child(row.next === undefined ? "" : String(row.next)))
      .child(div().w(18).h(ROW).flex().items_center().justify_center().flex_none().text_color(tone ?? t.dim).child(kind === " " ? "" : kind === "-" ? "−" : "+"))
      .child(chunks ? v_flex().flex_1().min_w(0).pr(10).children(chunks.map((c) => paint(c).h(ROW).items_center()))
        : paint(row.toks).flex_1().min_w(0).h(ROW).items_center().pr(10));
  }

  // personal: the file sidebar: "All files", then one row per file showing just that file; its right edge drags its width.
  sidebar(t, counts) {
    return div().w(this.sideW).flex_none().h_full().relative().border_r(1).border_color(t.border)
      .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(4)
        .when(this.files.length > 0, (e) => e.child(h_flex().id("change-all").h(30).flex_none().px(6).gap(6).items_center().rounded(6).cursor_pointer().when(!this.only, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.showFile(null, cx))
          .child(div().w(14).flex_none().text_color(t.dim).child("≡")).child(div().flex_1().text_size(12.5).child("All files")).child(div().text_size(11).text_color(t.dim).child(String(this.files.length)))))
        .children(this.files.map((f) => {
        const parts = f.path.split("/"), name = parts.pop();
        return h_flex().id(`change-${f.path}`).h(38).flex_none().px(6).gap(6).items_center().rounded(6).cursor_pointer().when(this.only === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.showFile(f.path, cx))
          .child(this.statusLetter(f, t))
          .child(v_flex().flex_1().min_w(0).child(div().truncate().text_size(12.5).child(name)).child(div().truncate().text_size(10.5).text_color(t.dim).child(parts.join("/") || " ")))
          .child(this.counts(f, t, counts));
      })).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || (this.loading ? "Loading…" : this.root ? "Nothing changed" : "No folder")))))
      .child(Scrollbar.vertical("changes-list").absolute().inset_0())
      .child(div().id("side-resize").absolute().top(0).bottom(0).right(-3).w(6).cursor_col_resize().hover((s) => s.bg(t.accent + "60")).when(Boolean(this.drag), (e) => e.bg(t.accent + "60"))
        .on_mouse_down("left", (e, cx) => { this.drag = { x: e.position.x, w: this.sideW }; cx.stop_propagation(); cx.notify(); }));
  }

  // The comment popup over the diff's bottom edge.
  composer(t) {
    const r = this.range(), at = r ? this.where(r[0], r[1]) : this.editing?.path ? this.editing : null;
    const title = at ? `${base(at.path)}:${at.lines}${at.removed ? " (removed)" : ""}` : "General comment";
    const can = Boolean(this.input.value().trim());
    return v_flex().id("composer").absolute().left(10).right(10).bottom(10).p(10).gap(8).rounded(10).bg(t.background).border_1().border_color(t.accent).shadow_lg().font_family(settings().ui_font_family ?? "Inter").text_size(12)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(h_flex().gap(8).items_center()
        .child(div().font_semibold().text_color(t.accent).truncate().child(title))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(at ? "shift-click or J/K to stretch" : "")))
      .child(div().id("comment-box").px(8).py(6).rounded(7).border_1().border_color(t.border).cursor_text().child(Textarea.new(this.input).w_full().text_size(12.5).text_color(t.foreground)))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child("Ctrl+Enter adds · Esc cancels"))
        .child(div().id("composer-cancel").px(10).h(26).flex().items_center().rounded(7).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.closeComposer(cx)).child("Cancel"))
        .child(div().id("composer-add").px(12).h(26).flex().items_center().rounded(7).bg(t.solid).text_color(t.solid_foreground).cursor_pointer().on_click((_e, cx) => this.addComment(cx)).child(this.editing ? "Save" : "Add comment")));
  }

  // Pending comments, listed above the footer.
  trayList(t) {
    return v_flex().id("tray").flex_none().max_h(220).overflow_y_scroll().px(6).py(4).border_t(1).border_color(t.border).children(this.comments.map((c, i) =>
      h_flex().id(`pending-${i}`).h(30).flex_none().gap(8).px(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.edit(c, cx))
        .child(div().flex_none().max_w(200).truncate().text_size(11).text_color(t.accent).child(c.path ? `${base(c.path)}:${c.lines}` : "General"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(c.text.replace(/\n/g, " ⏎ ")))
        .child(div().id(`pending-x-${i}`).px(6).text_color(t.dim).hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.comments = this.comments.filter((x) => x !== c); if (!this.comments.length) this.tray = false; cx.stop_propagation(); cx.notify(); }).child("×"))));
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const shown = this.shown = this.shownRows(), range = this.range(), cols = this.cols();
    this.uniform = shown.length > 10000;
    const agent = target(), n = this.comments.length, canSend = Boolean(n && agent && !this.sending);
    const counts = {};
    for (const c of this.comments) if (c.path) counts[c.path] = (counts[c.path] ?? 0) + 1;
    const nfiles = Object.keys(counts).length;
    const empty = this.error || (this.loading && !this.files.length ? "Loading changes…" : !this.root ? "No folder" : !this.files.length ? (scope === "branch" ? "No changes on this branch" : "No uncommitted changes") : null);
    return v_flex().id("changes").relative().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_mouse_down("left", (e, cx) => { this.shift = Boolean(e.modifiers?.shift); if (this.drag) this.endDrag(cx); if (!this.typing) this.handle.focus(); })
      .on_mouse_move((e, cx) => { if (!this.drag) return; this.sideW = Math.round(Math.min(560, Math.max(140, this.drag.w + e.position.x - this.drag.x))); cx.notify(); })
      .on_mouse_up("left", (_e, cx) => { if (this.drag) this.endDrag(cx); })
      .on_key_down((e, cx) => this.keyDown(e, cx))
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) >= 1) { this.width = size.width; cx.notify(); } })
      .child(h_flex().h(42).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().id("side-toggle").p(4).rounded(5).cursor_pointer().text_color(this.side ? t.foreground : t.dim).hover((s) => s.bg(t.hover)).tooltip(this.side ? "Hide files (b)" : "Show files (b)").on_click((_e, cx) => this.toggleSide(cx)).child(svg("mods/workspace-chrome/panel-left.svg").size(15)))
        .child(h_flex().p(2).gap(2).rounded(7).bg(t.raised).children(SCOPES.map(([id, label]) =>
          div().id(`scope-${id}`).px(8).py(2).rounded(5).text_size(12).cursor_pointer().when(scope === id, (e) => e.bg(t.background).font_semibold()).when(scope !== id, (e) => e.text_color(t.muted).hover((s) => s.text_color(t.foreground))).on_click((_e, cx) => this.setScope(id, cx)).child(label))))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(plural(this.files.length, "file")))
        .child(div().flex_1())
        .child(div().id("wrap-toggle").px(6).py(1).rounded(4).text_size(11).cursor_pointer().when(this.wrap, (e) => e.bg(t.selected).text_color(t.foreground)).when(!this.wrap, (e) => e.text_color(t.dim)).hover((s) => s.bg(t.hover)).tooltip("Wrap long lines (w)").on_click((_e, cx) => this.toggleWrap(cx)).child("wrap"))
        .child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
      .when(scope === "branch" && Boolean(this.base), (e) => e.child(h_flex().h(26).flex_none().px(14).gap(6).items_center().text_size(11).text_color(t.dim).border_b(1).border_color(t.border)
        .child(div().flex_none().child("vs"))
        .child(div().id("base-pick").flex_none().px(5).rounded(4).text_color(t.foreground).bg(this.picking ? t.selected : t.raised).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.togglePicker(cx)).child(`${this.base} ▾`))
        .child(div().flex_1().min_w(0).truncate().child(this.info ?? ""))
        .when(this.files.some((f) => f.dirty), (e) => e.child(h_flex().flex_none().gap(5).items_center().child(div().w(7).h(7).rounded(4).bg(t.working)).child("uncommitted")))))
      .when(this.picking, (e) => e.child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("base-list").absolute().inset_0().overflow_y_scroll().p(6).text_size(12)
          .child(div().px(8).pb(4).text_size(11).text_color(t.dim).child("Compare this branch with"))
          .child(this.baseRow("default", `Default${this.defaultBase ? ` (${this.defaultBase})` : ""}`, !picked[this.root], () => null, t))
          .children((this.refs ?? []).map((b) => this.baseRow(b, b, picked[this.root] === b, () => b, t)))
          .when(!this.refs, (e) => e.child(div().p(8).text_color(t.dim).child("Loading branches…"))))
        .child(Scrollbar.vertical("base-list").absolute().inset_0())))
      .when(!this.picking, (e) => e.child(h_flex().flex_1().min_h(0).items_stretch()
        .when(this.side, (e) => e.child(this.sidebar(t, counts)))
        .child(div().flex_1().min_w(0).h_full().relative()
          .child(div().size_full().relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(12.5)
            .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
              .child(div().w_full().min_w(this.wrap && !this.uniform ? 0 : this.diffWidth).h_full().child(v_virtual_list("changes-diff", shown.length, this.uniform ? ROW : shown.map((r) => this.height(r, cols)), (i) => String(i),
                (range2) => shown.slice(range2.start, range2.end).map((row, k) => this.diffRow(row, range2.start + k, t, counts, range, cols))).size_full().track_scroll(this.scroll).on_item_click((key, cx) => this.clickRow(shown[+key], cx)))))
            .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
            .when(Boolean(empty), (e) => e.child(div().absolute().top(8).px(12).text_color(t.dim).child(empty))))
          .when(this.composing, (e) => e.child(this.composer(t))))))
      .when(this.uniform && this.wrap, (el) => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Large diff: wrap is off in All files. Pick a file to wrap it.")))
      .when(this.limited, (el) => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pt(6).text_size(11).text_color(t.ansi1).child(this.note)))
      .when(this.tray && n > 0, (e) => e.child(this.trayList(t)))
      .child(h_flex().flex_none().h(48).px(10).gap(8).items_center().border_t(1).border_color(t.border)
        .when(n > 0, (e) => e.child(div().id("tray-toggle").flex_none().px(8).h(28).flex().items_center().gap(6).rounded(7).bg(t.accent + "26").text_color(t.accent).text_size(12).cursor_pointer().hover((s) => s.bg(t.accent + "40")).on_click((_e, cx) => { this.tray = !this.tray; cx.notify(); })
          .child(`${plural(n, "comment")}${nfiles > 1 ? ` · ${nfiles} files` : ""} ${this.tray ? "▾" : "▴"}`)))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(n ? "" : this.sent ?? HINT))
        .when(n > 0, (e) => e.child(div().id("comments-clear").px(8).h(28).flex().items_center().rounded(7).text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.comments = []; this.tray = false; cx.notify(); }).child("Clear")))
        .child(div().id("comments-send").h(28).px(12).max_w(240).flex().items_center().rounded(7).bg(canSend ? t.solid : t.raised).text_color(canSend ? t.solid_foreground : t.dim).text_size(12).when(canSend, (e) => e.cursor_pointer()).tooltip(agent ? `To ${agent.title || agent.program.name} (s)` : "No agent in this space").on_click((_e, cx) => this.send(cx))
          .child(div().truncate().child(this.sending ? "Sending…" : n ? `Send ${n} to agent` : "Send to agent"))));
  }

  baseRow(id, label, on, value, t) {
    return div().id(`base-${id}`).h(26).flex_none().px(8).flex().items_center().rounded(6).cursor_pointer().when(on, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pickBase(value(), cx)).child(div().truncate().child(label));
  }
}
