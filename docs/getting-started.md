# Getting started

A walk through wrangler's main features, from your first project to running several agents side by side. For setup see the [README](../README.md#install); for every option see the [reference](reference.md).

Key names below assume the suggested [`keys.json`](../keys.json) bindings, with the prefix on `ctrl-a`.

## 1. Install and switch to the layout

```sh
git clone https://github.com/imsalik/wrangler
cd wrangler
cp -r mods/* ~/.config/herdr-app/mods/
cp layouts/* ~/.config/herdr-app/layouts/
herdr-app do layout.switch '{"name":"wrangler"}'
```

The sidebar now has two lists: **Spaces** on top, **Agents** below. Both have a **+** in their header.

## 2. Add a project

A project is a repo (or any folder) wrangler remembers: its layout, its default base branch, its worktrees.

Open a space in your repo, then right-click it and pick **Add as project**:

![Right-click a space, Add as project](images/add-as-project.png)

Or use the Spaces **+** menu: **Add project...** picks a folder, **Add current space as project** adds the one you're in. Once added, projects are listed in that menu with a colored badge:

![The Spaces + menu listing three projects](images/plus-menu.png)

Click a project to open it. Hover a project for an **x** that removes it from the list (after a confirm; your files, worktrees and branches stay). Right-click it for more: open in a new space, clear its saved layout. If a space is already open at that repo it's selected; otherwise a new one opens. `ctrl-shift-j` (or prefix `⇧O`) opens the same list as a picker you can type to filter.

**Save a layout.** Arrange a space the way you like (tabs, splits, an editor, a dev server), then pick **Save this space's layout to ...** from the **+** menu, or press prefix `⇧S`. Next time the project opens, it opens like that.

## 3. Make a worktree

A worktree is a second checkout of the same repo on its own branch, so you (or an agent) can work on it without touching your main checkout.

Press prefix `g`, click the branch icon next to a project in the **+** menu, or right-click a space and pick **New worktree**:

![New worktree dialog with a branch name and base](images/new-worktree.png)

Type a **Branch** and pick **From**: the current HEAD or any remote branch (fetched first). **Create** makes the worktree under `~/.herdr/worktrees/<repo>/` and opens it in a new space, nested under its project in the Spaces list.

## 4. Start an agent

Click **+** in the Agents header, or press `ctrl-shift-g` (prefix `⇧A`):

![New agent dialog: project, where, agent, branch, base](images/new-agent.png)

- **Project:** defaults to the one you're in.
- **Where:** **This folder** adds a tab to the project's space. **New worktree** gives the agent its own worktree.
- **Agent:** any coding agent Herdr finds installed (Claude, Codex, OpenCode, ...).
- **Branch:** leave it empty and wrangler makes a temporary one.

Press `/` to jump to the Project list and type to filter it. Press **Open**, then give the agent its first message in the new tab.

## 5. Branches name themselves

With an empty Branch, a new worktree starts on a temp name like `wr/5d81d828`. When you send Claude its first prompt, wrangler asks a small model for a fitting name, renames the branch and the space, and leaves the folder where it is:

![Before and after: temp wr/ branches renamed to docs/, chore/ and fix/ names](images/branch-rename.png)

Each Agents row shows the project, what the agent is working on, and its branch. This needs the `claude` CLI; turn it off with `"naming": { "enabled": false }` in the [settings](reference.md#settings).

The Agents list (Priority sort, the clock button in its header) keeps the agents waiting on you at the top: **Needs you** first, then **Done**, then **Idle**, each with how long ago it stopped ("3m ago"). **Working** agents sit at the bottom with how long they've been running; it shows three, then an "N more" row. Hover an idle agent for an **x** that quits it (ctrl-c until it exits). The pane stays, with a shell in the same folder.

![Agents list: Needs you, Done and Idle on top, Working at the bottom](images/agents-list.png)

## 6. Switch between agents

Press `ctrl-shift-a` (prefix `a`). Agents that need you come first, then the ones you used most recently. The right side previews the selected agent's screen, live:

![Agent switcher with a live preview](images/switcher.png)

Type to filter, `1`-`9` to jump, Enter to go there. It opens on your previous agent, so the key then Enter flips between your last two.

## 7. Clean up

Right-click an agent row to copy its branch or path, or to delete its worktree:

![Agent right-click menu: Copy branch, Copy path, Delete worktree](images/agent-menu.png)

**Delete worktree...** closes the worktree's spaces and terminals and removes the folder. The branch is kept, so nothing committed is lost. If there are uncommitted changes, you have to confirm with **Force delete**.

## 8. Prefix keys

Press the prefix (`ctrl-a` in the suggested keys) and a panel lists every key you can press next:

![Prefix panel listing tab, pane, space, app and project keys](images/prefix.png)

Press one to run it; Esc or any other key cancels. Don't want the panel? Set `"show": "hint"` or `"off"` in `data/prefix/config.json`. Don't want the prefix at all? Leave it unbound, or don't copy `mods/prefix`. See [Prefix](reference.md#prefix) to add your own groups or move keys.

## Next

- [Configuration](../README.md#configuration): worktree folder, branch prefix, remote, naming.
- [Reference](reference.md): every `projects.*` command, all settings, how renaming works, files written.
