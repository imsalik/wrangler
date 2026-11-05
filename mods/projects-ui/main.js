// projects-ui: the projects mod's overlays (menus, picker, dialogs). Only draws: data comes from the projects
// host's cache, actions go to it as projects.* commands. Each open loads only its view's file (Herdr keeps
// every overlay's modules after it closes, so less code here means less memory kept).
import { View } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, theme } from "herdr";

const FILE = { picker: "menus", new: "menus", menu: "menus", "space-menu": "menus", "agent-menu": "menus", worktree: "worktree", "agent-delete": "worktree", "project-remove": "worktree", compose: "compose", switch: "switcher", history: "history", peek: "peek", cache: "cache" };

export default class ProjectsUi extends View {
  init(_props, cx) {
    this.p = props() ?? {};
    this.view = this.p.view ?? "picker";
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.opened = Date.now();
    // Tab, shift-Tab and Esc in a dialog's WranglerDialog context: wrangler::Next / Prev / Back (else Tab
    // leaves the dialog and Esc closes it from inside a dropdown).
    if (!globalThis.__wranglerKeys) {
      globalThis.__wranglerKeys = true;
      cx.bind_keys([
        { keystroke: "tab", action: "wrangler::Next", context: "WranglerDialog" },
        { keystroke: "shift-tab", action: "wrangler::Prev", context: "WranglerDialog" },
        { keystroke: "escape", action: "wrangler::Back", context: "WranglerDialog" },
      ]);
    }
    cx.spawn(async (cx) => {
      const m = await import(`./${FILE[this.view] ?? "menus"}.js`);
      Object.assign(this, m.views[this.view]);
      this.start?.(cx);
      cx.notify();
    });
    // Views' follow() ticks: only a timer started here can re-render the view. A view that keeps the keyboard on its
    // root (grabs) takes it back in its first 1.5 s: opened from the prefix, the prefix closing hands it to the terminal.
    cx.timer.every(100, (cx) => {
      if (this.grabs && Date.now() - this.opened < 1500 && !this.handle.is_focused()) this.handle.focus();
      if (this.tick?.()) cx.notify();
    });
  }

  render() {
    const t = theme();
    return this.draw ? this.draw(t) : v_flex().size_full().bg(t.popover);
  }
}
