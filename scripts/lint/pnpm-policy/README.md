# pnpm-policy

pnpmの供給網対策の設定が、消されたり緩められたりしていないかを検査します。

- 対象: `pnpm-workspace.yaml`、`package.json`、`.npmrc`、`package.json`のscriptsとlefthookとワークフローのコマンド
- 実行: `node scripts/lint/pnpm-policy/cli.ts`
- 実装: [rule.ts](./rule.ts)、[cli.ts](./cli.ts)

## 守る設定

| 設定                 | 値               | 理由                                                                          |
| -------------------- | ---------------- | ----------------------------------------------------------------------------- |
| `minimumReleaseAge`  | 10080以上        | 公開から7日未満の版を入れない。乗っ取られた版は数日で取り下げられることが多い |
| `engineStrict`       | `true`           | `engines`のNode.jsとpnpmの版を強制する                                        |
| `trustPolicy`        | `no-downgrade`   | 以前より信頼の低い方法で公開された版を拒む                                    |
| `blockExoticSubdeps` | `true`           | 依存の依存がGitやURLから入るのを拒む                                          |
| `allowBuilds`        | 下の表のみ`true` | インストールスクリプトを動かすパッケージを限る                                |

コマンドの`--config.<key>`、`--no-frozen-lockfile`などで、設定を一時的に上書きすることも禁止します。

## インストールスクリプトを許すパッケージ

| パッケージ | 理由                    |
| ---------- | ----------------------- |
| `lefthook` | Gitのフックを入れるため |

`@vscode/vsce-sign`は`false`にしています。署名はMarketplaceへの公開で使うもので、この雛形は公開しないためです。

## 経緯

- 実装を任せたモデルは、インストールが通らないと設定を緩めて通そうとします。設定ファイルを読み取り専用にしても、コマンドの引数で上書きできるので、引数も検査します。
- `trustPolicy: no-downgrade`がlefthook 2.2.2を拒みました。2.2.1に留めています。
