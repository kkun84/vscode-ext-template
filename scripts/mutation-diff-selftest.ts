// mutation-diff.tsを、一時的なGitリポジトリで本物のmutatorと一緒に動かして確かめる。
// mutatorを上げたときに、判定が黙って外れていないかを見るためのもの。CIのcheck (Linux)で毎回動かす。
// 1分ほどかかるので、pnpm checkには入れない。
//
// 手順: このリポジトリをcloneし、今の作業ツリーの判定のスクリプトを入れ、小さな見本のコードとテストだけを
// 対象にした設定でコミットする。そのコミットをorigin/mainとする。次の3つを確かめる。
// - 何も変えずに動かすと、終了コード0で終わる
// - 関数の中を確かめるテストを1つ消すと、テストが弱くなったとして終了コード1で終わる
// - モジュールの直下の正規表現を確かめるアサーションを消すと、終了コード1で終わる。このミュータントは
//   mutatorの差分の実行に選ばれないので、mutation-diff.tsが実行し直して見つける
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

const sample = `const WORD = /^[a-z]+$/u

export const clamp = (value: number, max: number): number => (value > max ? max : value)

export const isWord = (text: string): boolean => WORD.test(text)
`

const tests = `import { expect, it } from "vitest"
import { clamp, isWord } from "./selftest-sample.ts"

it("上限を超えたら上限にする", () => {
  expect(clamp(5, 3)).toBe(3)
})

it("上限以下ならそのまま返す", () => {
  expect(clamp(2, 3)).toBe(2)
})

it("英小文字だけなら単語とみなす", () => {
  expect(isWord("abc")).toBe(true)
  expect(isWord("ab1")).toBe(false)
  expect(isWord("1abc")).toBe(false)
  expect(isWord("")).toBe(false)
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
  const without = (name: string): string => {
    const start = tests.indexOf(`\nit("${name}`)
    const end = tests.indexOf("\n})\n", start) + "\n})\n".length
    return tests.slice(0, start) + tests.slice(end)
  }
  writeFileSync(join(repo, "src/core/selftest-sample.test.ts"), without("上限以下なら"))
  const weakened = { name: "関数の中を確かめるテストを消す", ...diff() }
  // テストは残し、アサーションだけを消す。テストを消すとmutatorが自分で見つけるので、この形で確かめる。
  writeFileSync(
    join(repo, "src/core/selftest-sample.test.ts"),
    tests.replace('  expect(isWord("ab1")).toBe(false)\n  expect(isWord("1abc")).toBe(false)\n  expect(isWord("")).toBe(false)\n', "")
  )
  const topLevel = { name: "モジュールの直下を確かめるアサーションを消す", ...diff() }
  const cases = [unchanged, weakened, topLevel]
  for (const result of cases) {
    process.stdout.write(`--- ${result.name}: 終了コード${result.status}\n${result.output}\n`)
  }
  const passed = check(cases, [
    { status: 0, text: "テストが弱くなった箇所: 0件" },
    { status: 1, text: "title=テストが弱くなった::" },
    { status: 1, text: "差分の実行で選ばれなかったため実行し直すと" }
  ])
  process.stdout.write(
    passed
      ? "判定の自己検査: 何も変えなければ成功し、テストやアサーションを消せば失敗しました。\n"
      : "::error title=判定の自己検査が失敗した::何も変えなければ成功し、テストを消せば失敗する、を満たしませんでした。mutatorを上げたときは、レポートの形と判定（scripts/mutation-report.ts）を合わせてください。\n"
  )
  process.exitCode = passed ? 0 : 1
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
