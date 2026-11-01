#!/usr/bin/env bash
# Symlinks wrangler's mods and layout into the Herdr app home. Safe to rerun; reruns reload them.
set -euo pipefail

usage() {
  cat <<EOF
Usage: ./install.sh [--no-prefix] [-h|--help]

Symlinks wrangler's mods and layout into \${HERDR_APP_HOME:-~/.config/herdr-app}.
Safe to rerun: reruns reload them; anything else in the way is moved to <name>.bak-<time>.

  --no-prefix  skip the prefix mod (and remove our link to it if there is one)
  -h, --help   show this help
EOF
}

prefix=1
for a in "$@"; do
  case "$a" in
    --no-prefix) prefix=0 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "install.sh: unknown option $a" >&2; usage >&2; exit 2 ;;
  esac
done

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
stamp="$(date +%Y%m%d-%H%M%S)"
mods=(projects projects-ui my-spaces my-agents)
[ "$prefix" = 1 ] && mods+=(prefix)
layouts=(wrangler.json wrangler-preview.svg)

for c in herdr-app hc git jq claude; do
  command -v "$c" >/dev/null || echo "warning: $c not found on PATH" >&2
done

link() {
  local src="$1" dst="$2"
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
    touch -h "$dst"
    echo "reload  $dst"
    return
  fi
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    mv "$dst" "$dst.bak-$stamp"
    echo "backup  $dst.bak-$stamp"
  fi
  ln -s "$src" "$dst"
  echo "link    $dst -> $src"
}

mkdir -p "$home/mods" "$home/layouts"
for m in "${mods[@]}"; do link "$repo/mods/$m" "$home/mods/$m"; done
for l in "${layouts[@]}"; do link "$repo/layouts/$l" "$home/layouts/$l"; done
if [ "$prefix" = 0 ] && [ -L "$home/mods/prefix" ] && [ "$(readlink "$home/mods/prefix")" = "$repo/mods/prefix" ]; then
  rm "$home/mods/prefix"
  echo "remove  $home/mods/prefix"
fi

if command -v herdr-app >/dev/null; then
  for m in "${mods[@]}"; do herdr-app check "$home/mods/$m"; done
  herdr-app status || true
fi

cat <<EOF

Next:
  Switch to the layout: herdr-app do layout.switch '{"name":"wrangler"}' (or ctrl-shift-l)
  Suggested keys are in $repo/keys.json: merge the ones you want into $home/keys.json.
EOF
if [ "$prefix" = 1 ]; then
  cat <<EOF
  Bind the prefix in $home/keys.json:
    "global": { "ctrl-a": "mod.open:prefix" }
  ctrl-a then no longer reaches the shell as beginning-of-line; keys.json's
  "terminal": { "ctrl-alt-a": "send:\u0001" } sends it instead.
EOF
fi
