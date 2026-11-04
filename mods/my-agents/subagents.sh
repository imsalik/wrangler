#!/bin/sh
# Running sub-agents of every Claude session in a herdr terminal, read from Claude's own files (no hooks).
# Usage: subagents.sh <claude dir>. One line each: terminal, agent id, started (s), then its .meta.json, tab-separated.
# Skips finished ones and ones whose files are 15 min old (interrupted: Claude never marks those finished).
c=$1
for s in "$c"/sessions/*.json; do
  [ -f "$s" ] || continue
  pid=${s##*/}
  pid=${pid%.json}
  case $pid in '' | *[!0-9]*) continue ;; esac
  t=$(tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null | sed -n 's/^HC_TERMINAL_ID=//p')
  [ -n "$t" ] || continue
  sid=$(sed -n 's/.*"sessionId": *"\([A-Za-z0-9-]*\)".*/\1/p' "$s")
  [ -n "$sid" ] || continue
  for m in "$c"/projects/*/"$sid"/subagents/agent-*.meta.json; do
    [ -f "$m" ] || continue
    grep -q '"finished": *true' "$m" && continue
    [ -n "$(find "$m" "${m%.meta.json}.jsonl" -maxdepth 0 -mmin -15 2>/dev/null)" ] || continue
    id=${m##*/agent-}
    printf '%s\t%s\t%s\t' "$t" "${id%.meta.json}" "$(stat -c %W "$m")"
    tr -d '\n' <"$m"
    echo
  done
done
