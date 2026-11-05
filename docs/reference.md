# wrangler reference

The details behind the [README](../README.md).

## Commands

Every action is a `projects.*` command, usable in `keys.json` or with `herdr-app do <command>`.

| Command | Does |
|---|---|
| `projects.pick` | projects picker |
| `projects.compose[:id[\|where]]` | New agent dialog; `where` is `local` or `worktree` |
| `projects.switch` / `projects.switch-last` | agent switcher / flip to the previous agent without the popup |
| `projects.peek:terminal` / `projects.peek-go` / `projects.peek-close` | peek at a terminal over the window / go to the peeked one / close the peek |
| `projects.history[:query[\|messages]]` | past Claude conversations, searching `query` (`messages`: inside your messages; `@x`: the project picker filtered by `x`) |
| `projects.resume:<json>` | resume a conversation, `{"id", "cwd", "title"?, "home"?}`: `claude --resume` in a new tab of the space at `cwd`, or at `home` when `cwd` is gone |

Any command that opens a menu (`space-menu`, `row-menu`, `agent-menu`, `menu`, `new-menu`) takes an `@x,y` suffix (window px, e.g. `projects.agent-menu:t7@120,340`) and opens the menu there; the sidebar sends the click position.
| `projects.worktree[:id]` | new worktree dialog; no id: the focused space's repo |
| `projects.wt-create:id\|branch[\|base]` | make and open a worktree, no dialog; base `HEAD` or `<remote>/<branch>` |
| `projects.save[:id]` | save the focused space's layout to its project (or to `id`) |
| `projects.add[:folder]` / `projects.add-folder` | add the focused space (or `folder`) / pick a folder |
| `projects.open:id` / `projects.open-new:id` | open a project / always in a new space |
| `projects.menu:id` | a project's menu (also right-click a project in the `+` menu): Open, Open new space anyway, Open in new worktree, Save layout here, Clear layout, Remove project |
| `projects.clear:id` / `projects.remove:id` | drop a project's saved layout / remove the project |
| `projects.new-menu` | the new space / project menu (the + on the sidebar's Spaces header) |
| `projects.agent-start:<json>` | start an agent with no dialog (below) |
| `projects.branch-name:id\|prompt[\|model[\|timeout]]` | show the branch name the hook would pick for a prompt |
| `projects.refresh[:folder]` | reread the cached git checkouts in `folder` (all without one); the rename hook runs it |

```
projects.agent-start:{"id":"myapp","where":"worktree","base":"origin/main","branch":"","agent":"claude","prompt":"fix the login bug"}
```

`agent` is an agent key from Herdr's programs, or `"none"`. `prompt` is optional and becomes the agent's first message.

Bind commands rather than `mod.open:projects-ui`: an overlay opened by a closing overlay doesn't show.

## projects.json

`~/.config/herdr-app/data/projects/projects.json`. Watched, so edits apply at once (the Agents list rereads it every 30 s).

### settings

| Field | Default | What it does |
|---|---|---|
| `worktreeRoot` | `~/.herdr/worktrees` | Worktrees go to `<worktreeRoot>/<repo>/<branch>` (slashes in the branch become dashes). |
| `branchPrefix` | `wr` | Temp branches are `<branchPrefix>/<8 hex>`. |
| `remote` | `origin` | The remote whose branches are offered as bases and fetched. |
| `naming.enabled` | `true` | `false` turns automatic branch names off. |
| `naming.model` | `haiku` | The Claude model that names branches. |

### projects

| Field | What it does |
|---|---|
| `id` | The key used by `projects.*` commands. Made from the folder name. |
| `name` | Shown in menus, the picker and agent rows. |
| `folder` | The repo or folder the project opens (`~` allowed). |
| `machine` | A Herdr machine name for a project on another machine; `null` is this computer. |
| `defaultBase` | The base a new worktree defaults to: `HEAD` or `<remote>/<branch>`. Set from `origin/HEAD` when added. |
| `worktreeRoot`, `branchPrefix`, `remote` | Per-project overrides of `settings`. |
| `layout` | The tabs the project opens with, set by Save layout; `null` opens one shell (or only the agent, from New agent). Each tab is `{ name, root }`; a root is `{ "pane": { "argv": [...] or null, "cwd": "." } }`, `{ "pane": { "mod": ..., "props": ... } }` or `{ "split": "row" or "column", "children": [...] }` with optional `weight`s. |

## Prefix

The prefix opens on whatever key you bind to `mod.open:prefix`. The next key runs its action.

### config.json

`~/.config/herdr-app/data/prefix/config.json`, read on every open:

```json
{
  "show": "side",
  "defaults": true,
  "groups": [{ "title": "Git", "after": "Panes", "items": [{ "show": "⇧G", "label": "lazygit", "bind": { "shift-g": "mod.open:popup-lazygit" } }] }],
  "mods": { "projects": { "shift-a": null, "a": "projects.compose" } }
}
```

| Field | What it does |
|---|---|
| `show` | `side` (panel bottom right, default), `top` (wide grid at the top), `hint` (a small tag with your prefix key) or `off` (nothing shown; keys still work). |
| `defaults` | `false` drops Herdr's command groups ([`mods/prefix/defaults.json`](../mods/prefix/defaults.json)). |
| `groups` | Your own groups. A group with an existing title replaces it (empty `items` hides it). A new one goes after the group named in `after`, else last. |
| `mods` | Per mod folder: rebind (`"a": "projects.compose"` moves that action to `a`) or hide (`null`) that mod's prefix keys. |

A key bound twice goes to `groups` first, then the defaults, then mods. Items that open a mod that isn't installed are left out.

### A mod's prefix.json

Any installed mod can add a group with `mods/<name>/prefix.json` (wrangler's is [`mods/projects/prefix.json`](../mods/projects/prefix.json)). Mods with the same title share one group.

```json
{ "title": "Popups", "items": [
  { "show": "⇧G", "label": "lazygit", "bind": { "shift-g": "mod.open:popup-lazygit" } },
  { "show": "t", "label": "Shell", "run": "mod.open:popup-shell" }
] }
```

`show` is the keycap text, `bind` maps keys to `keys.json` actions, a lone `run` binds `show` itself.

## History

`projects.history` (the clock on the Agents header, prefix `r`) lists past Claude conversations, newest first: interactive ones only (not `claude -p` or SDK runs), not ones running now, and not under a folder in `data/projects/history-ignore`.

- Typing searches titles, last prompt, folder and branch: every word must match, ignoring case, spaces and punctuation, and a word's letters in order in the title also count. Best matches first, then newest. ⌃↵ searches inside your own messages instead (slower: it reads whole transcripts).
- Project chips: All, Other (outside every project), the focused space's project, then your recent picks; "N more" or `@` lists every project. A project includes its worktrees, deleted ones too. Tab cycles the chips.
- ↵ resumes. A conversation whose folder is gone opens in its project's folder (else `~`); Claude finds it from any folder.

`mods/projects/history.sh` does the reading: it keeps one line per transcript in `data/projects/history.tsv` and on each run reads only transcripts that changed since (their last 64 KiB), so a search takes tens of milliseconds after the first run.

## Branch renaming

1. New agent with New worktree and an empty Branch creates `<branchPrefix>/<8 hex>` and marks it in git config (`branch.<name>.wranglerTemp`).
2. Claude started by wrangler gets `--settings ~/.config/herdr-app/data/projects/claude-settings.json` (generated on the first launch). It adds a `UserPromptSubmit` hook running [`mods/projects/hooks/rename-branch.sh`](../mods/projects/hooks/rename-branch.sh). Your own Claude settings are not touched, and `claude` started by hand never renames.
3. On the first real prompt (not empty, not a `/command`) on a marked branch, the hook returns at once and, in the background, asks the naming model for `<type>/<slug>`, adds `-2`, `-3` on a clash, runs `git branch -m`, clears the mark, and renames the space if it still has its default name (in the window whose data folder it was given). A reply that is the prompt's own `type` or `slug` placeholder counts as a failure. The folder stays where it is. If naming fails, the temp name stays.

The prompt is [`mods/projects/naming-prompt.txt`](../mods/projects/naming-prompt.txt), or `data/projects/naming-prompt.txt` when that exists. If the hook is missing or not executable, wrangler shows a toast and launches Claude without it.

## Files written

- `~/.config/herdr-app/data/projects/projects.json`: your projects.
- `~/.config/herdr-app/data/projects/claude-settings.json`: generated, points at this clone's hook.
- `~/.config/herdr-app/data/projects/history.tsv`: the history's cache of Claude transcripts (safe to delete).
- `<worktreeRoot>/<repo>/<branch>`: worktrees.
- `${XDG_STATE_HOME:-~/.local/state}/wrangler/rename.log`: hook failures; `locks/` beside it holds once-per-worktree markers, pruned after 30 days.
- Herdr's per-mod storage: the switcher's focus history, the Agents list's pins.

## What it runs

`git` (including `git fetch` for a remote base), `claude -p` for branch names (network), `hc` (background reads), `herdr-app` (from the hook, to rename spaces) and small shell helpers (`sh`, `readlink`, `mkdir`, `test`, `sleep`; for the history `ls`, `tail`, `awk`, `grep`, `sort`, `xargs`, reading `~/.claude`).

## Layout

[`layouts/wrangler.json`](../layouts/wrangler.json) is a copy of Herdr's `main` layout (0.1.7) with `my-spaces` and `my-agents` in the sidebar and a hidden 0px `projects` block that runs the commands. Don't add a second, visible `projects` block: commands would run twice. The edits in `my-spaces` and `my-agents` are marked `// personal:` so they can be reapplied to newer Herdr versions.
