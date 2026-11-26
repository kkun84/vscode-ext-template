# 設計

この雛形の構成と、その構成にした理由を書く。

## 目的

Effect v4で書くVS Code拡張機能の雛形にする。特定の拡張機能に固有の仕組みは入れない。

- desktop版とweb版の両方で動く形を標準にする。web版をやめる時は、入口とビルドを1つ消すだけで済むようにする
- テストからモックライブラリを無くす。VS Codeとの境界はEffectの層で差し替える
- 規約は文書だけでなく、lint、型、fallowの境界検査で機械的に守らせる

## ディレクトリ

```text
src/
  core/          純粋な計算。effectのほかに依存しない
  services/      Context.Serviceの定義と、それを組み合わせる手順
  layers/
    vscode/      VS Code APIで書いたLive実装。desktop版とweb版の両方で動く
    node/        Node.jsの組み込みモジュールを使うLive実装。desktop版だけで使う
    web/         web版で、node/の代わりに渡す実装
    test/        インメモリのTest実装
  entrypoints/
    shared/      activateの共通部分。実行環境の組み立て、コマンドの登録
    node/        desktop版の入口
    web/         web版の入口
e2e/
  vscode.ts      エディタの起動と後片付け
  fixtures.ts    テストに渡すフィクスチャ
  pages/         VS Codeの画面を操作するページオブジェクト
  *.spec.ts      E2Eのテスト
scripts/         ビルド、パッケージ化、自作lint、初期化
l10n/            実行時の文言の翻訳
```

## 層の向き

依存は次の向きにだけ流れる。fallowの`boundaries`と`architecture.rules.json`で検査する。

```text
entrypoints ──▶ layers ──▶ services ──▶ core
```

- `core`は`effect`だけに依存する。`vscode`、Node.jsの組み込みモジュール、時刻と乱数の取得を使わない。時刻は引数で受け取る
- `services`は`core`と`effect`だけに依存する。`vscode`もNode.jsの組み込みモジュールも使わない
- `layers/vscode`、`layers/web`、`layers/test`はNode.jsの組み込みモジュールを使わない
- Node.jsの組み込みモジュールを使ってよいのは`layers/node`、`scripts`、`e2e`だけにする
- `entrypoints/node`と`entrypoints/web`は互いに依存しない。`entrypoints/web`は`layers/node`に依存しない

## EffectとVS Codeのつなぎ方

`entrypoints/shared`が、`activate`の中で`ManagedRuntime`を作る。コマンドの処理はすべてこの実行環境の上で動かし、`deactivate`で`ManagedRuntime`を破棄する。破棄すると、層が`Effect.acquireRelease`で確保した出力チャネルなどの資源が逆順に解放される。

- コマンドは、ID、引数のSchema、処理のEffectを1組にした定義で登録する。`vscode.commands.registerCommand`に渡す関数は、引数をSchemaでdecodeしてから処理のEffectを実行する
- 処理が型付きのエラーで失敗したら、エラーの種類に応じた翻訳済みの文言を通知する。想定外の欠陥で失敗したら、詳細をログに残し、一般的な文言を通知する
- ログはEffectの`Logger`を、VS Codeの`LogOutputChannel`へ流す
- 時刻はEffectの`Clock`から取る。結合テストでは`TestClock`で固定できる

## 境界での検証

外から入る値は、使う前にすべてSchemaでdecodeする。

- 設定値。不正な値は既定値に戻し、警告をログに残す
- `globalState`などの保存データ
- コマンドの引数。コマンドは他の拡張やキー割り当てからも任意の値で呼ばれる

## 見本の機能

雛形には、全部の層を通る最小のコマンドを1つだけ入れる。

- コマンド「Create Note」は、題名を入力欄で尋ね、ワークスペースの`notes`フォルダにMarkdownのファイルを作り、エディタで開き、完了を通知する
- 保存先のフォルダ名と、著者名は設定から読む
- 著者名の設定が空の時、desktop版はOSのユーザー名を使い、web版は著者名を省く。Node.js専用の機能を`layers/node`に置き、web版では別の実装に差し替える見本にする
- 題名からファイル名を作る処理と、本文を組み立てる処理は`core`に置く

## 文言の翻訳

英語と日本語を用意する。

- package.jsonに書く文言は`package.nls.json`と`package.nls.ja.json`に置く
- 実行時の文言は`vscode.l10n.t`で翻訳し、`l10n/bundle.l10n.ja.json`に置く
- `core`と`services`は文言を持たない。何を伝えるかをタグ付きの値で返し、`layers/vscode`の実装が翻訳する

## ビルド

rolldownを直接呼ぶ`scripts/build.ts`で、2つのバンドルを作る。

- desktop版は`dist/node/extension.js`にESMで出力する。VS Code 1.100以降は、`"type": "module"`の拡張をESMとして読み込む
- web版は`dist/web/extension.cjs`にCommonJSで出力する。web版の拡張ホストはESMを読めない。`"type": "module"`のパッケージで拡張子を`.js`にすると、「ESM modules are not supported in the web worker extension host」で起動しない。E2Eで確かめた
- `scripts/package.ts`が配布用の`.vsix`を作る。`scripts/check-vsix.ts`が、`.vsix`に`dist`の2ファイルと文言と説明書以外が入っていないことを検査する。E2Eのdriverが混入すると、この検査で落ちる
- `budgets.json`に、バンドルの大きさの上限を書く

最低のVS Codeは1.116とする。ESMの読み込みに1.100以降が要り、Node.js 24を同梱している必要がある。そのうえで、CIのLinuxのE2Eが使うnixpkgsのVSCodiumが1.116なので、実際に確かめている版を最低の版にした。`@types/vscode`も1.116に固定し、それより新しいAPIを型の段階で使えなくする。

## テスト

| 種類       | 対象                                        | VS Code  | ツール                   |
| ---------- | ------------------------------------------- | -------- | ------------------------ |
| 単体テスト | `core`の純関数                              | 使わない | Vitest                   |
| 結合テスト | `services`の手順と`layers/test`の組み合わせ | Test層   | Vitestと`@effect/vitest` |
| E2E        | ビルドした拡張を本物のVS Codeで動かす       | 本物     | Playwrightの`_electron`  |

単体テストと結合テストは、どちらも1つのプロセスで完結するので、`pnpm test`でまとめて実行する。テストファイルは対象の隣に`*.test.ts`として置く。E2Eは`pnpm test:e2e`で分けて実行する。

### ミューテーションテスト

カバレッジは、コードが実行されたことしか示さない。実装を書き換えてもテストが落ちない箇所を見つけるために、`@mizchi/mutator`で`core`と`services`の実装を1か所ずつ書き換え、単体テストと結合テストが落ちるかを確かめる。

- 生き残りとスコアは指標として扱い、失敗にはしない。100%を強制すると、ミュータントを落とすためだけに実装をなぞるテストが増える。改善は、PRの警告と、AIへの指示（`AGENTS.md`）で働きかける
- テストを弱めた変更だけは失敗にする。変わっていないコードについて、前は検出できたミュータントを今は検出できない場合で、mutatorの`--include-test-changes`が`detectionRegression`として報告する。実装の差分に現れないので、スコアの低下だけでは見落とす。判定は`scripts/mutation-report.ts`に置き、何も検出しない新しいテスト（`newTestNoKills`）は警告に留める。`mutator accept`で通すことはしない。`mutator.accepted.json`は等価ミュータント専用である
- 比べる相手は、前回の実行の結果ではなく、毎回その場で作る。比べる相手（`origin/main`か、PRのマージ先）と`HEAD`の分岐点のコミットを`git worktree`で一時ディレクトリに取り出し、全件を実行して、その結果を`.mutator`に入れてから差分を実行する。手順は`scripts/mutation-diff.ts`に置き、pre-pushとCIで同じものを動かす。前回の結果に頼ると、次の問題が起きたため
  - mutatorは、Node.jsの版、`package.json`、ロックファイル、`pnpm-workspace.yaml`、`tsconfig.json`、`vitest.config.ts`、mutatorの設定のどれかが違う結果を比べる相手に使わず、判定が黙って外れる。`package.json`に空白を1つ足すだけで、テストを弱めた変更が通った。そこで分岐点には、これらのファイルを今の作業ツリーから写してから依存を入れる。写すファイルは`node_modules/@mizchi/mutator/src/reuse.ts`の`environmentHash`に合わせている
  - 手元の前回の実行は別のブランチのものかもしれず、ブランチを切り替えると無関係なpushが止まった。止まった記録はsnapshotに残り、再実行しても消えなかった
  - CIでmainの結果をActionsのキャッシュで引き継ぐと、7日使われなかったキャッシュが消えて判定が止まる。テストを弱めた変更が一度mainに入ると、後の無関係なPRが落ち続ける
- 分岐点の依存は`pnpm install --frozen-lockfile --offline --ignore-scripts`で入れる。`--ignore-scripts`は、lefthookの`prepare`がこのリポジトリの`.git/hooks`を書き換えないようにするため。`node_modules`のsymlinkは使わない。mutatorの`--since`が、未追跡のsymlinkを読んで失敗するため。worktreeは、割り込まれても消す
- 分岐点のテストが今の依存で落ちるなど、比べる相手を作れなかったときは、警告を出して失敗にしない。作ったのにmutatorが比べられなかったとき（`comparison: "unavailable"`）は、仕組みの故障なので失敗にする。レポートの形が変わったときも、黙って0件にせず失敗にする。`schemaVersion`は`"2"`だけを受け付ける
- 所要時間は、この雛形を手元で測ると、変更が無いときに約20秒、テストを変えたときに約30秒で、ほとんどが分岐点の全件の実行である。何も検出しない新しいテストを見つける`--kill-matrix`は、ミュータントごとにテストを全部動かし、テストを変えたときに約20秒遅くなるので、CIだけで付ける
- CIでは、PRでテストを弱めた変更があれば`check (Linux)`を失敗させる。`check (Linux)`はマージに必須のチェックである。変更した行の検出漏れはPRの差分に警告として表示する。GitHubが1ステップに表示する警告は10件までなので、変更した行に絞る。警告はmutatorではなく`scripts/mutation-report.ts`が出す。mutatorの注釈は「等価ならmutator accept」と案内し、テストを弱めた変更の失敗の横に並ぶと、acceptで通してよいように読めるため。続けて全件を実行して全体のスコアをジョブの概要に出す。判定が失敗しても、スコアは出す。mainへのpushでは全件だけを実行する
- mutatorの設定（`mutator.config.*`）と`mutator.accepted.json`を変えると、テストを弱めずに検査の範囲を狭められるので、PRで変わったら警告する
- `src/services/ports.ts`は対象から外す。サービスの識別子の文字列だけで、空にしても観測できない
- 等価ミュータントは、理由を付けて`mutator.accepted.json`に記録する

### E2Eの決まり

- 操作は画面から行う。コマンドパレット、入力欄、クリックを使う
- 合否は画面に出たもので決める。拡張が保存したファイルのように、利用者が後で開けば見られる結果は、直接読んでよい
- 準備は、起動前に書くファイルで行う。ユーザー設定は`settings.json`に、開くファイルは一時的なワークスペースに書く。テストは`settings`、`files`、`openFolder`のオプションで指定する
- 起動後にVS Code APIで準備したいテストが出てきたら、テスト専用の拡張(driver)を`e2e/driver`に足す。driverを使えるのは準備用のフィクスチャだけにし、テスト本体から使えないことをfallowの境界検査で守る。いまの見本のテストには要らないので、雛形には入れていない
- 内部のデータで合否を決めたいテストは、E2Eではなく結合テストに書く
- 起動のたびに一時的なユーザーデータを作る。パスは短くする。macOSではソケットのパスが約103文字までのためである
- `ELECTRON_RUN_AS_NODE`を外してから起動する。他のツールがこれを設定していると、VS CodeがNode.jsとして起動してしまう
- 他の拡張は無効にする
- ロケーターはroleとラベルで書き、VS Codeの画面の操作は`e2e/pages`にまとめる
- web版は、desktop版のVS Codeに`--extensionDevelopmentKind=web`を渡し、web版の拡張ホストで動かして確かめる

VS Codeの実行ファイルは、環境変数`VSCODE_EXECUTABLE`があればそれを使い、無ければ`@vscode/test-electron`で最新の安定版をダウンロードする。

- Linuxでは、Nixの`e2e`シェルが`VSCODE_EXECUTABLE`にnixpkgsのVSCodiumを渡す。VSCodiumはVS Codeと同じソースから作られ、拡張機能のAPIも同じである。VS Code本体はunfreeで、nixpkgsのバイナリキャッシュに無く、ビルドの度にMicrosoftのサーバーから取得する必要があるので使わない。この版は最低の版でもある
- Windowsでは、最新の安定版をダウンロードする
- こうすると、CI全体で最低の版と最新の版の両方を確かめられる
- Playwrightは`_electron`でVS Codeを起動するだけで、ブラウザは使わない。そのためPlaywrightのブラウザのダウンロードは要らず、`@playwright/test`の版をnixpkgsに合わせる必要もない

## 静的な検査

- oxlintで、型を使うルールも含めて検査する
- oxfmtで整形する
- fallowで、層の境界、禁止した呼び出し、未使用のコード、循環参照、重複を検査する
- rumdlでMarkdownを検査する
- 自作のlintを3つ持つ
  - `ja-space`は、和文と英数字の間の半角空白を検出し、直す
  - `no-suppress`は、lintや型検査、ミューテーションテストを黙らせるコメントを禁止する
  - `pnpm-policy`は、供給網対策のpnpmの設定が消えたり緩められたりしていないかを検査する

## 開発環境

- Nixのflakeが、Node.js 24、pnpm 12、shellcheck、actionlintを固定する。E2E用の`e2e`シェルは、VS Codeとxvfbも加える。nixpkgsは安定版のチャンネルにし、7日以上前のrevに固定する
- `.envrc`に`use flake`を置く。direnvは補助で、無くても`nix develop`で同じ環境に入れる
- pnpmは、公開から7日以上経った版だけを入れる。依存のインストールスクリプトは、`allowBuilds`で許可したものだけを動かす
- lefthookで、pre-commitに変更したファイルの整形とlint、pre-pushに`pnpm check`と差分のミューテーションテストを動かす。テストを弱めた変更はpushを止める

## CI

- LinuxとWindowsで、lint、型検査、テスト、ビルド、E2Eを動かす。有名な拡張の多くがこの2つを使っている。WindowsではNixが動かないので、Node.jsとpnpmを直接入れる。版は`.node-version`と`package.json`の`packageManager`から読む。`engines.node`は`^24.22.1`の範囲にする。完全に固定すると、Node.jsを自前で用意するDependabotがインストールで止まるため。Linuxでは`scripts/check-env.ts`が、Nixの入れたNode.jsとpnpmがこの2つと一致することを検査する。こうして、版を書く場所を`flake.lock`、`.node-version`、`package.json`に限り、食い違えばCIで落とす
- Linuxでは、ミューテーションテストも動かす。PRで変更した行の検出漏れは警告として表示し、テストを弱めた変更だけを失敗にする
- CIは、手元の`pnpm check`がまとめて動かす検査を、1つずつのステップに分けて動かす。どの検査で落ちたかが一覧で分かる。`pnpm check`に検査を足したら、`ci.yml`にも同じステップを足す
- CodeQLと、プルリクエストで増える依存関係のレビューを動かす。既に入っている依存の`pnpm audit`は、週1回の定期実行で動かす。プルリクエストで動かすと、修正版の無い勧告が出たときに無関係な変更まで落ちる
- Actionsは、タグではなくコミットのハッシュで固定する。リポジトリの設定（`.github/settings/`）でもハッシュでの固定を必須にする
- 依存関係の更新はDependabotに任せる。npm、GitHub Actions、Nixのいずれも、公開から7日経つまで更新しない。Renovateは使わない。Dependabotは設定ファイルだけで動き、GitHubのアプリを入れる必要がないため
- タグを付けると、`.vsix`を作ってGitHubのReleaseに添付する。Marketplaceには公開しない

## 採用しなかったもの

- Biome。型を使うlintが、TypeScript本体ではなく独自の型推論で動くため
- `node --test`。Effectの層やTestClockを扱う仕組みが無いため
- `@vscode/test-cli`とMocha。E2EはPlaywrightに一本化した
- `gh actions-lock`。この雛形を作った環境では使えず、ハッシュでの固定とDependabotで足りるため
- `@vscode/test-web`。web版の確認は、desktop版のVS Codeのweb版拡張ホストで行う
- tsdown。型定義の生成など、ライブラリ向けの機能が中心のため
