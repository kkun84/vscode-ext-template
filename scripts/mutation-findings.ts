// 直前のミューテーションテストの結果から、テストを弱めた変更を見つけて、GitHub Actionsの注釈の形で出す。
// テストを弱めた変更があれば終了コード1で終わる。判定はmutation-report.tsにある。
//
// 使い方: node scripts/mutation-findings.ts [基準のref]
// 基準のref（例: origin/main）を渡すと、そこからの変更にmutatorの設定が含まれるときも警告する。
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { Schema } from "effect"
import { MutationReport, reviewFindings, reviewSettingChanges } from "./mutation-report.ts"

const root = resolve(import.meta.dirname, "..")
const path = ".mutator/report/mutation.json"

const load = (): MutationReport | undefined => {
  try {
    return Schema.decodeUnknownSync(MutationReport)(JSON.parse(readFileSync(join(root, path), "utf8")))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined
    }
    throw error
  }
}

const changedFiles = (base: string | undefined): ReadonlyArray<string> =>
  base === undefined ? [] : execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: root, encoding: "utf8" }).split("\n")

const review = reviewFindings(load(), path)
process.stdout.write(`${[...reviewSettingChanges(changedFiles(process.argv[2])), ...review.lines].join("\n")}\n`)
process.exitCode = review.exitCode
