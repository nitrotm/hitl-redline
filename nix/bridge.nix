{ pkgs, workspace }:
let
  inherit (pkgs) lib;
  node = lib.getExe pkgs.nodejs;

  # the native messaging host's manifest, which hands the extension the user's token: in
  # lib/mozilla/native-messaging-hosts, for home-manager's programs.firefox.nativeMessagingHosts
  # (`redline install` writes the same, elsewhere, without Nix)
  manifest = builtins.toJSON {
    name = "redline_bridge";
    description = "Redline: hands the extension the user's token, which `redline wait` checks";
    path = "@out@/libexec/redline-native-host";
    type = "stdio";
    allowed_extensions = [ "redline@tmsrv.org" ];
  };
in
pkgs.runCommand "redline"
  {
    nativeBuildInputs = [ pkgs.makeWrapper ];
    meta.mainProgram = "redline";
  }
  ''
    makeWrapper ${node} $out/bin/redline \
      --add-flags ${workspace}/bridge/redline.mjs \
      --set-default REDLINE_EXTENSION ${workspace}/firefox \
      --set-default REDLINE_EXTENSION_CHROME ${workspace}/chrome \
      --set-default REDLINE_SKILL ${workspace}/skills/redline
    makeWrapper ${node} $out/libexec/redline-native-host \
      --add-flags "${workspace}/bridge/redline.mjs native-host"
    mkdir -p $out/lib/mozilla/native-messaging-hosts
    substitute ${pkgs.writeText "redline_bridge.json" manifest} $out/lib/mozilla/native-messaging-hosts/redline_bridge.json \
      --subst-var out
  ''
