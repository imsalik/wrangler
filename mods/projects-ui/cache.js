// A Claude agent opened with its prompt cache cooling or cold (my-agents opens it): how long since its last
// request and how much the next message re-sends. Enter, Esc or the button closes it.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, closeOverlay, exec, home } from "herdr";

// Self-contained: opening this loads only it and main.js (every overlay open keeps its modules).
const LAST_USAGE = `f=$(ls "$2"/.claude/projects/*/"$1".jsonl 2>/dev/null | head -n 1); [ -n "$f" ] || exit 0
tail -c 400000 "$f" | grep '"type":"assistant"' | grep -v '"model":"<synthetic>"' | tail -n 1 | grep -o '"[a-z_]*input_tokens":[0-9]*'`;

const span = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
};

export const views = {
  cache: {
    close() { closeOverlay(this.p.overlay); },
    start(cx) {
      this.tokens = null;
      if (this.p.sid) cx.spawn(async (cx) => {
        const r = await exec("sh", ["-c", LAST_USAGE, "sh", this.p.sid, home()]).catch(() => null);
        const n = (k) => Number(r?.stdout.match(new RegExp(`"${k}":(\\d+)`))?.[1] ?? 0);
        const sum = n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
        if (sum) { this.tokens = sum; cx.notify(); }
      });
      let was = -1;
      this.tick = () => {
        const m = Math.floor(Date.now() / 60000);
        if (m === was) return false;
        was = m;
        return true;
      };
    },
    draw(t) {
      const a = agents().find((x) => x.address === this.p.terminal);
      const since = Date.now() - this.p.at;
      const left = this.p.ttl * 60000 - since;
      const cold = left <= 0;
      const size = this.tokens ? `~${Math.round(this.tokens / 1000)}k tokens` : "the whole conversation";
      const tone = cold ? t.ansi4 ?? t.accent : t.working;
      return v_flex().id("projects-cache").track_focus(this.handle).w_full().bg(t.popover).text_size(13)
        .on_key_down((e, cx) => {
          if (e.key !== "escape" && e.key !== "enter") return;
          cx.stop_propagation();
          this.close();
        })
        .child(v_flex().p(16).gap(10)
          .child(h_flex().gap(10).items_center()
            .child(h_flex().size(28).flex_none().rounded(7).items_center().justify_center().bg(tone + "22").text_color(tone)
              .child(svg(`mods/my-agents/${cold ? "snowflake" : "hourglass"}.svg`).size(15)))
            .child(v_flex().min_w(0)
              .child(div().font_semibold().text_color(t.foreground).child(cold ? "Prompt cache expired" : `Prompt cache expires in ${Math.ceil(left / 60000)}m`))
              .child(div().text_size(12).text_color(t.dim).truncate().child(a?.title || a?.space_name || this.p.terminal))))
          .child(div().text_color(t.muted).child(cold
            ? `Last request ${span(since)} ago. The next message re-sends ${size} without the cache discount.`
            : `A message now keeps the cache warm. After ${span(left)}, the next one re-sends ${size} without the discount.`))
          .when(cold, (el) => el.child(div().text_size(12).text_color(t.dim).child("Starting something new? /clear or a new agent skips the re-read."))))
        .child(h_flex().px(16).py(10).items_center().justify_end().border_t(1).border_color(t.border)
          .child(h_flex().id("cache-ok").h(28).px(12).gap(8).items_center().rounded(7).cursor_pointer().bg(t.hover)
            .text_size(12.5).text_color(t.foreground).hover((s) => s.bg(t.selected))
            .on_click(() => this.close())
            .child("Got it")
            .child(div().text_size(10.5).text_color(t.dim).child("↵"))));
    },
  },
};
