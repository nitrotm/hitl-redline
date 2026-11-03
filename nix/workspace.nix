{ pkgs }:
let
  inherit (pkgs) lib;
  yarn = pkgs.yarn-berry_4;

  src = lib.cleanSourceWith {
    name = "redline-source";
    src = ../.;
    filter =
      path: type:
      let
        baseName = baseNameOf (toString path);
      in
      !(
        lib.elem baseName [
          ".git"
          ".direnv"
          ".redline"
          "result"
        ]
        || (
          type == "directory"
          && lib.elem baseName [
            "node_modules"
            "dist"
            ".output"
            ".wxt"
            ".yarn"
          ]
        )
      );
  };
in
pkgs.stdenv.mkDerivation (finalAttrs: {
  pname = "redline-workspace";
  # the release's, which scripts/version.mjs keeps the same in every package
  version = (lib.importJSON ../packages/bridge/package.json).version;
  inherit src;

  # yarn.lock's packages that carry no checksum of their own (yarn-berry-fetcher
  # missing-hashes yarn.lock > nix/missing-hashes.json)
  missingHashes = ./missing-hashes.json;
  offlineCache = yarn.fetchYarnBerryDeps {
    inherit (finalAttrs) src missingHashes;

    # after a change of yarn.lock: the hash nix says it got
    hash = "sha256-bMlF8Pdo7tDIVeqvvZuIBmsKzdKtM2WRtXD4Ornc4y0=";
  };

  nativeBuildInputs = [
    pkgs.nodejs
    yarn
    yarn.yarnBerryConfigHook
    pkgs.zip
  ];

  buildPhase = ''
    runHook preBuild
    yarn build
    runHook postBuild
  '';

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    yarn typecheck
    yarn test
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/bridge
    cp -r packages/extension/.output/firefox-mv2 $out/firefox
    cp -r packages/extension/.output/chrome-mv3 $out/chrome
    (cd $out/firefox && zip -qr $out/redline.xpi .)
    cp packages/bridge/dist/redline.mjs $out/bridge/
    # the skill, for `redline install --skills` (Codex, pi)
    mkdir -p $out/skills
    cp -r claude/skills/redline $out/skills/
    runHook postInstall
  '';
})
