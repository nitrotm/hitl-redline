{ pkgs }:
let
  inherit (pkgs) lib;

  # the dev shell's redline: the sources of packages/bridge, run as they are, so an
  # edit applies at once, without a build; the extension is the one `yarn build` made
  redline-dev = pkgs.writeShellScriptBin "redline" ''
    root=$(${lib.getExe pkgs.gitMinimal} rev-parse --show-toplevel) || exit
    export REDLINE_EXTENSION=''${REDLINE_EXTENSION:-$root/packages/extension/.output/firefox-mv2}
    exec ${lib.getExe pkgs.nodejs} "$root/packages/bridge/src/cli.ts" "$@"
  '';
in
pkgs.mkShell {
  buildInputs = with pkgs; [
    gitFull
    nodejs
    yarn-berry_4
    redline-dev
    firefox
    geckodriver
    web-ext
    ungoogled-chromium
  ];
  env = {
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"; # Playwright drives the Chromium above, and never downloads its own
    CHROMIUM_PATH = lib.getExe pkgs.ungoogled-chromium;
    FIREFOX_PATH = lib.getExe pkgs.firefox;
  };
}
