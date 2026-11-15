# lintの設定と、その経緯

この雛形のlintの設定のうち、既定から変えたものと、その理由を記録します。カスタムlintの経緯は、各ルールのREADME.mdにあります。

- [ja-space](../scripts/lint/ja-space/README.md)
- [no-suppress](../scripts/lint/no-suppress/README.md)
- [pnpm-policy](../scripts/lint/pnpm-policy/README.md)

設定を変えるときは、ここに理由を書き足します。

## 背景

この雛形は、実装の多くを安価なモデル（DeepSeek V4.1 Flash）に任せて作りました。任されたモデルは、lintを満たせないとき、設計を見直すより、lintに引っかからない書き方を探しがちです。一度の失敗なら依頼文で直しますが、繰り返す失敗はlintの設定やカスタムlintで防ぎます。

## oxlint（[.oxlintrc.json](../.oxlintrc.json)）

### `typescript/prefer-readonly-parameter-types`: off

VS CodeやEffectの型は読み取り専用ではないため、この規則を満たすには、`vscode.ExtensionContext`の代わりの独自型や、層を作る関数を余計に作る必要がありました。実際にそうした回り道のコードが書かれたので、規則を外しました。原因はコードではなく設定にありました。

### `no-underscore-dangle`: `_tag`と`_meta`を許す

Effectのタグ付きの型は`_tag`で判別するので、この名前は避けられません。許していなかったころ、規則を避けるために`notice["_tag"]`と角括弧で書いたコードがありました。

### `dot-notation`: error

上の角括弧の書き方を、規則で塞ぎました。名前が規則に掛かるなら、角括弧で避けるのではなく、設定で許すかどうかを決めます。

## fallow（[.fallowrc.json](../.fallowrc.json)）

### `ignoreDependencies`

`@effect/language-service`と`@effect/tsgo`だけを入れています。前者はtsconfigのプラグイン、後者は`scripts/typecheck.ts`が実行ファイルとして呼ぶので、importの解析では使用を検出できません。

まだ使っていない依存を先回りで入れたことがありましたが、未使用の依存を見逃す原因になるので外しました。

### `duplicates.ignore`: テストファイル

テストは、前提を揃えるために似た準備を並べます。共通化すると、個々のテストが何を確かめているかが読みにくくなるので、重複の検出から外しました。

## 型検査

型検査は`tsc`ではなく`@effect/tsgo`で行います。`tsc`はEffectの診断（エラー型にbrandが無い、など）を出しません。実装を任せたモデルは`tsc`で確かめて完了と報告し、Effectの診断で落ちたことがありました。`pnpm typecheck`はtsgoを使います。

## アーキテクチャの規則（[architecture.rules.json](../architecture.rules.json)）

`ARCH-EXTERNAL-001`は`src/core`から外部パッケージを使うことを禁じます。`src/core`のテストはvitestを使うので、テストファイルは除外しました。最初の仕様で書き漏らし、実装を任せたモデルが違反を正しく報告して気付きました。
