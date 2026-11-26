// 基準のrefとの差分をミューテーションテストし、テストを弱めた変更があれば終了コード1で終わる。
// pre-push（pnpm mutation:diff）とCIのPRで同じものを動かす。判定はmutation-report.tsにある。
//
// 使い方: node scripts/mutation-diff.ts [基準のref] [--skip-without-base]
// - 基準のrefの既定はorigin/main
// - 差分の実行には、いつも--kill-matrixを付ける。前の「検出した」を使い回さず実行し直させるためで、
//   何も検出しない新しいテスト（newTestNoKills）も見つかる
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
// excludedMutatorsなどでミュータントの種類を減らした変更は、基準のコミットのミュータントを分岐点の設定と
// 今の設定で数えて、今の設定で消えるものを求める。それを分岐点の設定で実行し直し、検出していたテストが
// 変わっていれば失敗にする。
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  cpSync,
  existsSync,
  globSync,
  mkdirSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { loadConfig } from "@mizchi/mutator"
// 実行せずにミュータントを数える関数は、パッケージの入口から出ていない。mutatorの版は固定しているので、
// 版を上げて形が変わればpnpm typecheckと自己検査（mutation-diff-selftest.ts）が落ちる。
import { parseCli, resolveValues } from "../node_modules/@mizchi/mutator/dist/options.js"
import { listMutants } from "../node_modules/@mizchi/mutator/dist/run.js"
import { Schema } from "effect"
import { resolveConfig } from "vitest/node"
import {
  isEnvironmentFile,
  missingFrom,
  MutationReport,
  parseOptions,
  pendingKeys,
  reviewBaselineFailure,
  reviewDroppedMutants,
  reviewDroppedSources,
  reviewDroppedTests,
  reviewFindings,
  reviewNotRun,
  reviewRunLimits,
  reviewTrackedMutator,
  reviewUnselected,
  reviewSettingChanges,
  reviewSkippedTests,
  reviewUnreadableReport,
  MUTATOR_CONFIG_FILES,
  snapshotDeps,
  snapshotRows,
  touchedTests,
  unselectedCandidates
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

// 区切りは、Windowsでも/にそろえる。gitの出力やmutatorのテストのidと比べるため。
const fromRoot = (file: string, directory = root): string => relative(directory, resolve(directory, file)).split(sep).join("/")

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
  // 分岐点のmutatorの設定を写したファイル。分岐点に無ければ、既定と同じ空の設定。
  readonly baseMutatorConfig: string
}

const loadReport = (path: string): { readonly report?: MutationReport; readonly error?: string } => {
  if (!existsSync(path)) {
    return {}
  }
  try {
    return { report: Schema.decodeUnknownSync(MutationReport)(JSON.parse(readFileSync(path, "utf8"))) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
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
  // mutatorが探すのと同じ順で、最初に見つかった設定を使う。無ければ、mutatorの既定で数える。
  const baseMutator = MUTATOR_CONFIG_FILES.find((name) => baseConfigs.includes(name)) ?? "mutator.config.json"
  const baseMutatorConfig = join(worktree, BASE_CONFIG_DIR, baseMutator)
  if (!baseConfigs.includes(baseMutator)) {
    writeFileSync(baseMutatorConfig, "{}\n")
  }
  const scope = {
    baseTests: collectedTests(worktree, temporary, join(worktree, BASE_CONFIG_DIR, baseVitest)),
    baseSources: await mutatedSources(worktree, baseMutatorConfig),
    baseMutatorConfig
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
  // 実行しなかったミュータントが残ると、その分だけ比べる相手が欠け、テストを弱めても見逃す。
  const baseReport = loadReport(join(worktree, reportPath))
  if (baseReport.report === undefined) {
    throw new BaselineFailure(`基準のコミット${base}の全件の結果を読めませんでした。${baseReport.error ?? "レポートがありません。"}`)
  }
  const pending = pendingKeys(baseReport.report)
  if (pending.length > 0) {
    throw new BaselineFailure(
      `基準のコミット${base}の全件の実行で、実行しなかったミュータントが${pending.length}件ありました（${pending.slice(0, 5).join("、")}）。全件が途中で打ち切られています。`
    )
  }
  say(`基準の結果ができました（${Math.round((performance.now() - started) / 1000)}秒）。変更を入れた作業ツリーで、差分を実行します。`)
  return scope
}

/**
 * `keys`のミュータントだけを、--kill-matrixで`directory`の作業ツリーで実行し、レポートを`reportDir`に書く。
 * 失敗するか、レポートを読めなければ、mutatorの出力を表示してreportを返さない。
 */
const runOnly = (
  directory: string,
  keys: ReadonlyArray<string>,
  reportDir: string,
  extra: ReadonlyArray<string> = []
): { readonly report?: MutationReport; readonly error?: string } => {
  const result = run(
    process.execPath,
    [
      mutatorCli(directory),
      ...extra,
      ...keys.flatMap((key) => ["--only", key]),
      "--kill-matrix",
      "--reporter",
      "json",
      "--report-dir",
      reportDir
    ],
    directory
  )
  const loaded = loadReport(join(reportDir, "mutation.json"))
  if (!result.ok || loaded.report === undefined) {
    say(tail(result.output))
    return loaded.error === undefined ? {} : { error: loaded.error }
  }
  return loaded
}

interface Dropped {
  // 今の設定で消えたミュータントのキーと、そのファイル（根からのパス）。
  readonly mutants: ReadonlyArray<{ readonly key: string; readonly file: string }>
  // 消えたものを、基準のコミットで分岐点の設定のまま実行し直したレポート。消えたものが無ければ無い。
  readonly report?: MutationReport
}

/** 基準のコミットのミュータントを、実行せずに数える。`configFile`を渡さなければ、今の設定で数える。 */
const listKeys = async (worktree: string, configFile?: string): Promise<ReadonlyArray<{ readonly key: string; readonly file: string }>> => {
  const resolved = await resolveValues(parseCli(configFile === undefined ? [] : ["--config-file", configFile]), worktree)
  const real = realpathSync.native(worktree)
  return (await listMutants({ ...resolved.run, root: resolved.root }))
    .filter((mutant) => mutant.ignored === undefined)
    .map((mutant) => ({ key: mutant.key, file: fromRoot(mutant.file, real) }))
}

/**
 * excludedMutators、plugins、aridなどで、今の設定では消えるミュータントを求め、分岐点の設定で実行し直す。
 * 設定のキーを並べて調べず、数えたミュータントの集合で比べる。
 */
const measureDropped = async (worktree: string, temporary: string, scope: Scope): Promise<Dropped> => {
  const now = new Set((await listKeys(worktree)).map((mutant) => mutant.key))
  const dropped = (await listKeys(worktree, scope.baseMutatorConfig)).filter((mutant) => !now.has(mutant.key))
  if (dropped.length === 0) {
    return { mutants: [] }
  }
  say(`今のmutatorの設定で消えたミュータント${dropped.length}件を、基準のコミットで分岐点の設定のまま実行します。`)
  const loaded = runOnly(
    worktree,
    dropped.map((mutant) => mutant.key),
    join(temporary, "dropped"),
    ["--config-file", scope.baseMutatorConfig]
  )
  if (loaded.report === undefined) {
    throw new BaselineFailure(
      `今のmutatorの設定で消えたミュータントを、基準のコミットで分岐点の設定のまま実行できませんでした（上の出力）。${loaded.error ?? ""}`
    )
  }
  return { mutants: dropped, report: loaded.report }
}

// 基準の全件の結果のうち、次の実行が比べる相手として読むsnapshotだけを写す。
// mutatorは.mutator/scopes/<対象の範囲>.jsonと.mutator/snapshot.jsonを読む（src/snapshot-store.ts）。
// 中断から再開するための.resume.sqliteと、レポートは写さない。基準のレポートとsnapshotは、
// もう一度の実行（recheck）で使うので、一時ディレクトリに残す。
const adoptBaseline = (worktree: string, temporary: string): void => {
  for (const [from, to] of [
    [".mutator/report/mutation.json", "base-report.json"],
    [".mutator/snapshot.json", "base-snapshot.json"]
  ] as const) {
    if (existsSync(join(worktree, from))) {
      copyFileSync(join(worktree, from), join(temporary, to))
    }
  }
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

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))

const unreadable = (path: string, detail: string): ReadonlyArray<string> => [reviewUnreadableReport(path, detail)]

const SNAPSHOTS = "基準か今の.mutator/snapshot.json"

/**
 * 差分の実行で選ばれず、前の「検出した」が残ったミュータントを実行し直す（理由はmutation-report.tsの
 * unselectedCandidates）。.mutatorを退けてから--only --kill-matrixで実行し、終わったら戻す。
 */
const checkUnselected = (current: MutationReport, temporary: string, touched: (test: string) => boolean): ReadonlyArray<string> => {
  const baseReport = loadReport(join(temporary, "base-report.json"))
  if (baseReport.report === undefined) {
    return unreadable("基準のレポート", baseReport.error ?? "ありません。")
  }
  let keys: ReadonlyArray<string>
  try {
    keys = unselectedCandidates(
      baseReport.report,
      current,
      snapshotRows(readJson(join(temporary, "base-snapshot.json"))),
      snapshotRows(readJson(join(root, ".mutator/snapshot.json"))),
      touched
    )
  } catch (error) {
    return unreadable(SNAPSHOTS, error instanceof Error ? error.message : String(error))
  }
  if (keys.length === 0) {
    return []
  }
  say(`差分の実行で選ばれなかったミュータント${keys.length}件を、実行し直します。`)
  const held = join(temporary, "held-mutator")
  const directory = join(temporary, "unselected")
  cpSync(join(root, ".mutator"), held, { recursive: true })
  try {
    rmSync(join(root, ".mutator"), { recursive: true, force: true })
    const loaded = runOnly(root, keys, directory)
    if (loaded.report === undefined) {
      return unreadable("実行し直しのレポート", loaded.error ?? "実行し直しに失敗しました。")
    }
    return reviewUnselected(baseReport.report, keys, loaded.report)
  } finally {
    rmSync(join(root, ".mutator"), { recursive: true, force: true })
    cpSync(held, join(root, ".mutator"), { recursive: true })
  }
}

/** 基準から変わったテストかを返す関数。snapshotを読めなければ、理由の文字列を返す。 */
const readTouched = (
  temporary: string,
  current: MutationReport | undefined,
  changedFiles: ReadonlyArray<string>
): ((test: string) => boolean) | string => {
  try {
    return touchedTests(current, changedFiles, [
      snapshotDeps(readJson(join(temporary, "base-snapshot.json"))),
      snapshotDeps(readJson(join(root, ".mutator/snapshot.json")))
    ])
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const judge = async (
  base: string,
  scope: Scope,
  temporary: string,
  setupFiles: ReadonlyArray<string>,
  dropped: Dropped
): Promise<0 | 1> => {
  const diff = run(
    process.execPath,
    [mutatorCli(root), "--since", base, "--include-test-changes", "--kill-matrix", "--reporter", "text", "--reporter", "json"],
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
  const droppedFiles = missingFrom(scope.baseSources, await mutatedSources(root))
  const droppedSources = reviewDroppedSources(droppedFiles)
  // コミットしていない変更と、まだ追跡していないファイルも含める。mutatorの--sinceと同じ範囲にする。
  // 名前を変えたファイルは、前と後の両方の名前を入れる。
  const changed = [
    ...git("diff", "--no-renames", "--name-only", base).output.split("\n"),
    ...git("ls-files", "--others", "--exclude-standard").output.split("\n")
  ].filter((file) => file !== "")
  const loaded = loadReport(join(root, reportPath))
  const review =
    loaded.error === undefined
      ? reviewFindings(loaded.report, reportPath)
      : { lines: [reviewUnreadableReport(reportPath, loaded.error)], exitCode: 1 as const }
  const touched = readTouched(temporary, loaded.report, changed)
  const unselected =
    loaded.report === undefined
      ? []
      : typeof touched === "string"
        ? unreadable(SNAPSHOTS, touched)
        : checkUnselected(loaded.report, temporary, touched)
  // 対象から外したファイルのものは、上のdroppedSourcesで失敗にするので重ねない。
  const removedFiles = new Set(droppedFiles)
  const droppedKeys = dropped.mutants.filter((mutant) => !removedFiles.has(mutant.file)).map((mutant) => mutant.key)
  // snapshotを読めなければ、上のunselectedが失敗にする。
  const droppedMutants =
    dropped.report === undefined || droppedKeys.length === 0 || typeof touched === "string"
      ? []
      : reviewDroppedMutants(dropped.report, droppedKeys, touched)
  const droppedFailed = droppedMutants.some((line) => line.startsWith("::error"))
  const notRun = reviewNotRun(diff.output)
  say(
    [
      ...reviewSettingChanges(changed, setupFiles),
      ...reviewSkippedTests(diff.output),
      ...droppedTests,
      ...droppedSources,
      ...droppedMutants,
      ...notRun,
      ...unselected,
      ...review.lines
    ].join("\n")
  )
  return droppedTests.length > 0 || droppedSources.length > 0 || droppedFailed || notRun.length > 0 || unselected.length > 0
    ? 1
    : review.exitCode
}

// 同じ作業ツリーで2つ同時に動かすと、.mutatorを取り合ってmutatorが落ちる。Gitの管理ディレクトリに
// 自分のプロセス番号と一時ディレクトリを書いたロックを置き、先に動いているものが生きていれば止める。
// 強制終了で残ったロックは、書いたプロセスがもう無ければ、残った一時ディレクトリとworktreeを消して取り直す。
const LockInfo = Schema.Struct({ pid: Schema.Finite, temporary: Schema.optionalKey(Schema.String) })

type LockInfo = typeof LockInfo.Type

// 書きかけのロックを他が読まないように、別の名前で書いてから、linkで作る。linkは、ロックが既にあれば失敗する。
const createLock = (path: string, info: LockInfo): boolean => {
  const draft = `${path}.${process.pid}.tmp`
  writeFileSync(draft, JSON.stringify(info))
  try {
    linkSync(draft, path)
    return true
  } catch {
    return false
  } finally {
    rmSync(draft, { force: true })
  }
}

// 自分のロックに一時ディレクトリを書き足す。renameで置き換えるので、読む側は書きかけを見ない。
const updateLock = (path: string, info: LockInfo): void => {
  const draft = `${path}.${process.pid}.tmp`
  writeFileSync(draft, JSON.stringify(info))
  renameSync(draft, path)
}

const readLock = (path: string): LockInfo | undefined => {
  try {
    return Schema.decodeUnknownSync(LockInfo)(JSON.parse(readFileSync(path, "utf8")))
  } catch {
    return undefined
  }
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERMは、他のユーザーのプロセスとして生きている。
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

// 強制終了で残った一時ディレクトリと、その中のworktreeの登録を消す。作ったものと同じ名前の形のときだけ消す。
const removeLeftovers = (temporary: string | undefined): void => {
  if (temporary === undefined || !/^mutation-base-[^/\\]+$/u.test(relative(tmpdir(), temporary))) {
    return
  }
  git("worktree", "remove", "--force", join(temporary, "base"))
  rmSync(temporary, { recursive: true, force: true })
  git("worktree", "prune")
}

interface Lock {
  readonly path: string
  readonly held: boolean
}

const acquireLock = (): Lock => {
  const path = resolve(root, git("rev-parse", "--git-path", "mutation-diff.lock").output.trim())
  if (createLock(path, { pid: process.pid })) {
    return { path, held: true }
  }
  // 古いロックを2つが同時に見つけても、取り直すのは1つだけにする。mkdirは、既にあれば失敗する。
  // 取り直しの途中で強制終了されると、このディレクトリが残る。そのときは、止まった文言のパスを消してもらう。
  const reclaim = `${path}.reclaim`
  try {
    mkdirSync(reclaim)
  } catch {
    return { path: reclaim, held: false }
  }
  try {
    // 取り直しの役を得た後で読み直す。先に取り直した他のプロセスの、新しいロックを消さないため。
    const info = readLock(path)
    if (existsSync(path) && (info === undefined || isAlive(info.pid))) {
      return { path, held: false }
    }
    removeLeftovers(info?.temporary)
    rmSync(path, { force: true })
  } finally {
    rmSync(reclaim, { recursive: true, force: true })
  }
  return { path, held: createLock(path, { pid: process.pid }) }
}

const withBaseline = async (ref: string, lock: string): Promise<number> => {
  const tracked = reviewTrackedMutator(
    git("ls-files", "--", ".mutator")
      .output.split("\n")
      .filter((file) => file !== "")
  )
  if (tracked.length > 0) {
    say(tracked.join("\n"))
    return 1
  }
  const config = await loadConfig(root)
  const limits = reviewRunLimits(config?.config, config === undefined ? "mutator.config.*" : fromRoot(config.path))
  if (limits.length > 0) {
    say(limits.join("\n"))
    return 1
  }
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
  updateLock(lock, { pid: process.pid, temporary })
  const worktree = join(temporary, "base")
  try {
    const { configFile, setupFiles } = await vitestFiles()
    let scope: Scope
    let dropped: Dropped
    try {
      scope = await buildBaseline(base, worktree, temporary, [...configFile, ...setupFiles])
      adoptBaseline(worktree, temporary)
      dropped = await measureDropped(worktree, temporary, scope)
    } finally {
      git("worktree", "remove", "--force", worktree)
      git("worktree", "prune")
    }
    return await judge(base, scope, temporary, setupFiles, dropped)
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
    process.stderr.write(`${options}\n使い方: node scripts/mutation-diff.ts [基準のref] [--skip-without-base]\n`)
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
  if (!lock.held) {
    say(
      `::error title=ミューテーションテストが動いている::同じ作業ツリーで、別のmutation-diff.tsが動いています（ロック: ${lock.path}）。終わってから、もう一度実行してください。どれも動いていないのに止まるときは、このロックを消してください。`
    )
    return 1
  }
  try {
    return await withBaseline(options.ref, lock.path)
  } finally {
    rmSync(lock.path, { force: true })
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
