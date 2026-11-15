// 和文と英数字の間の半角空白を検査する。`--fix`で直す。
// 使い方: node scripts/lint/ja-space/cli.ts [--fix] [paths...]
// パスを渡さなければリポジトリ全体を検査する。判定はrule.ts、経緯はREADME.mdにある。
import { readFileSync, writeFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import { report, runAsCli } from "../shared/files.ts"
import { findFiles, type FoundFile } from "./files.ts"
import { detectJaSpace, fixJaSpace } from "./rule.ts"

const REPO_ROOT = resolve(import.meta.dirname, "../../..")

const check = (file: FoundFile): ReadonlyArray<string> => {
  const display = relative(REPO_ROOT, file.path) || file.path
  return detectJaSpace(readFileSync(file.path, "utf8"), { mode: file.mode }).map(
    (violation) => `${display}:${violation.line}:${violation.column}: remove the space between Japanese and ASCII (${violation.direction})`
  )
}

const fix = (file: FoundFile): number => {
  const { fixed, violations } = fixJaSpace(readFileSync(file.path, "utf8"), { mode: file.mode })
  if (violations.length > 0) {
    writeFileSync(file.path, fixed)
  }
  return violations.length
}

export const run = (args: ReadonlyArray<string>): { readonly output: string; readonly exitCode: number } => {
  const files = findFiles(
    args.filter((arg) => !arg.startsWith("--")),
    REPO_ROOT
  )
  if (!args.includes("--fix")) {
    return report(
      "ja-space",
      files.flatMap((file) => check(file))
    )
  }
  const counts = files.map((file) => fix(file))
  const total = counts.reduce((sum, count) => sum + count, 0)
  const changed = counts.filter((count) => count > 0).length
  return { output: `ja-space: fixed ${total} violation(s) in ${changed} file(s)\n`, exitCode: 0 }
}

if (import.meta.main) {
  runAsCli(run)
}
