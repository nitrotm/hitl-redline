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
        pkgs = import nixpkgs { inherit system; };

        workspace = import ./nix/workspace.nix { inherit pkgs; };

        # the extension: its unpacked directories, firefox/ and chrome/, and redline.xpi
        redline-extension = pkgs.runCommand "redline-extension" { } ''
          mkdir $out
          ln -s ${workspace}/{firefox,chrome,redline.xpi} $out/
        '';

        # the bridge to Claude Code
        redline = import ./nix/bridge.nix { inherit pkgs workspace; };
      in
      {
        packages = {
          inherit redline redline-extension;

          default = redline;
        };
        checks = {
          inherit workspace;
        };

        devShells.default = import ./nix/shell.nix { inherit pkgs; };
      }
    );
}
