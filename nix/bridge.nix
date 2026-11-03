{ pkgs, workspace }:
pkgs.runCommand "redline" { nativeBuildInputs = [ pkgs.makeWrapper ]; } ''
  makeWrapper ${pkgs.lib.getExe pkgs.nodejs} $out/bin/redline \
    --add-flags ${workspace}/bridge/redline.mjs \
    --set-default REDLINE_EXTENSION ${workspace}/firefox
''
