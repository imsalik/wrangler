# wrangler

Projects, git worktrees and coding agents for the [Herdr](https://herdr.dev) desktop app. Save a repo as a project, open it with its saved tabs and splits, start an agent in it or in a fresh worktree, and jump between agents from a switcher.

![wrangler](preview.gif)

## Features

- **Projects.** Save a repo or folder as a project. Opening it selects its space, or makes a new one with the project's saved layout (tabs, splits, programs).
- **Worktrees.** Make a worktree from the current HEAD or any remote branch, opened with the project's layout. Worktree spaces sit under their project in the Spaces list, even when the main checkout isn't open.
- **New agent dialog.** Pick a project, this folder or a new worktree, and any agent Herdr finds installed (Claude, Codex, OpenCode, ...).
- **Auto-named branches.** A worktree started without a branch name gets a temp branch. Claude's first prompt names it (`feat/...`, `fix/...`) and renames the space.
- **Agent switcher.** Every agent and sub-agent, the ones that need you first, then most recently used, with a live preview of the selected agent's screen.
- **Agents list.** Rows show the project, Claude's current task and the branch. Right-click to copy the branch or path, or delete the worktree.
- **Prefix keys (optional).** A which-key style prefix: press it, then one key. Every key shows in a panel while it waits.

## Requirements

- **Herdr desktop app** 0.1.11 or newer, with `herdr-app` and `hc` on your PATH.
- **git** 2.31 or newer.
- **Claude Code** (`claude`), optional: only for automatic branch names (uses the `haiku` model with your Claude login).
- **jq** and **bash**, for the branch-name hook.
- **OS:** built and used on Linux. macOS should work but is untested. Windows is not supported.

## Install

```sh
git clone https://github.com/imsalik/wrangler ~/code/wrangler
cd ~/code/wrangler
./install.sh                 # or: ./install.sh --no-prefix
herdr-app do layout.switch '{"name":"wrangler"}'
```

`install.sh` symlinks the mods and the layout into `~/.config/herdr-app` (or `$HERDR_APP_HOME`), backs up anything in the way as `<name>.bak-<time>`, checks each mod and prints the next steps. It warns about missing programs. Rerun it any time to reload, and after moving the clone.

Keep the clone where it is: the mods are symlinks into it, and the branch-name hook is found through them.

`ctrl-shift-l` switches layouts, so you can go back to yours at any time.

### Keys

`install.sh` never edits your `keys.json`. The suggested bindings are in this repo's [`keys.json`](keys.json); copy the ones you want into `~/.config/herdr-app/keys.json`:

| Key | Does |
|---|---|
| `ctrl-a` | prefix (then one key, see below) |
| `ctrl-shift-j` | projects picker |
| `ctrl-shift-g` | New agent |
| `ctrl-shift-a` | agent switcher |
| `ctrl-alt-a` (in a terminal) | sends a real `ctrl-a`, since the prefix takes it |

**Prefix on or off.** The prefix is just a binding: any key mapped to `mod.open:prefix` opens it, and the panel's label follows your key. Pick another key (`"ctrl-space": "mod.open:prefix"`) to keep `ctrl-a` for your shell, or don't bind it at all to turn it off. `./install.sh --no-prefix` leaves the prefix mod out entirely; everything else works through the plain keys or commands.

## Usage

### Add a project

- Spaces header **+** > **Add project...** (pick a folder) or **Add current space as project**.
- Right-click a space > **Add as project**.
- The projects picker has the same two rows at the bottom.

A project is named after its folder. New worktrees default to the repo's `origin/HEAD` (else `origin/main`).

### Open a project

Spaces header **+** and click it, or the projects picker (prefix `⇧O`): type to filter, Enter opens. If a space is already open at that repo it's selected; otherwise a new space opens with the project's layout, or a single shell.

**Save a layout:** arrange a space, then prefix `⇧S` (or **+** > Save this space's layout). Shells are saved as shells, other programs with their command line, folders relative to the repo.

### New worktree

Prefix `g` (focused space's repo), the branch icon on a project in the **+** menu, Tab in the projects picker, or right-click a space > **New worktree**.

Pick a **Branch** and a **From** (Current HEAD, or remote branches newest first). Remote bases are fetched first. Worktrees go to `~/.herdr/worktrees/<repo>/<branch>` (configurable).

### Start an agent

Agents header **+**, or prefix `⇧A`.

- **Project:** defaults to the focused space's project.
- **Where:** **This folder** (a new tab in the project's space) or **New worktree** (adds Branch and From).
- **Agent:** any agent Herdr knows that's installed.
- **Open** starts it.

Leave Branch empty and the worktree gets a temp branch `wr/<8 hex>`; Claude's first prompt renames it to something like `fix/login-redirect` and renames the space to match. Other agents keep the temp name.

Dialog keys: Tab / ⇧Tab move between fields, ↓ or Space opens a dropdown (type to filter), Enter picks or starts, Esc closes.

### Switch agents

Prefix `a`. It opens on your previous agent, so prefix `a` then Enter flips between two. Type to filter, ↑↓ or ctrl-j/k to move, 1-9 to jump, Enter to go, ⇧Enter to peek, ctrl-o to hide the preview, Esc to close.

### Right-click menus

- **Space:** Rename, New worktree (or New worktree from this branch), Open / Remove worktree, Close, and Add as project when it isn't one.
- **Agent row:** Copy branch, Copy path and, in a worktree, **Delete worktree...** (closes its spaces and terminals, removes the worktree, keeps the branch; uncommitted changes need an explicit Force delete).

### Prefix keys

| Key | Does |
|---|---|
| `a` | agent switcher |
| `⇧O` | projects picker |
| `⇧A` | New agent |
| `g` | new worktree |
| `⇧S` | save layout to the project |

Plus Herdr's own commands: Tabs (`c` new, `n`/`p`, `1`-`9`, `,` rename, `⇧X` close), Panes (`;` `"` split, `hjkl` focus, `z` zoom, `x` close), Spaces (`o` picker, `⇧N` new, `⇧W` rename, `⇧D` close), App (`b` sidebar, `s` settings, `?` all keys). Esc or any other key cancels.

## Configuration

All optional. Files live in `~/.config/herdr-app/data/`.

**`projects/projects.json`**: your projects, hand-editable and watched. Top-level `settings` apply to all projects; a project can override `worktreeRoot`, `branchPrefix` and `remote`.

```json
{
  "version": 1,
  "settings": {
    "worktreeRoot": "~/.herdr/worktrees",
    "branchPrefix": "wr",
    "remote": "origin",
    "naming": { "enabled": true, "model": "haiku" }
  },
  "projects": [
    { "id": "myapp", "name": "myapp", "folder": "~/code/myapp", "defaultBase": "origin/main" }
  ]
}
```

- `naming.enabled: false` turns automatic branch names off.
- `projects/naming-prompt.txt`: your own naming prompt, used instead of [`mods/projects/naming-prompt.txt`](mods/projects/naming-prompt.txt). Names must look like `<type>/<slug>`.

**`prefix/config.json`**: the prefix panel.

```json
{ "show": "side" }
```

`show` is `side` (panel bottom right, default), `top` (wide grid), `hint` (a small tag only) or `off` (nothing shown, keys still work). You can also add your own groups, drop Herdr's defaults, and rebind or hide wrangler's keys: see [docs/reference.md](docs/reference.md#prefix).

Full details (every field, all `projects.*` commands, how branch renaming works, files written): **[docs/reference.md](docs/reference.md)**.

## Uninstall

```sh
cd ~/.config/herdr-app
rm mods/projects mods/projects-ui mods/my-spaces mods/my-agents mods/prefix
rm layouts/wrangler.json layouts/wrangler-preview.svg
```

Switch to another layout first (`ctrl-shift-l`), restore any `*.bak-*` the installer made, and remove wrangler's lines from `keys.json`. Optionally delete `data/projects/`, `data/prefix/` and `~/.local/state/wrangler/`. Worktrees are plain git worktrees: remove them with `git worktree remove`.

## Limitations

- The project menu (Open in new space anyway, Clear layout, Remove project) has no button yet: use `herdr-app do projects.menu:<id>` or edit `projects.json`.
- Branch renaming is Claude only, and only for projects on this computer.
- `my-spaces` and `my-agents` are copies of Herdr's `spaces` (0.1.10) and `agents` (0.1.7) mods, so they don't get Herdr's later changes to those.
- Saving a layout reads Herdr's internal document through `hc connect`, which is undocumented and may change.
- Herdr doesn't watch symlink targets: after editing files in the clone, rerun `./install.sh` to reload.

## License

MIT. See [LICENSE](LICENSE).
