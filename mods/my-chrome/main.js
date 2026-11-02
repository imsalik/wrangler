// Sidebar chrome: the brand row (over the layout's gradient), the search row (filters the spaces and agents
// lists through shared "sidebar.query"; Enter goes to the first match), and the footer.
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, agents, spaces, focused, openOverlay } from "herdr";

const ICON = (n) => `mods/workspace-chrome/${n}.svg`;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const fits = (hay, q) => q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.toLowerCase().includes(w));

export default class WorkspaceChrome extends View {
  init(_props, cx) {
    if (!props()?.search) return;
    setShared("sidebar.query", "");
    this.input = InputState.new({ placeholder: "Search" });
    this.input.on("change", () => setShared("sidebar.query", this.input.value()));
    this.input.on("focus", (_e, cx) => { this.active = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.active = false; cx.notify(); });
    this.input.on("submit", () => this.go());
    this.asked = shared("sidebar.search")?.at;
  }

  clear(back) {
    this.input.set_value("");
    setShared("sidebar.query", "");
    const pane = focused()?.pane;
    if (back && pane) run("pane.focus", { pane });
  }

  // The first agent whose space, tab or title fits, else the first space.
  go() {
    const q = this.input.value().trim();
    if (!q) return;
    const tabs = new Map(spaces().flatMap((s) => s.tabs).map((tb) => [tb.id, tb.name]));
    const a = agents().find((a) => fits([a.space_name, tabs.get(a.tab), a.title, a.program?.name].join(" "), q));
    const s = !a && spaces().find((s) => fits(s.name, q));
    this.clear(false);
    if (a) run("pane.focus", { pane: a.pane });
    else if (s) run("space.select", { id: s.id });
  }

  button(id, label, action, tip) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action)
      .when(Boolean(tip), el => el.tooltip(tip)).child(label);
  }

  search(t, collapsed) {
    const asked = shared("sidebar.search");
    if (asked?.at !== this.asked) {
      this.asked = asked?.at;
      if (collapsed) toggleSidebar();
      if (asked?.q) { this.input.set_value(asked.q); setShared("sidebar.query", asked.q); }
      this.input.focus();
    }
    const compose = this.button("sb-compose", svg(ICON("square-pen")).size(15), () => run("projects.compose"), "New agent");
    if (collapsed) return h_flex().size_full().bg(t.chrome).items_center().justify_center().child(compose);
    const q = this.input.value();
    const box = h_flex().id("sb-search").flex_1().min_w(0).h(32).pl(9).pr(4).gap(8).items_center().rounded(8)
      .border_1().border_color(this.active ? t.accent + "99" : t.chrome)
      .when(this.active, el => el.bg(t.background))
      .when(!this.active, el => el.hover(s => s.bg(t.hover)))
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        this.clear(true);
        cx.stop_propagation();
      })
      .child(svg(ICON("search")).size(16).flex_none().text_color(this.active ? t.foreground : t.dim))
      .child(Input.new(this.input).flex_1().min_w(0).h_full().text_size(13.5).text_color(t.foreground))
      .when(Boolean(q), el => el.child(div().id("sb-clear").size(20).flex_none().flex().items_center().justify_center().rounded(5)
        .text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { this.clear(true); cx.notify(); })
        .child(svg(ICON("x")).size(12))));
    return h_flex().size_full().bg(t.chrome).pl(10).pr(8).gap(2).items_center()
      .child(box)
      .child(this.button("sb-sort", svg("mods/my-chrome/filter.svg").size(15),
        () => openOverlay({ mod: "my-agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }), "Sort agents"))
      .child(this.button("sb-new", svg(ICON("folder-plus")).size(15),
        (e) => run(e?.position ? `projects.new-menu@${Math.round(e.position.x)},${Math.round(e.position.y)}` : "projects.new-menu"), "New space or project"))
      .child(compose);
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.search) return this.search(t, collapsed);
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8)
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(ICON(icon)).size(14))
        .when(!collapsed, el => el.child(label));
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(4).pb(8).text_size(13)
        .child(row("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(div().size(6).rounded_full().bg(t.accent))))
        .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
    }
    // No background: the layout paints the brand block's gradient.
    return h_flex().size_full().pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(14)
      .when(window()?.platform === "macos" && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(9).items_center()
        .child(image("frame/welcome/herdr.png").size(20).rounded(5))
        .child(div().font_semibold().text_color(t.foreground).child("Herdr"))))
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg(ICON("sidebar")).size(15), toggleSidebar, "Toggle sidebar")));
  }
}
