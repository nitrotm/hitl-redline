{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        inherit (nixpkgs) lib;

        pkgs = import nixpkgs { inherit system; };

        # the yarn workspaces, checked and built: the extension for Firefox and Chrome
        # (packages/extension) and the bridge's bundle (packages/bridge)
        workspace = import ./nix/workspace.nix { inherit pkgs; };
        # the extension: its unpacked directories, firefox/ and chrome/, and redline.xpi
        redline-extension = pkgs.runCommand "redline-extension" { } ''
          mkdir $out
          ln -s ${workspace}/{firefox,chrome,redline.xpi} $out/
        '';
        # the bridge to Claude Code: `redline wait`, which knows the extension above
        # (`redline extension-path`)
        redline = import ./nix/bridge.nix { inherit pkgs workspace; };

        # the dev shell's redline: the sources of packages/bridge, run as they are, so an
        # edit applies at once, without a build; the extension is the one `yarn build` made
        redline-dev = pkgs.writeShellScriptBin "redline" ''
          root=$(${lib.getExe pkgs.gitMinimal} rev-parse --show-toplevel) || exit
          export REDLINE_EXTENSION=''${REDLINE_EXTENSION:-$root/packages/extension/.output/firefox-mv2}
          exec ${lib.getExe pkgs.nodejs} "$root/packages/bridge/src/cli.ts" "$@"
        '';
      in
      {
        packages = {
          inherit redline redline-extension;
          default = redline;
        };
        checks = {
          # its build checks it: tsc and vitest
          inherit workspace;
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            gitFull
            # the workspaces: yarn install, build, dev (WXT's watch), test
            nodejs
            yarn-berry_4
            # `redline wait` and the rest, from the sources
            redline-dev
            # the Firefox end-to-end tests (Selenium), and web-ext lint
            firefox
            geckodriver
            web-ext
            # the Chrome end-to-end tests (Playwright): Chromium still loads an unpacked
            # extension (--load-extension), which Google Chrome no longer does
            ungoogled-chromium
          ];
          env = {
            # Playwright drives the Chromium above, and never downloads its own
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
            CHROMIUM_PATH = lib.getExe pkgs.ungoogled-chromium;
            FIREFOX_PATH = lib.getExe pkgs.firefox;
          };
        };
      }
    );
}
