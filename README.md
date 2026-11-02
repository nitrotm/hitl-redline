# Redline

Draw on the page you are building, comment each mark, and send the screenshots to Claude Code.

```
/redline ──▶ Claude opens the preview in Firefox, and waits
                │
                ▼
   you take a screenshot: the page freezes under it
   you draw on it:  ▭ rectangles  ➚ arrows  ✎ freehand marks   each one numbered #1, #2…
   you write a comment per mark, as you draw it
   … as many screenshots as you need
                │  Send to Claude
                ▼
   Claude reads .redline/rounds/NNN/, changes the code, reloads the page, and waits again
                │
                └──▶ … until you click Done
```

It has three parts:

- **The extension** (`packages/extension`), for Firefox, and for Chrome too. It draws on the page,
  lists the marks in the sidebar, captures snapshots, and sends each round.
- **The bridge** (`packages/bridge`), `redline`: `redline wait` listens on `127.0.0.1:47390` for
  one round, writes it to `.redline/rounds/NNN/` in the project, prints the path of its
  `feedback.md`, and exits. Claude runs it in the background, so it is woken up when you send.
- **The `/redline` command** (`claude/`), a Claude Code plugin that runs the loop.

## Install

With Nix:

```sh
nix build .#redline            # bin/redline, which knows the extension of the same build
nix build .#redline-extension  # firefox/, chrome/, redline.xpi
```

Or add `packages.<system>.redline` of this flake to your home-manager packages.

The `/redline` command is a Claude Code plugin; this repository is its marketplace:

```
/plugin marketplace add /path/to/firefox-redline
/plugin install redline@redline
```

Firefox comes from the **firefox-devtools** MCP server: `/redline` installs the extension in
its profile as a temporary add-on, each time.

## Use

In a project, run `/redline` (or `/redline http://localhost:5173/`). Claude opens the preview,
and the Redline toolbar shows up on the page.

A screenshot comes first: <kbd>C</kbd>, or the toolbar's **Screenshot**. It covers the page,
frozen, and you draw on it. Each mark opens a comment box at once: type, <kbd>Enter</kbd>
saves. Double-click a mark to edit its comment again.

| Key                                                 | Tool                                                  |
| --------------------------------------------------- | ----------------------------------------------------- |
| <kbd>C</kbd>                                        | Take a screenshot (of the live page)                  |
| <kbd>1</kbd>                                        | Select: move a mark, or select it                     |
| <kbd>2</kbd>                                        | Rectangle                                             |
| <kbd>3</kbd>                                        | Arrow: press where it starts, release where it points |
| <kbd>4</kbd>                                        | Pen (freehand)                                        |
| <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> | Colors (and the selected mark's)                      |
| <kbd>Del</kbd>                                      | Delete the selected mark                              |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd>                        | Undo the last mark                                    |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>        | Turn Redline on or off on the tab                     |

The toolbar's ✕ leaves the screenshot, back to the live page; its grip moves it out of the way.

Click the Redline button of the browser's toolbar to open the sidebar. It lists the
screenshots of the round, and the marks of each with their comment:

- A mark selected in the sidebar is selected on the screenshot, and the other way round.
- **Annotate** (or a click on the preview) shows an earlier screenshot again, to mark more.
- Write a comment on the round as a whole, then **Send to Claude**, or **Done** to end the loop.

A round waits in the browser until Claude listens. The bar at the bottom of the sidebar tells
whether it does.

Each round lands in the project:

```
.redline/rounds/003/
├─ feedback.md          what Claude reads first: every mark by #id, its comment, its element
├─ feedback.json        all of it, with coordinates
├─ S1.annotated.png     the screenshot with the marks and their #id
└─ S1.clean.png         the same, without
```

Add `.redline/` to the project's `.gitignore` (`/redline` does).

Mark ids are never reused in a session: `#7` is the same mark in every snapshot and every round.

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

To try it by hand: `node e2e-fixtures/serve.mjs` serves a test page on `http://127.0.0.1:47391/`,
and `redline wait --url http://127.0.0.1:47391/` makes Redline start there by itself.

See [AGENTS.md](AGENTS.md) for how the code is laid out.

## Browsers

Firefox first: it builds as Manifest V2, with a sidebar. Chrome builds as Manifest V3, with a side
panel, from the same sources (`yarn dev:chrome` in `packages/extension`).
