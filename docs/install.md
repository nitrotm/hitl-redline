# Install

The [quick start](../README.md#quick-start) has the shortest way, for Claude Code. Here is all of it.

## The bridge

### With Nix

This repository is a flake, `github:nitrotm/hitl-redline`. Its packages, for each system:

- `redline` (the default): `bin/redline`, which knows the extension of the same build
  (`redline extension-path`), and the native host's manifest for Firefox, in
  `lib/mozilla/native-messaging-hosts`.
- `redline-extension`: the extension, unpacked (`firefox/`, `chrome/`) and packed (`redline.xpi`).

To try it, or to put it in your profile:

```sh
nix run github:nitrotm/hitl-redline -- --help
nix profile install github:nitrotm/hitl-redline
nix build github:nitrotm/hitl-redline#redline-extension   # ./result/firefox, ./result/chrome, ./result/redline.xpi
```

In the flake of your NixOS or home-manager configuration, add it to the inputs:

```nix
{
  inputs.redline.url = "github:nitrotm/hitl-redline";
}
```

(or a release's tag, which never moves: `github:nitrotm/hitl-redline/v1.0.0`)

then use its package, `inputs.redline.packages.${pkgs.stdenv.hostPlatform.system}.redline`,
here `redline`:

```nix
# home-manager
home.packages = [ redline ];
programs.firefox.nativeMessagingHosts = [ redline ];

# or NixOS
environment.systemPackages = [ redline ];
programs.firefox.nativeMessagingHosts.packages = [ redline ];
```

With home-manager's Claude Code (`programs.claude-code`), the skill comes from the same input, so
it always matches its `redline`, and needs no `/plugin marketplace add`:

```nix
programs.claude-code = {
  enable = true;
  # the plugin is the input's claude/ directory: home-manager gives it to claude with --plugin-dir
  plugins = [ "${inputs.redline}/claude" ];
};
home.packages = [ redline ]; # the skill runs `redline` from PATH
programs.firefox.nativeMessagingHosts = [ redline ];
```

A browser MCP for the agent (see [The browser](#the-browser)) goes in the same place, in
`programs.claude-code.mcpServers`.

With the native host from the package, Firefox needs no `redline install`: the host makes your
token the first time the extension asks for it. Chrome and Chromium still need `redline install`
(the package has Firefox's manifest only); it leaves a manifest that is a link, such as
home-manager's, as it is. That command writes a host script with the store paths
of the `redline` that runs it: after an update, run it again, before a garbage collection takes
the old ones away.

The flake pins its own nixpkgs (the release it is built and tested with). With
`inputs.redline.inputs.nixpkgs.follows = "nixpkgs"`, it builds with yours instead, which shares
Node with the rest of your system, but is not what the tests ran on.

### Without Nix

On macOS, Windows or any Linux, with Node 22.18 or later. A [release](https://github.com/nitrotm/hitl-redline/releases)
has it built: `hitl-redline-X.Y.Z.tar.gz` unpacks to a `hitl-redline-X.Y.Z` that you use as the
clone below, without the build. Or build it:

```sh
git clone https://github.com/nitrotm/hitl-redline && cd hitl-redline
yarn install && yarn build
node packages/bridge/dist/redline.mjs --help
```

and put that `node …/redline.mjs` on your `PATH` as `redline`: an alias or a small script, or a
`redline.cmd` on Windows (`@node C:\path\to\hitl-redline\packages\bridge\dist\redline.mjs %*`).
`redline extension-path` finds the extension's build next to it, or `REDLINE_EXTENSION` names
another.

### Pairing

Then pair your browsers with you, once:

```sh
redline install
```

It makes your token (see [Security](security.md)) and installs the native messaging host that hands
it to the extension, for Firefox, and for Chrome and Chromium if they are there. With Nix, the
package can install Firefox's host instead (see [With Nix](#with-nix)). Where the browser cannot run a native host (Firefox as a Snap or a Flatpak without
the WebExtensions portal), the sidebar asks for the token: paste what `redline token` prints.

### The skill

Then the skill, for your agent:

- **Claude Code**: the skill is a plugin; this repository is its marketplace (with home-manager,
  see [With Nix](#with-nix) instead).

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
