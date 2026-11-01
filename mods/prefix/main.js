// A which-key prefix (keys.json "ctrl-a": "mod.open:prefix"): takes the next key and runs its action, showing every
// key meanwhile. No keys here: each installed mod brings its own in mods/<name>/prefix.json ({ title, items }; groups
// of the same title merge), defaults.json has Herdr's own commands, and data/prefix/config.json configures it:
// { "show": "side" | "top" | "hint" | "off", "defaults": false, "groups": [{ title, after?, items }], "mods": { <mod>: { <key>: action | null } } }.
// The overlay covers the window, frameless; a click closes it.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, closeOverlay, commands, exec, props, readTextFile, run, settings, theme } from "herdr";

// Kept across opens (every popup copy shares globalThis); refreshed in the background on each open.
const st = (globalThis.__prefix ??= { ready: false, show: "side", groups: [], map: {} });
st.key ??= "prefix";
const LINE = 21;

const keyText = (k) => (k.startsWith("shift-") ? `⇧${k.slice(6).toUpperCase()}` : k);

/** Keys to actions: each item's bind, and a lone run on its show key. */
const mapOf = (groups) => Object.assign({}, ...groups.flatMap((g) => g.items).map((i) => ({ ...(i.run ? { [i.show]: i.run } : {}), ...i.bind })));

/** A mod's group with its overrides applied: keys rebound or hidden, items left without a key dropped. */
function override(g, o) {
  const map = mapOf([g]);
  for (const [k, v] of Object.entries(o)) {
    if (v !== null) for (const [k2, v2] of Object.entries(map)) if (v2 === v) delete map[k2];
    if (v === null) delete map[k];
    else map[k] = v;
  }
  const items = g.items.map((i) => {
    const acts = new Set([...(i.run ? [i.run] : []), ...Object.values(i.bind ?? {})]);
    const keys = Object.keys(map).filter((k) => acts.has(map[k]));
    return keys.length ? { label: i.label, show: keys.map(keyText).join(" "), bind: Object.fromEntries(keys.map((k) => [k, map[k]])) } : null;
  }).filter(Boolean);
  return { ...g, items };
}

/** Groups in order, one per title: own ones replace a base group of their title or go after `after`. */
function merge(base, own) {
  const out = base.map((g) => own.find((x) => x.title === g.title) ?? g);
  for (const g of own) {
    if (out.some((b) => b.title === g.title)) continue;
    const i = out.findIndex((x) => x.title === g.after);
    out.splice(i < 0 ? out.length : i + 1, 0, g);
  }
  return out;
}

/** Drops items that only open a mod that isn't installed (`mod.open:<name>`). */
function installed(g, have) {
  const ok = (a) => !a.startsWith("mod.open:") || have.has(a.slice(9));
  return { ...g, items: (g.items ?? []).filter((i) => [i.run, ...Object.values(i.bind ?? {})].filter(Boolean).some(ok)) };
}

const json = async (path) => { try { return JSON.parse((await readTextFile(path)) ?? "null"); } catch { return null; } };

async function load() {
  const home = appHome();
  const r = await exec("sh", ["-c", 'cd "$1"/mods && for d in */; do printf "%s\\n" "${d%/}"; done', "sh", home]);
  const have = new Set((r.stdout ?? "").split("\n").filter(Boolean));
  const cfg = (await json(`${home}/data/prefix/config.json`)) ?? {};
  const keys = (await json(`${home}/keys.json`)) ?? {};
  const bound = (sec) => Object.keys(sec ?? {}).find((k) => sec[k] === "mod.open:prefix");
  const base = cfg.defaults === false ? [] : ((await json(`${home}/mods/prefix/defaults.json`))?.groups ?? []);
  const user = Array.isArray(cfg.groups) ? cfg.groups : [];
  const mods = [];
  for (const m of [...have].sort()) {
    const g = m === "prefix" ? null : await json(`${home}/mods/${m}/prefix.json`);
    if (!g?.title || !Array.isArray(g.items)) continue;
    const o = cfg.mods?.[m], x = o ? override(g, o) : g, same = mods.find((y) => y.title === x.title);
    if (same) same.items = [...same.items, ...x.items];
    else mods.push({ ...x, items: [...x.items] });
  }
  const shown = base.map((b) => { const m = mods.find((x) => x.title === b.title); return m ? { ...b, items: [...b.items, ...m.items] } : b; });
  for (const m of mods) if (!base.some((b) => b.title === m.title)) shown.push(m);
  const groups = merge(shown, user).map((g) => installed(g, have)).filter((g) => g.items.length);
  // A key goes to the config's groups first, then the defaults, then the mods.
  const kept = (g) => !user.some((u) => u.title === g.title);
  const map = {};
  for (const g of [...user, ...base.filter(kept), ...mods.filter(kept)]) for (const [k, v] of Object.entries(mapOf([installed(g, have)]))) map[k] ??= v;
  const key = bound(keys.global) ?? Object.values(keys).map(bound).find(Boolean) ?? "prefix";
  Object.assign(st, { ready: true, key, show: ["side", "top", "hint", "off"].includes(cfg.show) ? cfg.show : "side", groups, map });
}

const MODIFIERS = new Set(["shift", "control", "ctrl", "alt", "super", "cmd", "platform", "function", "fn"]);

/** Runs a keys.json-style action: `name` or `name:value` (value fills the first argument). */
function dispatch(action) {
  const i = action.indexOf(":");
  if (i < 0) return run(action, {});
  const name = action.slice(0, i), raw = action.slice(i + 1);
  const arg = commands().find((c) => c.name === name)?.args[0]?.name;
  return run(name, arg ? { [arg]: /^\d+$/.test(raw) ? Number(raw) : raw } : {});
}

function keycap(text, t, mono) {
  return div().flex_none().min_w(22).h(20).px(6).rounded(5).bg(t.raised).border(1).border_color(t.border)
    .flex().items_center().justify_center()
    .font_family(mono).text_size(11.5).font_semibold().text_color(t.foreground).child(text);
}

const card = (t) => v_flex().rounded(10).border(1).border_color(t.border).bg(t.popover).shadow_lg();

export default class Prefix extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.off = 0;
    this.acc = 0;
    cx.spawn(async (cx) => { await load().catch(() => null); cx.notify(); });
  }

  close() { closeOverlay(props().overlay); }

  /** Lines the side panel can show at once (the window's height less its frame). */
  room() { return Math.max(6, Math.floor(((this.h ?? st.h ?? 900) - 28 - 70) / LINE)); }

  scroll(by, n) { this.off = Math.max(0, Math.min(this.off + by, n - this.room())); }

  key(e, cx) {
    if (MODIFIERS.has(e.key)) return;
    cx.stop_propagation();
    const n = this.lines?.length ?? 0, half = Math.max(1, Math.floor(this.room() / 2));
    if (e.keystroke === "ctrl-d" || e.keystroke === "ctrl-u") return this.scroll(e.keystroke === "ctrl-d" ? half : -half, n), cx.notify();
    const action = st.map[e.keystroke] ?? (e.key_char ? st.map[e.key_char] : undefined);
    this.close();
    if (action) dispatch(action);
  }

  side(t, mono) {
    const lines = (this.lines = st.groups.flatMap((g) => [{ head: g.title }, ...g.items]));
    const room = this.room(), more = lines.length > room;
    this.scroll(0, lines.length);
    const line = (l) => l.head
      ? div().h(LINE).flex_none().flex().items_end().pb(2).text_size(10.5).font_semibold().text_color(t.dim).child(l.head.toUpperCase())
      : h_flex().h(LINE).flex_none().gap(6).items_center()
        .child(div().w(46).flex_none().truncate().text_color(t.accent).child(l.show))
        .child(div().flex_none().text_color(t.dim).child("→"))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(l.label));
    return card(t).w(290).px(12).pt(10).pb(8).font_family(mono).text_size(12)
      .child(h_flex().pb(2).gap(8).items_center()
        .child(div().px(6).rounded(4).bg(t.accent).text_color(t.accent_foreground).font_bold().child(st.key))
        .child(div().flex_1().text_color(t.muted).child("prefix"))
        .when(more, (el) => el.child(div().text_size(11).text_color(t.dim).child(`${this.off + 1}-${Math.min(lines.length, this.off + room)}/${lines.length}`))))
      .child(v_flex().id("prefix-lines").relative().h(LINE * Math.min(room, lines.length)).overflow_hidden()
        .on_scroll_wheel((ev, cx) => {
          this.acc += ev.delta_lines ? ev.delta_lines.y * LINE : ev.delta.y;
          const step = Math.trunc(this.acc / LINE);
          if (!step) return;
          this.acc -= step * LINE;
          this.scroll(-step, lines.length);
          cx.stop_propagation();
          cx.notify();
        })
        .children(lines.slice(this.off, this.off + room).map(line))
        .when(more, (el) => el.child(div().absolute().right(-8).w(3).rounded(2).bg(t.border)
          .top(Math.round(LINE * room * this.off / lines.length)).h(Math.max(12, Math.round(LINE * room * room / lines.length))))))
      .child(h_flex().pt(8).gap(6).text_size(11).text_color(t.dim)
        .child(div().text_color(t.accent).child("esc")).child("close")
        .when(more, (el) => el.child(div().pl(10).text_color(t.accent).child("^d/^u")).child("scroll")));
  }

  hint(t, mono) {
    return card(t).px(10).py(6).font_family(mono).text_size(12)
      .child(h_flex().gap(8).items_center()
        .child(div().px(6).rounded(4).bg(t.accent).text_color(t.accent_foreground).font_bold().child(st.key))
        .child(div().text_color(t.muted).child("prefix")));
  }

  top(t, mono) {
    return card(t).w(1000).max_w_full().px(16).pt(12).pb(14).gap(12)
      .child(h_flex().w_full().items_center().gap(10).pb(10).border_b(1).border_color(t.border)
        .child(div().px(8).py(2).rounded(5).bg(t.accent).text_color(t.accent_foreground).font_family(mono).text_size(12).font_bold().child(st.key))
        .child(div().flex_1().text_size(13).font_medium().text_color(t.foreground).child("Prefix"))
        .child(h_flex().items_center().gap(6).text_size(11.5).text_color(t.dim).child(keycap("esc", t, mono)).child("cancel")))
      .child(h_flex().w_full().items_start().gap(18).children(st.groups.map((g) => v_flex().flex_1().min_w(0).gap(6)
        .child(div().pb(2).text_size(11).font_semibold().text_color(t.accent).child(g.title.toUpperCase()))
        .children(g.items.map((i) => h_flex().items_center().gap(8)
          .child(h_flex().w(54).flex_none().child(keycap(i.show, t, mono)))
          .child(div().truncate().text_size(12.5).text_color(t.muted).child(i.label)))))));
  }

  render() {
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono";
    const shown = !st.ready || st.show === "off" ? null : st.show === "top" ? this.top(t, mono) : st.show === "hint" ? this.hint(t, mono) : this.side(t, mono);
    // The popup is as tall as its content, up to the window: a huge height held to the parent's fills the window.
    return v_flex().id("prefix").w_full().h(10000).max_h_full().p(14).track_focus(this.handle)
      .on_size_change((size, cx) => {
        const h = size.height / (settings().zoom ?? 1);
        if (Math.abs(h - (this.h ?? 0)) < 1) return;
        this.h = st.h = h;
        cx.notify();
      })
      .when(st.show === "top", (el) => el.pt(8).items_center())
      .when(st.show !== "top", (el) => el.justify_end().items_end())
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.close())
      .when(!!shown, (el) => el.child(shown));
  }
}
