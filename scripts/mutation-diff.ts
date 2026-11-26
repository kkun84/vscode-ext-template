// 基準のrefとの差分をミューテーションテストし、テストを弱めた変更があれば終了コード1で終わる。
// pre-push（pnpm mutation:diff）とCIのPRで同じものを動かす。判定はmutation-report.tsにある。
//
// 使い方: node scripts/mutation-diff.ts [基準のref] [--kill-matrix] [--skip-without-base]
// - 基準のrefの既定はorigin/main
// - --kill-matrixを付けると、何も検出しない新しいテスト（newTestNoKills）も見つける。ミュータントごとに
//   テストを全部動かすので、テストを変えたときは遅くなる。CIだけで付ける
// - --skip-without-baseを付けると、基準のrefが無いとき（雛形から作った直後のcloneなど）とGitの外では
//   何もしない。手元のpre-pushだけで付ける。CIで基準が無いのは設定の誤りなので、失敗にする
// 知らない指定は、終了コード2で止める。
//
// 比べる相手は、前回の実行の結果ではなく、毎回その場で作る。前回の結果に頼ると、ブランチを切り替えた
// だけで無関係な変更が止まり、環境のファイルが1文字変わっただけで判定が黙って外れるため。
// まず、基準のrefとHEADの分岐点のコミットを、一時ディレクトリにgit worktreeで取り出す。mutatorの環境ハッシュを
// 今と揃えるため、package.jsonなどの環境のファイルを今の作業ツリーから写し、依存を入れて、全件を実行する。
// その結果（.mutatorのsnapshot）を今の作業ツリーの.mutatorに入れ、分岐点からの差分を実行して判定する。
// 基準を作れなかった（分岐点のテストが今の依存で落ちるなど）ときは、理由を出して失敗にする。
//
// 基準も今の設定で作るので、設定を狭めた変更は差分に現れない。そこで、分岐点の設定で集めていたテスト
// ファイルと、対象だったソースファイルのうち、今もあるのに今の設定から外れたものを失敗にする。
import { spawnSync } from "node:child_process"
import {
  closeSync,
  copyFileSync,
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { loadConfig } from "@mizchi/mutator"
import { Schema } from "effect"
import { resolveConfig } from "vitest/node"
import {
  isEnvironmentFile,
  missingFrom,
  MutationReport,
  parseOptions,
  reviewBaselineFailure,
  reviewDroppedSources,
  reviewDroppedTests,
  reviewFindings,
  reviewSettingChanges,
  reviewSkippedTests,
  reviewUnreadableReport
} from "./mutation-report.ts"

const root = resolve(import.meta.dirname, "..")
const reportPath = ".mutator/report/mutation.json"
const mutatorCli = (directory: string): string => join(directory, "node_modules/@mizchi/mutator/dist/cli.js")
const vitestCli = (directory: string): string => join(directory, "node_modules/vitest/vitest.mjs")
// 分岐点の設定ファイルを、基準のworktreeの中で今の設定に入れ替える前に写しておく場所。
const BASE_CONFIG_DIR = ".mutation-base-config"

// 割り込まれたら、一時的なworktreeを消してから終わる。Ctrl+Cは子のプロセスにも届くので、子がシグナルで
// 止まったことで知る。シグナルを受け取る関数を置くのは、Node.jsがその場で終わらないようにするため。
class Interrupted extends Error {}

// SIGHUP、SIGINT、SIGTERMで終わったときの終了コード。
const SIGNAL_EXITS: ReadonlySet<number> = new Set([129, 130, 143])

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    process.exitCode = 130
  })
}

interface Result {
  readonly ok: boolean
  readonly output: string
}

// 出力は受け取って返す。表示するかは呼ぶ側が決める。
const run = (command: string, args: ReadonlyArray<string>, cwd: string): Result => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    // mutatorがGitHub Actionsの注釈を出すと、「等価ならmutator accept」の案内が判定の注釈と並ぶ。
    // 注釈はmutation-report.tsで出し直すので、mutatorには出させない。
    env: { ...process.env, GITHUB_ACTIONS: "" },
    shell: command === "pnpm" && process.platform === "win32"
  })
  // mutatorはシグナルを受けると、自分で後片付けをして128+シグナル番号で終わる。
  if (result.signal !== null || (result.status !== null && SIGNAL_EXITS.has(result.status))) {
    throw new Interrupted(result.signal ?? String(result.status))
  }
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` }
}

const git = (...args: ReadonlyArray<string>): Result => run("git", args, root)

// pnpm runから呼ばれたときは、同じpnpmを使う。
const pnpm = (args: ReadonlyArray<string>, cwd: string): Result => {
  const execPath = process.env["npm_execpath"]
  return execPath !== undefined && /\.[cm]?js$/u.test(execPath) ? run(process.execPath, [execPath, ...args], cwd) : run("pnpm", args, cwd)
}

const tail = (output: string): string => output.trimEnd().split("\n").slice(-20).join("\n")

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const fromRoot = (file: string): string => relative(root, resolve(root, file))

const insideRoot = (file: string): boolean => !file.startsWith("..") && !isAbsolute(file)

const VitestFiles = Schema.Struct({
  configFile: Schema.optionalKey(Schema.String),
  test: Schema.optionalKey(
    Schema.Struct({
      setupFiles: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
      globalSetup: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)]))
    })
  )
})

// Vitestの設定ファイルと、それが読むsetupFilesとglobalSetupも、mutatorの環境ハッシュに入る
//（mutator-vitestのconfigFiles）。根からの相対パスで返す。根の外のものは、基準でも同じなので要らない。
const vitestFiles = async (): Promise<{ readonly configFile: ReadonlyArray<string>; readonly setupFiles: ReadonlyArray<string> }> => {
  const config = Schema.decodeUnknownSync(VitestFiles)(await resolveConfig({ root, watch: false }))
  const pick = (files: ReadonlyArray<string>): ReadonlyArray<string> =>
    files.map((file) => fromRoot(file)).filter((file) => insideRoot(file) && existsSync(join(root, file)))
  return {
    configFile: pick(config.configFile === undefined ? [] : [config.configFile]),
    setupFiles: pick([config.test?.setupFiles ?? [], config.test?.globalSetup ?? []].flat())
  }
}

const TestList = Schema.Array(Schema.Struct({ file: Schema.String }))

class BaselineFailure extends Error {}

/** Vitestが集めるテストファイル（根からのパス）。`config`を渡すと、その設定で今の作業ツリーから集める。 */
const collectedTests = (directory: string, temporary: string, config?: string): ReadonlyArray<string> => {
  const output = join(temporary, `tests-${config === undefined ? "now" : "base"}.json`)
  const listed = run(
    process.execPath,
    [
      vitestCli(directory),
      "list",
      "--filesOnly",
      "--root",
      root,
      ...(config === undefined ? [] : ["--config", config]),
      `--json=${output}`
    ],
    directory
  )
  if (!listed.ok) {
    say(tail(listed.output))
    throw new BaselineFailure(
      `${config === undefined ? "今" : "分岐点"}のVitestの設定で、テストファイルを集められませんでした（上の出力）。`
    )
  }
  return Schema.decodeUnknownSync(TestList)(JSON.parse(readFileSync(output, "utf8"))).map((entry) => fromRoot(entry.file))
}

// mutatorが対象にするソースファイルを、今の作業ツリーから集める。node_modules/@mizchi/mutator/src/setup.tsの
// resolveSetupと同じ既定と除外を使う。
const DEFAULT_INCLUDE = ["src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"]
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/*.d.ts", "**/*.{test,spec}.*", "**/__tests__/**"]

const mutatedSources = async (directory: string, file?: string): Promise<ReadonlyArray<string>> => {
  const config = (await loadConfig(directory, file))?.config
  return globSync([...(config?.include ?? DEFAULT_INCLUDE)], { cwd: root, exclude: [...DEFAULT_EXCLUDE, ...(config?.exclude ?? [])] })
    .map((path) => fromRoot(path))
    .toSorted()
}

interface Scope {
  readonly baseTests: ReadonlyArray<string>
  readonly baseSources: ReadonlyArray<string>
}

/** 基準を作る。作れなければBaselineFailureを投げる。分岐点の設定で集めたテストと対象のソースを返す。 */
const buildBaseline = async (base: string, worktree: string, temporary: string, setupFiles: ReadonlyArray<string>): Promise<Scope> => {
  const added = git("worktree", "add", "--detach", worktree, base)
  if (!added.ok) {
    say(tail(added.output))
    throw new BaselineFailure(`基準のコミット${base}を一時ディレクトリに取り出せませんでした。上のgitの出力を確かめてください。`)
  }
  // 分岐点のVitestとmutatorの設定を、今のものに入れ替える前に写しておく。
  const baseConfigs = readdirSync(worktree).filter((file) => /^(?:vitest|mutator)\.config\./u.test(file))
  mkdirSync(join(worktree, BASE_CONFIG_DIR))
  for (const name of baseConfigs) {
    copyFileSync(join(worktree, name), join(worktree, BASE_CONFIG_DIR, name))
  }
  // 環境のファイルを、基準のものから今のものに入れ替える。今だけにあるものは足し、基準だけにあるものは消す。
  for (const name of readdirSync(worktree).filter((file) => isEnvironmentFile(file))) {
    rmSync(join(worktree, name))
  }
  for (const name of readdirSync(root).filter((file) => isEnvironmentFile(file))) {
    copyFileSync(join(root, name), join(worktree, name))
  }
  for (const file of setupFiles) {
    mkdirSync(dirname(join(worktree, file)), { recursive: true })
    copyFileSync(join(root, file), join(worktree, file))
  }
  // --ignore-scriptsで、lefthookのprepareがこのリポジトリの.git/hooksを書き換えないようにする。
  // node_modulesは今のものをsymlinkで使い回さない。mutatorの--sinceが、未追跡のsymlinkを読んで失敗するため。
  const installed = pnpm(["install", "--frozen-lockfile", "--offline", "--ignore-scripts"], worktree)
  if (!installed.ok) {
    say(tail(installed.output))
    throw new BaselineFailure(
      `基準のコミット${base}に、今の依存を入れられませんでした。今の作業ツリーでpnpm installを実行してから、もう一度実行してください。`
    )
  }
  // 分岐点のVitestの設定が無ければ、Vitestの既定で集める。
  const baseVitest = baseConfigs.find((name) => name.startsWith("vitest.")) ?? "vitest.config.mjs"
  if (!baseConfigs.includes(baseVitest)) {
    writeFileSync(join(worktree, BASE_CONFIG_DIR, baseVitest), "export default {}\n")
  }
  const baseMutator = baseConfigs.find((name) => name.startsWith("mutator."))
  const scope = {
    baseTests: collectedTests(worktree, temporary, join(worktree, BASE_CONFIG_DIR, baseVitest)),
    baseSources: await mutatedSources(worktree, baseMutator === undefined ? undefined : join(worktree, BASE_CONFIG_DIR, baseMutator))
  }
  say(`基準のコミット${base}で、ミューテーションテストを全件実行します。`)
  const started = performance.now()
  const full = run(process.execPath, [mutatorCli(worktree), "--reporter", "json"], worktree)
  if (!full.ok) {
    say(tail(full.output))
    throw new BaselineFailure(
      `基準のコミット${base}のテストが、今の依存と設定では通りませんでした（上の出力）。多くは、依存の更新でテストが壊れたときに起きます。今の作業ツリーでpnpm testが通るように直してください。今のテストが通るのに起きるときは、基準のテストが今の依存や設定（setupFilesなど）に合っていません。依存や設定の変更と、それに合わせたテストの直しを分け、新旧どちらでも通る直しを先にmainに入れてください。`
    )
  }
  say(`基準の結果ができました（${Math.round((performance.now() - started) / 1000)}秒）。変更を入れた作業ツリーで、差分を実行します。`)
  return scope
}

// 基準の全件の結果のうち、次の実行が比べる相手として読むsnapshotだけを写す。
// mutatorは.mutator/scopes/<対象の範囲>.jsonと.mutator/snapshot.jsonを読む（src/snapshot-store.ts）。
// 中断から再開するための.resume.sqliteと、レポートは写さない。
const adoptBaseline = (worktree: string): void => {
  const target = join(root, ".mutator")
  rmSync(target, { recursive: true, force: true })
  mkdirSync(join(target, "scopes"), { recursive: true })
  const source = join(worktree, ".mutator")
  const scopes = existsSync(join(source, "scopes")) ? readdirSync(join(source, "scopes")).filter((file) => file.endsWith(".json")) : []
  for (const name of scopes) {
    copyFileSync(join(source, "scopes", name), join(target, "scopes", name))
  }
  if (existsSync(join(source, "snapshot.json"))) {
    copyFileSync(join(source, "snapshot.json"), join(target, "snapshot.json"))
  }
}

const loadReport = (): { readonly report?: MutationReport; readonly error?: string } => {
  if (!existsSync(join(root, reportPath))) {
    return {}
  }
  try {
    return { report: Schema.decodeUnknownSync(MutationReport)(JSON.parse(readFileSync(join(root, reportPath), "utf8"))) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const judge = async (
  base: string,
  scope: Scope,
  temporary: string,
  setupFiles: ReadonlyArray<string>,
  killMatrix: boolean
): Promise<0 | 1> => {
  const diff = run(
    process.execPath,
    [
      mutatorCli(root),
      "--since",
      base,
      "--include-test-changes",
      ...(killMatrix ? ["--kill-matrix"] : []),
      "--reporter",
      "text",
      "--reporter",
      "json"
    ],
    root
  )
  process.stdout.write(diff.output)
  if (!diff.ok) {
    say("::error title=ミューテーションテストが失敗した::変更を入れた作業ツリーで、mutatorが失敗しました。上の出力を確かめてください。")
    return 1
  }
  // 分岐点の設定から外れたもののうち、今もあるもの。消したファイルは、テストを弱めた変更として検出する。
  const droppedTests = reviewDroppedTests(
    missingFrom(scope.baseTests, collectedTests(root, temporary)).filter((file) => existsSync(join(root, file)))
  )
  const droppedSources = reviewDroppedSources(missingFrom(scope.baseSources, await mutatedSources(root)))
  // コミットしていない変更と、まだ追跡していないファイルも含める。mutatorの--sinceと同じ範囲にする。
  const changed = [
    ...git("diff", "--name-only", base).output.split("\n"),
    ...git("ls-files", "--others", "--exclude-standard").output.split("\n")
  ]
  const loaded = loadReport()
  const review =
    loaded.error === undefined
      ? reviewFindings(loaded.report, reportPath)
      : { lines: [reviewUnreadableReport(reportPath, loaded.error)], exitCode: 1 as const }
  say(
    [
      ...reviewSettingChanges(changed, setupFiles),
      ...reviewSkippedTests(diff.output),
      ...droppedTests,
      ...droppedSources,
      ...review.lines
    ].join("\n")
  )
  return droppedTests.length > 0 || droppedSources.length > 0 ? 1 : review.exitCode
}

// 同じ作業ツリーで2つ同時に動かすと、.mutatorを取り合ってmutatorが落ちる。Gitの管理ディレクトリに
// 自分のプロセス番号を書いたロックを置き、先に動いているものが生きていれば止める。
const acquireLock = (): string | undefined => {
  const path = resolve(root, git("rev-parse", "--git-path", "mutation-diff.lock").output.trim())
  for (const attempt of [1, 2]) {
    try {
      const handle = openSync(path, "wx")
      writeFileSync(handle, String(process.pid))
      closeSync(handle)
      return path
    } catch {
      if (attempt === 2 || isAlive(Number(readFileSync(path, "utf8")))) {
        return undefined
      }
      // 書いたプロセスがもう無い。強制終了で残ったロックなので消して取り直す。
      rmSync(path, { force: true })
    }
  }
  return undefined
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const withBaseline = async (ref: string, killMatrix: boolean): Promise<number> => {
  const mergeBase = git("merge-base", ref, "HEAD")
  if (!mergeBase.ok) {
    say(
      reviewBaselineFailure(`${ref}とHEADの分岐点が見つかりませんでした。浅いcloneなら、履歴を取得してください（git fetch --unshallow）。`)
    )
    return 1
  }
  const base = mergeBase.output.trim()
  // 前回に強制終了されて残った登録を消す。
  git("worktree", "prune")
  const temporary = mkdtempSync(join(tmpdir(), "mutation-base-"))
  const worktree = join(temporary, "base")
  try {
    const { configFile, setupFiles } = await vitestFiles()
    let scope: Scope
    try {
      scope = await buildBaseline(base, worktree, temporary, [...configFile, ...setupFiles])
      adoptBaseline(worktree)
    } finally {
      git("worktree", "remove", "--force", worktree)
      git("worktree", "prune")
    }
    return await judge(base, scope, temporary, setupFiles, killMatrix)
  } catch (error) {
    if (!(error instanceof BaselineFailure)) {
      throw error
    }
    say(reviewBaselineFailure(error.message))
    return 1
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

const main = async (): Promise<number> => {
  const options = parseOptions(process.argv.slice(2))
  if (typeof options === "string") {
    process.stderr.write(`${options}\n使い方: node scripts/mutation-diff.ts [基準のref] [--kill-matrix] [--skip-without-base]\n`)
    return 2
  }
  if (!git("rev-parse", "--verify", "--quiet", `${options.ref}^{commit}`).ok) {
    if (options.skipWithoutBase) {
      say(`skipping mutation:diff: ${options.ref} not found`)
      return 0
    }
    say(
      reviewBaselineFailure(
        `基準のref（${options.ref}）が見つかりませんでした。CIではactions/checkoutにfetch-depth: 0を付けて、マージ先のブランチを取得してください。`
      )
    )
    return 1
  }
  const lock = acquireLock()
  if (lock === undefined) {
    say(
      "::error title=ミューテーションテストが動いている::同じ作業ツリーで、別のmutation-diff.tsが動いています。終わってから、もう一度実行してください。"
    )
    return 1
  }
  try {
    return await withBaseline(options.ref, options.killMatrix)
  } finally {
    rmSync(lock, { force: true })
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  if (!(error instanceof Interrupted)) {
    throw error
  }
  process.exitCode = 130
}
