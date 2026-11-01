// The "New agent" dialog: project, This folder | New worktree (optional branch, base), agent (programs' agents); Open runs it on the host.
import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { knownAgents, panes, spaces } from "herdr";
import { Dropdown, ICON, ago, badge, basesOf, closeSelf, follow, headed, newReq, projects, reqState, send, sendJson, shownSpace, spinner, summary, tilde, worktreePath } from "./ui.js";

const leaves = (n) => (n.split ? n.children.flatMap(leaves) : [n.pane]);
const agentLeaf = (layout, key) => (layout?.tabs ?? []).some((t) => leaves(t.root).some((p) => p.argv?.[0]?.split("/").pop() === key));
const CLAUDE = { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false };
const icon = (a, size, color) => (!a?.icon ? null : a.tint ? svg(a.icon).size(size).flex_none().text_color(color) : image(a.icon).w(size).h(size).flex_none());

export const views = {
  // props: id (the project to preselect), where ("local" | "worktree"), pick (open the base list).
  // Keys: tab / shift-tab move between fields, ←→ or space flip Where, ↓ opens a list, ↵ opens, esc cancels.
  compose: {
    close: closeSelf,
    start(cx) {
      this.where = this.p.where === "worktree" ? "worktree" : "local";
      this.agent = "claude";
      this.pid = this.p.id ?? projects()[0]?.id ?? null;
      this.base = null;
      this.stage = "";
      this.error = "";
      this.whereF = cx.focus_handle();
      this.branch = InputState.new({ placeholder: "optional: auto-named if empty" });
      this.branch.on("change", (_e, cx) => { this.error = ""; cx.notify(); });
      this.branch.on("submit", (_e, cx) => this.submit(cx));
      this.branch.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
      this.branch.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
      this.proj = new Dropdown(cx, {
        placeholder: "filter projects", max: 7, rowH: 32,
        items: (f) => [...projects().filter((x) => !f || `${x.name} ${x.folder}`.toLowerCase().includes(f)),
          { action: "add-folder", icon: "folder", label: "Add project…" }, { action: "add", icon: "folder-plus", label: "Add current space as project" }],
        current: () => projects().findIndex((x) => x.id === this.pid),
        pick: (x, cx) => {
          if (!x.action) return this.pick(x.id);
          this.before = new Set(projects().map((y) => y.id));
          send(x.action);
        },
      });
      this.agents = [CLAUDE];
      knownAgents().then((l) => {
        this.agents = l.filter((a) => a.agent && a.installed && a.key !== "agent");
        if (!this.agents.some((a) => a.key === this.agent)) this.agent = this.agents[0]?.key ?? "none";
      }).catch(() => null);
      this.ag = new Dropdown(cx, {
        placeholder: "filter", max: 6,
        items: (f) => this.agents.filter((a) => !f || `${a.key} ${a.name}`.toLowerCase().includes(f)),
        current: () => this.agents.findIndex((a) => a.key === this.agent),
        pick: (a) => { this.agent = a.key; },
      });
      this.from = new Dropdown(cx, {
        placeholder: "filter branches",
        items: (f) => (this.b ? headed(this.b) : []).filter((r) => !f || r.name.toLowerCase().includes(f)),
        current: () => (this.b ? headed(this.b).findIndex((r) => r.name === this.base) : -1),
        pick: (r) => { this.base = r.name; },
      });
      const wt = this.where === "worktree";
      if (wt && this.p.pick) this.from.show(cx);
      else if (wt) { this.branch.focus(); this.typing = true; }
      else this.proj.trigger.focus();
      cx.timer.after(600, () => { if (!this.typing && !this.proj.open && !this.from.open && !this.fields().some((h) => h.is_focused?.())) this.proj.trigger.focus(); });
      this.loadBases();
      follow(this, () => this.sync(), () => `${this.agents.length}|${this.typing}|${this.branch.value()}|${this.fields().map((h) => (h.is_focused?.() ? 1 : 0)).join("")}`);
    },
    // Picks up fresh bases, a project just added from the list, and the host's progress on Open.
    sync() {
      if (this.before) {
        const fresh = projects().find((x) => !this.before.has(x.id));
        if (fresh) { this.before = null; this.pick(fresh.id); }
      }
      this.showBases();
      const r = reqState(this.req);
      if (!r) return;
      if (r.done) return this.close();
      this.stage = r.error ? "" : r.stage ?? "Starting…";
      if (r.error) { this.error = r.error; this.req = null; }
    },
    // The tab order: focus handles, and the branch input (no handle; its focus comes from events).
    fields() {
      return [this.proj.trigger, this.whereF, this.ag.trigger, ...(this.where === "worktree" ? [this.branch, this.from.trigger] : [])];
    },
    step(by, cx) {
      for (const d of [this.proj, this.ag, this.from]) if (d.open) return d.choose(d.at, cx);
      const fs = this.fields();
      const i = this.typing ? fs.indexOf(this.branch) : fs.findIndex((h) => h !== this.branch && h.is_focused());
      fs[(Math.max(0, i) + by + fs.length) % fs.length].focus();
    },
    project() {
      return projects().find((x) => x.id === this.pid);
    },
    loadBases() {
      const p = this.project();
      this.b = undefined;
      this.base = null;
      if (!p) return;
      sendJson("bases", { project: p, src: null, req: newReq() });
      this.showBases();
    },
    // The cached bases; a base already picked stays picked.
    showBases() {
      const p = this.project(), b = p && basesOf(p);
      if (!b || b === this.b) return;
      this.b = b;
      const want = this.base ?? p.defaultBase ?? b.origin;
      this.base = want === "HEAD" || b.refs.some((r) => r.name === want) ? want : b.refs[0]?.name ?? "HEAD";
      this.from.sync();
    },
    pick(id) {
      if (this.pid === id || this.stage) return;
      this.pid = id;
      this.error = "";
      this.loadBases();
    },
    submit(cx) {
      if (this.stage) return;
      const p = this.project();
      if (!p) return (this.error = "Pick a project."), cx.notify();
      if (this.where === "worktree" && !this.base) return (this.error = "Pick a branch to start from."), cx.notify();
      this.error = "";
      this.stage = "Starting…";
      this.req = newReq();
      sendJson("agent-run", { id: p.id, where: this.where, base: this.base, branch: this.branch.value(), agent: this.agent, req: this.req });
      cx.notify();
    },
    key(e, cx) {
      if (this.proj.key(e, cx) || this.ag.key(e, cx) || this.from.key(e, cx)) return cx.stop_propagation();
      const flip = e.key === "left" || e.key === "right" || e.key === "space";
      if (e.key === "escape") return this.close();
      if (e.keystroke === "tab") this.step(1, cx);
      else if (e.keystroke === "shift-tab") this.step(-1, cx);
      else if ((e.key_char ?? e.key) === "/" && !this.branch.is_focused()) this.proj.show(cx);
      else if (flip && this.whereF.is_focused()) this.where = this.where === "worktree" ? "local" : "worktree";
      else if (e.key === "enter" || e.keystroke === "ctrl-enter") this.submit(cx);
      else return;
      cx.stop_propagation();
      cx.notify();
    },
    draw(t) {
      const p = this.project(), b = this.b, sp = spaces(), ps = panes();
      const wt = this.where === "worktree";
      const ag = this.agents.find((a) => a.key === this.agent) ?? { key: this.agent, name: this.agent };
      const agName = ag.key === "claude" ? "Claude" : ag.name;
      const branch = this.branch.value().trim();
      const open = !wt && p && shownSpace(p, sp, ps);
      const leaf = !open && agentLeaf(p?.layout, ag.key);
      const baseName = this.base === "HEAD" ? `current HEAD (${b?.head.branch ?? "detached"})` : this.base;
      const agentPart = this.agent === "none" ? "no agent" : leaf ? `${agName} in the layout's pane` : !open && !p?.layout?.tabs?.length ? `${agName} as its only tab` : `${agName} in a new tab`;
      const hint = !p ? "" : wt
        ? (!b ? "…" : `${branch ? tilde(worktreePath(b.root, branch)) : `${tilde(b.root)}/${b.prefix ?? "wr"}-…`} from ${baseName}, new space, ${agentPart}`)
        : `${p.folder}, ${open ? "its open space" : p.layout ? `new space (${summary(p)})` : "new space"}, ${agentPart}`;
      const caption = (s) => div().w(54).h(32).flex().items_center().flex_none().text_size(11.5).text_color(t.dim).child(s);
      const seg = (id, on, text, fn) => div().id(id).px(12).h(26).flex().items_center().justify_center().rounded(6).cursor_pointer()
        .text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => { fn(); cx.notify(); }).child(text);
      const group = (id, handle, ...kids) => h_flex().id(id).track_focus(handle).p(2).gap(2).rounded(8).bg(t.background).border(1)
        .border_color(handle.is_focused() ? t.accent : t.border).text_size(12.5).children(kids);
      const button = (id, text, primary, fn) => div().id(id).h(30).px(14).flex().items_center().justify_center().rounded(7).cursor_pointer()
        .text_size(12.8).font_medium()
        .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground).when(!!this.stage, (el) => el.opacity(0.6)).hover((s) => s.opacity(0.88)))
        .when(!primary, (el) => el.border(1).border_color(t.border).text_color(t.foreground).hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => fn(cx)).child(text);
      const projLabel = (x) => [badge(x, sp, ps), div().flex_1().min_w(0).truncate().text_color(t.foreground).child(x.name)];
      const projRow = (x) => x.action
        ? [svg(ICON(x.icon)).size(14).flex_none().text_color(t.muted), div().flex_1().text_color(t.muted).child(x.label)]
        : [badge(x, sp, ps), div().flex_shrink(0).max_w(160).truncate().text_color(t.foreground).child(x.name),
          div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(x.folder),
          ...(shownSpace(x, sp, ps) ? [div().flex_none().text_size(11).text_color(t.accent).child("open")] : [])];
      const def = p?.defaultBase ?? b?.origin;
      const refLabel = (r) => [
        svg(ICON(r.head ? "branch" : "git-branch")).size(13).flex_none().text_color(t.dim),
        div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.head ? `Current HEAD · ${b?.head.branch ?? "detached"} @ ${b?.head.sha ?? ""}` : r.name),
      ];
      const sel = b && headed(b).find((r) => r.name === this.base);
      const W = 466;
      return v_flex().id("projects-compose").track_focus(this.handle).key_context("WranglerDialog").w_full().p(16).gap(10).bg(t.popover).text_size(13)
        .on_key_down((e, cx) => this.key(e, cx))
        .on_action("wrangler::Next", (_e, cx) => { this.step(1, cx); cx.notify(); })
        .on_action("wrangler::Prev", (_e, cx) => { this.step(-1, cx); cx.notify(); })
        .on_action("wrangler::Back", (_e, cx) => { for (const d of [this.proj, this.ag, this.from]) if (d.open) return d.hide(cx); this.close(); })
        .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("New agent"))
          .child(div().text_size(11).text_color(t.dim).child("esc")))
        .child(h_flex().gap(8).items_center().child(caption("Project"))
          .child(this.proj.draw(t, "cp-proj", W, p ? projLabel(p) : div().text_color(t.dim).child(projects().length ? "Pick a project" : "No projects yet"),
            projRow, "No matching projects.")))
        .child(h_flex().gap(8).items_center().child(caption("Where"))
          .child(group("cw", this.whereF,
            seg("cw-local", !wt, "This folder", () => { this.where = "local"; }),
            seg("cw-tree", wt, "New worktree", () => { this.where = "worktree"; })))
          .child(div().flex_1())
          .child(this.ag.draw(t, "ca-agent", 150, [icon(ag, 15, t.foreground), div().flex_1().min_w(0).truncate().text_color(t.foreground).child(agName)].filter(Boolean),
            (a) => [icon(a, 15, t.foreground), div().flex_1().min_w(0).truncate().text_color(t.foreground).child(a.key === "claude" ? "Claude" : a.name)].filter(Boolean))))
        .when(wt, (el) => el
          .child(h_flex().gap(8).items_center().child(caption("Branch"))
            .child(Input.new(this.branch).w(W).h(32).px(10).items_center().rounded(6).border(1)
              .border_color(this.typing && !this.from.open && !this.proj.open && !this.ag.open && !this.fields().some((h) => h !== this.branch && h.is_focused()) ? t.accent : t.input).bg(t.background).text_color(t.foreground)))
          .child(h_flex().gap(8).items_center().child(caption("From"))
            .child(this.from.draw(t, "cb-base", W, b === undefined ? div().text_color(t.dim).child("…") : sel ? refLabel(sel) : div().text_color(t.dim).child("Pick a branch"),
              (r) => [...refLabel(r),
                ...(r.name === def ? [div().flex_none().text_size(11).text_color(t.accent).child("default")] : []),
                div().flex_none().text_size(11).text_color(t.dim).child(r.at ? ago(r.at) : "")],
              "No matching branches."))))
        .child(div().pl(62).text_size(11.5).text_color(t.dim).child(hint))
        .when(!!this.error, (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
        .child(h_flex().gap(8).items_center()
          .child(h_flex().flex_1().min_w(0).gap(6).items_center().text_size(11).text_color(t.dim)
            .when(!!this.stage, (el) => el.child(spinner(t, this.stage)))
            .when(!this.stage, (el) => el.child(this.proj.open || this.ag.open || this.from.open ? "type to filter · ↑↓ · ↵ pick · esc back"
              : "tab next · ←→ toggle · ↓ list · / project · ↵ open · esc cancel")))
          .child(button("cc-cancel", "Cancel", false, () => this.close()))
          .child(button("cc-go", "Open", true, (cx) => this.submit(cx))));
    },
  },
};
