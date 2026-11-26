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

- 比べる相手は、毎回その場で作ります。`origin/main`（CIではPRのマージ先）と`HEAD`の分岐点のコミットを、一時ディレクトリに`git worktree`で取り出し、全件を実行します。このとき、mutatorが比べる相手として使えるように、環境のファイル（`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig*.json`、`vitest.config.*`とそれが読む`setupFiles`と`globalSetup`、`mutator.config.*`、`.npmrc`）を今の作業ツリーから写し、依存を入れ直します。mutatorは、Node.jsの版とこれらのファイルとmutatorの設定のどれかが違う結果を、比べる相手に使わないためです。その結果を`.mutator`に入れてから、分岐点からの差分と、変更したテストが確かめるコードのミュータントを実行して判定します。手順は`scripts/mutation-diff.ts`、判定は`scripts/mutation-report.ts`にあります。前回の実行の結果は使わないので、ブランチを切り替えても判定は変わりません
- 基準も今の設定で作るので、設定を狭めた変更は差分に現れません。そこで、分岐点の`vitest.config.*`で集めていたテストファイルのうち、今もあるのに今の設定では集めないものと、分岐点の`mutator.config.*`で対象だったソースファイルのうち、今もあるのに対象外になったものを、失敗にします
- 手元では、pre-pushが`pnpm mutation:diff`（`--skip-without-base`付き）を実行し、テストを弱めた変更があればpushを止めます。`origin/main`が無いclone（雛形から作った直後など）とGitの外では何もしません。同じ作業ツリーで2つ同時には動かせず、後から動かした方が失敗します。この雛形を手元で測ると、変更が無いときに約20秒、テストを変えたときに約30秒かかります。ほとんどは分岐点の全件の実行です
- 何も検出しない新しいテストは、手元では出ません。見つけるには、ミュータントごとにテストを全部動かす`--kill-matrix`が要り、テストを変えたときに約20秒遅くなるためです。手元で確かめるときは`pnpm mutation:diff origin/main --kill-matrix`を実行します
- CIでは、`check (Linux)`がPRで`node scripts/mutation-diff.ts`を`--kill-matrix`付きで直接実行し、テストを弱めた変更があれば失敗します。`package.json`の`scripts`を書き換えるだけで判定を外せないように、`pnpm mutation:diff`は通しません。基準のrefが無ければ失敗します。`check (Linux)`はマージに必須のチェックです。変更した行の検出漏れ（どのテストも届かないものを含む）は、PRの差分に警告として表示します。変更の中で飛ばしたテスト（`it.skip`など）も警告します。続けて、一時的なGitリポジトリで、何も変えなければ成功し、テストを消せば失敗することを確かめます（`pnpm mutation:selftest`、約20秒）。Dependabotがmutatorを上げたPRでも、判定が黙って外れていないことが分かります。続けて全件を実行し、全体のスコアをジョブの概要（Summary）に出します。mainへのpushでは全件だけを実行します。判定が失敗しても、スコアは出します
- 分岐点のテストが今の依存で落ちるなど、比べる相手を作れなかったときは、テストを弱めたかを確かめられないので、原因と直し方を出して失敗にします。多くは依存の更新でテストが壊れたときで、そのときは普段のテストも落ちます。作ったのにmutatorが比べられなかったとき（レポートの`comparison`が`unavailable`）も、仕組みの故障として失敗にします
- 次のファイルを変えると、テストを弱めずに判定を外せます。機械では防ぎきれないので、CIは警告を出し、PRでは人が確かめます
  - テストの設定と準備のファイル（`vitest.config.*`と、それが読む`setupFiles`と`globalSetup`）。たとえば`setupFiles`で`expect`を無力化すると、基準も同じ準備で作るので検出できません
  - mutatorの設定（`mutator.config.*`）と`mutator.accepted.json`
  - 判定のスクリプト（`scripts/mutation-diff.ts`、`scripts/mutation-report.ts`）。`package.json`の`scripts`と`.github/workflows`の書き換えも同じで、こちらは警告も出ません
- 次の場合は、方針の帰結として失敗しません、または検出しません
  - 関数を書き換えて、そのテストも消した場合。書き換えた箇所は変わったコードなので、検出できないミュータントの警告になり、失敗にはなりません
  - テストがファイルから読むデータを変えた場合
- 破壊的な依存の更新と、それに合わせたテストの直しを同じPRに入れると、分岐点のテストが新しい依存で落ちて基準を作れず、必ず失敗します。新旧どちらの依存でも通るテストの直しを先にmainに入れ、依存の更新は別のPRにします。どうしても分けられないときは、管理者が判断します
- 検出できなかったミュータントは、テストが足りないのか、コードが要らないのかを考えます。数字を満たすためだけのテストは書きません。手順は`node_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.md`にあります。どんな入力でも振る舞いが変わらない等価ミュータントだけを、`pnpm exec mutator accept <key> --reason <理由>`で`mutator.accepted.json`に記録します。キーは`pnpm exec mutator --reporter agent`の`gaps[].key`にあります。テストを弱めた変更を通すために記録してはいけません。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足します

### やめるとき

次を消し、`pnpm remove @mizchi/mutator`を実行します。

- `package.json`の`mutation`、`mutation:diff`、`mutation:selftest`、`scripts/mutation-diff.ts`、`scripts/mutation-diff-selftest.ts`、`scripts/mutation-report.ts`とそのテスト、`scripts/fixtures/mutation-report-*.json`
- `lefthook.yml`の`mutation`と、`.github/workflows/ci.yml`の`Mutation tests`の3ステップと`fetch-depth: 0`
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
