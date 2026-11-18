# VS Code Extension Template

Effect v4で書くVS Code拡張機能の雛形です。デスクトップ版とWeb版の両方で動き、`.vsix`を作ってGitHubのReleaseで配布します。

見本の機能として、ワークスペースにメモを作るコマンド「Create Note」が入っています。

## 構成

| 分類             | 採用したもの                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------ |
| 言語とライブラリ | TypeScript 7、Effect 4                                                                     |
| ビルド           | rolldown（デスクトップ版はESM、Web版はCJS）                                                |
| 型検査           | `@effect/tsgo`（Effectの診断を含む）                                                       |
| lintと整形       | oxlint（型情報あり）、oxfmt、fallow、rumdl、カスタムlint 3種                               |
| テスト           | Vitest（単体と結合）、Playwright（実際のエディタでE2E）、mutator（ミューテーションテスト） |
| パッケージ       | `@vscode/vsce`                                                                             |
| 開発環境         | Nix flake、pnpm、lefthook、direnv（任意）                                                  |
| CI               | GitHub Actions（LinuxとWindows）、CodeQL、Dependabot                                       |

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
pnpm mutation:diff   # origin/mainとの差分だけミューテーションテスト
pnpm mutation        # ミューテーションテストを全件。レポートは.mutator/report/index.html
pnpm package         # .vsixを作る
```

Nixを使わない場合は、`.node-version`の版のNode.jsと、`package.json`の`packageManager`の版のpnpmを入れます。

## ミューテーションテスト

[@mizchi/mutator](https://github.com/mizchi/mutator) で、テストが実装の変更を検出できるかを確かめます。対象は`src/core`と`src/services`です。結果はテストを見直すための指標で、テストが検出できないミュータント（生き残りと、どのテストも届かないもの）があっても失敗にはしません。

- 手元では、pre-pushが`pnpm mutation:diff`で`origin/main`との差分だけを実行します。`origin/main`を取得済みのcloneが要ります
- CIでは、`check (Linux)`が、PRで変更した行の検出漏れ（どのテストも届かないものを含む）をPRの差分に警告として表示します。続けて全件を実行し、全体のスコアを出します。テストを弱めたり消したりしただけの変更は、全件の結果に現れます
- 検出できなかったミュータントは、テストが足りないのか、コードが要らないのかを考えます。数字を満たすためだけのテストは書きません。手順は`node_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.md`にあります。どんな入力でも振る舞いが変わらない等価ミュータントだけを、`pnpm exec mutator accept <key> --reason <理由>`で`mutator.accepted.json`に記録します。キーは`pnpm exec mutator --reporter agent`の`gaps[].key`にあります

### やめるとき

次を消し、`pnpm remove @mizchi/mutator`を実行します。

- `package.json`の`mutation`と`mutation:diff`
- `lefthook.yml`の`mutation`と、`.github/workflows/ci.yml`の`Mutation tests`の2ステップと`fetch-depth: 0`
- `mutator.config.json`と`mutator.accepted.json`
- `.mutator`の除外（`.gitignore`、`.oxlintrc.json`、`.rumdl.toml`、`.fallowrc.json`、`scripts/lint/shared/files.ts`）
- `AGENTS.md`の完了の条件、`docs/design.md`、このREADMEにあるミューテーションテストの記述

## Web版をやめるとき

`package.json`の`browser`、`scripts/build.ts`のWeb版の出力、`src/layers/web`と`src/entrypoints/web`、`playwright.config.ts`の`web`プロジェクトを消します。Node.jsの組み込みモジュールは`src/layers/node`の中でだけ使う、という境界は残しておくと、後でWeb版に戻しやすくなります。

## リリース

`package.json`の`version`を上げ、`v`で始まる同じ版のタグを付けてpushすると、`.vsix`がReleaseに添付されます。Marketplaceには公開しません。

## 文書

- [docs/design.md](docs/design.md): 設計と、採用しなかったもの
- [docs/lint-history.md](docs/lint-history.md): lintの設定を既定から変えた理由
- [AGENTS.md](AGENTS.md): AIエージェント向けの指示
