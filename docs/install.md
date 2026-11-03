# Install

The [quick start](../README.md#quick-start) has the shortest way, for Claude Code. Here is all of it.

## The bridge

With Nix:

```sh
nix build github:nitrotm/hitl-redline#redline            # bin/redline, which knows the extension of the same build
nix build github:nitrotm/hitl-redline#redline-extension  # firefox/, chrome/, redline.xpi
```

Or add `packages.<system>.redline` of this flake (`github:nitrotm/hitl-redline`) to your
home-manager packages.

Without Nix (macOS, Windows, any Linux), with Node 22.18 or later:

```sh
git clone https://github.com/nitrotm/hitl-redline && cd hitl-redline
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

It makes your token (see [Security](security.md)) and installs the native messaging host that hands
it to the extension, for Firefox, and for Chrome and Chromium if they are there. With home-manager,
`programs.firefox.nativeMessagingHosts = [ redline ]` installs the host instead (the package has
its manifest). Where the browser cannot run a native host (Firefox as a Snap or a Flatpak without
the WebExtensions portal), the sidebar asks for the token: paste what `redline token` prints.

Then the skill, for your agent:

- **Claude Code**: the skill is a plugin; this repository is its marketplace.

  ```
  /plugin marketplace add nitrotm/hitl-redline
  /plugin install redline@redline
  ```

- **Codex**: it reads the skill from `.agents/skills` in this repository already; for your other
  projects, `redline install --skills` links it into `~/.agents/skills`.
- **pi**: `pi install /path/to/hitl-redline/packages/pi`, in a clone of this repository: the skill,
  and the `redline_wait` tool.
- **Another agent**: [agents.md](agents.md) has what it needs.

## The browser

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

## With an agent's sandbox

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
