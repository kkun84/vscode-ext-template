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
pnpm mutation:diff   # origin/mainとの分岐点と比べ、テストを弱めた変更なら失敗する
pnpm mutation        # ミューテーションテストを全件。レポートは.mutator/report/index.html
pnpm package         # .vsixを作る
```

Nixを使わない場合は、`.node-version`の版のNode.jsと、`package.json`の`packageManager`の版のpnpmを入れます。

## ミューテーションテスト

[@mizchi/mutator](https://github.com/mizchi/mutator) で、テストが実装の変更を検出できるかを確かめます。対象は`src/core`と`src/services`です。結果はテストを見直すための指標で、テストが検出できないミュータント（生き残りと、どのテストも届かないもの）があっても失敗にはしません。

失敗にするのは、テストを弱めた変更だけです。変わっていないコードについて、前は検出できたミュータントを今は検出できない場合を指します。アサーションを弱めたり、テストを消したりした変更がこれに当たります。何も検出しない新しいテストは警告にします。

- 比べる相手は、毎回その場で作ります。`origin/main`（CIではPRのマージ先）と`HEAD`の分岐点のコミットを、一時ディレクトリに`git worktree`で取り出し、全件を実行します。このとき、mutatorが比べる相手として使えるように、環境のファイル（`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig*.json`、`vitest.config.*`、`mutator.config.*`）を今の作業ツリーから写し、依存を入れ直します。mutatorは、Node.jsの版とこれらのファイルとmutatorの設定のどれかが違う結果を、比べる相手に使わないためです。その結果を`.mutator`に入れてから、分岐点からの差分と、変更したテストが確かめるコードのミュータントを実行して判定します。手順は`scripts/mutation-diff.ts`、判定は`scripts/mutation-report.ts`にあります。前回の実行の結果は使わないので、ブランチを切り替えても判定は変わりません
- 手元では、pre-pushが`pnpm mutation:diff`を実行し、テストを弱めた変更があればpushを止めます。`origin/main`が無いclone（雛形から作った直後など）では何もしません。この雛形を手元で測ると、変更が無いときに約20秒、テストを変えたときに約30秒かかります。ほとんどは分岐点の全件の実行です
- 何も検出しない新しいテストは、手元では出ません。見つけるには、ミュータントごとにテストを全部動かす`--kill-matrix`が要り、テストを変えたときに約20秒遅くなるためです。手元で確かめるときは`pnpm mutation:diff origin/main --kill-matrix`を実行します
- CIでは、`check (Linux)`がPRで同じ`pnpm mutation:diff`を`--kill-matrix`付きで実行し、テストを弱めた変更があれば失敗します。`check (Linux)`はマージに必須のチェックです。変更した行の検出漏れ（どのテストも届かないものを含む）は、PRの差分に警告として表示します。`mutator.config.*`か`mutator.accepted.json`を変えたときも警告します。続けて全件を実行し、全体のスコアをジョブの概要（Summary）に出します。mainへのpushでは全件だけを実行します。判定が失敗しても、スコアは出します
- 分岐点のテストが今の依存で落ちるなど、比べる相手を作れなかったときは、テストを弱めたかを確かめられません。理由を警告として出し、失敗にはしません。作ったのにmutatorが比べられなかったとき（レポートの`comparison`が`unavailable`）は、仕組みの故障なので失敗にします
- 検出できなかったミュータントは、テストが足りないのか、コードが要らないのかを考えます。数字を満たすためだけのテストは書きません。手順は`node_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.md`にあります。どんな入力でも振る舞いが変わらない等価ミュータントだけを、`pnpm exec mutator accept <key> --reason <理由>`で`mutator.accepted.json`に記録します。キーは`pnpm exec mutator --reporter agent`の`gaps[].key`にあります。テストを弱めた変更を通すために記録してはいけません。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足します

### やめるとき

次を消し、`pnpm remove @mizchi/mutator`を実行します。

- `package.json`の`mutation`と`mutation:diff`、`scripts/mutation-diff.ts`、`scripts/mutation-report.ts`とそのテスト、`scripts/fixtures/mutation-report-*.json`
- `lefthook.yml`の`mutation`と、`.github/workflows/ci.yml`の`Mutation tests`の2ステップと`fetch-depth: 0`
- `scripts/lint/no-suppress/rule.ts`の`mutator-disable`と`Stryker disable`、そのテストとREADMEの記述（残しても害はない）
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
