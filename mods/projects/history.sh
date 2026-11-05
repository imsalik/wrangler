#!/bin/sh
# Past Claude conversations for projects.history, from Claude's own transcripts through a cache file (no database).
# Usage: history.sh <claude dir> <cache file> <count> <from> <query> <messages: 0|1> [-v] [folder...] (-v: outside them)
# Cache: one line per transcript, newest first: id, mtime, path, cwd, JSON (- for non-interactive), tab-separated.
# Only transcripts new or changed since the last run are read (their last 64 KiB); deleted ones drop out.
# Prints count rows from the from-th match as JSON {"id","at","cwd","gitBranch","customTitle","aiTitle","lastPrompt"}
# ("gone":true when cwd no longer exists), then "next <n>" when more match. Matches: interactive (entrypoint cli),
# not running, cwd in one of the folders (any without), every query word in title, prompt, folder or branch (fuzzy, ranked); with messages 1,
# in the person's own messages instead. Folders listed in history-ignore next to the cache (one a line, ~ allowed) never show.
c=$1 cache=$2 n=$3 from=$4 q=$5 messages=$6
shift 6
inv=0
[ "$1" = -v ] && { inv=1; shift; }
T=$(printf '\t')
live=""
for s in "$c"/sessions/*.json; do
  [ -f "$s" ] || continue
  pid=${s##*/}
  [ -d "/proc/${pid%.json}" ] || continue
  live="$live $(sed -n 's/.*"sessionId": *"\([A-Za-z0-9-]*\)".*/\1/p' "$s")"
done
mkdir -p "${cache%/*}"
[ -f "$cache" ] || : >"$cache"
new="$cache.$$"
ls -tl --time-style=+%s -- "$c"/projects/*/*.jsonl 2>/dev/null |
  awk -v cache="$cache" 'BEGIN { FS = "\t"; while ((getline l < cache) > 0) { split(l, f, "\t"); have[f[1] "\t" f[2]] = l }; FS = " " }
    { id = $7; sub(/.*\//, "", id); sub(/\.jsonl$/, "", id)
      if ((id "\t" $6) in have) print have[id "\t" $6]; else print id "\t" $6 "\t" $7 "\t?\t?" }' |
  while IFS=$T read -r id at p cwd js; do
    if [ "$cwd" = "?" ]; then
      js=$(tail -c 65536 "$p" | awk -v id="$id" -v at="$at" '
        { while (match($0, /"(entrypoint|cwd|gitBranch|customTitle|aiTitle|lastPrompt)":"([^"\\]|\\.)*"/)) {
            m = substr($0, RSTART, RLENGTH); k[substr(m, 2, index(m, "\":") - 2)] = m; $0 = substr($0, RSTART + RLENGTH) } }
        END { if (k["entrypoint"] != "\"entrypoint\":\"cli\"") exit 1; delete k["entrypoint"]
          s = ""; for (x in k) s = s "," k[x]; printf "{\"id\":\"%s\",\"at\":%s%s}", id, at, s }') || js=-
      cwd=$(printf '%s' "$js" | sed -n 's/.*"cwd":"\([^"]*\)".*/\1/p')
    fi
    printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$at" "$p" "${cwd:--}" "$js"
  done >"$new" && mv -f "$new" "$cache"
rm -f "$new"
# Query words, lowercase, split at anything not a letter or digit; every word must match.
words=$(printf '%s' "$q" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' ' ')
hits=-
if [ "$messages" = 1 ] && [ -n "${words% }" ]; then
  hits="$cache.hits.$$"
  long=$(printf '%s\n' $words | awk 'length > length(l) { l = $0 } END { print l }')
  awk -F'\t' '$5 != "-" { print $3 }' "$cache" | xargs -d '\n' -r grep -iHF -e "$long" -- 2>/dev/null |
    W=$words awk 'index($0, "\"type\":\"user\"") && !index($0, "\"tool_use_id\"") {
      l = tolower($0); n = split(ENVIRON["W"], w, " "); for (i = 1; i <= n; i++) if (!index(l, w[i])) next
      print substr($0, 1, index($0, ":") - 1) }' | uniq >"$hits"
fi
# Each match scored per word: 4 a title word starts with it, 3 the title has it (spaces and punctuation ignored),
# 2 the prompt, folder or branch has it, 1 its letters are in the title in order (3+ letters). Best first, then newest.
LIVE=$live W=$words FOLDERS=$(printf '%s\n' "$@") awk -F'\t' -v inv="$inv" -v hits="$hits" -v ignore="${cache%/*}/history-ignore" '
  function val(s, k) { return match(s, "\"" k "\":\"([^\"\\\\]|\\\\.)*\"") ? substr(s, RSTART + length(k) + 4, RLENGTH - length(k) - 5) : "" }
  function words(s) { s = tolower(s); gsub(/\\u[0-9a-f]{4}|\\./, " ", s); gsub(/[^a-z0-9]+/, " ", s); return " " s }
  function inorder(t, s,   i, j) { j = 1; for (i = 1; i <= length(s) && j <= length(t); i++) if (substr(s, i, 1) == substr(t, j, 1)) j++; return j > length(t) }
  BEGIN { nw = split(ENVIRON["W"], w, " "); nf = split(ENVIRON["FOLDERS"], fs, "\n"); live = " " ENVIRON["LIVE"] " "
    if (hits != "-") while ((getline l < hits) > 0) hit[l] = 1
    while ((getline l < ignore) > 0) { sub(/^~/, ENVIRON["HOME"], l); sub(/\/+$/, "", l); if (l != "") skip[++ns] = l } }
  $5 == "-" || index(live, " " $1 " ") { next }
  { for (i = 1; i <= ns; i++) if ($4 == skip[i] || index($4, skip[i] "/") == 1) next }
  nf { ok = 0; for (i = 1; i <= nf; i++) if (fs[i] != "" && ($4 == fs[i] || index($4, fs[i] "/") == 1)) ok = 1; if (ok == inv) next }
  hits != "-" { if (!($3 in hit)) next; print 0 "\t" NR "\t" $4 "\t" $5; next }
  { score = 0
    if (nw) {
      t = words(val($5, "customTitle") " " val($5, "aiTitle")); ts = t; gsub(/ /, "", ts)
      o = words(val($5, "lastPrompt") " " $4 " " val($5, "gitBranch")); gsub(/ /, "", o)
      for (i = 1; i <= nw; i++) {
        s = index(t, " " w[i]) ? 4 : index(ts, w[i]) ? 3 : index(o, w[i]) ? 2 : length(w[i]) >= 3 && inorder(w[i], ts) ? 1 : 0
        if (!s) next
        score += s
      } }
    print score "\t" NR "\t" $4 "\t" $5 }' "$cache" |
  sort -t "$T" -k1,1nr -k2,2n |
  awk -F'\t' -v n="$n" -v from="$from" '{ if (++m <= from) next; if (m > from + n) { print "next " (m - 1); exit } print $3 "\t" $4 }' |
  while IFS=$T read -r cwd js; do
    case $cwd in "next "*) echo "$cwd"; continue ;; esac
    if [ -d "$cwd" ]; then printf '%s\n' "$js"; else printf '%s\n' "${js%\}},\"gone\":true}"; fi
  done
[ "$hits" = - ] || rm -f "$hits"
