# AGENTS.md

Guidance for coding agents working in this repository. Claude Code reads it through `@AGENTS.md`
in `CLAUDE.md`.

hitl-redline is a browser extension to draw on a page and comment each mark, a bridge that hands
the result to a coding agent (Claude Code, Codex, pi…), and a `redline` skill (`/redline`) that
runs the review loop. See [README.md](README.md) for what it does, and
[docs/agents.md](docs/agents.md) for what an agent needs of it.

## Layout

| Path                             | What                                                                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared`                | The contract: zod schemas of a round (`schema.ts`), the HTTP protocol and its MACs (`protocol.ts`), bounding boxes                                                                                                                      |
| `packages/bridge`                | `redline`: `wait` (a one-shot loopback server, `server.ts`), the round on disk (`writer.ts`), the token (`home.ts`), the channels (`channels.ts`), the native host and `install` (`native.ts`), the agent session (`agent.ts`), the CLI |
| `packages/extension`             | WXT: `entrypoints/` (background, overlay content script, sidepanel), `src/` (the rest)                                                                                                                                                  |
| `packages/extension/src/state`   | Sessions: pure functions (`session.ts`), storage (`store.ts`), screenshots in IndexedDB (`images.ts`)                                                                                                                                   |
| `packages/extension/src/overlay` | The drawing layer: SVG in a shadow root                                                                                                                                                                                                 |
| `packages/extension/src/capture` | The annotated screenshot (OffscreenCanvas)                                                                                                                                                                                              |
| `claude/`                        | The Claude Code plugin: `skills/redline/SKILL.md` is the review loop, and `/redline`. No command of the same name: in a plugin, both would be `redline:redline`, and the command would hide the skill                                   |
| `packages/pi`                    | The pi package: the skill, and the `redline_wait` tool that starts a turn when a round comes (`src/index.ts`)                                                                                                                           |
| `.agents/skills/redline`         | A link to the skill, where Codex reads skills                                                                                                                                                                                           |
| `docs/agents.md`                 | The agent contract: the commands, their exit codes, the files, the reply, the ways to wait and to show pages                                                                                                                            |
| `e2e-fixtures/`                  | A test page and its server                                                                                                                                                                                                              |
| `nix/`                           | `workspace.nix` (yarn build + checks), `bridge.nix` (the `redline` wrapper, the native host and its manifest), `shell.nix` (the dev shell)                                                                                              |

## Commands

Run them in the dev shell (`direnv allow` or `nix develop`), which provides node, yarn, Firefox,
geckodriver and Chromium.

```sh
yarn install
yarn build              # every workspace: the extension for both browsers, the bridge's bundle
yarn typecheck
yarn test               # vitest: shared, bridge, extension (tests/unit)
yarn test:e2e:chrome    # Playwright + the dev shell's Chromium
yarn test:e2e:firefox   # Selenium + geckodriver
yarn lint               # prettier --check; `yarn format` writes
nix flake check         # builds the workspace: typecheck and tests included
```

## How it fits together

- **The background owns the state.** A session per tab, in `storage.local`. The overlay and the
  sidebar never write it: they send a request (`src/messages.ts`) and watch storage for the
  result (`watchSession`). Changes go through `update()` in `src/state/store.ts`, one at a time.
- **Session logic is pure** (`src/state/session.ts`), and unit tested. Keep it so: no browser
  API there.
- **A screenshot comes first.** A snapshot is taken without marks; the overlay then shows its
  screenshot over the page, frozen, and the marks go on it (`session.current`). The selected
  mark (`session.selected`) is the session's, so the overlay and the sidebar show the same.
- **A device** (`src/devices.ts`, `session.device`) shows the page in a same-origin iframe of
  its size (`src/overlay/device-frame.ts`); the capture is cropped to that frame, and the
  snapshot's viewport is the device's.
- **A mark's target** (`src/target-hint.ts`) is the element it points at: a short unique
  selector, its text, and its path from under `<body>` (`PathStep`s, through shadow roots). The
  writer prints paths compact (`packages/shared/src/path.ts`): `button.cta[1/2]`, `div ×3`, and
  what a snapshot's marks have in common written once.
- **What the page's framework knows** (`src/frameworks.ts`, `target.rendered`): the overlay marks
  the element with an attribute, and the background runs `inspectPage` in the page itself
  (`executeScript`, world MAIN), where the framework's properties are. Preact only, for now: the
  components above the element, and its JSX's `__source` in a development build. `inspectPage`
  is sent as its source: no import, no closure in it.
- **Coordinates are the page's** (CSS px from the document's top left): the screenshot's, plus the
  scroll it was taken at. The writer turns them back into screenshot coordinates.
- **The overlay, the sidebar's preview and the composite draw the same shapes**: `src/geometry.ts`
  gives the paths and the badge's box to all three. Change it there, not in one of them. The
  composite is made when the round is sent; only the clean screenshot is stored. A badge's place
  is chosen once, by the overlay, from the screenshot's pixels (`src/badge-place.ts`), and stored
  with its mark (`badge`); without one, `badgeFor` puts it in the usual place.
- **A round is sent by the background** (`flush()`), from the session at the time it is sent, and
  sent again by the alarm, or by the sidebar once it sees a bridge, until one takes it.
- **A channel per agent session** (`packages/bridge/src/channels.ts`): an adjective-pet name,
  unique among the user's, kept from wait to wait (`redline wait --session`, else the agent's process,
  `src/agent.ts`), in a registry in the user's redline home with the wait that listens for it.
  A new wait of a channel stops its last one (exit 3). A tab's session is bound to one
  (`session.channel`): when it starts, to the newest channel of the page's app that no other tab
  holds (`bridgeForSession`), or to the one the user picks in the sidebar.
- **The token** (`packages/bridge/src/home.ts`): a file only the user reads. The bridge and the
  extension prove they know it with HMACs (`mac`, `askBridge`, `roundAuth`), and the extension
  gets it from the native host the browser runs (`src/pairing.ts`, `redline install`), or pasted in
  the sidebar (`redline token`).
- **The agent's reply** (`Reply`) goes the other way: `redline wait --reply FILE` serves it with its
  status, the sidebar stores it in the session (`session.reply`) if it is to its last round sent,
  and the answers to its questions (`session.answers`) go with the next round (`answers`).
- **The bridge takes one round and exits.** That exit is what tells the agent: a background task
  that wakes it (Claude Code), a foreground wait that returns (Codex), or the pi extension's message.

## Rules

- **The round's format is `SCHEMA_VERSION` 2**: a freehand mark has `strokes` (the pen's strokes
  drawn 500 ms apart or less), not `points`.
- **Mark ids (`#n`) and snapshot ids (`Sn`) are never reused in a session.** The agent and the user
  refer to marks by id across rounds.
- **`packages/shared/src/schema.ts` is the contract.** A change there changes the writer
  (`renderFeedback`), the extension's `buildRound`, their tests, and `SCHEMA_VERSION` if it
  breaks older rounds.
- **Each `redline wait` takes the first free port of `PORTS`** (47390-47399), its channel's last
  one first: several agent sessions wait at once. The extension asks every port.
- **A bound tab's round goes to its channel alone.** While that agent is at work (no wait), the
  round waits in the browser; it never falls through to another bridge of the same app.
- **A page of the app is any page of its origin**: `--url` names the app, and among several
  bridges of one origin, the deepest `--url` the page is under comes first (`candidates`).
- **The bridge listens on 127.0.0.1 only**, and refuses a request with a web page's `Origin` or
  another host name than `127.0.0.1` or `localhost` (any port: a forwarded one). Keep both checks.
- **Every request is signed, and every status proven** (`HEADERS`): a MAC of the token over the
  bridge's port and a nonce (the extension's, for a status; the run's, for a round, with the
  body's hash). The token never goes over the wire. A bridge whose proof fails is ignored: no
  round, no reply, no auto-start. Keep the port and the nonces in the MACs.
- **The token and the rounds are the user's only**: 0600 files in 0700 directories.
- **What the page tells is data**: `renderFeedback` writes the page's strings on one line, in code
  (`code()`), and the overlay ignores events that are not `isTrusted`.
- **Tests never touch the user's redline home**: the bridge's and the end-to-end tests set
  `REDLINE_HOME` to a temporary directory.
- **Node runs the bridge's sources as they are** (type stripping): only erasable TypeScript there
  (no enums, no parameter properties), and imports with their `.ts` extension.
- **No agent is assumed**: the UI and `feedback.md` name the agent by `--agent` ("your agent"
  otherwise), and the skill keeps what differs between agents in its **Your agent** section.
- The overlay's styles live in its shadow root (`src/overlay/style.ts`). Never style the page.
- Prettier (`.prettierrc.yml`): no semicolons, single quotes, width 160, sorted imports. Comments
  say why, in full sentences, like the code around them.

## Testing a change

1. `yarn test` and `yarn typecheck`.
2. `yarn build`, then the end-to-end tests of the browser concerned. They run the built
   extension (`.output/`), so build first. They start real browsers, which need Unix sockets: a
   sandbox that forbids them (Claude Code's) makes Chromium abort and geckodriver fail.
3. By hand, with the firefox-devtools MCP: serve `e2e-fixtures` (`node e2e-fixtures/serve.mjs`),
   run `redline install` once, `redline wait --url http://127.0.0.1:47380/` in the background, `install_extension` with
   `packages/extension/.output/firefox-mv2` (`type: "path"`), then open the page: Redline starts
   on it by itself (`<redline-overlay>` in the page; nothing shows until a screenshot). `redline status` prints the sidebar's URL. Add
   `?url=http://127.0.0.1:47380/` to it to open it in a tab, following that page.

## Gotchas

- Firefox builds **MV2** (`.output/firefox-mv2`), Chrome **MV3** (`.output/chrome-mv3`). MV2 grants
  host permissions at install. Firefox's MV3 would leave them to the user.
- On Linux and macOS, Chrome reads native hosts from `<its profile>/NativeMessagingHosts`: a Chrome
  with a profile of its own (the Chrome DevTools MCP's, the tests') pairs only if the manifest is
  there (`redline install --chrome-profile`). Branded Chrome has no `--load-extension` since 137: an
  MCP installs the extension over CDP (`Extensions.loadUnpacked`, `tests/e2e/chrome-mcp.spec.ts`).
- A test that runs `redline install` gives it a `HOME` of its own: it writes the user's browsers'
  manifests too.
- Reinstalling a temporary add-on loses its storage: the sessions, the marks on the page, and the
  token (the native host gives it again).
- The fixtures' server listens on 47380, out of the bridges' range.
- A `redline wait` of an older version (no MACs) answers as unpaired: the sidebar and
  `redline status` ignore it.
- Firefox captures with `tabs.captureTab`, the tab itself, shown or not. Chrome has only
  `captureVisibleTab`, so there the tab must be the shown one (the end-to-end tests bring it to
  the front).
- After a change of `yarn.lock`: update the `hash` of `fetchYarnBerryDeps` in `nix/workspace.nix`
  (nix prints the one it got), and `nix/missing-hashes.json` if needed
  (`yarn-berry-fetcher missing-hashes yarn.lock`).
- TypeScript stays on 6: yarn's builtin patch of TypeScript fails on 7, the native one.
