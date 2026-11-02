# redline, the bridge to Claude Code: the bundle of packages/bridge run by node, with the
# extension of the same build (`redline extension-path`, for the MCP's install_extension).
{ pkgs, workspace }:
pkgs.runCommand "redline" { nativeBuildInputs = [ pkgs.makeWrapper ]; } ''
  makeWrapper ${pkgs.lib.getExe pkgs.nodejs} $out/bin/redline \
    --add-flags ${workspace}/bridge/redline.mjs \
    --set-default REDLINE_EXTENSION ${workspace}/firefox
''
