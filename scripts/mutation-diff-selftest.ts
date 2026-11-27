// mutation-diff.tsを、一時的なGitリポジトリで本物のmutatorと一緒に動かして確かめる。
// mutatorを上げたときに、判定が黙って外れていないかを見るためのもの。CIのcheck (Linux)で毎回動かす。
// 約2分かかるので、pnpm checkには入れない。
//
// 手順: このリポジトリをcloneし、今の作業ツリーの判定のスクリプトを入れ、小さな見本のコードとテストだけを
// 対象にした設定でコミットする。そのコミットをorigin/mainとする。次を確かめる。
// - 何も変えずに動かすと、終了コード0で終わる
// - 関数の中を確かめるテストを1つ消すと、テストが弱くなったとして終了コード1で終わる
// - テストの題名だけを変えると、消したか題名を変えたテストとして警告し、終了コード0で終わる
// - モジュールの直下の正規表現を確かめるアサーションを消すと、終了コード1で終わる。このミュータントは
//   mutatorの差分の実行に選ばれないので、mutation-diff.tsが実行し直して見つける
// - 同じことを、テストが呼ぶヘルパーだけを弱めて行っても、終了コード1で終わる
// - mutatorの設定にsinceかtimeBudgetを足すと、名前を挙げて終了コード1で終わる
// - excludedMutatorsでミュータントを消すだけなら警告で終了コード0、それを検出していたアサーションも
//   消すと終了コード1で終わる
// - excludedMutatorsでミュータントを消し、テストが読み込むソースのコメントを変えるだけなら、終了コード0で終わる
// - tsconfig.jsonにnoUnusedParametersを足して、ミュータントをCompileErrorにし、それを検出していたテストも
//   消すと、終了コード1で終わる。基準も今のtsconfig.jsonで作るので、mutatorの比較からは消える
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

// 式を数値に置き換えるミュータントは、引数を使わなくなるので、noUnusedParametersのときだけコンパイルできない。
export const magnitude = (value: number): number => Math.abs(value)
`

const tests = `import { expect, it } from "vitest"
import { clamp, isWord, magnitude } from "./selftest-sample.ts"

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

it("絶対値を返す", () => {
  expect(magnitude(-3)).toBe(3)
})
`

// テストがヘルパーを通してだけ確かめる見本。ヘルパーはミューテーションテストの対象にしない。
const word = `const LOWER = /^[a-z]+$/u

export const isLower = (text: string): boolean => LOWER.test(text)
`

const helper = `import { expect } from "vitest"
import { isLower } from "../core/selftest-word.ts"

export const expectLower = (): void => {
  expect(isLower("abc")).toBe(true)
  expect(isLower("ab1")).toBe(false)
  expect(isLower("1abc")).toBe(false)
  expect(isLower("")).toBe(false)
}
`

const helperTests = `import { it } from "vitest"
import { expectLower } from "../testing/selftest-expect.ts"

it("英小文字だけかを見分ける", () => {
  expectLower()
})
`

const vitestConfig = `import { defineConfig } from "vitest/config"

export default defineConfig({
  test: { include: ["src/core/selftest-sample.test.ts", "src/core/selftest-word.test.ts"], environment: "node", passWithNoTests: false }
})
`

const mutatorConfig = (extra: object = {}): string =>
  `${JSON.stringify({ include: ["src/core/selftest-sample.ts", "src/core/selftest-word.ts"], reporters: ["json"], ...extra })}\n`

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
  writeFileSync(join(repo, "src/core/selftest-word.ts"), word)
  mkdirSync(join(repo, "src/testing"), { recursive: true })
  writeFileSync(join(repo, "src/testing/selftest-expect.ts"), helper)
  writeFileSync(join(repo, "src/core/selftest-word.test.ts"), helperTests)
  writeFileSync(join(repo, "vitest.config.ts"), vitestConfig)
  writeFileSync(join(repo, "mutator.config.json"), mutatorConfig())
  // 分岐点では、使わない引数を許す。
  const tsconfig = (noUnusedParameters: boolean): string => {
    const text = readFileSync(join(root, "tsconfig.json"), "utf8")
    if (!text.includes('"noUnusedParameters": true')) {
      throw new Error("tsconfig.jsonにnoUnusedParameters: trueがありません。自己検査の見本を合わせてください。")
    }
    return text.replace('"noUnusedParameters": true', `"noUnusedParameters": ${noUnusedParameters}`)
  }
  writeFileSync(join(repo, "tsconfig.json"), tsconfig(false))
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
  writeFileSync(join(repo, "src/core/selftest-sample.test.ts"), tests.replace("上限以下ならそのまま返す", "上限以下なら値を変えない"))
  const renamed = { name: "テストの題名だけを変える", ...diff() }
  // テストは残し、アサーションだけを消す。テストを消すとmutatorが自分で見つけるので、この形で確かめる。
  const withoutWordAssertions = tests.replace(
    '  expect(isWord("ab1")).toBe(false)\n  expect(isWord("1abc")).toBe(false)\n  expect(isWord("")).toBe(false)\n',
    ""
  )
  writeFileSync(join(repo, "src/core/selftest-sample.test.ts"), withoutWordAssertions)
  const topLevel = { name: "モジュールの直下を確かめるアサーションを消す", ...diff() }
  writeFileSync(join(repo, "src/core/selftest-sample.test.ts"), tests)
  writeFileSync(
    join(repo, "src/testing/selftest-expect.ts"),
    helper.replace('  expect(isLower("ab1")).toBe(false)\n  expect(isLower("1abc")).toBe(false)\n  expect(isLower("")).toBe(false)\n', "")
  )
  const viaHelper = { name: "ヘルパーだけを弱める", ...diff() }
  writeFileSync(join(repo, "src/testing/selftest-expect.ts"), helper)
  writeFileSync(join(repo, "mutator.config.json"), mutatorConfig({ since: "HEAD" }))
  const since = { name: "mutatorの設定にsinceを足す", ...diff() }
  writeFileSync(join(repo, "mutator.config.json"), mutatorConfig({ timeBudget: 6 }))
  const timeBudget = { name: "mutatorの設定にtimeBudgetを足す", ...diff() }
  // 正規表現のミュータントを種類ごと消す。
  writeFileSync(join(repo, "mutator.config.json"), mutatorConfig({ excludedMutators: ["Regex"] }))
  const excluded = { name: "excludedMutatorsでミュータントを消すだけ", ...diff() }
  writeFileSync(join(repo, "src/core/selftest-sample.test.ts"), withoutWordAssertions)
  const excludedWeakened = { name: "excludedMutatorsで消し、それを検出していたアサーションも消す", ...diff() }
  writeFileSync(join(repo, "src/core/selftest-sample.test.ts"), tests)
  writeFileSync(join(repo, "src/core/selftest-sample.ts"), `// テストが読み込むソースのコメント\n${sample}`)
  const excludedWithSource = { name: "excludedMutatorsで消し、テストが読み込むソースのコメントを変える", ...diff() }
  writeFileSync(join(repo, "src/core/selftest-sample.ts"), sample)
  writeFileSync(join(repo, "mutator.config.json"), mutatorConfig())
  writeFileSync(join(repo, "tsconfig.json"), tsconfig(true))
  writeFileSync(
    join(repo, "src/core/selftest-sample.test.ts"),
    without("絶対値を返す").replace("clamp, isWord, magnitude", "clamp, isWord")
  )
  const typeHidden = { name: "tsconfig.jsonでミュータントをCompileErrorにし、それを検出していたテストも消す", ...diff() }
  const cases = [
    unchanged,
    weakened,
    renamed,
    topLevel,
    viaHelper,
    since,
    timeBudget,
    excluded,
    excludedWeakened,
    excludedWithSource,
    typeHidden
  ]
  for (const result of cases) {
    process.stdout.write(`--- ${result.name}: 終了コード${result.status}\n${result.output}\n`)
  }
  const passed = check(cases, [
    { status: 0, text: "判定の結果: エラー0件" },
    { status: 1, text: "title=テストが弱くなった::" },
    { status: 0, text: "title=テストを消したか、題名を変えた::" },
    { status: 1, text: "差分の実行で選ばれなかったため実行し直すと" },
    { status: 1, text: "差分の実行で選ばれなかったため実行し直すと" },
    { status: 1, text: "mutator.config.jsonにsince（" },
    { status: 1, text: "mutator.config.jsonにtimeBudget（" },
    { status: 0, text: "title=ミュータントが設定で外れた::" },
    { status: 1, text: "title=テストを弱めて、設定で比べる対象から外した::" },
    { status: 0, text: "title=ミュータントが設定で外れた::" },
    { status: 1, text: "title=テストを弱めて、設定で比べる対象から外した::" }
  ])
  process.stdout.write(
    passed
      ? "判定の自己検査: 何も変えなければ成功し、テストやアサーションを消すか、判定を外す設定を足せば失敗しました。\n"
      : "::error title=判定の自己検査が失敗した::何も変えなければ成功し、テストを消すか判定を外す設定を足せば失敗する、を満たしませんでした。上の各場合の出力を確かめてください。mutatorを上げたときは、レポートの形と判定（scripts/mutation-report.ts、scripts/mutation-diff.ts）を合わせてください。\n"
  )
  process.exitCode = passed ? 0 : 1
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
