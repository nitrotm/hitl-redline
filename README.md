# hitl-redline

Draw on the page you are building, comment each mark, and send the screenshots to your coding
agent: Claude Code, Codex, pi, or another ([docs/agents.md](docs/agents.md)).

```
/redline ──▶ your agent opens the preview in the browser, and waits
                │
                ▼
   you take a screenshot: the page freezes under it
   you draw on it:  ▭ rectangles  ➚ arrows  ✎ freehand marks   each one numbered #1, #2…
   you write a comment per mark, as you draw it
   … as many screenshots as you need
                │  Send
                ▼
   the agent reads .redline/rounds/NNN/, changes the code, reloads the page, and waits again
                │
                └──▶ … until you click Done
```

It has three parts:

- **The extension** (`packages/extension`), for Firefox, and for Chrome too. It draws on the page,
  lists the marks in the sidebar, captures snapshots, and sends each round.
- **The bridge** (`packages/bridge`), `redline`: `redline wait` listens on the loopback, on the first
  free port of 47390-47399 (one per agent session waiting), for one round, writes it to `.redline/rounds/NNN/` in the project, prints the path of its
  `feedback.md`, and exits: that exit is what tells the agent a round came.
- **The `redline` skill** (`claude/skills/redline`), an [Agent Skill](https://agentskills.io) that runs the loop: a continuous session, round after round,
  until you send one with nothing to change. The agent starts it on `/redline`, or by itself when you ask to review the page in the browser. It comes as a
  Claude Code plugin, as a skill for Codex, and in a pi package (`packages/pi`) with a tool that wakes pi when a round comes.

## Install

With Nix:

```sh
nix build .#redline            # bin/redline, which knows the extension of the same build
nix build .#redline-extension  # firefox/, chrome/, redline.xpi
```

Or add `packages.<system>.redline` of this flake to your home-manager packages.

Without Nix (macOS, Windows, any Linux), with Node 22.18 or later:

```sh
yarn install && yarn build
node packages/bridge/dist/redline.mjs --help
```

and put that `node …/redline.mjs` on your `PATH` as `redline`: an alias or a small script, or a
`redline.cmd` on Windows (`@node C:\path\to\hitl-redline\packages\bridge\dist\redline.mjs %*`).
`redline extension-path` finds the extension's build next to it, or `REDLINE_EXTENSION` names
another.

Then pair your browsers with you, once:

```sh
redline install
```

It makes your token (see [Security](#security)) and installs the native messaging host that hands
it to the extension, for Firefox, and for Chrome and Chromium if they are there. With home-manager,
`programs.firefox.nativeMessagingHosts = [ redline ]` installs the host instead (the package has
its manifest). Where the browser cannot run a native host (Firefox as a Snap or a Flatpak without
the WebExtensions portal), the sidebar asks for the token: paste what `redline token` prints.

Then the skill, for your agent:

- **Claude Code**: the skill is a plugin; this repository is its marketplace.

  ```
  /plugin marketplace add /path/to/hitl-redline
  /plugin install redline@redline
  ```

- **Codex**: it reads the skill from `.agents/skills` in this repository already; for your other
  projects, `redline install --skills` links it into `~/.agents/skills`.
- **pi**: `pi install /path/to/hitl-redline/packages/pi`: the skill, and the `redline_wait` tool.
- **Another agent**: [docs/agents.md](docs/agents.md) has what it needs.

### The browser

- **With the firefox-devtools MCP** (Claude Code, Codex): the agent installs the extension in the
  MCP's Firefox as a temporary add-on, at each review, and opens and reloads the pages itself.
- **With the Chrome DevTools MCP** (Claude Code, Codex; [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)):
  the same in Chrome. Its extension tools are off by default, and it reads files only under its
  roots: give it both, the root being the directory of `redline extension-path chrome`.

  ```sh
  claude mcp add chrome-devtools -- npx chrome-devtools-mcp@1.11.0 --categoryExtensions \
    --filesystemRoot="$(dirname "$(redline extension-path chrome)")"
  ```

  (in Codex, the same command and arguments under `[mcp_servers.chrome-devtools]` in
  `~/.codex/config.toml`). Its Chrome has a profile of its own
  (`~/.cache/chrome-devtools-mcp/chrome-profile`), where Chrome looks for the native host on Linux
  and macOS: run `redline install` once that Chrome has run, and it pairs it too
  (`--chrome-profile DIR` for one started with `--userDataDir`; with `--isolated`, a new profile
  each time, paste the token in the sidebar instead). Pin Redline's button from Chrome's puzzle
  menu: it opens the side panel.

- **Without it** (pi, or any agent without a browser MCP), install the extension in your own
  browser, once, then run `redline install` if not done yet:
  - **Firefox**: a release Firefox installs signed add-ons only. Sign `redline.xpi` (of
    `nix build .#redline-extension`, or `packages/extension/.output/firefox-mv2` zipped) for
    yourself with `web-ext sign --channel unlisted` and an [AMO](https://addons.mozilla.org)
    account, then open the signed file in Firefox. Firefox Developer Edition and Nightly also
    take it unsigned, with `xpinstall.signatures.required` set to `false` in `about:config`.
  - **Chrome, Chromium**: `chrome://extensions`, **Developer mode**, **Load unpacked**, and the
    `chrome/` directory (`packages/extension/.output/chrome-mv3`).

  The agent opens pages there with `redline open URL`, and has them reloaded after its changes
  with `redline wait --reload`.

### With an agent's sandbox

`redline wait` and `redline status` talk to the browser over the machine's loopback, and an
agent's sandbox stands in the way.

**Codex**: a sandboxed command may not listen on the loopback (`allow_local_binding` is off). The
skill has Codex run `redline` with escalated permissions; approving `redline` once spares the
question afterwards.

**Claude Code**:

- **Linux and WSL2**: a sandboxed command has a `localhost` of its own, which the browser does not
  reach. They must run outside the sandbox.
- **macOS**: the sandbox forbids listening on a port unless `sandbox.network.allowLocalBinding` is
  on, which lets every sandboxed command reach every service of your `localhost`, not only this one.
  Running `redline` outside the sandbox is the narrower choice there too.
- **Windows** (native): Claude Code has no sandbox there.

The skill runs them outside the sandbox. To spare the permission prompt each round, list them in
your Claude Code settings. The entries are matched like `Bash(…)` rules, so a bare `redline` would
match only `redline` with no arguments, and a call that chains another command stays sandboxed:

```json
{ "sandbox": { "excludedCommands": ["redline wait *", "redline status", "redline install"] } }
```

## Use

In a project, run `/redline` (or `/redline http://localhost:5173/`), or ask your agent to show
you the page. It opens the preview,
and Redline starts on it. Open the sidebar with the Redline button of the browser's toolbar: the
live page itself shows nothing of Redline.

A screenshot comes first: <kbd>Ctrl</kbd>+<kbd>S</kbd> on the page, or the sidebar's **Take a screenshot**. It covers the page,
frozen, and you draw on it. Each mark opens a comment box at once: type, <kbd>Enter</kbd>
saves. Double-click a mark or its number, whatever the tool, to edit its comment again: all of it selected, to type over it. The box's trash icon deletes the mark.

| Key                                                 | Tool                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| <kbd>Ctrl</kbd>+<kbd>S</kbd>                        | Take a screenshot of the live page; on a screenshot, back to the live page |
| <kbd>1</kbd>                                        | Select: move a mark, or select it                                          |
| <kbd>2</kbd>                                        | Rectangle                                                                  |
| <kbd>3</kbd>                                        | Arrow: press where it starts, release where it points                      |
| <kbd>4</kbd>                                        | Pen: strokes 500 ms apart or less make one mark; a click is a dot          |
| <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> | Colors (and the selected mark's)                                           |
| <kbd>Del</kbd>                                      | Delete the selected mark                                                   |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd>                        | Undo the last mark                                                         |
| <kbd>Ctrl</kbd>+<kbd>D</kbd>                        | Send to your agent; Done when there is nothing to send                     |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>        | Turn Redline on or off on the tab                                          |

The tools and colors go by their places on the keyboard, not their letters: the colors are the
row under the digits whatever the layout (A Z E R on AZERTY). While Redline is on,
<kbd>Ctrl</kbd>+<kbd>S</kbd> is its screenshot, not the browser's Save Page.

While a screenshot is shown, a toolbar on it has the tools, the colors, undo and delete. Its ✕
leaves the screenshot, back to the live page, where the next one is taken; its grip moves it out
of the way.

To see the responsive layouts, pick a device in the sidebar's dropdown before
the screenshot: Phone (iPhone 15, 393×852), Tablet (iPad Air, 820×1180), Laptop 14″ FHD
(1536×864) or Desktop 4K (2560×1440), in CSS pixels; `packages/extension/src/devices.ts` has
them. The page shows in a frame of that size, scaled down when the window is smaller, and the
screenshot is the frame's. The frame loads the page anew, and its pixel ratio is the window's,
scaled: a 4K layout on a smaller screen is captured smaller.

Click the Redline button of the browser's toolbar to open the sidebar. It lists the
screenshots of the round, and the marks of each with their comment:

- A mark selected in the sidebar is selected on the screenshot, and the other way round; clicked
  again, unselected. On the screenshot, a click on a mark selects it whatever the tool, and a drag
  moves it (a drawing tool catches a mark by its outline and its number, so a rectangle can still
  be drawn inside another).
- The marks of the screenshot being annotated have a trash icon, to delete them.
- A click on a screenshot's preview shows it on the page, to mark more; another click goes back to
  the live page.
- Write a comment on the round as a whole, then **Send**, or **Done** to end the loop.

The agent replies in the sidebar: what it did of each mark, and its questions, each with a field to
answer it. The answers go with the next round, which may hold only them.

A round waits in the browser until the agent listens. The bar at the bottom of the sidebar tells
whether it does, and which agent: its name, its channel's, and its project.

Each round lands in the project:

```
.redline/rounds/003/
├─ feedback.md          what the agent reads first: every mark by #id, its comment, its element
├─ feedback.json        all of it, with coordinates
├─ S1.annotated.png     the screenshot with the marks and their #id
└─ S1.clean.png         the same, without
```

Add `.redline/` to the project's `.gitignore` (`/redline` does).

Each `#id` badge goes where it hides the least: of the places around its mark, the one with the
least to see on the screenshot, and no other mark.

Each mark tells the agent where its element is: a CSS selector, its text, and its path in the page
(`main#app > section.hero > button.cta[1/2]`). On a Preact page in development, it also names the
components that rendered it and where its JSX is, so the agent goes straight to the source.

Mark ids are never reused in a session: `#7` is the same mark in every snapshot and every round.

### Several agent sessions at once

Each agent session, of whichever agent, reviews with you on a channel of its own, named like `sleepy-gecko`: in
different projects, in worktrees of one, or even in the same directory on the same dev server.
`redline wait` prints its channel's name, and the sidebar's bar shows it.

- A tab is bound to the channel of the agent that opened it (the one whose `redline wait` names
  the page's app, and that no other tab has yet). Its rounds go to that agent alone: while it is
  at work on the last round, the next one waits in the browser, never going to another agent.
- With several agents for the page's app, the bar has a menu to send the tab's rounds to another.
- A channel keeps its name from round to round (`redline wait --session`, which the skill gives
  Claude Code's session id; other agents' are found by their process), and a new wait of a channel stops its last one.
- Ten at once: the ten ports of 47390-47399.

## Security

Redline is meant to expose nothing of your machine. What it does, and what it relies on:

- **What listens**: a `redline wait` only, while an agent waits for a round, on 127.0.0.1 (never
  another interface) and a port of 47390-47399. It takes one round and exits.
- **Web pages cannot reach it**: it refuses a request that names another host than `127.0.0.1` or
  `localhost` (DNS rebinding), or that carries a web page's `Origin`, and it sends no CORS headers.
- **Other users and processes of the machine cannot either.** The loopback is everyone's on the
  machine, so the bridge and the extension prove to each other that they know your **token**: 32
  random bytes in a file only you can read (`~/.config/redline/token` on Linux, or under `$XDG_CONFIG_HOME`;
  `~/Library/Application Support/redline/token` on macOS, `%APPDATA%\redline\token` on Windows;
  `REDLINE_HOME` moves the directory). Each request carries an HMAC of it, bound to the bridge's
  port and to a random value of each run, and the token itself never goes over the wire. A process
  of another user can neither post a round to your agent nor read its status, and one that
  listens on a port of the range first gets nothing from your browser: no screenshot, no round.
  The browser gets the token from the native messaging host, which it runs as you
  (`redline install`), or from you, pasted in the sidebar.
- **What it writes**: `.redline/` in the project, readable by you only (0700 and 0600). The
  screenshots show what the page showed: keep `.redline/` out of git (`/redline` adds it to
  `.gitignore`).
- **The extension** has the permission of every site (`<all_urls>`), to capture whatever page you
  start it on. It runs on a page only when you start it there, or when a `redline wait` names the
  page's app. Install it in the browser the firefox-devtools MCP drives, a profile of its own, not
  the one of your everyday browsing: the agent drives that browser. Without an MCP, it is your
  own browser, where the extension does nothing until you start it, or a page of an app an agent
  waits for opens.
- **The app under review is trusted**: its pages run in the browser, and their text, selectors and
  components go to the agent. `feedback.md` writes them as data, on one line each, which a page cannot
  turn into instructions of its own. The overlay ignores the events that the page's scripts make
  up (a page could otherwise send a round with a synthetic Ctrl+D).
- **What remains**: root, and anyone who can read your files, can read the token. A process can
  still hold all ten ports, so that no `redline wait` can listen: a nuisance, not a leak.

## Platforms and networks

- **macOS, Linux, Windows**: the same, but for the paths above and the sandbox (see
  [With an agent's sandbox](#with-an-agents-sandbox)). `redline install` writes the native
  host's manifest where each browser looks for it (in the registry, on Windows).
- **WSL2**: with the agent, and the firefox-devtools MCP's Firefox (WSLg), in the same
  distribution, everything is on its loopback, as on Linux.
- **A firewall** that asks whether to let `node` accept connections: deny it. Redline needs none
  from the network.
- **A proxy**: browsers do not send `127.0.0.1` through one. Keep it so: Firefox's
  `network.proxy.allow_hijacking_localhost` would send the rounds through the proxy.
- **A VPN** does not change the loopback.
- **A port of 47390-47399 taken** by other software: each `redline wait` takes the next free one.
  The range is `PORTS`, in `packages/shared/src/protocol.ts`.
- **The agent on another host, or in a container**, with the browser here: forward the ports
  to this machine's loopback (`ssh -L 47390:127.0.0.1:47390 …` for each, or VS Code's port
  forwarding), and give both sides the same token (copy it, or point `REDLINE_HOME` at a mounted
  copy). Never make the bridge listen on another interface, nor publish its ports with
  `docker -p`: that is the network.

## Develop

```sh
direnv allow        # or: nix develop
yarn install
yarn dev            # WXT: builds the Firefox extension on each change, in packages/extension/.output/firefox-mv2
yarn build          # both browsers
yarn test           # unit tests and the bridge's
yarn test:e2e:chrome
yarn test:e2e:firefox
yarn lint
nix flake check     # the build of the flake, with the type check and the tests
```

In the dev shell, `redline` runs the bridge from its sources, and `redline extension-path`
points at `packages/extension/.output/firefox-mv2`.

To try it by hand: `node e2e-fixtures/serve.mjs` serves a test page on `http://127.0.0.1:47380/`,
and `redline wait --url http://127.0.0.1:47380/` makes Redline start there by itself.

See [AGENTS.md](AGENTS.md) for how the code is laid out.

## Browsers

Firefox first: it builds as Manifest V2, with a sidebar. Chrome builds as Manifest V3, with a side
panel, from the same sources (`yarn dev:chrome` in `packages/extension`).
