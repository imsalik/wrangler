// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, closeOverlay, openOverlay, props, appHome, exec, home, readTextFile, window, layout, notify } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// personal: the rail goes by the sidebar's width, not the shared flag.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// personal: project agents titled by project, with a branch line under the task. Projects from the projects mod's projects.json, colored as its + menu does.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const expand = (p) => (p === "~" || p?.startsWith("~/") ? home() + p.slice(1) : p);
const inside = (p, root) => !!p && (p === root || p.startsWith(root + "/"));
async function git(cwd, args, on = null) {
  try { const r = await exec("git", args, { cwd, ...(on ? { on } : {}) }); return r.code === 0 ? r.stdout.trim() : null; } catch { return null; }
}
const machineOf = (address) => (address.includes("/") ? address.split("/")[0] : null);
function hue(p, ids) {
  const root = expand(p.folder), ps = panes();
  const place = (s) => { const tabs = new Set(s.tabs.map((t) => t.id)); return ps.find((x) => tabs.has(x.tab) && x.cwd)?.cwd || s.folder; };
  const near = spaces().filter((s) => (s.machine ?? null) === (p.machine ?? null) && inside(place(s), root));
  const s = near.find((x) => place(x) === root) ?? near[0];
  const c = s && shared("space.colors")?.[s.id];
  if (c) return c.startsWith("#") ? c : (MARK[c] ?? theme()[c]);
  const all = Object.values(MARK);
  return all[Math.max(0, ids.indexOf(p.id)) % all.length];
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all = panes()) {
  const mine = all.filter(p => p.tab === tab.id && p.terminal);
  return mine.find(p => p.program?.agent) ?? mine.find(p => p.focused) ?? mine[0];
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return tab.name === prog && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by project", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };
// personal: priority view keeps Working at the bottom, capped until "more"; everything waiting on you stays on top.
const BOTTOM = new Set(["sec-2"]);
const LIMIT = 3;

// personal: Claude's own sub-agents (Agent tool), listed from Claude's session files by subagents.sh.
const LIST_SUBS = () => `${appHome()}/mods/my-agents/subagents.sh`;
// personal: when a Claude session's last real reply came (its transcript's last assistant entry), read from the end.
const LAST_REPLY = `f=$(ls "$2"/projects/*/"$1".jsonl 2>/dev/null | head -n 1); [ -n "$f" ] || exit 0
rev=tac; command -v tac >/dev/null || rev="tail -r"
$rev "$f" | grep '"type":"assistant"' | grep -v -m 1 '"model":"<synthetic>"' | grep -o '"timestamp":"[^"]*"' | tail -n 1`;

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// personal: how long since a waiting agent last changed.
const ago = (ms) => (ms < 60000 ? "just now" : `${duration(ms)} ago`);

// personal: Claude's prompt cache lives this long after its last request; warn this many minutes before.
// Overridden by projects.json settings.cache {ttl, warn} (minutes).
const CACHE = { ttl: 60, warn: 10 };

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// personal: a small icon button for the header.
function headerButton(id, src, tip, t, action) {
  return div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
    .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(action)
    .child(svg(src).size(14));
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    // personal: agents with Claude sub-agents start folded; these were opened.
    this.opened = new Set();
    this.more = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    cx.timer.every(30000, (cx) => cx.notify());
    // personal: project title and branch line. checkouts: cwd → {main, linked} from git; projects reread every 30 s;
    // redrawn when the projects host's cache changes (its branches).
    this.projects = [];
    // personal: kept across reloads, so cards don't show their space until git answers again.
    this.checkouts = new Map(JSON.parse(localStorage.getItem("checkouts") ?? "[]"));
    this.want = new Set();
    this.recheck = new Set(this.checkouts.keys());
    this.cache = CACHE;
    const reread = (cx) => cx.spawn(async (cx) => {
      try {
        const j = JSON.parse((await readTextFile(`${appHome()}/data/projects/projects.json`)) ?? "{}");
        this.projects = (j.projects ?? []).filter((p) => p.id && p.folder);
        this.cache = { ...CACHE, ...j.settings?.cache };
        cx.notify();
      } catch {}
    });
    reread(cx);
    cx.timer.every(30000, reread);
    cx.timer.every(1500, (cx) => {
      const ver = globalThis.__wranglerProjects?.ver;
      if (ver !== this.ver) { this.ver = ver; cx.notify(); }
      this.lookup(cx);
      // personal: Claude sub-agents and sessions, reread while an agent works or a sub-agent is listed, else every 30 s.
      if (!this.reading && (this.subs.size || Date.now() - this.readAt > 30000 || agents().some((a) => a.status === "working"))) this.readSubs(cx);
      this.cacheCheck(cx);
    });
    // personal: terminal → its running Claude sub-agents ({id, type, desc, at}).
    this.subs = new Map();
    // personal: terminal → its Claude session ({status, at: statusUpdatedAt ms, sid}); cache warnings already given.
    this.sessions = new Map();
    this.warned = new Set(JSON.parse(localStorage.getItem("cacheWarned") ?? "[]"));
    // personal: session id → {key: the statusUpdatedAt it was read at, at: its last reply (ms), 0 for none}.
    this.replies = new Map();
    this.readSubs(cx);
  }

  readSubs(cx) {
    this.reading = true;
    const started = this.readAt = Date.now();
    cx.spawn(async (cx) => {
      const r = await exec("sh", [LIST_SUBS(), `${home()}/.claude`]).catch(() => null);
      const out = r?.stdout ?? "";
      if (out === this.subsOut) { this.reading = false; this.readDone = started; return; }
      this.subsOut = out;
      const m = new Map();
      this.sessions = new Map();
      for (const line of out.split("\n")) {
        if (line.startsWith("S\t")) {
          const [, t, status, at, sid] = line.split("\t");
          if (at) this.sessions.set(t, { status, at: Number(at), sid });
          continue;
        }
        const [t, id, at, ...rest] = line.split("\t");
        if (!rest.length) continue;
        try {
          const meta = JSON.parse(rest.join("\t"));
          m.set(t, [...(m.get(t) ?? []), { id, type: meta.agentType, desc: meta.description, at: Number(at) }]);
        } catch {}
      }
      for (const l of m.values()) l.sort((x, y) => x.at - y.at);
      this.subs = m;
      // personal: a session's last reply, reread only when its status changed.
      for (const ss of this.sessions.values()) {
        if (ss.status === "busy" || this.replies.get(ss.sid)?.key === ss.at) continue;
        const q = await exec("sh", ["-c", LAST_REPLY, "sh", ss.sid, `${home()}/.claude`]).catch(() => null);
        const ts = q?.stdout.match(/"timestamp":"([^"]+)"/)?.[1];
        this.replies.set(ss.sid, { key: ss.at, at: ts ? Date.parse(ts) || 0 : 0 });
      }
      this.reading = false;
      this.readDone = started;
      cx.notify();
    });
  }

  isFolded(addr, subs) {
    return this.folded.has(addr) || (!this.opened.has(addr) && subs.some((s) => s.t.claude));
  }

  // Claude's sub-agents under the agent or live terminal running them, shaped like terminals() entries for tree().
  claudeKids(list, terms) {
    return [...this.subs].flatMap(([t, cs]) => {
      const a = list.find((x) => x.address === t) ?? terms.find((x) => x.address === t && x.state === "live");
      return a ? cs.map((c) => ({
        address: `${t}:${c.id}`, parent: t, state: "live", status: "working",
        name: c.desc || c.type || "Sub-agent", program: a.program, pane: a.pane ?? null, claude: true,
      })) : [];
    });
  }

  lookup(cx) {
    if (this.looking || !(this.want.size || this.recheck.size)) return;
    const list = [...new Set([...this.want, ...this.recheck])];
    this.want.clear();
    this.recheck.clear();
    this.looking = true;
    cx.spawn(async (cx) => {
      for (const key of list) {
        const [on, cwd] = JSON.parse(key);
        const common = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
        const top = common && (await git(cwd, ["rev-parse", "--show-toplevel"], on));
        const main = common?.replace(/\/\.git$/, "");
        this.checkouts.set(key, top ? { main, linked: top !== main } : null);
      }
      localStorage.setItem("checkouts", JSON.stringify([...this.checkouts].slice(-200)));
      this.looking = false;
      cx.notify();
    });
  }

  // personal: the agent's project (by its checkout's main repo, on its machine), branch (the projects host's cached checkout,
  // else Herdr's, else the folder name), and whether it's a linked worktree.
  where(a) {
    const pane = panes().find((p) => p.pane === a.pane);
    const cwd = pane?.cwd, on = machineOf(a.address), key = JSON.stringify([on, cwd]);
    if (!cwd) return null;
    if (!this.checkouts.has(key)) { this.want.add(key); return null; }
    const c = this.checkouts.get(key);
    const local = (f) => (on ? f : expand(f));
    const p = this.projects.find((x) => (x.machine ?? null) === on && (c ? local(x.folder) === c.main : inside(cwd, local(x.folder))));
    if (!p) return null;
    if (!c) return { p, branch: null, linked: false };
    const co = globalThis.__wranglerProjects?.memo.get(`co|${on ?? ""}|${cwd}`)?.v;
    return { p, branch: co?.branch || pane.branch || cwd.split("/").pop(), linked: c.linked };
  }

  // personal: an agent on another machine: a server icon, its name on hover.
  remote(t, a, machine) {
    return div().id(`on-${a.address}`).flex_none().text_color(t.dim).tooltip(`On ${machine}`).child(svg("mods/workspace-chrome/server.svg").size(11));
  }

  branchLine(t, w) {
    return h_flex().gap(5).items_center().text_size(11.5).text_color(t.dim)
      .child(svg("mods/workspace-chrome/branch.svg").size(12).flex_none())
      .child(div().flex_1().min_w(0).truncate().child(w.branch));
  }

  // personal: a card's state on its project line: Working 3m, Needs you, Done, draft, or how long it has been idle.
  // personal: its cache cooling (amber, minutes left) or cold (red) when Claude's prompt cache is near or past its end.
  badge(t, st, ms, cache, draft, addr) {
    const label = (color, icon, text) => h_flex().flex_none().gap(4).items_center().text_size(11.5).text_color(color).child(icon).child(text);
    if (st === "working") return label(t.working, svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().spin(900), `Working ${ms == null ? "" : duration(ms)}`.trim());
    const pill = (tone, icon, text, tip) => h_flex().id(`cache-${addr}`).h(17).px(6).gap(4).flex_none().items_center().rounded(9)
      .bg(tone + "22").text_size(11).font_medium().text_color(tone).tooltip(tip)
      .child(svg(`mods/my-agents/${icon}.svg`).size(11).flex_none()).child(text);
    if (draft && st === "idle") return pill(t.muted, "pencil", "draft", "Nothing sent yet");
    const note = cache && cache.left <= this.cache.warn * 60000
      ? cache.left > 0
        ? pill(t.working, "hourglass", `${Math.ceil(cache.left / 60000)}m`, "Prompt cache expires soon: a message now keeps it warm")
        : pill(t.ansi4 ?? t.accent, "snowflake", "cold", "Prompt cache expired: the next message re-sends the whole conversation")
      : null;
    const base = st === "blocked" ? this.status(t, { status: "blocked" })
      : st === "done" ? label(t.done, svg("mods/workspace-chrome/circle-check.svg").size(12).flex_none(), "Done")
      : note && cache.left > 0 ? null
      : div().flex_none().text_size(11.5).text_color(t.dim).child(ms == null ? "idle" : ago(ms));
    if (!note) return base;
    const parts = st === "blocked" || st === "done" ? [base, note] : [note, base];
    return h_flex().flex_none().gap(5).items_center().children(parts.filter(Boolean));
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      const was = this.changed[a.address];
      if (was?.s === s) continue;
      // personal: req, when it last stopped working: its last request, for agents whose transcript isn't here.
      this.changed[a.address] = { s, at: now, req: was?.s === "working" ? now : was?.req };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  setPins(pins) {
    this.pins = pins;
    localStorage.setItem("pins", JSON.stringify(pins));
  }

  // Drops pins of agents that ended. Only for machines the list has heard from:
  // right after a start, or while a machine connects, its agents aren't listed yet.
  prunePins(all) {
    const machine = (addr) => (addr.includes("/") ? addr.split("/")[0] : "");
    const heard = new Set(all.map((k) => machine(k.address)));
    const live = new Set(all.filter((k) => k.state === "live").map((k) => k.address));
    const kept = this.pins.filter((p) => !heard.has(machine(p)) || live.has(p));
    if (kept.length !== this.pins.length) this.setPins(kept);
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // personal: a waiting Claude agent's prompt cache: ms left (negative once cold), from its last reply in the
  // transcript (an agent on another machine: when it last stopped working here). Null when working, not read
  // yet, or nothing was ever sent (a new session, or a resumed one with no message yet keeps the old reply).
  cacheLeft(a, now = Date.now()) {
    if (a.status === "working" || !/claude/i.test(a.app ?? "")) return null;
    const s = this.sessions.get(a.address);
    const r = s && this.replies.get(s.sid);
    const at = s ? (s.status === "busy" || r?.key !== s.at ? null : r.at || null) : machineOf(a.address) ? this.changed[a.address]?.req ?? null : null;
    return at == null ? null : { left: this.cache.ttl * 60000 - (now - at), at, sid: s?.sid ?? null };
  }

  // personal: a Claude session with no reply yet (a new one, nothing sent).
  isDraft(a) {
    const s = a.status !== "working" && this.sessions.get(a.address);
    const r = s && s.status !== "busy" && this.replies.get(s.sid);
    return Boolean(r && r.key === s.at && !r.at);
  }

  // personal: cache warnings given, kept across reloads (newest 200).
  warn(...keys) {
    for (const k of keys) this.warned.add(k);
    this.warned = new Set([...this.warned].slice(-200));
    localStorage.setItem("cacheWarned", JSON.stringify([...this.warned]));
  }

  // personal: a toast when a waiting agent's cache nears its end; a popup when one with a cooling or cold
  // cache is opened, judged by a session read started after opening (within 10 s). Each once per request and phase.
  cacheCheck(cx) {
    const warn = this.cache.warn * 60000;
    const shown = focused()?.agent ?? null;
    const now = Date.now();
    if (shown !== this.lastShown && this.lastShown !== undefined) this.arrived = { address: shown, at: now };
    this.lastShown = shown;
    const arrived = this.arrived?.address === shown && now - this.arrived.at < 10000 ? this.arrived : null;
    if (arrived && !this.reading && !(this.readAt >= arrived.at)) this.readSubs(cx);
    const opened = arrived && this.readDone >= arrived.at ? shown : null;
    for (const a of agents()) {
      const c = this.cacheLeft(a);
      if (!c || c.left > warn) continue;
      const key = `${a.address}|${c.at}`;
      const open = c.left > 0 ? `open|${key}` : `open|${key}|cold`;
      if (a.address === opened && !this.warned.has(open)) {
        this.arrived = null;
        this.warn(open, `open|${key}`, key);
        openOverlay({ mod: "projects-ui", kind: "dialog", width: 420, props: { view: "cache", terminal: a.address, at: c.at, ttl: this.cache.ttl, sid: c.sid } });
        continue;
      }
      // Only as it crosses the line, not for every old agent after a start.
      if (this.warned.has(key) || c.left < warn - 120000 || c.left <= 0 || a.focused) continue;
      this.warn(key);
      notify({ title: `Cache expiring: ${clean(a.title) || a.space_name || a.address}`, body: `${Math.ceil(c.left / 60000)}m left. A message now keeps it warm.`, level: "warning", action: { name: "pane.focus", args: { pane: a.pane } } });
    }
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

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    // personal: our peek (projects.peek), with go to / close keys on its bar.
    run(`projects.peek:${addr}`);
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

  // personal: plain rows under the card's title, indented by depth; Claude's own sub-agents get the bot icon.
  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = k.claude ? svg("mods/my-agents/bot.svg").size(12).flex_none().text_color(t.dim) : icon(k.program, 12, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(33 + 12 * (s.lines.length - 1))
      .pr(10)
      .rounded(6)
      .h(22)
      .flex_none()
      .gap(6)
      .items_center()
      .text_size(12)
      .hover((s) => s.bg(t.hover))
      // personal: a Claude sub-agent has no terminal: its parent shows it.
      .on_click(() => (k.claude && k.pane ? run("pane.focus", { pane: k.pane }) : this.peek(k.claude ? k.parent : k.address)))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const terms = terminals();
    const all = [...terms, ...this.claudeKids(list, terms)];
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    this.prunePins(all);
    const pinned = this.pins.map((p) => list.find((a) => a.address === p)).filter(Boolean);
    const rest = list.filter((a) => !this.pins.includes(a.address));
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const ids = this.projects.map((x) => x.id);
    const dot = (a, w) => {
      if (w) return hue(w.p, ids);
      const c = shared("space.colors")?.[a.space];
      return c ? (c.startsWith("#") ? c : (MARK[c] ?? theme()[c])) : t.dim;
    };
    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.isFolded(a.address, subs)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.isFolded(a.address, subs);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (open) { this.folded.add(a.address); this.opened.delete(a.address); }
          else { this.folded.delete(a.address); this.opened.add(a.address); }
          cx.notify();
        })
        // personal: the bot icon and how many, open or folded.
        .tooltip(open ? "Hide sub-agents" : "Show sub-agents")
        .child(svg("mods/my-agents/bot.svg").size(12).flex_none())
        .child(String(subs.length));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    const tabs = spaces().flatMap(s => s.tabs);
    const label = (a) => {
      const tab = tabs.find(tab => tab.id === a.tab);
      return tab ? title(tab, lead(tab)) : a.title || a.program?.name || "";
    };
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = this.pins.includes(a.address);
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.setPins(isPinned ? this.pins.filter((p) => p !== a.address) : [...this.pins, a.address]);
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // personal: idle agents close from the row: their pane, or their space when it's the only pane there.
      const close = div()
        .id(`close-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.blocked))
        .tooltip("Close agent")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          const all = spaces();
          const n = all.find((x) => x.id === a.space)?.tabs.reduce((k, tb) => k + tb.panes, 0) ?? 2;
          // Closing the last space would quit the app: leave a shell tab there instead.
          if (n <= 1 && all.length <= 1) run("tab.new", { space: a.space });
          if (n <= 1 && all.length > 1) run("space.close", { id: a.space, confirmed: true });
          else run("pane.close", { pane: a.pane });
          this.hovered = null;
          cx.notify();
        })
        .child(svg("mods/workspace-chrome/x.svg").size(13));
      // personal: a card. Top line: the session (Claude's current task, else a named tab), with the hover buttons at its
      // end; then its project (else space), the agent's icon and state; then the branch. Under a project (or space)
      // header, no project line: the agent's icon leads the session and the state ends the branch line (the session
      // line when there's no branch).
      const w = this.where(a);
      const ctx = w?.p.name ?? a.space_name ?? "";
      const st = rankOf(a) === RANK.done && a.status !== "blocked" ? "done" : a.status;
      const sub = /claude/i.test(a.app ?? "") ? clean(a.title) : "";
      const head = (sub && sub !== a.program?.name ? sub : null) ?? more ?? (label(a) || a.program?.name || a.address);
      const hovered = this.hovered === a.address;
      const underHeader = !byPriority && !isPinned;
      const state = () => this.badge(t, st, when ? now - when : null, this.cacheLeft(a, now), this.isDraft(a), a.address);
      const ctxLine = !underHeader && h_flex()
        .h(20)
        .gap(6)
        .items_center()
        .text_size(12)
        .child(h_flex().size(14).flex_none().rounded(4).bg(dot(a, w)).items_center().justify_center().text_size(9).font_bold().text_color("#ffffff").child([...ctx][0]?.toUpperCase() ?? "?"))
        .child(div().flex_shrink(1).min_w(0).truncate().text_color(t.muted).child(ctx))
        .when(Boolean(pic), (el) => el.child(icon(a.program, 13, t.foreground)))
        .when(Boolean(machine), (el) => el.child(this.remote(t, a, machine)))
        .when(isPinned, (el) => el.child(svg("mods/workspace-chrome/pin.svg").size(11).flex_none().text_color(t.dim)))
        .child(div().flex_1())
        .child(state());
      const main = h_flex()
        .h(22)
        .gap(7)
        .items_center()
        .when(underHeader && Boolean(pic), (el) => el.child(pic))
        .child(div().flex_1().min_w(0).truncate().text_size(13.5).when(a.focused, (el) => el.font_medium())
          .text_color(idle ? t.muted : t.foreground).child(head))
        .when(subs.length > 0, (el) => el.child(fold(a, subs)))
        .when(underHeader && Boolean(machine), (el) => el.child(this.remote(t, a, machine)))
        .when(underHeader && !w?.branch, (el) => el.child(state()))
        .when(hovered, (e) => e.child(pin))
        .when(hovered && rankOf(a) === RANK.idle, (e) => e.child(close));
      return v_flex()
        .id(`ag-${a.address}`)
        .px(10)
        .py(5)
        .gap(1)
        .flex_none()
        .rounded(10)
        .when(a.focused, (el) => el.bg(t.selected))
        .when(!a.focused, (el) => el.hover((s) => s.bg(t.hover)))
        .cursor_pointer()
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        // personal: agent menu
        .on_mouse_down("right", (e) => run(`projects.agent-menu:${a.address}@${Math.round(e.position.x)},${Math.round(e.position.y)}`))
        .child(main)
        .when(!underHeader, (el) => el.child(ctxLine))
        // personal: branch line
        .when(Boolean(w?.branch), (el) => el.child(underHeader
          ? h_flex().h(18).gap(6).items_center().child(this.branchLine(t, w).flex_1().min_w(0)).child(state())
          : this.branchLine(t, w)));
    };

    // Groups in list order: priority sections, or (personal) projects, else the agent's space, each where its first agent is.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    const byId = new Map();
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const w = !byPriority && this.where(a);
      const id = byPriority ? `sec-${r}` : w ? `pr-${w.p.id}` : `sp-${a.space}`;
      if (byId.has(id)) { byId.get(id).members.push(a); continue; }
      const g = byPriority
        ? { id, label: SECTION[r], status: SECTION_STATUS[r], members: [a] }
        : { id, label: w ? w.p.name : a.space_name || "", status: null, color: dot(a, w), members: [a] };
      byId.set(id, g);
      groups.push(g);
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(4)
        .h(26)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .when(Boolean(g.color), (el) => el.child(h_flex().size(14).flex_none().rounded(4).bg(g.color).items_center().justify_center()
          .text_size(9).font_bold().text_color("#ffffff").child([...g.label][0]?.toUpperCase() ?? "?")))
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        // personal: the fold chevron shows either way, so sections read as foldable.
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
        .child(div().flex_1())
        .when(!open && !byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)));
    };
    const capped = (g) => byPriority && BOTTOM.has(g.id) && g.members.length > LIMIT;
    const moreRow = (g) => {
      const open = this.more.has(g.id);
      return h_flex()
        .id(`more-${g.id}`)
        .px(8)
        .h(24)
        .flex_none()
        .items_center()
        .text_size(11.5)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.more.delete(g.id) : this.more.add(g.id);
          cx.notify();
        })
        .child(open ? "Show less" : `${g.members.length - LIMIT} more`);
    };
    const body = (g) => {
      if (this.folded.has(g.id)) return [];
      if (!capped(g)) return g.members.flatMap(withKids);
      const some = this.more.has(g.id) ? g.members : g.members.slice(0, LIMIT);
      return [...some.flatMap(withKids), moreRow(g)];
    };
    const section = (gs) => gs.flatMap((g) => [header(g), ...body(g)]);
    const split = byPriority && !collapsed;
    const rows = collapsed ? list.flatMap(withKids) : section(split ? groups.filter((g) => !BOTTOM.has(g.id)) : groups);
    const bottom = split ? section(groups.filter((g) => BOTTOM.has(g.id))) : [];
    this.lookup(cx);
    const spacesHidden = Boolean(find(layout(), "spaces")?.hidden);

    return v_flex()
      .size_full()
      .min_h(0)
      .pb(6)
      .bg(t.chrome)
      .when(!spacesHidden, (el) => el.border_t(1))
      .border_color(t.border)
      .text_size(13)
      // personal: switcher, sort, past conversations and new agent on the header; in the rail, new agent on top.
      .when(!collapsed, (el) => el.child(h_flex().pl(16).pr(12).h(28).pt(6).flex_none().items_center().gap(2)
        .text_size(11.5).font_medium().text_color(t.dim)
        .child(div().flex_1().child("Agents"))
        .child(headerButton("ag-find", "mods/workspace-chrome/search.svg", "Switch agent (⌃⇧A)", t, () => run("projects.switch")))
        .child(headerButton("ag-sort", "mods/my-chrome/filter.svg", "Sort agents", t,
          () => openOverlay({ mod: "my-agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } })))
        .child(headerButton("ag-hist", "mods/workspace-chrome/clock.svg", "Past conversations (prefix r)", t, () => run("projects.history")))
        .child(headerButton("ag-new", "mods/workspace-chrome/square-pen.svg", "New agent", t, () => run("projects.compose")))))
      .when(collapsed, (el) => el.child(h_flex().h(36).flex_none().items_center().justify_center()
        .child(headerButton("ag-new", "mods/workspace-chrome/square-pen.svg", "New agent", t, () => run("projects.compose")))))
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(16).py(6).text_size(12).text_color(t.dim).child("No agents yet. Start one with the pen above.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(rows.length && bottom.length ? 96 : 0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(bottom.length > 0, (el) => el.child(v_flex().id("ag-bottom").flex_shrink_1().min_h(0).px(8).pb(4).overflow_y_scroll().children(bottom)))
      .when(collapsed, (el) => el.child(
        h_flex().h(28).items_center().justify_center().child(
          div().id("collapse").text_size(13).text_color(t.dim).hover((s) => s.text_color(t.foreground)).on_click(toggleSidebar).child("»"))));
  }
}
