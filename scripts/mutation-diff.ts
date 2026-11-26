// 基準のrefとの差分をミューテーションテストし、テストを弱めた変更があれば終了コード1で終わる。
// pre-push（pnpm mutation:diff）とCIのPRで同じものを動かす。判定はmutation-report.tsにある。
//
// 使い方: node scripts/mutation-diff.ts [基準のref] [--kill-matrix]（基準のrefの既定はorigin/main）
// --kill-matrixを付けると、何も検出しない新しいテスト（newTestNoKills）も見つける。ミュータントごとに
// テストを全部動かすので、テストを変えたときは遅くなる。CIだけで付ける。
//
// 比べる相手は、前回の実行の結果ではなく、毎回その場で作る。前回の結果に頼ると、ブランチを切り替えた
// だけで無関係な変更が止まり、環境のファイルが1文字変わっただけで判定が黙って外れるため。
// まず、基準のrefとHEADの分岐点のコミットを、一時ディレクトリにgit worktreeで取り出す。mutatorの環境ハッシュを
// 今と揃えるため、package.jsonなどの環境のファイルを今の作業ツリーから写し、依存を入れて、全件を実行する。
// その結果（.mutatorのsnapshot）を今の作業ツリーの.mutatorに入れ、分岐点からの差分を実行して判定する。
// 基準を作れなかった（分岐点のテストが今の依存で落ちるなど）ときは、理由を出して失敗にする。
// 基準のrefが無いとき（雛形から作った直後のcloneなど）と、Gitの外では何もしない。
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { Schema } from "effect"
import { resolveConfig } from "vitest/node"
import {
  isEnvironmentFile,
  MutationReport,
  reviewBaselineFailure,
  reviewFindings,
  reviewSettingChanges,
  reviewSkippedTests
} from "./mutation-report.ts"

const root = resolve(import.meta.dirname, "..")
const argv = process.argv.slice(2)
const killMatrix = argv.includes("--kill-matrix")
const ref = argv.find((arg) => !arg.startsWith("--")) ?? "origin/main"
const reportPath = ".mutator/report/mutation.json"
const mutatorCli = (directory: string): string => join(directory, "node_modules/@mizchi/mutator/dist/cli.js")

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
const vitestFiles = async (): Promise<ReadonlyArray<string>> => {
  const config = Schema.decodeUnknownSync(VitestFiles)(await resolveConfig({ root, watch: false }))
  return [config.configFile ?? [], config.test?.setupFiles ?? [], config.test?.globalSetup ?? []]
    .flat()
    .map((file) => relative(root, resolve(root, file)))
    .filter((file) => !file.startsWith("..") && !isAbsolute(file) && existsSync(join(root, file)))
}

class BaselineFailure extends Error {}

/** 基準を作る。作れなければBaselineFailureを投げる。 */
const buildBaseline = async (base: string, worktree: string): Promise<void> => {
  const added = git("worktree", "add", "--detach", worktree, base)
  if (!added.ok) {
    say(tail(added.output))
    throw new BaselineFailure(`基準のコミット${base}を一時ディレクトリに取り出せませんでした。上のgitの出力を確かめてください。`)
  }
  // 環境のファイルを、基準のものから今のものに入れ替える。今だけにあるものは足し、基準だけにあるものは消す。
  for (const name of readdirSync(worktree).filter((file) => isEnvironmentFile(file))) {
    rmSync(join(worktree, name))
  }
  for (const name of readdirSync(root).filter((file) => isEnvironmentFile(file))) {
    copyFileSync(join(root, name), join(worktree, name))
  }
  for (const file of await vitestFiles()) {
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
  say(`基準のコミット${base}で、ミューテーションテストを全件実行します。`)
  const started = performance.now()
  const full = run(process.execPath, [mutatorCli(worktree), "--reporter", "json"], worktree)
  if (!full.ok) {
    say(tail(full.output))
    throw new BaselineFailure(
      `基準のコミット${base}のテストが、今の依存と設定では通りませんでした（上の出力）。多くは、依存の更新でテストが壊れたときに起きます。今の作業ツリーでpnpm testが通るように直してください。今のテストが通るのに起きるときは、基準のテストが今の依存や設定（setupFilesなど）に合っていません。依存や設定の変更と、それに合わせたテストの直しを分け、テストの直しを先にmainに入れてください。`
    )
  }
  say(`基準の結果ができました（${Math.round((performance.now() - started) / 1000)}秒）。変更を入れた作業ツリーで、差分を実行します。`)
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

const loadReport = (): MutationReport | undefined =>
  existsSync(join(root, reportPath))
    ? Schema.decodeUnknownSync(MutationReport)(JSON.parse(readFileSync(join(root, reportPath), "utf8")))
    : undefined

const judge = (base: string): 0 | 1 => {
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
  const changed = git("diff", "--name-only", `${base}..HEAD`)
  const review = reviewFindings(loadReport(), reportPath)
  say([...reviewSettingChanges(changed.output.split("\n")), ...reviewSkippedTests(diff.output), ...review.lines].join("\n"))
  return review.exitCode
}

const main = async (): Promise<number> => {
  if (!git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`).ok) {
    say(`skipping mutation:diff: ${ref} not found`)
    return 0
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
  const worktree = join(temporary, "base")
  try {
    await buildBaseline(base, worktree)
    adoptBaseline(worktree)
  } catch (error) {
    if (!(error instanceof BaselineFailure)) {
      throw error
    }
    say(reviewBaselineFailure(error.message))
    return 1
  } finally {
    git("worktree", "remove", "--force", worktree)
    rmSync(temporary, { recursive: true, force: true })
    git("worktree", "prune")
  }
  return judge(base)
}

try {
  process.exitCode = await main()
} catch (error) {
  if (!(error instanceof Interrupted)) {
    throw error
  }
  process.exitCode = 130
}
