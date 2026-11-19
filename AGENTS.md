# AGENTS.md

Effect v4で書くVS Code拡張機能の雛形です。設計は[docs/design.md](docs/design.md)にあります。

## 環境

- Node.jsの版は`.node-version`に、pnpmの版は`package.json`の`packageManager`に固定しています。Nixがあれば`nix develop`で揃います。
- 版が合っているかは`pnpm check-env`で確かめます。

## 完了の条件

変更を終える前に、次の2つを実行し、両方が成功することを確かめます。

- `pnpm check`: lint、型検査、テストとカバレッジ、ビルド、サイズの上限、`.vsix`の中身
- `pnpm test:e2e`: 実際のエディタを起動するE2Eテスト。Linuxでは`nix develop .#e2e`の中で`xvfb-run -a pnpm test:e2e`

`src/core`か`src/services`を変えたら、`pnpm mutation:diff`の結果も見直します。テストが検出できないミュータント（生き残りと、テストの届かないもの）があっても失敗にはなりません。

- 検出できないミュータントは、テストが足りないのか、コードが要らないのかを判断します
- テストを足すときは、呼び出す側から見える振る舞いを確かめます。ミュータントを落とすためだけに実装をなぞるテストは書きません
- 手順は`node_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.md`に従います
- 等価ミュータントだけを`pnpm exec mutator accept <key> --reason <理由>`で`mutator.accepted.json`に記録します。キーは`pnpm exec mutator --reporter agent`の`gaps[].key`にあります。テストを弱めた変更を通すために記録してはいけません。ミューテーションテストから外すものは、コメントではなく`mutator.config.json`の`exclude`に書きます。PRで`mutator.config.*`か`mutator.accepted.json`を変えると、CIが警告を出します

## 層の分け方

- `src/core`: 純粋な関数。VS Code、Node.js、Effectのサービスに依存しない
- `src/services`: 拡張機能の手順。外部とのやりとりは`ports.ts`のサービスを通す
- `src/layers`: サービスの実装。`vscode`はVS CodeのAPI、`node`と`web`は実行環境ごとの差分、`test`はテスト用
- `src/entrypoints`: `activate`とコマンドの登録だけを書く

境界はfallowが検査します。Node.jsの組み込みモジュールは`src/layers/node`の中でだけ使えます。Web版でも動かすため、ファイルの読み書きは`vscode.workspace.fs`を使います。

## 守ること

- lintや型検査の警告を、抑止コメントで黙らせてはいけません。`no-suppress`が検出します。警告が誤りだと考えるなら、設定を変える理由を[docs/lint-history.md](docs/lint-history.md)に書いてから設定を直します。
- 規則に掛かる名前を、角括弧のアクセスなど別の書き方で避けてはいけません。
- 型検査は`pnpm typecheck`で行います。`tsc`はEffectの診断を出さないので、`tsc`が通っても完了ではありません。
- 型付きのエラーを手順の中で握りつぶしてはいけません。サービスの関数はエラーをそのまま返し、通知に変えるのは`src/entrypoints/shared/commands.ts`だけです。
- `Date.now`と`Math.random`は`src/core`と`src/services`で使えません。時刻は`Clock`から取ります。
- `pnpm-workspace.yaml`の供給網対策の設定を緩めてはいけません。コマンドの引数で上書きすることも禁止です。インストールが通らないときは、緩めずに報告します。
- 依存関係は版を完全に固定します。

## テスト

- 単体テストと結合テストはVitestで、`src`の各ファイルの隣に置きます。サービスのテストは`src/layers/test`の層を使います。
- E2EテストはPlaywrightで、`e2e/`に置きます。操作と確認はすべてUIを通します。起動前の準備だけは、設定ファイルやワークスペースのファイルを書いて行います。
