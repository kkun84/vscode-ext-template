// 自作lintが共通で使う、検査するファイルの列挙と、CLIの出力。
import { lstatSync, readdirSync } from "node:fs"
import { basename, join, resolve } from "node:path"

/** 検査しないディレクトリ。生成物、キャッシュ、参考用の複製。 */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  ".ref",
  ".vscode-test",
  "coverage",
  ".direnv",
  ".fallow",
  ".rumdl_cache",
  "playwright-report",
  "test-results"
])

const LOCKFILES: ReadonlySet<string> = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"])

/** 機械が書くロックファイルか。検査しない。 */
export const isLockfileName = (name: string): boolean => LOCKFILES.has(name) || name.endsWith(".lock")

const walk = (dir: string, out: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      walk(join(dir, entry.name), out)
    } else if (entry.isFile() && !isLockfileName(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
}

const collect = (path: string, out: string[]): void => {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (stat?.isDirectory() === true) {
    walk(path, out)
  } else if (stat?.isFile() === true && !isLockfileName(basename(path))) {
    out.push(path)
  }
}

/**
 * 検査するファイルの絶対パス。`paths`が空ならリポジトリ全体を探す。
 * シンボリックリンクは、リンク先を二重に数えないよう辿らない。
 */
export const listFiles = (paths: ReadonlyArray<string>, root: string): ReadonlyArray<string> => {
  const out: string[] = []
  for (const path of paths.length > 0 ? paths : [root]) {
    collect(resolve(path), out)
  }
  return out
}

/** 違反の一覧を出力して終了コードを決める。 */
export const report = (name: string, lines: ReadonlyArray<string>): { readonly output: string; readonly exitCode: number } =>
  lines.length === 0
    ? { output: `${name}: no violations found\n`, exitCode: 0 }
    : { output: `${lines.join("\n")}\n${name}: ${lines.length} violation(s) found\n`, exitCode: 1 }

/** CLIとして実行されたときに`run`を呼ぶ。テストからは`run`を直接呼ぶ。 */
export const runAsCli = (run: (args: ReadonlyArray<string>) => { readonly output: string; readonly exitCode: number }): void => {
  const { output, exitCode } = run(process.argv.slice(2))
  process.stdout.write(output)
  process.exitCode = exitCode
}
