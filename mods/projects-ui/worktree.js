// The new-worktree dialog and the agent's delete-worktree dialog.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { Dropdown, ICON, ago, basesOf, closeSelf, follow, headed, newReq, projects, reqState, send, sendJson, spinner, tilde, worktreePath } from "./ui.js";

export const views = {
  // props: id (a saved project) or project (an unsaved one), src (whose HEAD "Current HEAD" is), mode ("head" picks it), branch, pick (open the branch list).
  worktree: {
    close: closeSelf,
    start(cx) {
      const p = this.p;
      this.sel = p.mode === "head" ? "HEAD" : null;
      this.stage = "";
      this.error = "";
      this.input = InputState.new({ value: p.branch ?? "", placeholder: "new branch name" });
      this.input.on("change", (_e, cx) => { this.error = ""; cx.notify(); });
      this.input.on("submit", (_e, cx) => this.create(cx));
      this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
      this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
      this.from = new Dropdown(cx, {
        placeholder: "filter branches",
        items: (f) => (this.b ? headed(this.b) : []).filter((r) => !f || r.name.toLowerCase().includes(f)),
        pick: (r) => { this.sel = r.name; this.input.focus(); },
        current: () => (this.b ? headed(this.b).findIndex((r) => r.name === this.sel) : -1),
      });
      if (p.pick) this.from.show(cx);
      else { this.input.focus(); this.typing = true; }
      cx.timer.after(600, () => { if (!this.from.open && !this.from.trigger.is_focused()) this.input.focus(); });
      const q = this.project();
      if (q) {
        this.load = newReq();
        sendJson("bases", { project: q, src: p.src ?? null, req: this.load });
      }
      this.sync();
      follow(this, () => this.sync(), () => `${this.typing}|${this.input.value()}|${this.from.trigger.is_focused()}`);
    },
    // Picks up the cached bases and the host's progress on our requests.
    sync() {
      const q = this.project(), b = q && basesOf(q, this.p.src);
      if (b && b !== this.b) {
        const want = this.sel ?? q.defaultBase ?? b.origin;
        this.b = b;
        this.sel = want === "HEAD" || b.refs.some((r) => r.name === want) ? want : b.refs[0]?.name ?? "HEAD";
        this.from.sync();
      }
      const l = reqState(this.load);
      if (!q) this.error = `No project ${this.p.id}.`;
      else if (l?.error && !this.b) this.error = l.error;
      const r = reqState(this.req);
      if (!r) return;
      if (r.done) return this.close();
      this.stage = r.error ? "" : r.stage ?? "Working…";
      if (r.error) { this.error = r.error; this.req = null; }
    },
    project() {
      return this.p.project ?? projects().find((x) => x.id === this.p.id);
    },
    create(cx) {
      if (this.stage || !this.b) return;
      if (!this.sel) return (this.error = "Pick a branch to start from."), cx.notify();
      this.error = "";
      this.stage = "Working…";
      this.req = newReq();
      sendJson("wt-run", { project: this.project(), branch: this.input.value(), from: this.sel, src: this.p.src ?? null, req: this.req });
      cx.notify();
    },
    step() {
      (this.from.trigger.is_focused() ? this.input : this.from.trigger).focus();
    },
    key(e, cx) {
      if (this.from.key(e, cx)) return cx.stop_propagation();
      if (e.key === "escape") return this.close();
      if (e.keystroke === "tab" || e.keystroke === "shift-tab") this.step();
      else if (e.key === "enter" && this.from.trigger.is_focused()) this.create(cx);
      else return;
      cx.stop_propagation();
      cx.notify();
    },
    draw(t) {
      const p = this.project(), b = this.b;
      const branch = this.input.value().trim();
      const has = !!branch && !!b?.locals.has(branch);
      const path = b && branch ? worktreePath(b.root, branch) : null;
      const exists = !!path && !!b?.trees.has(path);
      const note = !b ? "" : !path ? `Goes to ${tilde(b.root)}/<branch>`
        : exists ? `Worktree exists: opens ${tilde(path)}`
        : has ? `Branch exists: checks it out at ${tilde(path)}`
        : `New branch at ${tilde(path)}`;
      const def = p?.defaultBase ?? b?.origin;
      const caption = (s) => div().w(54).h(32).flex().items_center().flex_none().text_size(11.5).text_color(t.dim).child(s);
      const refLabel = (r) => [
        svg(ICON(r.head ? "branch" : "git-branch")).size(13).flex_none().text_color(t.dim),
        div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.head ? `Current HEAD · ${b?.head.branch ?? "detached"} @ ${b?.head.sha ?? ""}` : r.name),
      ];
      const sel = b && headed(b).find((r) => r.name === this.sel);
      const button = (id, text, primary, fn) => div().id(id).h(30).px(14).flex().items_center().justify_center().rounded(7).cursor_pointer()
        .text_size(12.8).font_medium()
        .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground).when(!!this.stage || !b, (el) => el.opacity(0.6)).hover((s) => s.opacity(0.88)))
        .when(!primary, (el) => el.border(1).border_color(t.border).text_color(t.foreground).hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => fn(cx)).child(text);
      return v_flex().id("projects-worktree").track_focus(this.handle).key_context("WranglerDialog").w_full().p(16).gap(10).bg(t.popover).text_size(13)
        .on_key_down((e, cx) => this.key(e, cx))
        .on_action("wrangler::Next", (_e, cx) => { if (this.from.open) this.from.choose(this.from.at, cx); else this.step(); cx.notify(); })
        .on_action("wrangler::Prev", (_e, cx) => { if (!this.from.open) this.step(); cx.notify(); })
        .on_action("wrangler::Back", (_e, cx) => (this.from.open ? this.from.hide(cx) : this.close()))
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(`New worktree of ${p?.name ?? this.p.id}`))
          .child(div().max_w(220).truncate().text_size(11).text_color(t.dim).child(this.p.src ? tilde(this.p.src) : p?.folder ?? "")))
        .child(h_flex().gap(8).items_center().child(caption("Branch"))
          .child(Input.new(this.input).flex_1().h(32).px(10).items_center().rounded(6).border(1)
            .border_color(this.typing && !this.from.trigger.is_focused() && !this.from.open ? t.accent : t.input).bg(t.background).text_color(t.foreground)))
        .child(h_flex().gap(8).items_center().when(exists || has, (el) => el.opacity(0.45)).child(caption("From"))
          .child(this.from.draw(t, "wt-from", 426, !b ? div().text_color(t.dim).child("…") : sel ? refLabel(sel) : div().text_color(t.dim).child("Pick a branch"),
            (r) => [...refLabel(r),
              ...(r.name === def ? [div().flex_none().text_size(11).text_color(t.accent).child("default")] : []),
              div().flex_none().text_size(11).text_color(t.dim).child(r.at ? ago(r.at) : "")],
            b?.refs.length ? "No matching branches." : `No ${b?.remote ?? "origin"} branches. Fetch ${b?.remote ?? "origin"} first.`)))
        .child(div().pl(62).text_size(11.5).text_color(has ? t.accent : t.dim).truncate().child(note))
        .when(!!this.error, (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
        .child(h_flex().gap(8).items_center()
          .child(h_flex().flex_1().min_w(0).gap(6).items_center().text_size(11).text_color(t.dim)
            .when(!!this.stage, (el) => el.child(spinner(t, this.stage)))
            .when(!this.stage, (el) => el.child(this.from.open ? "type to filter · ↑↓ · ↵ pick · esc back" : "tab next field · ↓ branches · ↵ create · esc cancel")))
          .child(button("wt-cancel", "Cancel", false, () => this.close()))
          .child(button("wt-go", "Create", true, (cx) => this.create(cx))));
    },
  },

  // Delete an agent's worktree (props.terminal): Esc or Cancel closes, only a click deletes; uncommitted
  // changes make it Force delete.
  "agent-delete": {
    close: closeSelf,
    start(cx) {
      this.stage = "";
      this.error = "";
      this.info = newReq();
      send("agent-info", `${this.p.terminal}|${this.info}`);
      follow(this, () => this.sync());
    },
    sync() {
      const i = reqState(this.info);
      if (i?.done) { this.a = i.value?.a ?? null; this.n = i.value?.n ?? null; this.checked = true; }
      else if (i?.stage?.a !== undefined) this.a = i.stage.a;
      else if (i?.error) { this.a = null; this.error = i.error; }
      const r = reqState(this.req);
      if (!r) return;
      if (r.done) return this.close();
      if (r.error) { this.error = r.error; this.stage = ""; this.req = null; }
    },
    remove(cx) {
      if (this.stage || !this.a?.linked || this.n == null) return;
      this.stage = "Deleting…";
      this.error = "";
      this.req = newReq();
      send("wt-delete-run", `${this.p.terminal}|${this.n ? "force" : ""}|${this.req}`);
      cx.notify();
    },
    draw(t) {
      const a = this.a, n = this.n;
      const ok = !!a?.linked && n != null;
      const button = (id, text, bg, fg, on, fn) => div().id(id).h(30).px(14).flex().items_center().justify_center().rounded(7).text_size(12.8).font_medium()
        .bg(bg).text_color(fg).border(1).border_color(id === "ad-cancel" ? t.border : bg)
        .when(on, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => fn(cx)))
        .when(!on, (el) => el.opacity(0.5)).child(text);
      const detail = a === undefined ? "…"
        : !a?.linked ? "This agent isn't in a linked worktree."
        : !this.checked ? `Closes its space and agents and removes ${tilde(a.top)}; the branch is kept. Checking for uncommitted changes…`
        : n == null ? `git status failed in ${tilde(a.top)}.`
        : `Closes its space and agents and removes ${tilde(a.top)}; the branch is kept.`;
      return v_flex().id("projects-agent-delete").track_focus(this.handle).w_full().p(18).gap(12).bg(t.popover).text_size(13)
        .on_key_down((e, cx) => { if (e.key === "escape") this.close(); else if (e.key !== "enter") return; cx.stop_propagation(); })
        .child(h_flex().items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(`Delete worktree ${a?.branch ?? ""}?`))
          .child(div().text_size(11).text_color(t.dim).child("Esc")))
        .child(div().text_color(t.muted).child(detail))
        .when(ok && n > 0, (el) => el.child(div().text_color(t.blocked).child(`${n} uncommitted change${n > 1 ? "s" : ""}: they will be lost. Force delete runs git worktree remove --force.`)))
        .when(!!this.error, (el) => el.child(div().text_color(t.blocked).child(this.error)))
        .child(h_flex().gap(8).items_center()
          .child(h_flex().flex_1().gap(6).items_center().text_size(11).text_color(t.dim)
            .when(!!this.stage, (el) => el.child(spinner(t, this.stage))))
          .child(button("ad-cancel", "Cancel", t.raised, t.foreground, true, () => this.close()))
          .child(button("ad-go", n ? "Force delete" : "Delete", t.blocked, "#ffffff", ok && !this.stage, (cx) => this.remove(cx))));
    },
  },

  // Remove a project (props.id) from the list; Enter or a click removes, Esc or Cancel closes.
  "project-remove": {
    close: closeSelf,
    start(cx) { follow(this); },
    remove() { send("remove", this.p.id); this.close(); },
    draw(t) {
      const p = projects().find((x) => x.id === this.p.id);
      const button = (id, text, bg, fg, fn) => div().id(id).h(30).px(14).flex().items_center().justify_center().rounded(7).text_size(12.8).font_medium()
        .bg(bg).text_color(fg).border(1).border_color(id === "pr-cancel" ? t.border : bg)
        .cursor_pointer().hover((s) => s.opacity(0.88)).on_click(() => fn()).child(text);
      return v_flex().id("projects-remove").track_focus(this.handle).w_full().p(18).gap(12).bg(t.popover).text_size(13)
        .on_key_down((e, cx) => {
          if (e.key === "escape") this.close();
          else if (e.key === "enter" && p) this.remove();
          else return;
          cx.stop_propagation();
        })
        .child(h_flex().items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(p ? `Remove ${p.name}?` : "Project not found"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")))
        .child(div().text_color(t.muted).child(p
          ? `Takes it off the projects list and forgets its saved layout. ${tilde(p.folder)}, its worktrees and branches stay as they are.`
          : "It may have been removed already."))
        .child(h_flex().gap(8).justify_end()
          .child(button("pr-cancel", "Cancel", t.raised, t.foreground, () => this.close()))
          .when(!!p, (el) => el.child(button("pr-go", "Remove", t.blocked, "#ffffff", () => this.remove()))));
    },
  },
};
