# no-suppress

lintや型検査の警告を、コメントで黙らせていないかを検査します。

- 対象の指示: oxlint、ESLint、TypeScript（`@ts-ignore`など）、fallow、oxfmt、Prettier、Effectの言語サービス
- 実行: `node scripts/lint/no-suppress/cli.ts`
- 実装: [rule.ts](./rule.ts)、[cli.ts](./cli.ts)

警告が誤りなら、コメントで消さずに設定を直し、その理由を設定ファイルか[docs/lint-history.md](../../../docs/lint-history.md)に書きます。

## 経緯

- chrome-ext-templateから移植し、この雛形の道具に合わせて対象を足しました（oxfmt、fallow、`@effect-diagnostics`）。
- 実装を任せたモデルは、lintを満たせないときに抜け道を探します。抑止コメントはその最も手軽な抜け道なので、一律に禁止しました。
- `rule.ts`自身が指示の文字列を含まないよう、指示は部品を連結して組み立てています。
