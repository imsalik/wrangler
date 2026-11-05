// Past Claude conversations (projects.history): newest first, read by the projects mod's history.sh from Claude's
// own transcripts through its cache. Type to search (fuzzy: every word, ranked), ↑↓ or ctrl-j/k move, ↵ resumes,
// ⌃↵ searches your messages instead of titles, tab / ⇧tab cycle the project chips (all, this project, recent picks),
// @ or "more" lists every project to pick from (type to filter), esc clears, then closes.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, exec, focused, home, panes, spaces } from "herdr";
import { ICON, badge, closeSelf, expand, hints, projects, reveal, sendJson, tilde, windowed } from "./ui.js";

const ROW = 48, MAX = 9, PAGE = 30, LIMIT = 300, CHIPS = 4, PROW = 36, PMAX = 12;
const inside = (p, root) => !!p && (p === root || p.startsWith(root + "/"));
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const titleOf = (h) => clean(h.customTitle || h.aiTitle || h.lastPrompt) || h.cwd?.split("/").pop() || h.id;
const wtRoot = (p) => expand(p.worktreeRoot || "~/.herdr/worktrees").replace(/\/+$/, "");

function age(s) {
  const m = Math.floor((Date.now() - s * 1000) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

export const views = {
  history: {
    close: closeSelf,

    start() {
      this.filter = this.p.q ?? "";
      this.messages = !!this.p.messages;
      this.list = { off: 0 };
      this.rows = [];
      this.want = PAGE;
      this.sel = 0;
      try { this.scope = localStorage.getItem("history.scope") ?? "all"; } catch { this.scope = "all"; }
      try { this.recent = JSON.parse(localStorage.getItem("history.recent") ?? "[]"); } catch { this.recent = []; }
      const cwd = focused()?.cwd;
      this.here = cwd ? this.projectOf(cwd)?.id ?? null : null;
      this.picking = false;
      this.pick = { filter: "", sel: 0, list: { off: 0 } };
      if (this.filter.startsWith("@")) { this.openPick(); this.pick.filter = this.filter.slice(1); this.filter = ""; }
      this.read();
      // Searches once typing pauses; one read at a time, the latest filter winning.
      this.tick = () => {
        if (this.filter !== this.ran && Date.now() - (this.typed ?? 0) > 150) this.read();
        if (!this.dirty) return false;
        this.dirty = false;
        return true;
      };
    },

    projs() {
      return projects().filter((p) => !p.machine);
    },

    // Its project: the deepest one whose folder holds it, else a worktree folder (<root>/<repo>/…) by the repo's folder name.
    projectOf(cwd) {
      const ps = this.projs(), repo = /\/worktrees\/([^/]+)\//.exec(`${cwd}/`)?.[1];
      const holds = ps.filter((p) => inside(cwd, expand(p.folder))).sort((a, b) => expand(b.folder).length - expand(a.folder).length);
      return holds[0] ?? (repo ? ps.find((p) => expand(p.folder).split("/").pop() === repo) : null) ?? null;
    },

    read() {
      if (this.busy) return;
      this.busy = true;
      this.ran = this.filter;
      const dirs = (p) => [expand(p.folder), `${wtRoot(p)}/${expand(p.folder).split("/").pop()}`];
      const p = this.projs().find((x) => x.id === this.scope);
      const folders = p ? dirs(p) : this.scope === "other" ? ["-v", ...this.projs().flatMap(dirs)] : [];
      const want = this.want, q = this.filter.trim();
      exec("sh", [`${appHome()}/mods/projects/history.sh`, `${home()}/.claude`, `${appHome()}/data/projects/history.tsv`,
        String(want), "0", q, this.messages && q ? "1" : "0", ...folders])
        .then((r) => {
          const rows = [];
          let more = false;
          for (const l of r.stdout.split("\n")) {
            if (l.startsWith("next ")) more = true;
            else if (l) try { rows.push(JSON.parse(l)); } catch {}
          }
          if (this.ran !== this.filter) return;
          this.rows = rows;
          this.more = more && want < LIMIT;
          this.sel = Math.min(this.sel, Math.max(0, rows.length - 1));
        })
        .catch(() => {})
        .finally(() => { this.busy = false; this.loaded = true; this.dirty = true; });
    },

    setFilter(f) {
      this.filter = f;
      this.typed = Date.now();
      this.want = PAGE;
      this.sel = 0;
      this.list.off = 0;
    },

    setScope(id) {
      this.scope = id;
      this.picking = false;
      if (id !== "all") this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, 8);
      try { localStorage.setItem("history.scope", id); localStorage.setItem("history.recent", JSON.stringify(this.recent)); } catch {}
      this.want = PAGE;
      this.sel = 0;
      this.list.off = 0;
      this.ran = null;
    },

    resume(h) {
      if (!h) return;
      this.close();
      const p = h.cwd ? this.projectOf(h.cwd) : null;
      sendJson("resume", { id: h.id, cwd: h.cwd, title: titleOf(h), ...(p ? { home: p.folder } : {}) });
    },

    row(t, h, i, on, sp, ps) {
      const p = this.projectOf(h.cwd ?? ""), name = p?.name ?? h.cwd?.split("/").pop() ?? "";
      const tile = p ? badge(p, sp, ps) : h_flex().size(18).flex_none().rounded(5).bg(t.dim + "66").items_center().justify_center()
        .text_size(10.5).font_bold().text_color("#ffffff").child([...name][0]?.toUpperCase() ?? "?");
      const away = h.cwd && p && h.cwd !== expand(p.folder) ? tilde(h.cwd) : !p ? tilde(h.cwd ?? "") : "";
      return h_flex().id(`hi-${h.id}`).h(ROW).px(10).gap(10).items_center().rounded(8).cursor_pointer()
        .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
        .on_click(() => this.resume(h))
        .child(tile.when(!!h.gone, (el) => el.opacity(0.45)))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(13.5).text_color(h.gone ? t.dim : t.foreground).child(titleOf(h)))
            .child(div().flex_none().text_size(11.5).text_color(t.dim).child(age(h.at))))
          .child(h_flex().gap(10).items_center().text_size(11.5).text_color(t.dim)
            .child(div().flex_none().max_w(160).truncate().text_color(t.muted).child(name))
            .when(!!h.gitBranch, (el) => el.child(h_flex().flex_shrink(1).max_w(220).min_w(0).gap(4).items_center()
              .child(svg(ICON("branch")).size(12).flex_none())
              .child(div().min_w(0).truncate().child(h.gitBranch))))
            .when(!!away, (el) => el.child(div().flex_1().min_w(0).truncate().child(away)))
            .when(!!h.gone, (el) => el.child(div().flex_none().text_color(t.dim).child(p ? `worktree gone · opens in ${p.name}` : "folder gone · opens in ~")))));
    },

    // The chip row's projects: this one, then recent picks; the picked one always among them.
    chipIds() {
      const ok = new Set(this.projs().map((p) => p.id)), out = [];
      for (const id of [this.here, ...this.recent]) if (id && ok.has(id) && !out.includes(id)) out.push(id);
      const ids = out.slice(0, CHIPS);
      return ok.has(this.scope) && !ids.includes(this.scope) ? [this.scope, ...ids.slice(0, CHIPS - 1)] : ids;
    },

    chip(t, id, p, label, on, action) {
      return h_flex().id(`hs-${id}`).h(24).px(8).gap(6).flex_none().max_w(150).items_center().rounded(6).cursor_pointer().text_size(12)
        .when(on, (el) => el.bg(t.selected).text_color(t.foreground))
        .when(!on, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => { action(); cx.notify(); })
        .when(!!p, (el) => el.child(badge(p, spaces(), panes()).size(14).rounded(4).text_size(9)))
        .child(div().min_w(0).truncate().child(label))
        .when(id === this.here, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child("here")));
    },

    // Every project to pick from, filtered by name or folder (words in order, like the switcher).
    pickRows() {
      const f = this.pick.filter.trim().toLowerCase();
      const fits = (hay) => f.split(/\s+/).filter(Boolean).every((w) => { let i = 0; for (const c of hay) if (c === w[i]) i++; return i >= w.length; });
      return [{ id: "all", p: null, name: "All projects" }, { id: "other", p: null, name: "Other (no project)" }, ...this.projs().map((p) => ({ id: p.id, p, name: p.name }))]
        .filter((r) => !f || fits(`${r.name} ${r.p ? tilde(expand(r.p.folder)) : ""}`.toLowerCase()));
    },

    pickRow(t, r, on) {
      return h_flex().id(`hp-${r.id}`).h(PROW).px(10).gap(10).items_center().rounded(8).cursor_pointer()
        .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.setScope(r.id); cx.notify(); })
        .child(r.p ? badge(r.p, spaces(), panes()) : h_flex().size(18).flex_none().items_center().justify_center().child(svg(ICON("layers")).size(14).text_color(t.dim)))
        .child(div().flex_shrink(0).max_w(220).truncate().text_color(t.foreground).child(r.name))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(r.p ? tilde(expand(r.p.folder)) : ""))
        .when(r.id === this.here, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("here")))
        .when(r.id === (this.projs().some((x) => x.id === this.scope) || this.scope === "other" ? this.scope : "all"), (el) => el.child(svg(ICON("check")).size(14).flex_none().text_color(t.foreground)));
    },

    draw(t) {
      if (this.picking) return this.drawPick(t);
      const rows = this.rows, n = rows.length, sp = spaces(), ps = panes(), q = this.filter.trim();
      const at = Math.min(this.sel, Math.max(0, n - 1));
      if (this.more && !this.busy && this.list.off + MAX >= n - 2) { this.want += PAGE; this.read(); }
      const ids = this.chipIds(), byId = new Map(this.projs().map((p) => [p.id, p]));
      const cur = byId.has(this.scope) || this.scope === "other" ? this.scope : "all";
      const cycle = ["all", "other", ...ids];
      const rest = this.projs().length - ids.length;
      return this.frame(t, (e, cx) => {
        const m = e.modifiers ?? {}, k = e.key;
        const move = (d) => { if (n) { this.sel = (at + d + n) % n; reveal(this.list, this.sel, MAX); } };
        if (k === "escape" && this.filter) this.setFilter("");
        else if (k === "escape") return this.close();
        else if (k === "enter" && m.control) { this.messages = !this.messages; this.ran = null; }
        else if (k === "enter") return this.resume(rows[at]);
        else if (k === "tab") { const i = cycle.indexOf(cur); this.setScope(cycle[(i + (m.shift ? -1 : 1) + cycle.length) % cycle.length]); }
        else if (e.key_char === "@" && !this.filter) this.openPick();
        else if (k === "down" || (m.control && (k === "j" || k === "n"))) move(1);
        else if (k === "up" || (m.control && (k === "k" || k === "p"))) move(-1);
        else if (m.control && k === "u") this.setFilter("");
        else if (k === "backspace") this.setFilter(m.control || m.alt ? this.filter.replace(/\S*\s*$/, "") : this.filter.slice(0, -1));
        else if (m.control && k === "w") this.setFilter(this.filter.replace(/\S*\s*$/, ""));
        else if (e.key_char && !m.control && !m.alt && !m.platform) this.setFilter(this.filter + e.key_char);
        else return;
        cx.stop_propagation();
        cx.notify();
      }, this.filter, "Search past conversations…",
      [div().id("h-scope").flex_none().px(7).h(20).flex().items_center().rounded(5).cursor_pointer().text_size(11.5)
        .bg(this.messages ? t.accent + "33" : t.raised).text_color(this.messages ? t.foreground : t.dim)
        .tooltip("⌃↵: titles or your messages")
        .on_click((_e, cx) => { this.messages = !this.messages; this.ran = null; cx.notify(); })
        .child(this.messages ? "In messages" : "Titles"),
      div().flex_none().w(44).text_right().text_size(11.5).text_color(t.dim).child(this.busy && !n ? "…" : `${n}${this.more ? "+" : ""}`)])
        .child(h_flex().flex_none().px(12).py(7).gap(4).overflow_hidden().border_b(1).border_color(t.border)
          .child(this.chip(t, "all", null, "All", cur === "all", () => this.setScope("all")))
          .child(this.chip(t, "other", null, "Other", cur === "other", () => this.setScope("other")).tooltip("Not in any project"))
          .children(ids.map((id) => this.chip(t, id, byId.get(id), byId.get(id).name, cur === id, () => this.setScope(id))))
          .when(rest > 0, (el) => el.child(this.chip(t, "more", null, `${rest} more`, false, () => this.openPick())
            .child(svg(ICON("chevron-down")).size(11).flex_none()).tooltip("Every project (@)"))))
        .child(v_flex().flex_1().min_h(0).p(6)
          .when(!!n, (el) => el.child(windowed(t, "hi-list", this.list, n, MAX, ROW, (i) => this.row(t, rows[i], i, i === at, sp, ps))))
          .when(!n, (el) => el.child(div().px(10).py(8).text_color(t.dim)
            .child(!this.loaded ? "Reading…" : q ? (this.messages ? "No message matches." : "No matches. ⌃↵ searches your messages.") : "No past conversations."))))
        .child(h_flex().flex_none().px(16).py(9).border_t(1).border_color(t.border)
          .child(hints(t, [["↵", "resume"], ["⌃↵", this.messages ? "titles" : "in messages"], ["tab", "project"], ["@", "all projects"], ["esc", "close"]])));
    },

    openPick() {
      this.picking = true;
      this.pick = { filter: "", sel: 0, list: { off: 0 } };
    },

    // The project picker in place of the rows: type to filter, ↑↓, ↵ picks, esc goes back.
    drawPick(t) {
      const rows = this.pickRows(), n = rows.length, pk = this.pick;
      const at = Math.min(pk.sel, Math.max(0, n - 1));
      return this.frame(t, (e, cx) => {
        const m = e.modifiers ?? {}, k = e.key;
        const move = (d) => { if (n) { pk.sel = (at + d + n) % n; reveal(pk.list, pk.sel, PMAX); } };
        if (k === "escape" && pk.filter) { pk.filter = ""; pk.sel = 0; }
        else if (k === "escape") this.picking = false;
        else if (k === "enter" || k === "tab") { if (rows[at]) this.setScope(rows[at].id); }
        else if (k === "down" || (m.control && (k === "j" || k === "n"))) move(1);
        else if (k === "up" || (m.control && (k === "k" || k === "p"))) move(-1);
        else if (k === "backspace") { pk.filter = pk.filter.slice(0, -1); pk.sel = 0; }
        else if (e.key_char && !m.control && !m.alt && !m.platform) { pk.filter += e.key_char; pk.sel = 0; pk.list.off = 0; }
        else return;
        cx.stop_propagation();
        cx.notify();
      }, pk.filter, "Pick a project…", [div().flex_none().text_size(11.5).text_color(t.dim).child(`${n}`)])
        .child(v_flex().flex_1().min_h(0).p(6)
          .when(!!n, (el) => el.child(windowed(t, "hp-list", pk.list, n, PMAX, PROW, (i) => this.pickRow(t, rows[i], i === at))))
          .when(!n, (el) => el.child(div().px(10).py(8).text_color(t.dim).child("No project matches."))))
        .child(h_flex().flex_none().px(16).py(9).border_t(1).border_color(t.border)
          .child(hints(t, [["↵", "pick"], ["esc", "back"]])));
    },

    // The popup, its keys and its search line (text with a caret, else the placeholder, then the extras on the right).
    frame(t, keys, text, placeholder, extras) {
      return v_flex().id("history").track_focus(this.handle).size_full().bg(t.popover).text_size(13)
        .on_key_down(keys)
        .child(h_flex().h(46).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
          .child(svg(ICON("search")).size(16).flex_none().text_color(t.dim))
          .child(h_flex().flex_1().min_w(0).items_center().text_size(14)
            .when(!!text, (el) => el.child(div().truncate().text_color(t.foreground).child(text)))
            .child(div().w(1).h(16).flex_none().bg(t.accent))
            .when(!text, (el) => el.child(div().pl(2).truncate().text_color(t.dim).child(placeholder))))
          .children(extras));
    },
  },
};
