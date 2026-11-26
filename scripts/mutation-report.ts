// ミューテーションテストの結果（.mutator/report/mutation.json）から、テストを弱めた変更を見つけて、
// GitHub Actionsの注釈の形の行と終了コードにする。ファイルとgitを読むのはmutation-findings.ts。
//
// 失敗にするのは、変わっていないコードについて、前は検出できたミュータントを今は検出できない
//（detectionRegression）ときだけ。何も検出しない新しいテスト（newTestNoKills）は警告にする。
// 生き残りとスコアは表示だけで、この判定には使わない。

import { Schema } from "effect"

const MutantRecord = Schema.Struct({
  id: Schema.String,
  mutatorName: Schema.optionalKey(Schema.String),
  replacement: Schema.optionalKey(Schema.String),
  location: Schema.optionalKey(Schema.Struct({ start: Schema.optionalKey(Schema.Struct({ line: Schema.optionalKey(Schema.Finite) })) }))
})

type MutantRecord = typeof MutantRecord.Type

const Finding = Schema.Struct({
  kind: Schema.String,
  key: Schema.optionalKey(Schema.String),
  test: Schema.optionalKey(Schema.String),
  previousKillers: Schema.optionalKey(Schema.Array(Schema.String))
})

type Finding = typeof Finding.Type

/** mutatorのjsonレポーターの出力のうち、判定に使う部分。 */
export const MutationReport = Schema.Struct({
  comparison: Schema.optionalKey(Schema.String),
  findings: Schema.optionalKey(Schema.Array(Finding)),
  files: Schema.optionalKey(Schema.Record(Schema.String, Schema.Struct({ mutants: Schema.optionalKey(Schema.Array(MutantRecord)) })))
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

const locate = (report: MutationReport, key: string): { readonly file: string; readonly mutant: MutantRecord } | undefined =>
  Object.entries(report.files ?? {})
    .flatMap(([file, entry]) => (entry.mutants ?? []).filter((mutant) => mutant.id === key).map((mutant) => ({ file, mutant })))
    .at(0)

const describeKillers = (killers: ReadonlyArray<string>): string =>
  killers.length === 0 ? "テスト" : killers.map((killer) => `「${killer}」`).join("、")

const regression = (report: MutationReport, finding: Finding): Annotation => {
  const key = finding.key ?? ""
  const found = locate(report, key)
  const change =
    found?.mutant.mutatorName === undefined ? "" : `（${found.mutant.mutatorName}で${found.mutant.replacement ?? ""}に置き換え）`
  const line = found?.mutant.location?.start?.line
  return {
    level: "error",
    title: "テストが弱くなった",
    message: `変わっていないコードのミュータント${key}${change}を、前は${describeKillers(finding.previousKillers ?? [])}が検出していましたが、今はどのテストも検出しません。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。mutator acceptで記録して通してはいけません。`,
    ...(found === undefined ? {} : { file: found.file }),
    ...(line === undefined ? {} : { line })
  }
}

const noKills = (finding: Finding): Annotation => ({
  level: "warning",
  title: "何も検出しない新しいテスト",
  message: `「${finding.test ?? ""}」は、どのミュータントも検出しません。振る舞いを確かめるアサーションがあるかを見直してください。`
})

const unavailable: Annotation = {
  level: "notice",
  title: "比較の基準が無い",
  message:
    "前回の結果が無いか、package.json、ロックファイル、tsconfig.json、Node.jsの版、mutatorの設定のどれかが変わったため、テストが弱くなったかは確かめていません。"
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
  const findings = report.findings ?? []
  const regressions = findings.filter((finding) => finding.kind === "detectionRegression").map((finding) => regression(report, finding))
  const idle = findings.filter((finding) => finding.kind === "newTestNoKills").map((finding) => noKills(finding))
  const gaps = findings.filter((finding) => finding.kind === "mutationGap").length
  return {
    lines: [
      ...[...(report.comparison === "unavailable" ? [unavailable] : []), ...regressions, ...idle].map((annotation) =>
        formatAnnotation(annotation)
      ),
      `テストが弱くなった箇所: ${regressions.length}件、何も検出しない新しいテスト: ${idle.length}件`,
      ...(gaps === 0
        ? []
        : [
            `テストが検出できなかったミュータント: ${gaps}件。失敗にはしません。テストが足りないのか、コードが要らないのかを見直してください。手順は${guide}にあります。`
          ])
    ],
    exitCode: regressions.length === 0 ? 0 : 1
  }
}

// mutatorの設定と等価ミュータントの記録。書き換えると、テストを弱めずに検査の範囲を狭められる。
const isSetting = (file: string): boolean => /^mutator\.config\.[^/]+$/u.test(file) || file === "mutator.accepted.json"

/** 変わったファイル（リポジトリの根からのパス）のうち、ミューテーションテストの設定を警告にする。 */
export const reviewSettingChanges = (changedFiles: ReadonlyArray<string>): ReadonlyArray<string> =>
  changedFiles
    .filter((file) => isSetting(file))
    .map((file) =>
      formatAnnotation({
        level: "warning",
        title: "ミューテーションテストの設定が変わった",
        file,
        message: `${file}が変わりました。検査する範囲が狭まっていないか、動作の変わる壊し方を記録していないかを確かめてください。`
      })
    )
