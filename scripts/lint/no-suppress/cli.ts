// lintや型検査を黙らせるコメントを検査する。自動では直さない。
// 使い方: node scripts/lint/no-suppress/cli.ts [paths...]
// パスを渡さなければリポジトリ全体を検査する。判定はrule.ts、経緯はREADME.mdにある。
import { readFileSync } from "node:fs"
import { extname, relative, resolve } from "node:path"
import { listFiles, report, runAsCli } from "../shared/files.ts"
import { findSuppressions, isSupportedSuppressionFile } from "./rule.ts"

const REPO_ROOT = resolve(import.meta.dirname, "../../..")

export const run = (args: ReadonlyArray<string>): { readonly output: string; readonly exitCode: number } => {
  const files = listFiles(
    args.filter((arg) => !arg.startsWith("--")),
    REPO_ROOT
  ).filter((file) => isSupportedSuppressionFile(file))
  const lines = files.flatMap((file) => {
    const display = relative(REPO_ROOT, file) || file
    return findSuppressions(readFileSync(file, "utf8"), extname(file).toLowerCase()).map(
      (finding) => `${display}:${finding.line}:${finding.column}: ${finding.message}`
    )
  })
  return report("no-suppress", lines)
}

if (import.meta.main) {
  runAsCli(run)
}
