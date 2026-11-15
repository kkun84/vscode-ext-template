{
  description = "VS Code拡張機能の雛形の開発環境";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # 素の開発環境とE2E用の環境で共通の道具。
      basePackages = pkgs: [
        pkgs.nodejs_24
        pkgs.pnpm_12
        pkgs.git
        pkgs.shellcheck
        pkgs.actionlint
      ];
    in
    {
      devShells = forAll (pkgs: {
        default = pkgs.mkShellNoCC { packages = basePackages pkgs; };

        # E2Eは本物のエディタを動かす。LinuxではnixpkgsのVSCodiumを使う。
        # VSCodiumはVS Codeと同じソースから作られ、拡張機能のAPIも同じ。
        # VS Code本体と違ってunfreeでなく、Nixのバイナリキャッシュから入る。
        # この版が最低の対応版でもある(package.jsonのengines.vscode)。
        # Linux以外では環境変数を渡さず、E2Eが最新のVS Codeをダウンロードする。
        e2e = pkgs.mkShellNoCC {
          packages =
            basePackages pkgs
            ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
              pkgs.vscodium
              pkgs.xvfb-run
            ];
          env = pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
            VSCODE_EXECUTABLE = "${pkgs.vscodium}/lib/vscode/codium";
          };
        };
      });

      formatter = forAll (pkgs: pkgs.nixfmt);

      # devShellが壊れていないことをnix flake checkで確かめる。
      checks = nixpkgs.lib.genAttrs systems (system: {
        default = self.devShells.${system}.default;
        e2e = self.devShells.${system}.e2e;
      });
    };
}
