// mutation-diff.tsを、一時的なGitリポジトリで本物のmutatorと一緒に動かして確かめる。
// mutatorを上げたときに、判定が黙って外れていないかを見るためのもの。CIのcheck (Linux)で毎回動かす。
// 1分ほどかかるので、pnpm checkには入れない。
//
// 手順: このリポジトリをcloneし、今の作業ツリーの判定のスクリプトを入れ、小さな見本のコードとテストだけを
// 対象にした設定でコミットする。そのコミットをorigin/mainとする。何も変えずに動かすと終了コード0で、
// 見本のテストを1つ消して動かすと、テストが弱くなったとして終了コード1で終わることを確かめる。
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")

const run = (command: string, args: ReadonlyArray<string>, cwd: string): { readonly status: number | null; readonly output: string } => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GITHUB_ACTIONS: "" }
  })
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` }
}

const must = (command: string, args: ReadonlyArray<string>, cwd: string): void => {
  const result = run(command, args, cwd)
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")}が失敗しました。\n${result.output}`)
  }
}

const pnpm = (args: ReadonlyArray<string>, cwd: string): void => {
  const execPath = process.env["npm_execpath"]
  if (execPath !== undefined && /\.[cm]?js$/u.test(execPath)) {
    must(process.execPath, [execPath, ...args], cwd)
  } else {
    must("pnpm", args, cwd)
  }
}

const sample = `export const clamp = (value: number, max: number): number => (value > max ? max : value)
`

const tests = `import { expect, it } from "vitest"
import { clamp } from "./selftest-sample.ts"

it("上限を超えたら上限にする", () => {
  expect(clamp(5, 3)).toBe(3)
})

it("上限以下ならそのまま返す", () => {
  expect(clamp(2, 3)).toBe(2)
})
`

const vitestConfig = `import { defineConfig } from "vitest/config"

export default defineConfig({ test: { include: ["src/core/selftest-sample.test.ts"], environment: "node", passWithNoTests: false } })
`

const mutatorConfig = `${JSON.stringify({ include: ["src/core/selftest-sample.ts"], reporters: ["json"] })}\n`

interface Case {
  readonly name: string
  readonly status: number | null
  readonly output: string
}

const check = (cases: ReadonlyArray<Case>, expected: ReadonlyArray<{ readonly status: number; readonly text: string }>): boolean =>
  cases.every((result, index) => result.status === expected[index]?.status && result.output.includes(expected[index]?.text ?? ""))

const temporary = mkdtempSync(join(tmpdir(), "mutation-selftest-"))
try {
  const repo = join(temporary, "repo")
  must("git", ["clone", "--quiet", "--no-hardlinks", root, repo], temporary)
  for (const file of ["scripts/mutation-diff.ts", "scripts/mutation-report.ts"]) {
    copyFileSync(join(root, file), join(repo, file))
  }
  writeFileSync(join(repo, "src/core/selftest-sample.ts"), sample)
  writeFileSync(join(repo, "src/core/selftest-sample.test.ts"), tests)
  writeFileSync(join(repo, "vitest.config.ts"), vitestConfig)
  writeFileSync(join(repo, "mutator.config.json"), mutatorConfig)
  must("git", ["add", "-A"], repo)
  must(
    "git",
    [
      "-c",
      "user.name=selftest",
      "-c",
      "user.email=selftest@example.invalid",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--quiet",
      "-m",
      "base"
    ],
    repo
  )
  must("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], repo)
  // --ignore-scriptsで、lefthookのprepareがフックを入れないようにする。
  pnpm(["install", "--frozen-lockfile", "--offline", "--ignore-scripts"], repo)

  const diff = (): { readonly status: number | null; readonly output: string } =>
    run(process.execPath, [join(repo, "scripts/mutation-diff.ts"), "origin/main"], repo)
  const unchanged = { name: "何も変えない", ...diff() }
  writeFileSync(join(repo, "src/core/selftest-sample.test.ts"), tests.slice(0, tests.indexOf('\nit("上限以下なら')))
  const weakened = { name: "テストを1つ消す", ...diff() }
  const cases = [unchanged, weakened]
  for (const result of cases) {
    process.stdout.write(`--- ${result.name}: 終了コード${result.status}\n${result.output}\n`)
  }
  const passed = check(cases, [
    { status: 0, text: "テストが弱くなった箇所: 0件" },
    { status: 1, text: "title=テストが弱くなった::" }
  ])
  process.stdout.write(
    passed
      ? "判定の自己検査: 何も変えなければ成功し、テストを消せば失敗しました。\n"
      : "::error title=判定の自己検査が失敗した::何も変えなければ成功し、テストを消せば失敗する、を満たしませんでした。mutatorを上げたときは、レポートの形と判定（scripts/mutation-report.ts）を合わせてください。\n"
  )
  process.exitCode = passed ? 0 : 1
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
