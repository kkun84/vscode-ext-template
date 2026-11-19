# no-suppress

lintや型検査の警告を、コメントで黙らせていないかを検査します。

- 対象の指示: oxlint、ESLint、TypeScript（`@ts-ignore`など）、fallow、oxfmt、Prettier、Effectの言語サービス、ミューテーションテスト（mutatorとStrykerJSの無効化コメント）
- 実行: `node scripts/lint/no-suppress/cli.ts`
- 実装: [rule.ts](./rule.ts)、[cli.ts](./cli.ts)

警告が誤りなら、コメントで消さずに設定を直し、その理由を設定ファイルか[docs/lint-history.md](../../../docs/lint-history.md)に書きます。

## 経緯

- chrome-ext-templateから移植し、この雛形の道具に合わせて対象を足しました（oxfmt、fallow、`@effect-diagnostics`）。
- 抑止コメントは、警告の原因を直さずに消す最も手軽な方法なので、一律に禁止しました。
- mutatorの無効化コメントは、書いた行をミューテーションテストから外し、弱いテストのまま合格させられるので、禁止に足しました。検査から外すものは`mutator.config.json`の`exclude`に書きます。
- `rule.ts`自身が指示の文字列を含まないよう、指示は部品を連結して組み立てています。
