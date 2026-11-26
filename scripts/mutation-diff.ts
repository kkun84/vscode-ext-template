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
// 基準を作れなかった（分岐点のテストが今の依存で落ちるなど）ときは、警告を出して成功にする。
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Schema } from "effect"
import { isEnvironmentFile, MutationReport, reviewFindings, reviewMissingBaseline, reviewSettingChanges } from "./mutation-report.ts"

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

// 出力を受け取るときは、失敗した時だけ表示する。inheritなら、そのまま流す。
const run = (command: string, args: ReadonlyArray<string>, cwd: string, inherit = false): Result => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
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

/** 基準を作れたらtrue。作れなければ、理由を警告にして出す。 */
const buildBaseline = (base: string, worktree: string): boolean => {
  const added = git("worktree", "add", "--detach", worktree, base)
  if (!added.ok) {
    say(tail(added.output))
    say(reviewMissingBaseline(`基準のコミット${base}を取り出せませんでした。`))
    return false
  }
  // 環境のファイルを、基準のものから今のものに入れ替える。今だけにあるものは足し、基準だけにあるものは消す。
  for (const name of readdirSync(worktree).filter((file) => isEnvironmentFile(file))) {
    rmSync(join(worktree, name))
  }
  for (const name of readdirSync(root).filter((file) => isEnvironmentFile(file))) {
    copyFileSync(join(root, name), join(worktree, name))
  }
  // --ignore-scriptsで、lefthookのprepareがこのリポジトリの.git/hooksを書き換えないようにする。
  // node_modulesは今のものをsymlinkで使い回さない。mutatorの--sinceが、未追跡のsymlinkを読んで失敗するため。
  const installed = pnpm(["install", "--frozen-lockfile", "--offline", "--ignore-scripts"], worktree)
  if (!installed.ok) {
    say(tail(installed.output))
    say(
      reviewMissingBaseline(`基準のコミット${base}に、今の依存を入れられませんでした。先に今の作業ツリーでpnpm installを実行してください。`)
    )
    return false
  }
  say(`基準のコミット${base}で、ミューテーションテストを全件実行します。`)
  const started = performance.now()
  const full = run(process.execPath, [mutatorCli(worktree), "--reporter", "json"], worktree)
  if (!full.ok) {
    say(tail(full.output))
    say(
      reviewMissingBaseline(
        `基準のコミット${base}で、ミューテーションテストの全件が失敗しました。基準のテストが今の依存で落ちるときに起きます。`
      )
    )
    return false
  }
  say(`基準の結果ができました（${Math.round((performance.now() - started) / 1000)}秒）。変更を入れた作業ツリーで、差分を実行します。`)
  return true
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
    root,
    true
  )
  if (!diff.ok) {
    say("::error title=ミューテーションテストが失敗した::変更を入れた作業ツリーで、mutatorが失敗しました。上の出力を確かめてください。")
    return 1
  }
  const changed = git("diff", "--name-only", `${base}..HEAD`)
  const review = reviewFindings(loadReport(), reportPath)
  say([...reviewSettingChanges(changed.output.split("\n")), ...review.lines].join("\n"))
  return review.exitCode
}

const main = (): number => {
  if (!git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`).ok) {
    say(`skipping mutation:diff: ${ref} not found`)
    return 0
  }
  const mergeBase = git("merge-base", ref, "HEAD")
  if (!mergeBase.ok) {
    say(reviewMissingBaseline(`${ref}とHEADの分岐点が見つかりませんでした。`))
    return 0
  }
  const base = mergeBase.output.trim()
  // 前回に強制終了されて残った登録を消す。
  git("worktree", "prune")
  const temporary = mkdtempSync(join(tmpdir(), "mutation-base-"))
  const worktree = join(temporary, "base")
  try {
    if (!buildBaseline(base, worktree)) {
      return 0
    }
    adoptBaseline(worktree)
  } finally {
    git("worktree", "remove", "--force", worktree)
    rmSync(temporary, { recursive: true, force: true })
    git("worktree", "prune")
  }
  return judge(base)
}

try {
  process.exitCode = main()
} catch (error) {
  if (!(error instanceof Interrupted)) {
    throw error
  }
  process.exitCode = 130
}
