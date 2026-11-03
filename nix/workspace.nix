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
  version = "0.1.0";
  inherit src;

  # yarn.lock's packages that carry no checksum of their own (yarn-berry-fetcher
  # missing-hashes yarn.lock > nix/missing-hashes.json)
  missingHashes = ./missing-hashes.json;
  offlineCache = yarn.fetchYarnBerryDeps {
    inherit (finalAttrs) src missingHashes;

    # after a change of yarn.lock: the hash nix says it got
    hash = "sha256-9uj7/pd2kpIVXainMyvrJ+qTObQxwq9Ij0APmh+sXCU=";
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
    runHook postInstall
  '';
})
