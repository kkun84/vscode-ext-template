// ミューテーションテストの結果（.mutator/report/mutation.json）から、テストを弱めた変更を見つけて、
// GitHub Actionsの注釈の形の行と終了コードにする。基準を作ってmutatorを動かすのはmutation-diff.ts。
//
// 失敗にするのは、変わっていないコードについて、前は検出できたミュータントを今は検出できない
//（detectionRegression）ときと、基準と比べられなかったとき。比べられないのは、基準を作った後では
// 仕組みの故障なので、黙って通さない。何も検出しない新しいテスト（newTestNoKills）と、
// 変更した行の検出できないミュータントは警告にする。スコアは表示だけで、この判定には使わない。

import { Schema } from "effect"

const MutantRecord = Schema.Struct({
  id: Schema.String,
  mutatorName: Schema.String,
  replacement: Schema.String,
  location: Schema.Struct({ start: Schema.Struct({ line: Schema.Finite }) }),
  status: Schema.String,
  killedBy: Schema.Array(Schema.String)
})

type MutantRecord = typeof MutantRecord.Type

// kindごとに持つ項目が違う。kindは今後増えうるので、知らないkindは読み飛ばす。
const Finding = Schema.Struct({
  kind: Schema.String,
  key: Schema.optionalKey(Schema.String),
  test: Schema.optionalKey(Schema.String),
  previousKillers: Schema.optionalKey(Schema.Array(Schema.String))
})

type Finding = typeof Finding.Type

/**
 * mutator 0.4のjsonレポーターの出力のうち、判定に使う部分。形が変わったら黙って0件にせず、読み込みで失敗させる。
 * schemaVersionはmutation-testing-elementsの版で、mutatorの版が上がっても変わらないことがある。
 */
export const MutationReport = Schema.Struct({
  schemaVersion: Schema.Literal("2"),
  comparison: Schema.Literals(["available", "unavailable"]),
  findings: Schema.Array(Finding),
  // 変更したテストファイルをテストランナーが拾っていない、などの結果を疑わせる事情。無ければ項目ごと無い。
  warnings: Schema.optionalKey(Schema.Array(Schema.Struct({ file: Schema.optionalKey(Schema.String), message: Schema.String }))),
  files: Schema.Record(Schema.String, Schema.Struct({ mutants: Schema.Array(MutantRecord) })),
  // 前回と比べて足した、変えた、消したテスト。比べる相手があるときだけある。
  testChanges: Schema.optionalKey(
    Schema.Struct({ added: Schema.Array(Schema.String), changed: Schema.Array(Schema.String), removed: Schema.Array(Schema.String) })
  ),
  // 変えたテストが届くので差分の実行に選んだミュータントと、そのテスト。--include-test-changesのときだけある。
  selectionReasons: Schema.optionalKey(Schema.Array(Schema.Struct({ key: Schema.String, tests: Schema.Array(Schema.String) })))
})

export type MutationReport = typeof MutationReport.Type

export interface Review {
  readonly lines: ReadonlyArray<string>
  readonly exitCode: 0 | 1
}

export interface Annotation {
  readonly level: "error" | "warning" | "notice"
  readonly title: string
  readonly message: string
  readonly file?: string
  readonly line?: number
}

// 注釈の値の中の改行と区切りを符号化する。符号化の規則はGitHub Actionsのtoolkitに合わせる。
const escapeData = (text: string): string => text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")

const escapeProperty = (text: string): string => escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C")

/** `::error file=...,line=...,title=...::本文`の1行にする。 */
export const formatAnnotation = (annotation: Annotation): string => {
  const properties = [
    ...(annotation.file === undefined ? [] : [`file=${escapeProperty(annotation.file)}`]),
    ...(annotation.line === undefined ? [] : [`line=${annotation.line}`]),
    `title=${escapeProperty(annotation.title)}`
  ]
  return `::${annotation.level} ${properties.join(",")}::${escapeData(annotation.message)}`
}

interface Located {
  readonly key: string
  readonly change: string
  readonly file?: string
  readonly line?: number
}

const locate = (report: MutationReport, key: string): Located => {
  const found = Object.entries(report.files)
    .flatMap(([file, entry]) => entry.mutants.filter((mutant) => mutant.id === key).map((mutant) => ({ file, mutant })))
    .at(0)
  return found === undefined
    ? { key, change: "" }
    : {
        key,
        change: `（${found.mutant.mutatorName}で${found.mutant.replacement}に置き換え）`,
        file: found.file,
        line: found.mutant.location.start.line
      }
}

const position = (located: Located): Pick<Annotation, "file" | "line"> => ({
  ...(located.file === undefined ? {} : { file: located.file }),
  ...(located.line === undefined ? {} : { line: located.line })
})

const describeKillers = (killers: ReadonlyArray<string>): string =>
  killers.length === 0 ? "テスト" : killers.map((killer) => `「${killer}」`).join("、")

/** テストを弱めた変更で失敗したときの直し方。mutatorが出す「等価ならaccept」の案内と取り違えないように書く。 */
export const regressionAdvice = "mutator acceptで通さないでください。弱めたテストを戻すか、同じ振る舞いを確かめるテストを足してください。"

const regression = (report: MutationReport, finding: Finding): Annotation => {
  const located = locate(report, finding.key ?? "")
  return {
    level: "error",
    title: "テストが弱くなった",
    message: `変わっていないコードのミュータント${located.key}${located.change}を、前は${describeKillers(finding.previousKillers ?? [])}が検出していましたが、今はどのテストも検出しません。${regressionAdvice}`,
    ...position(located)
  }
}

const gap = (report: MutationReport, finding: Finding): Annotation => {
  const located = locate(report, finding.key ?? "")
  return {
    level: "warning",
    title: "テストが検出できないミュータント",
    message: `ミュータント${located.key}${located.change}を、どのテストも検出しません。テストが足りないのか、コードが要らないのかを見直してください。どんな入力でも振る舞いが変わらない等価ミュータントだけは、mutator accept ${located.key} --reason <理由>で記録できます。`,
    ...position(located)
  }
}

const noKills = (finding: Finding): Annotation => ({
  level: "warning",
  title: "何も検出しない新しいテスト",
  message: `「${finding.test ?? ""}」は、どのミュータントも検出しません。振る舞いを確かめるアサーションがあるかを見直してください。`
})

const caveat = (warning: { readonly file?: string; readonly message: string }): Annotation => ({
  level: "warning",
  title: "ミューテーションテストの結果を疑わせる事情",
  message: warning.message,
  ...(warning.file === undefined ? {} : { file: warning.file })
})

const unavailable: Annotation = {
  level: "error",
  title: "基準と比べられなかった",
  message:
    "基準のコミットで全件を実行したのに、mutatorが基準の結果を使えませんでした（comparison: unavailable）。テストが弱くなったかを確かめられないので失敗にします。基準に写す環境のファイル（mutation-report.tsのisEnvironmentFile）が、mutatorの環境ハッシュに入るファイルと合っているかを確かめてください。"
}

const guide = "node_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.md"

/** 結果を判定する。`report`が無ければ、結果のファイルが無いとして失敗にする。 */
export const reviewFindings = (report: MutationReport | undefined, path: string): Review => {
  if (report === undefined) {
    return {
      lines: [
        formatAnnotation({
          level: "error",
          title: "ミューテーションテストの結果が無い",
          message: `${path}がありません。先にmutatorを--reporter jsonを付けて実行してください。`
        })
      ],
      exitCode: 1
    }
  }
  const of = (kind: string): ReadonlyArray<Finding> => report.findings.filter((finding) => finding.kind === kind)
  const regressed = new Set(of("detectionRegression").map((finding) => finding.key))
  const regressions = of("detectionRegression").map((finding) => regression(report, finding))
  // テストを弱めて検出できなくなったミュータントは、上のエラーで知らせるので、警告を重ねない。
  const gaps = of("mutationGap")
    .filter((finding) => !regressed.has(finding.key))
    .map((finding) => gap(report, finding))
  const idle = of("newTestNoKills").map((finding) => noKills(finding))
  const caveats = (report.warnings ?? []).map((warning) => caveat(warning))
  const broken = report.comparison === "unavailable"
  return {
    lines: [
      ...[...(broken ? [unavailable] : []), ...regressions, ...idle, ...caveats, ...gaps].map((annotation) => formatAnnotation(annotation)),
      `テストが弱くなった箇所: ${regressions.length}件、何も検出しない新しいテスト: ${idle.length}件、テストが検出できないミュータント: ${gaps.length}件`,
      ...(gaps.length === 0
        ? []
        : [
            `テストが検出できないミュータントは失敗にしません。テストが足りないのか、コードが要らないのかを見直してください。手順は${guide}にあります。`
          ])
    ],
    exitCode: broken || regressions.length > 0 ? 1 : 0
  }
}

/**
 * 基準を作れなかったときの注釈。失敗にする。多くは依存の更新でテストが壊れたときで、そのときは
 * 普段のテストも落ちるので、失敗にしても余計な手間は増えない。黙って通すと、その間はテストを弱めた変更が通る。
 */
export const reviewBaselineFailure = (reason: string): string =>
  formatAnnotation({
    level: "error",
    title: "比較の基準を作れなかった",
    message: `${reason} 基準が無いと、テストが弱くなったかを確かめられないので失敗にします。`
  })

// mutatorのtextレポーターが、変更の中で飛ばしたテスト（it.skipなど）を知らせる行。
// jsonレポーターには載らないので、textの出力から拾う（node_modules/@mizchi/mutator/src/report.tsのskippedMessage）。
const SKIPPED = /^warning: (?<file>.+?):(?<line>\d+) skips a test in the change, so it checks nothing: (?<text>.*)$/gmu

/** mutatorのtextの出力から、変更の中で飛ばしたテストを警告にする。 */
export const reviewSkippedTests = (output: string): ReadonlyArray<string> =>
  [...output.matchAll(SKIPPED)].map((match) =>
    formatAnnotation({
      level: "warning",
      title: "飛ばしたテスト",
      file: match.groups?.["file"] ?? "",
      line: Number(match.groups?.["line"]),
      message: `変更の中でテストを飛ばしています（${match.groups?.["text"] ?? ""}）。飛ばしたテストは何も確かめません。`
    })
  )

// 変わると、テストを弱めずに判定を外せるファイル。機械では防ぎきれないので、人が確かめるように警告する。
// mutatorの設定と等価ミュータントの記録は、検査する範囲を狭められる。
const isMutatorSetting = (file: string): boolean => /^mutator\.config\.[^/]+$/u.test(file) || file === "mutator.accepted.json"
// Vitestの設定と、setupFilesやglobalSetupは、expectを無力化するなどして、全部のテストを黙らせられる。
const isTestSetting = (file: string, setupFiles: ReadonlySet<string>): boolean =>
  /^vitest\.config\.[^/]+$/u.test(file) || setupFiles.has(file)
// 判定の仕組みそのものと、それを呼ぶ所。
const isJudge = (file: string): boolean =>
  ["scripts/mutation-diff.ts", "scripts/mutation-report.ts", "package.json", "lefthook.yml"].includes(file) ||
  file.startsWith(".github/workflows/")

const settingChange = (file: string, setupFiles: ReadonlySet<string>): Annotation | undefined => {
  if (isMutatorSetting(file)) {
    return {
      level: "warning",
      title: "ミューテーションテストの設定が変わった",
      file,
      message: `${file}が変わりました。検査する範囲が狭まっていないか、動作の変わる壊し方を記録していないかを確かめてください。`
    }
  }
  if (isTestSetting(file, setupFiles)) {
    return {
      level: "warning",
      title: "テストの設定が変わった",
      file,
      message: `${file}が変わりました。テストの設定と準備のファイルは、expectを無力化するなどして、テストを弱めずに判定を外せます。人が確かめてください。`
    }
  }
  if (isJudge(file)) {
    return {
      level: "warning",
      title: "テストを弱めた変更の判定が変わった",
      file,
      message: `${file}が変わりました。判定のスクリプトや、それを呼ぶ所（package.jsonのscripts、lefthook.yml、ワークフロー）を書き換えると、テストを弱めた変更を通せます。人が確かめてください。`
    }
  }
  return undefined
}

/**
 * 変わったファイル（リポジトリの根からのパス）のうち、テストを弱めずに判定を外せるものを警告にする。
 * `setupFiles`は、今のVitestの設定が読むsetupFilesとglobalSetup（根からのパス）。
 */
export const reviewSettingChanges = (
  changedFiles: ReadonlyArray<string>,
  setupFiles: ReadonlyArray<string> = []
): ReadonlyArray<string> => {
  const setup = new Set(setupFiles)
  return changedFiles.flatMap((file) => {
    const annotation = settingChange(file, setup)
    return annotation === undefined ? [] : [formatAnnotation(annotation)]
  })
}

/** `before`にあって`after`に無いもの。並びは`before`のまま。 */
export const missingFrom = (before: ReadonlyArray<string>, after: ReadonlyArray<string>): ReadonlyArray<string> => {
  const kept = new Set(after)
  return before.filter((file) => !kept.has(file))
}

/** 分岐点の設定では集めていたのに、今の設定では集めないテストファイル（今もあるもの）を失敗にする。 */
export const reviewDroppedTests = (files: ReadonlyArray<string>): ReadonlyArray<string> =>
  files.map((file) =>
    formatAnnotation({
      level: "error",
      title: "テストファイルを集めなくなった",
      file,
      message: `${file}は、分岐点のVitestの設定では集めていたのに、今の設定では集めていません。テストファイルを残したまま対象から外すと、そのテストを消したのと同じになり、テストを弱めた変更として検出できません。vitest.config.*のincludeとexcludeを戻してください。`
    })
  )

/** 分岐点の設定ではミューテーションテストの対象だったのに、今の設定では対象外のソースファイル（今もあるもの）を失敗にする。 */
export const reviewDroppedSources = (files: ReadonlyArray<string>): ReadonlyArray<string> =>
  files.map((file) =>
    formatAnnotation({
      level: "error",
      title: "ミューテーションテストの対象から外れた",
      file,
      message: `${file}は、分岐点のmutatorの設定では対象だったのに、今の設定では対象外です。対象から外すと、そのコードのテストを弱めても検出できません。mutator.config.*のincludeとexcludeを戻してください。`
    })
  )

/** mutatorのレポートを読めなかったときの注釈。形が変わったときなど。 */
export const reviewUnreadableReport = (path: string, detail: string): string =>
  formatAnnotation({
    level: "error",
    title: "ミューテーションテストの結果を読めなかった",
    message: `${path}の形が、判定の想定と違います。mutatorを上げたときは、scripts/mutation-report.tsのMutationReportを合わせてください。${detail}`
  })

export interface Options {
  readonly ref: string
  readonly skipWithoutBase: boolean
}

/** mutation-diff.tsの引数を読む。知らない指定は黙って無視せず、理由を返す。 */
export const parseOptions = (argv: ReadonlyArray<string>): Options | string => {
  const unknown = argv.filter((arg) => arg.startsWith("-") && arg !== "--skip-without-base")
  const refs = argv.filter((arg) => !arg.startsWith("-"))
  if (unknown.length > 0) {
    return `知らない指定です: ${unknown.join(" ")}`
  }
  if (refs.length > 1) {
    return `基準のrefは1つだけ指定できます: ${refs.join(" ")}`
  }
  return {
    ref: refs[0] ?? "origin/main",
    skipWithoutBase: argv.includes("--skip-without-base")
  }
}

// 差分の実行で選ばれないミュータントの確かめ。
//
// mutatorの--since --include-test-changesは、変えたテストが届くミュータントを選んで実行する。モジュールの
// 直下にある正規表現など、読み込みの時に一度だけ動くコードのミュータントは、どのテストが届くかが記録されず
//（coveredByが空）、選ばれない。すると、それを検出していたテストを弱めても、前の「検出した」が残る。
// そこで、基準で検出したテストに変わったテストを含み、関数の中身が変わっておらず、今回の実行で
// 確かめられていない（--kill-matrixで実行し直した「検出した」ではない）ミュータントを、--onlyで実行し直す。
// 範囲の中の「検出した」は、--kill-matrixを付けるとmutatorが必ず実行し直す
//（node_modules/@mizchi/mutator-coreのsrc/plan.tsのreuse）。
//
// 変わったテストは、次のどれかに当たるもの。レポートのtestChangesは、差分にテストファイルがあるものに
// 限るので、それだけではヘルパーだけを弱めた変更が漏れる。
// - レポートのtestChangesの変えたか消したテストと、selectionReasons[].tests
// - テストのファイルか、それが読み込むファイル（mutatorのsnapshotのdeps。Viteのモジュールグラフを
//   推移的に辿ったもの）が、分岐点からの差分にあるテスト
// 差分の範囲の外のミュータントは、今のsnapshotでは何も変えなくてもPendingになるので、テストが変わったか
// を問わずに選ぶと、関係の無い変更でもほぼ全件を実行し直すことになる。

const UNDETECTED: ReadonlySet<string> = new Set(["Survived", "NoCoverage"])
// mutatorのsrc/status.tsのisDetectedに合わせる。
const DETECTED: ReadonlySet<string> = new Set(["Killed", "Timeout", "RuntimeError"])

const mutants = (report: MutationReport): ReadonlyMap<string, MutantRecord> =>
  new Map(Object.values(report.files).flatMap((entry) => entry.mutants.map((mutant) => [mutant.id, mutant] as const)))

export interface SnapshotRow {
  readonly scopeHash: string
  readonly status: string
  // --kill-matrixで実行した「検出した」。
  readonly matrix: boolean
}

const SnapshotRows = Schema.Struct({ rows: Schema.Array(Schema.Array(Schema.Unknown)) })

/** mutatorのsnapshotの行を読む。行の形はnode_modules/@mizchi/mutator/src/snapshot.tsのRow。 */
export const snapshotRows = (snapshot: unknown): ReadonlyMap<string, SnapshotRow> =>
  new Map(
    Schema.decodeUnknownSync(SnapshotRows)(snapshot).rows.flatMap((row) =>
      typeof row[0] === "string" && typeof row[3] === "string" && typeof row[4] === "string"
        ? [[row[0], { scopeHash: row[3], status: row[4], matrix: row[9] === 1 }] as const]
        : []
    )
  )

const SnapshotDeps = Schema.Struct({ deps: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.String))) })

/** mutatorのsnapshotから、テストファイルごとに読み込んだファイルを読む。 */
export const snapshotDeps = (snapshot: unknown): ReadonlyMap<string, ReadonlyArray<string>> =>
  new Map(Object.entries(Schema.decodeUnknownSync(SnapshotDeps)(snapshot).deps ?? {}))

// テストのid（src/core/a.test.ts#suite > name）のファイル。
const fileOfTest = (test: string): string => {
  const at = test.indexOf("#")
  return at === -1 ? test : test.slice(0, at)
}

/**
 * 変わったテストかを返す関数。`changedFiles`は分岐点からの差分のファイル（根からのパス）、`deps`は基準と
 * 今のsnapshotのsnapshotDepsを並べたもの。足しただけのテストは、前の「検出した」を弱めないが、
 * ファイルが差分にあれば含まれる。
 */
export const touchedTests = (
  current: MutationReport | undefined,
  changedFiles: ReadonlyArray<string>,
  deps: ReadonlyArray<ReadonlyMap<string, ReadonlyArray<string>>>
): ((test: string) => boolean) => {
  const named = new Set([
    ...(current?.testChanges?.changed ?? []),
    ...(current?.testChanges?.removed ?? []),
    ...(current?.selectionReasons ?? []).flatMap((reason) => reason.tests)
  ])
  const changed = new Set(changedFiles)
  return (test) => {
    const file = fileOfTest(test)
    return named.has(test) || changed.has(file) || deps.some((map) => (map.get(file) ?? []).some((dep) => changed.has(dep)))
  }
}

/** 実行し直すミュータント。基準で検出したテストに`touched`を含み、関数の中身が同じで、今回確かめていないもの。 */
export const unselectedCandidates = (
  base: MutationReport,
  current: MutationReport,
  baseRows: ReadonlyMap<string, SnapshotRow>,
  currentRows: ReadonlyMap<string, SnapshotRow>,
  touched: (test: string) => boolean
): ReadonlyArray<string> => {
  const reported = new Set(current.findings.filter((finding) => finding.kind === "detectionRegression").map((finding) => finding.key))
  return [...mutants(base).values()]
    .filter((mutant) => {
      const before = baseRows.get(mutant.id)
      const now = currentRows.get(mutant.id)
      return (
        mutant.status === "Killed" &&
        mutant.killedBy.some((test) => touched(test)) &&
        before !== undefined &&
        now !== undefined &&
        before.scopeHash === now.scopeHash &&
        !(now.status === "Killed" && now.matrix) &&
        !reported.has(mutant.id)
      )
    })
    .map((mutant) => mutant.id)
}

/** 実行し直した結果を判定する。検出されなければテストを弱めた変更、それ以外の想定外の状態も失敗にする。 */
export const reviewUnselected = (base: MutationReport, keys: ReadonlyArray<string>, rerun: MutationReport): ReadonlyArray<string> => {
  const before = mutants(base)
  const after = mutants(rerun)
  return keys.flatMap((key) => {
    const status = after.get(key)?.status
    if (status !== undefined && DETECTED.has(status)) {
      return []
    }
    const located = locate(base, key)
    return [
      formatAnnotation(
        status !== undefined && UNDETECTED.has(status)
          ? {
              level: "error",
              title: "テストが弱くなった",
              message: `変わっていないコードのミュータント${key}${located.change}を、前は${describeKillers(before.get(key)?.killedBy ?? [])}が検出していましたが、差分の実行で選ばれなかったため実行し直すと、どのテストも検出しませんでした。${regressionAdvice}`,
              ...position(located)
            }
          : {
              level: "error",
              title: "実行し直しの結果が想定外",
              message: `ミュータント${key}を実行し直した結果が「${status ?? "結果なし"}」でした。テストが弱くなったかを確かめられないので失敗にします。`,
              ...position(located)
            }
      )
    ]
  })
}

// mutatorのtextレポーターが、実行しなかったミュータントを知らせる行（src/report.tsの"not run:"）。
// 時間の上限（timeBudget）などで実行しなかったものがあると、判定が空になりうる。
const NOT_RUN = /^not run: (?<detail>.+)$/mu

/** 差分の実行で、実行しなかったミュータントがあれば失敗にする。 */
export const reviewNotRun = (output: string): ReadonlyArray<string> => {
  const detail = NOT_RUN.exec(output)?.groups?.["detail"]
  return detail === undefined
    ? []
    : [
        formatAnnotation({
          level: "error",
          title: "実行しなかったミュータントがある",
          message: `差分の実行で、実行しなかったミュータントがあります（${detail}）。テストが弱くなったかを確かめきれないので失敗にします。mutator.config.*のtimeBudgetやmutantsPerLineを外してください。`
        })
      ]
}

// 実行するミュータントを減らすか、結果の置き場所を変えるmutatorの設定。基準の全件も差分の実行も
// 途中で打ち切られたり、判定が読む結果と食い違ったりして、テストを弱めた変更を黙って通しうる。
const RUN_LIMITS = ["since", "timeBudget", "mutantsPerLine", "shard", "reportDir"]

/** mutatorの設定に、判定と合わない項目があれば失敗にする。`config`は読み込んだ設定、`path`はそのファイル。 */
export const reviewRunLimits = (config: object | undefined, path: string): ReadonlyArray<string> => {
  const found = RUN_LIMITS.filter((key) => config !== undefined && Object.hasOwn(config, key))
  return found.length === 0
    ? []
    : [
        formatAnnotation({
          level: "error",
          title: "判定と合わないmutatorの設定",
          file: path,
          message: `${path}に${found.join("、")}があります。実行するミュータントを減らすか、結果の置き場所を変えるので、テストを弱めた変更を確かめきれません。外してください。`
        })
      ]
}

/** 実行しなかったミュータント（Pending）のキー。基準の全件が途中で打ち切られていないかを見る。 */
export const pendingKeys = (report: MutationReport): ReadonlyArray<string> =>
  [...mutants(report).values()].filter((mutant) => mutant.status === "Pending").map((mutant) => mutant.id)

// 警告に並べるミュータントの数。設定で種類ごと外すと数百件になりうる。
const LISTED = 5

/**
 * 今の設定で消えたミュータントを判定する。`dropped`は、基準のコミットを基準の元の設定で実行し直した
 * レポート、`keys`は今の設定で消えたもの。基準で検出していて、検出したテストに`touched`を含むものは
 * 失敗にする。テストを弱めて、そのミュータントを設定で消せば通ってしまうため。残りは警告にする。
 */
export const reviewDroppedMutants = (
  dropped: MutationReport,
  keys: ReadonlyArray<string>,
  touched: (test: string) => boolean
): ReadonlyArray<string> => {
  const records = mutants(dropped)
  const failing = (key: string): boolean => {
    const record = records.get(key)
    return (
      record === undefined || record.status === "Pending" || (DETECTED.has(record.status) && record.killedBy.some((test) => touched(test)))
    )
  }
  const errors = keys
    .filter((key) => failing(key))
    .map((key) => {
      const record = records.get(key)
      const located = locate(dropped, key)
      return formatAnnotation(
        record === undefined || record.status === "Pending"
          ? {
              level: "error",
              title: "消えたミュータントを確かめられなかった",
              message: `今の設定で消えたミュータント${key}を、基準の設定で実行し直した結果が「${record?.status ?? "結果なし"}」でした。テストが弱くなったかを確かめられないので失敗にします。`,
              ...position(located)
            }
          : {
              level: "error",
              title: "テストを弱めて、ミュータントを設定で消した",
              message: `ミュータント${key}${located.change}は、基準の設定では${describeKillers(record.killedBy.filter((test) => touched(test)))}が検出していましたが、今のmutatorの設定で対象から消えました。そのテストかヘルパーも変わっているので、テストを弱めた変更を設定で隠していないかを確かめられません。設定を戻すか、テストの変更と設定の変更を別のPRに分けてください。`,
              ...position(located)
            }
      )
    })
  const rest = keys.filter((key) => !failing(key))
  return [
    ...errors,
    ...(rest.length === 0
      ? []
      : [
          formatAnnotation({
            level: "warning",
            title: "ミュータントが設定で消えた",
            message: `今のmutatorの設定で、基準の設定にあったミュータントが${rest.length}件消えました（${rest.slice(0, LISTED).join("、")}${rest.length > LISTED ? "など" : ""}）。それを検出していたテストは変わっていませんが、検査する範囲が狭まっていないかを確かめてください。`
          })
        ])
  ]
}

/** .mutatorがGitで追跡されていたら失敗にする。追跡した結果を基準と取り違えないため。 */
export const reviewTrackedMutator = (tracked: ReadonlyArray<string>): ReadonlyArray<string> =>
  tracked.length === 0
    ? []
    : [
        formatAnnotation({
          level: "error",
          title: ".mutatorが追跡されている",
          file: tracked[0] ?? ".mutator",
          message: `.mutatorの中のファイル（${tracked.length}件）がGitで追跡されています。.mutatorは実行のたびに作り直す結果なので、git rm -r --cached .mutatorで追跡を外してください。`
        })
      ]

/** mutatorの設定ファイル。mutatorが探す順（node_modules/@mizchi/mutator/dist/config.jsのCONFIG_FILES）。 */
export const MUTATOR_CONFIG_FILES = [
  "mutator.config.ts",
  "mutator.config.mts",
  "mutator.config.mjs",
  "mutator.config.js",
  "mutator.config.json"
]

// mutatorの環境ハッシュ（node_modules/@mizchi/mutator/src/reuse.tsのenvironmentHash）に入るファイルのうち、
// この雛形の根にありうるもの。Node.jsの版とmutatorの設定もハッシュに入る。テストランナーの設定
//（vitest.config.*）と、TypeScriptの設定（tsconfig*.json）、mutatorの設定も、今と同じものを使う。
// .npmrcはハッシュに入らないが、依存を今と同じ設定で入れるために写す。
const ENVIRONMENT_FILE =
  /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|tsconfig.*\.json|vitest\.config\..+|mutator\.config\..+|\.npmrc)$/u

/** リポジトリの根にあるファイル名のうち、基準を作るときに今の作業ツリーから写すもの。 */
export const isEnvironmentFile = (name: string): boolean => ENVIRONMENT_FILE.test(name)
