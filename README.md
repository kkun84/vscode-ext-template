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

失敗にするのは、テストを弱めた変更と、それを確かめられない場合だけです。テストを弱めた変更は、変わっていないコードについて、前は検出できたミュータントを今は検出できない場合を指します。アサーションを弱めたり、テストを消したりした変更がこれに当たります。確かめられない場合は、比べる相手を作れなかったときや、判定と合わない設定があるときなどで、下に挙げます。何も検出しない新しいテストと、消したテストは警告にします。判定が出した注釈は最後にまとめ、`判定の結果: エラーN件、警告M件`の集計を1回だけ出します。エラーには、mutatorが報告したものに加えて、判定が自分で見つけたもの（実行し直し、設定で外れたもの、集めなくなったテストなど）をすべて数え、1件でもあれば失敗にします。

- 比べる相手は、毎回その場で作ります。`origin/main`（CIではPRのマージ先）と`HEAD`の分岐点のコミットを、一時ディレクトリに`git worktree`で取り出し、全件を実行します。このとき、mutatorが比べる相手として使えるように、環境のファイル（`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig*.json`、`vitest.config.*`とそれが読む`setupFiles`と`globalSetup`、`mutator.config.*`、`.npmrc`）を今の作業ツリーから写し、依存を入れ直します。mutatorは、Node.jsの版とこれらのファイルとmutatorの設定のどれかが違う結果を、比べる相手に使わないためです。その結果を`.mutator`に入れてから、分岐点からの差分と、変更したテストが確かめるコードのミュータントを実行して判定します。手順は`scripts/mutation-diff.ts`、判定は`scripts/mutation-report.ts`にあります。前回の実行の結果は使わないので、ブランチを切り替えても判定は変わりません
- 基準も今の設定で作るので、設定を狭めた変更は差分に現れません。そこで、分岐点の`vitest.config.*`で集めていたテストファイルのうち、今もあるのに今の設定では集めないものと、分岐点の`mutator.config.*`で対象だったソースファイルのうち、今もあるのに対象外になったものを、失敗にします
- `excludedMutators`、`plugins`、`arid`などでミュータントの種類を減らした変更や、`tsconfig*.json`を変えてミュータントを`CompileError`にした変更も、差分に現れません。基準も今の設定で作るので、両方で同じように外れるためです。そこで、`mutator.config.*`、`tsconfig*.json`、`vitest.config.*`とそれが読む`setupFiles`と`globalSetup`のどれかが分岐点と違えば、分岐点のコミットでそれらを分岐点の物に戻し、今の設定の基準で`Killed`でないミュータント（今の設定で消えたものを含む）を実行します。そこで`Killed`なら、設定で比べる対象から外れたものです。検出していたテストに変えたテスト（下の項目と同じ数え方）を含むものは、今の作業ツリーの写しを分岐点の設定に戻して`--only --kill-matrix`で実行し直し、今は検出されなければ失敗にします。今も検出されるものと、検出していたテストが変わっていないものは警告にします
- 差分の実行には、いつも`--kill-matrix`を付けます。mutatorは、前に検出したテストのどれかが変わっていなければ前の「検出した」を使い回すので、負荷で関係の無いテストがたまたま落ちた基準では、テストを弱めた変更を見逃すことがありました。`--kill-matrix`を付けると、範囲の中の「検出した」は必ず実行し直されます。何も検出しない新しいテストも、手元で警告します
- モジュールの直下にある正規表現など、読み込みの時に一度だけ動くコードのミュータントは、差分の実行に選ばれません。基準で検出したテストに変えたテストを含み、今回確かめていないミュータントは、`--only`で実行し直し、検出されなければ失敗にします。結果が`Killed`、`Timeout`、`RuntimeError`、`CompileError`なら検出とみなします。`CompileError`は、ソースの型を変えて、前は`Killed`だったミュータントがコンパイルできなくなった場合で、テストは弱くなっていません。`Ignored`、`Pending`と結果が無い場合は、確かめられないので失敗にします。変えたテストには、mutatorが挙げたもの（レポートの`testChanges`と`selectionReasons`）に加えて、テストのファイルか、それが読み込むファイル（ヘルパーなど）が分岐点からの差分にあるものを数えます。ヘルパーだけを弱めた変更も、これで見つけます
- `mutator.config.*`に`since`、`timeBudget`、`mutantsPerLine`、`shard`、`reportDir`、`sharedCache`、`runner`、`vitestConfig`、`jestConfig`、`playwrightConfig`があれば、基準を作る前に、名前を挙げて失敗にします。実行するミュータントを減らすか、結果の置き場所を変えるか（`sharedCache`は、基準と今が`.git/mutator`の同じ結果を読み書きします）、判定がテストを集める設定（既定のVitestと`vitest.config.*`）と食い違うためです。それでも基準の全件に実行しなかったミュータント（`Pending`）が残れば、比較の基準を作れなかったとして失敗にします。差分の実行で実行しなかったミュータントがあっても失敗にします。`.mutator`がGitで追跡されていても失敗にします
- 手元では、pre-pushが`pnpm mutation:diff`（`--skip-without-base`付き）を実行し、テストを弱めた変更があればpushを止めます。`origin/main`が無いclone（雛形から作った直後など）とGitの外では何もしません。同じ作業ツリーで2つ同時には動かせず、後から動かした方が、ロックのパスを示して失敗します。強制終了で残ったロックと一時ディレクトリは、次の実行が消します。一時ディレクトリは、ロックに書いたパスで消すので、`nix develop`などで`TMPDIR`がシェルごとに変わっても消せます。この雛形を手元で測ると、変更が無いときに約30秒、テストを変えたときに約50秒かかります。テストやmutatorの設定が分岐点と違うときは、上の数え直しの分だけ長くなります
- CIでは、`check (Linux)`がPRで`node scripts/mutation-diff.ts`を直接実行し、テストを弱めた変更があれば失敗します。`package.json`の`scripts`を書き換えるだけで判定を外せないように、`pnpm mutation:diff`は通しません。基準のrefが無ければ失敗します。`check (Linux)`はマージに必須のチェックです。変更した行の検出漏れ（どのテストも届かないものを含む）は、PRの差分に警告として表示します。変更の中で飛ばしたテスト（`it.skip`など）も警告します。続けて、一時的なGitリポジトリで、何も変えなければ成功し、テストやアサーションを消すか、判定を外す設定を足せば失敗することを確かめます（`pnpm mutation:selftest`、約2分）。モジュールの直下のコードを確かめるアサーションを、テストから消す場合とヘルパーから消す場合、`mutator.config.*`に`since`か`timeBudget`を足す場合、`excludedMutators`でミュータントを消す場合、`tsconfig.json`でミュータントを`CompileError`にしてテストを消す場合を含みます。`excludedMutators`を足してテストが読み込むソースのコメントを変えるだけなら、成功することも確かめます。テストの題名だけを変えると、警告を出して成功することも確かめます。Dependabotがmutatorを上げたPRでも、判定が黙って外れていないことが分かります。続けて、`.mutator`を消してから全件を実行し、全体のスコアをジョブの概要（Summary）に出します。mainへのpushでは全件だけを実行します。判定が失敗しても、スコアは出します
- 分岐点のテストが今の依存で落ちるなど、比べる相手を作れなかったときは、テストを弱めたかを確かめられないので、原因と直し方を出して失敗にします。多くは依存の更新でテストが壊れたときで、そのときは普段のテストも落ちます。作ったのにmutatorが比べられなかったとき（レポートの`comparison`が`unavailable`）も、仕組みの故障として失敗にします
- 次のファイルを変えると、テストを弱めずに判定を外せます。機械では防ぎきれないので、CIは警告を出し、PRでは人が確かめます
  - テストの設定と準備のファイル（`vitest.config.*`と、それが読む`setupFiles`と`globalSetup`）。たとえば`setupFiles`で`expect`を無力化すると、基準も同じ準備で作るので検出できません
  - mutatorの設定（`mutator.config.*`）と`mutator.accepted.json`。ミュータントの種類を減らす変更は上のとおり機械でも確かめますが、検出していたテストが変わっていなければ警告に留めます
  - TypeScriptの設定（`tsconfig*.json`）。型の合わないミュータントは`CompileError`になって比べる対象から外れます。上のとおり機械でも確かめます
  - 判定のスクリプト（`scripts/mutation-diff.ts`、`scripts/mutation-report.ts`）と、それを呼ぶ`package.json`、`lefthook.yml`、`.github/workflows`
  - Vitestの`testNamePattern`など、テストファイルは集めたままテストを外す設定。テストファイルを集めなくなったときだけを機械で確かめるので、これは警告と人の確認に頼ります
- 次の場合は、方針の帰結として失敗しません、または検出しません
  - 関数を書き換えて、そのテストも消した場合。書き換えた箇所は変わったコードなので、検出できないミュータントの警告になり、失敗にはなりません
  - 検出が減らない弱め方（アサーションの削除や、`toBe`から`toBeFalsy`への弱めなど）。他のテストが同じミュータントを検出していれば、ミューテーションテストで測る検出力が落ちていないため、通ります。テストを丸ごと消した場合だけは、mutatorのレポートの`testChanges.removed`から、消したテストを1件ずつ警告します。mutatorはテストを題名で見分けるので、題名を変えたテストも消したテストとして挙がります。同じファイルにテストを足していれば、題名を変えただけかもしれないと書きます
  - テストがファイルから読むデータを変えた場合
  - 基準で`Timeout`か`RuntimeError`で検出していたミュータント。mutatorは基準で`Killed`だったものだけを比べます
  - ソースのファイルの名前を変えるか移して、同時にテストを弱めた場合。ミュータントのファイルが変わるので、mutatorは変わったコードとして扱い、検出できないミュータントの警告になります
  - ソースを変えた結果、変えていない他の関数のミュータントを検出できなくなった場合。テストではなくソースの変更で検出が減る場合は、判定の対象外です
- 次の場合は、テストを弱めていなくても失敗することがあります
  - ソースを変えた結果、それを呼ぶ側のミュータントが等価になった場合。呼ぶ側のテストが変わったとみなされて実行し直され、検出されないので失敗します。テストが確かめる振る舞いを見直してください
  - mutatorかテストの設定（上の数え直しの対象）と、テストが読み込むソースを、同じPRで変えた場合。設定で外れたミュータントを実行し直すと、ソースの変更で検出されなくなっていることがあります。そのときは、設定の変更を別のPRに分けます。エラーの文面にも、この直し方を出します
- 次の場合は、遅くなるか、後片付けが遅れます
  - 多くのテストが読み込むソース（共通のヘルパーなど）を変えると、そのテストが検出していたミュータントをすべて実行し直すので、遅くなります
  - `mutation-diff.ts`の親のプロセスだけを強制終了すると（`kill -9`など）、子のmutatorは終わるまで動き続け、ロックも残ります。次の実行は、ロックを書いた親がもう無いので、古いロックとして取り直し、一時ディレクトリを消します。子がまだ動いていると、`.mutator`を取り合って失敗することがあるので、子が終わってから実行し直します
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
