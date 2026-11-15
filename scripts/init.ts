// 雛形から作ったリポジトリの名前を、自分の拡張機能のものに置き換える。
//
// 使い方:
//   node scripts/init.ts --name my-extension --publisher me --prefix myExtension \
//     --display-name "My Extension" --display-name-ja "私の拡張機能" --repository me/my-extension
//
// 置き換えるのは、拡張機能のID、コマンドと設定の接頭辞、表示名、サービスの名前空間。
// README.mdとdocs/は、自分の拡張機能に合わせて手で書き直す。
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { listFiles } from "./lint/shared/files.ts"

export interface Names {
  readonly name: string
  readonly publisher: string
  readonly prefix: string
  readonly displayName: string
  readonly displayNameJa: string
  readonly repository: string
}

/** 雛形の名前を置き換える。長い語から先に置き換え、短い語が長い語の一部を壊さないようにする。 */
export const rename = (text: string, names: Names): string =>
  [
    ["https://github.com/kkun84/vscode-ext-template", `https://github.com/${names.repository}`],
    ['"publisher": "kkun84"', `"publisher": "${names.publisher}"`],
    ["vscode-ext-template", names.name],
    ["extTemplate", names.prefix],
    ["VS Code Extension Template", names.displayName],
    ["Extension Template", names.displayName],
    ["VS Code拡張機能の雛形", names.displayNameJa],
    ["拡張機能の雛形", names.displayNameJa]
  ].reduce((current, [from, to]) => current.replaceAll(from ?? "", to ?? ""), text)

const TARGETS = /^(?:package(?:\.nls(?:\.[\w-]+)?)?\.json|l10n\/.*\.json|(?:src|e2e)\/.*\.ts)$/u

const main = (): void => {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      publisher: { type: "string" },
      prefix: { type: "string" },
      "display-name": { type: "string" },
      "display-name-ja": { type: "string" },
      repository: { type: "string" }
    }
  })
  const { name, publisher, prefix, repository } = values
  const displayName = values["display-name"]
  if (name === undefined || publisher === undefined || prefix === undefined || displayName === undefined || repository === undefined) {
    console.error(
      "--name、--publisher、--prefix、--display-name、--repositoryを指定してください。使い方はscripts/init.tsの先頭にあります。"
    )
    process.exitCode = 1
    return
  }
  const names: Names = { name, publisher, prefix, displayName, displayNameJa: values["display-name-ja"] ?? displayName, repository }
  const root = resolve(import.meta.dirname, "..")
  const files = listFiles([], root).filter((file) => TARGETS.test(file.slice(root.length + 1).replaceAll("\\", "/")))
  for (const file of files) {
    const before = readFileSync(file, "utf8")
    const after = rename(before, names)
    if (after !== before) {
      writeFileSync(file, after)
      console.log(`renamed: ${file.slice(root.length + 1)}`)
    }
  }
  console.log(`次に、${join("README.md")}とLICENSEを自分の拡張機能に合わせて書き直し、pnpm checkを実行してください。`)
}

if (import.meta.main) {
  main()
}
