# lintの設定と、その経緯

この雛形のlintの設定のうち、既定から変えたものと、その理由を記録します。カスタムlintの経緯は、各ルールのREADME.mdにあります。

- [ja-space](../scripts/lint/ja-space/README.md)
- [no-suppress](../scripts/lint/no-suppress/README.md)
- [pnpm-policy](../scripts/lint/pnpm-policy/README.md)

設定を変えるときは、ここに理由を書き足します。lintに掛かる書き方を別の書き方で避けるのではなく、設定を変えるべきかをここで判断します。

## oxlint（[.oxlintrc.json](../.oxlintrc.json)）

### `typescript/prefer-readonly-parameter-types`: off

VS CodeやEffectの型は読み取り専用ではないため、この規則を満たすには、`vscode.ExtensionContext`の代わりの独自型や、層を作る関数を余計に作る必要があります。回り道のコードを生むだけなので、規則を外しました。

### `no-underscore-dangle`: `_tag`と`_meta`を許す

Effectのタグ付きの型は`_tag`で判別するので、この名前は避けられません。許さないと、`notice["_tag"]`のように角括弧で書いて規則を避けるコードが生まれます。

### `dot-notation`: error

上の角括弧の書き方を、規則で塞ぎました。名前が規則に掛かるなら、角括弧で避けるのではなく、設定で許すかどうかを決めます。

## fallow（[.fallowrc.json](../.fallowrc.json)）

### `ignoreDependencies`

`@effect/language-service`と`@effect/tsgo`だけを入れています。前者はtsconfigのプラグイン、後者は`scripts/typecheck.ts`が実行ファイルとして呼ぶので、importの解析では使用を検出できません。

ここに依存を足すと未使用の依存を見逃すので、importで検出できないものだけを入れます。

### `duplicates.ignore`: テストファイル

テストは、前提を揃えるために似た準備を並べます。共通化すると、個々のテストが何を確かめているかが読みにくくなるので、重複の検出から外しました。

## 型検査

型検査は`tsc`ではなく`@effect/tsgo`で行います。`tsc`はEffectの診断（エラー型にbrandが無い、など）を出さないので、`tsc`が通っても`pnpm typecheck`で落ちることがあります。

## アーキテクチャの規則（[architecture.rules.json](../architecture.rules.json)）

`ARCH-EXTERNAL-001`は`src/core`から外部パッケージを使うことを禁じます。`src/core`のテストはvitestを使うので、テストファイルは除外しました。
