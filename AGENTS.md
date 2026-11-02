# AGENTS.md

Guidance for coding agents working in this repository. Claude Code reads it through `@AGENTS.md`
in `CLAUDE.md`.

Redline is a browser extension to draw on a page and comment each mark, a bridge that hands the
result to Claude Code, and a `/redline` command that runs the review loop. See
[README.md](README.md) for what it does.

## Layout

| Path                             | What                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/shared`                | The contract: zod schemas of a round (`schema.ts`), the HTTP protocol (`protocol.ts`), bounding boxes            |
| `packages/bridge`                | `redline`: `wait` (a one-shot loopback server, `server.ts`), the round on disk (`writer.ts`), the CLI (`cli.ts`) |
| `packages/extension`             | WXT: `entrypoints/` (background, overlay content script, sidepanel), `src/` (the rest)                           |
| `packages/extension/src/state`   | Sessions: pure functions (`session.ts`), storage (`store.ts`), screenshots in IndexedDB (`images.ts`)            |
| `packages/extension/src/overlay` | The drawing layer: SVG in a shadow root                                                                          |
| `packages/extension/src/capture` | The annotated screenshot (OffscreenCanvas)                                                                       |
| `claude/`                        | The Claude Code plugin: `commands/redline.md` is `/redline`                                                      |
| `e2e-fixtures/`                  | A test page and its server                                                                                       |
| `nix/`                           | `workspace.nix` (yarn build + checks), `bridge.nix` (the `redline` wrapper)                                      |

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
- **Coordinates are the page's** (CSS px from the document's top left): the screenshot's, plus the
  scroll it was taken at. The writer turns them back into screenshot coordinates.
- **The overlay, the sidebar's preview and the composite draw the same shapes**: `src/geometry.ts`
  gives the paths and the badge's box to all three. Change it there, not in one of them. The
  composite is made when the round is sent; only the clean screenshot is stored. A badge's place
  is chosen once, by the overlay, from the screenshot's pixels (`src/badge-place.ts`), and stored
  with its mark (`badge`); without one, `badgeFor` puts it in the usual place.
- **A round is sent by the background** (`flush()`), from the session at the time it is sent, and
  sent again by the alarm, or by the sidebar once it sees a bridge, until one takes it.
- **The bridge takes one round and exits.** That exit is what wakes Claude (a background task).

## Rules

- **The round's format is `SCHEMA_VERSION` 2**: a freehand mark has `strokes` (the pen's strokes
  drawn 500 ms apart or less), not `points`.
- **Mark ids (`#n`) and snapshot ids (`Sn`) are never reused in a session.** Claude and the user
  refer to marks by id across rounds.
- **`packages/shared/src/schema.ts` is the contract.** A change there changes the writer
  (`renderFeedback`), the extension's `buildRound`, their tests, and `SCHEMA_VERSION` if it
  breaks older rounds.
- **The bridge listens on 127.0.0.1 only**, and refuses a request with a web page's `Origin` or
  another `Host`. Keep both checks.
- **Node runs the bridge's sources as they are** (type stripping): only erasable TypeScript there
  (no enums, no parameter properties), and imports with their `.ts` extension.
- The overlay's styles live in its shadow root (`src/overlay/style.ts`). Never style the page.
- Prettier (`.prettierrc.yml`): no semicolons, single quotes, width 160, sorted imports. Comments
  say why, in full sentences, like the code around them.

## Testing a change

1. `yarn test` and `yarn typecheck`.
2. `yarn build`, then the end-to-end tests of the browser concerned. They run the built
   extension (`.output/`), so build first. They start real browsers, which need Unix sockets: a
   sandbox that forbids them (Claude Code's) makes Chromium abort and geckodriver fail.
3. By hand, with the firefox-devtools MCP: serve `e2e-fixtures` (`node e2e-fixtures/serve.mjs`),
   run `redline wait --url http://127.0.0.1:47391/` in the background, `install_extension` with
   `packages/extension/.output/firefox-mv2` (`type: "path"`), then open the page: Redline starts
   on it by itself (`<redline-overlay>` in the page; nothing shows until a screenshot). `redline status` prints the sidebar's URL. Add
   `?url=http://127.0.0.1:47391/` to it to open it in a tab, following that page.

## Gotchas

- Firefox builds **MV2** (`.output/firefox-mv2`), Chrome **MV3** (`.output/chrome-mv3`). MV2 grants
  host permissions at install. Firefox's MV3 would leave them to the user.
- Reinstalling a temporary add-on loses its storage: the sessions, and the marks on the page.
- Firefox captures with `tabs.captureTab`, the tab itself, shown or not. Chrome has only
  `captureVisibleTab`, so there the tab must be the shown one (the end-to-end tests bring it to
  the front).
- After a change of `yarn.lock`: update the `hash` of `fetchYarnBerryDeps` in `nix/workspace.nix`
  (nix prints the one it got), and `nix/missing-hashes.json` if needed
  (`yarn-berry-fetcher missing-hashes yarn.lock`).
- TypeScript stays on 6: yarn's builtin patch of TypeScript fails on 7, the native one.
