# VS Code Extension Template

Effect v4で書くVS Code拡張機能の雛形です。デスクトップ版とWeb版の両方で動き、`.vsix`を作ってGitHubのReleaseで配布します。

見本の機能として、ワークスペースにメモを作るコマンド「Create Note」が入っています。

## 構成

| 分類             | 採用したもの                                                 |
| ---------------- | ------------------------------------------------------------ |
| 言語とライブラリ | TypeScript 7、Effect 4                                       |
| ビルド           | rolldown（デスクトップ版はESM、Web版はCJS）                  |
| 型検査           | `@effect/tsgo`（Effectの診断を含む）                         |
| lintと整形       | oxlint（型情報あり）、oxfmt、fallow、rumdl、カスタムlint 3種 |
| テスト           | Vitest（単体と結合）、Playwright（実際のエディタでE2E）      |
| パッケージ       | `@vscode/vsce`                                               |
| 開発環境         | Nix flake、pnpm、lefthook、direnv（任意）                    |
| CI               | GitHub Actions（LinuxとWindows）、CodeQL、Dependabot         |

採用しなかったものと、その理由は[docs/design.md](docs/design.md)にあります。

## 使い始める

1. GitHubで「Use this template」からリポジトリを作ります。
2. 名前を置き換えます。

   ```sh
   node scripts/init.ts --name my-extension --publisher me --prefix myExtension \
     --display-name "My Extension" --display-name-ja "私の拡張機能" --repository me/my-extension
   ```

3. このREADME.md、LICENSE、見本の機能を、自分の拡張機能に合わせて書き直します。
4. GitHubのリポジトリ設定を反映します（任意）。

   ```sh
   scripts/github-settings.sh me/my-extension
   ```

## 開発

```sh
nix develop          # またはdirenvで自動に
pnpm install
pnpm check           # lint、型検査、テスト、ビルド、サイズの上限、.vsixの中身
pnpm test:e2e        # E2E。LinuxではNixの`.#e2e`シェルの中でxvfb-run -aを付ける
pnpm package         # .vsixを作る
```

Nixを使わない場合は、`.node-version`の版のNode.jsと、`package.json`の`packageManager`の版のpnpmを入れます。

## Web版をやめるとき

`package.json`の`browser`、`scripts/build.ts`のWeb版の出力、`src/layers/web`と`src/entrypoints/web`、`playwright.config.ts`の`web`プロジェクトを消します。Node.jsの組み込みモジュールは`src/layers/node`の中でだけ使う、という境界は残しておくと、後でWeb版に戻しやすくなります。

## リリース

`package.json`の`version`を上げ、`v`で始まる同じ版のタグを付けてpushすると、`.vsix`がReleaseに添付されます。Marketplaceには公開しません。

## 文書

- [docs/design.md](docs/design.md): 設計と、採用しなかったもの
- [docs/lint-history.md](docs/lint-history.md): lintの設定を既定から変えた理由
- [AGENTS.md](AGENTS.md): AIエージェント向けの指示
