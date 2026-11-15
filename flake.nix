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

      # vscodeはunfreeなので、この名前だけを許可する。E2E用のshellでしか使わない。
      forAll =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f (
            import nixpkgs {
              inherit system;
              config.allowUnfreePredicate = pkg: nixpkgs.lib.getName pkg == "vscode";
            }
          )
        );

      # 素の開発環境とE2E用の環境で共通の道具立て。
      basePackages =
        pkgs:
        [
          pkgs.nodejs_24
          pkgs.pnpm_12
          pkgs.git
          pkgs.shellcheck
          pkgs.actionlint
        ];
    in
    {
      devShells = forAll (pkgs: {
        default = pkgs.mkShellNoCC {
          packages = basePackages pkgs;
        };

        # E2Eは本物のVS Codeを動かす。Linuxだけは画面の無い環境なのでxvfbを足す。
        e2e = pkgs.mkShellNoCC {
          packages =
            basePackages pkgs
            ++ [ pkgs.vscode ]
            ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.xvfb-run ];

          # E2EはVSCODE_EXECUTABLEのVS Codeを使う。macOSは.appの中の実行ファイルを指す。
          env.VSCODE_EXECUTABLE =
            if pkgs.stdenv.hostPlatform.isDarwin then
              "${pkgs.vscode}/Applications/Visual Studio Code.app/Contents/MacOS/Code"
            else
              "${pkgs.vscode}/lib/vscode/code";
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
