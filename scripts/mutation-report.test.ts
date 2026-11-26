import { readFileSync } from "node:fs"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  formatAnnotation,
  isEnvironmentFile,
  missingFrom,
  MutationReport,
  parseOptions,
  regressionAdvice,
  reviewBaselineFailure,
  reviewDroppedSources,
  reviewDroppedTests,
  reviewFindings,
  reviewSettingChanges,
  reviewSkippedTests,
  reviewUnreadableReport
} from "./mutation-report.ts"

const decode = Schema.decodeUnknownSync(MutationReport)

// mutator 0.4.5が実際に書いたレポートの抜粋。テストを1つ弱め、何も確かめないテストを1つ足して、
// pnpm mutation:diffで作った。判定に使わない項目（sourceなど）とミュータントは省いた。
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8"))

const mutant = (id: string, line: number) => ({ id, mutatorName: "StringLiteral", replacement: '""', location: { start: { line } } })

const files = { "src/core/note.ts": { mutants: [mutant("other", 3), mutant("weak", 24)] } }

const report = (findings: MutationReport["findings"], comparison: MutationReport["comparison"] = "available"): MutationReport => ({
  schemaVersion: "2",
  comparison,
  findings,
  files
})

describe("mutator 0.4.5の実物のレポート", () => {
  it("テストを弱めた変更を行に付けたエラーにし、何も検出しない新しいテストを警告にして失敗する", () => {
    const review = reviewFindings(decode(fixture("mutation-report-weakened.json")), "mutation.json")
    expect(review.exitCode).toBe(1)
    expect(review.lines).toEqual([
      `::error file=src/core/note.ts,line=24,title=テストが弱くなった::変わっていないコードのミュータントlri4646151（StringLiteralで""に置き換え）を、前は「src/core/note.test.ts#formatDate > 年が3桁なら0で埋める」が検出していましたが、今はどのテストも検出しません。${regressionAdvice}`,
      "::warning title=何も検出しない新しいテスト::「src/core/note.test.ts#呼ぶだけ > 何も確かめない」は、どのミュータントも検出しません。振る舞いを確かめるアサーションがあるかを見直してください。",
      "テストが弱くなった箇所: 1件、何も検出しない新しいテスト: 1件、テストが検出できないミュータント: 0件"
    ])
  })

  it("変更の無いときは、何も出さずに成功する", () => {
    expect(reviewFindings(decode(fixture("mutation-report-unchanged.json")), "mutation.json")).toEqual({
      lines: ["テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 0件、テストが検出できないミュータント: 0件"],
      exitCode: 0
    })
  })
})

describe("MutationReport", () => {
  it("レポートの形が変わったら、黙って0件にせず読み込みで失敗する", () => {
    expect(() => decode({})).toThrow()
    expect(() => decode({ schemaVersion: "3", comparison: "available", findings: [], files: {} })).toThrow()
    expect(() => decode({ schemaVersion: "2", comparison: "unknown", findings: [], files: {} })).toThrow()
    expect(() => decode({ schemaVersion: "2", comparison: "available", files: {} })).toThrow()
    expect(decode({ schemaVersion: "2", comparison: "available", findings: [], files: {}, extra: 1 })).toEqual({
      schemaVersion: "2",
      comparison: "available",
      findings: [],
      files: {}
    })
  })
})

describe("reviewFindings", () => {
  it("位置の分からないミュータントは、分かる所までを付けてエラーにする", () => {
    const review = reviewFindings(
      report([
        { kind: "detectionRegression", key: "gone", previousKillers: [] },
        { kind: "detectionRegression", key: "weak", previousKillers: ["a.test.ts#一", "a.test.ts#二"] }
      ]),
      "mutation.json"
    )
    expect(review.lines.slice(0, 2)).toEqual([
      `::error title=テストが弱くなった::変わっていないコードのミュータントgoneを、前はテストが検出していましたが、今はどのテストも検出しません。${regressionAdvice}`,
      `::error file=src/core/note.ts,line=24,title=テストが弱くなった::変わっていないコードのミュータントweak（StringLiteralで""に置き換え）を、前は「a.test.ts#一」、「a.test.ts#二」が検出していましたが、今はどのテストも検出しません。${regressionAdvice}`
    ])
    expect(review.exitCode).toBe(1)
  })

  it("失敗したときの案内は、mutator acceptで通さず、テストを戻すか足すように言う", () => {
    expect(regressionAdvice).toContain("mutator acceptで通さない")
    expect(regressionAdvice).toContain("弱めたテストを戻すか、同じ振る舞いを確かめるテストを足して")
  })

  it("基準を作ったのに比べられなかったら、仕組みの故障として失敗する", () => {
    const review = reviewFindings(report([], "unavailable"), "mutation.json")
    expect(review.exitCode).toBe(1)
    expect(review.lines[0]).toMatch(/^::error title=基準と比べられなかった::/u)
  })

  it("変更した行の検出できないミュータントは、行に付けた警告にして成功する。テストを弱めたものには重ねない", () => {
    const review = reviewFindings(
      report([
        { kind: "mutationGap", key: "other" },
        { kind: "mutationGap", key: "weak" },
        { kind: "detectionRegression", key: "weak", previousKillers: [] },
        { kind: "testNotMeasured", test: "a.test.ts#届かない" }
      ]),
      "mutation.json"
    )
    expect(review.lines.filter((line) => line.startsWith("::warning"))).toEqual([
      '::warning file=src/core/note.ts,line=3,title=テストが検出できないミュータント::ミュータントother（StringLiteralで""に置き換え）を、どのテストも検出しません。テストが足りないのか、コードが要らないのかを見直してください。どんな入力でも振る舞いが変わらない等価ミュータントだけは、mutator accept other --reason <理由>で記録できます。'
    ])
    expect(reviewFindings(report([{ kind: "mutationGap", key: "other" }]), "mutation.json")).toMatchObject({
      lines: [
        expect.stringMatching(/^::warning /u),
        "テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 0件、テストが検出できないミュータント: 1件",
        expect.stringContaining("失敗にしません")
      ],
      exitCode: 0
    })
  })

  it("結果を疑わせる事情は、警告にして成功する", () => {
    expect(
      reviewFindings(
        { ...report([]), warnings: [{ file: "src/a.spec.ts", message: "not collected" }, { message: "child process" }] },
        "mutation.json"
      )
    ).toEqual({
      lines: [
        "::warning file=src/a.spec.ts,title=ミューテーションテストの結果を疑わせる事情::not collected",
        "::warning title=ミューテーションテストの結果を疑わせる事情::child process",
        "テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 0件、テストが検出できないミュータント: 0件"
      ],
      exitCode: 0
    })
  })

  it("結果のファイルが無ければ、エラーにして失敗する", () => {
    expect(reviewFindings(undefined, ".mutator/report/mutation.json")).toEqual({
      lines: [
        "::error title=ミューテーションテストの結果が無い::.mutator/report/mutation.jsonがありません。先にmutatorを--reporter jsonを付けて実行してください。"
      ],
      exitCode: 1
    })
  })
})

describe("reviewBaselineFailure", () => {
  it("基準を作れなかった理由を、失敗のエラーにする", () => {
    expect(reviewBaselineFailure("取り出せませんでした。")).toBe(
      "::error title=比較の基準を作れなかった::取り出せませんでした。 基準が無いと、テストが弱くなったかを確かめられないので失敗にします。"
    )
  })
})

describe("reviewSkippedTests", () => {
  it("mutatorのtextの出力から、変更の中で飛ばしたテストを行に付けた警告にする", () => {
    const output = [
      "score (changed code): 100.0% [high]  (1.3s)",
      "warning: src/core/note.test.ts:39 skips a test in the change, so it checks nothing: 飛ばしたテストの行",
      "report written to .mutator/report"
    ].join("\n")
    expect(reviewSkippedTests(output)).toEqual([
      "::warning file=src/core/note.test.ts,line=39,title=飛ばしたテスト::変更の中でテストを飛ばしています（飛ばしたテストの行）。飛ばしたテストは何も確かめません。"
    ])
    expect(reviewSkippedTests("warning: something else")).toEqual([])
  })
})

describe("isEnvironmentFile", () => {
  it("mutatorの環境ハッシュに入るファイルと、テストとmutatorの設定を選ぶ", () => {
    const names = [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "tsconfig.build.json",
      "vitest.config.ts",
      "mutator.config.json",
      ".npmrc",
      "mutator.accepted.json",
      "README.md",
      "package.json.bak",
      "src"
    ]
    expect(names.filter((name) => isEnvironmentFile(name))).toEqual([
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "tsconfig.build.json",
      "vitest.config.ts",
      "mutator.config.json",
      ".npmrc"
    ])
  })
})

describe("formatAnnotation", () => {
  it("注釈の区切りと改行を、値の中で符号化する", () => {
    expect(formatAnnotation({ level: "warning", title: "a:b,c", message: "100%\r\nok", file: "src/a,b:c.ts", line: 4 })).toBe(
      "::warning file=src/a%2Cb%3Ac.ts,line=4,title=a%3Ab%2Cc::100%25%0D%0Aok"
    )
  })
})

describe("reviewSettingChanges", () => {
  it("mutatorの設定と等価ミュータントの記録が変わったら、ファイルごとに警告する", () => {
    expect(reviewSettingChanges(["src/core/note.ts", "mutator.config.json", "mutator.accepted.json", "mutator.config.ts"])).toEqual([
      "::warning file=mutator.config.json,title=ミューテーションテストの設定が変わった::mutator.config.jsonが変わりました。検査する範囲が狭まっていないか、動作の変わる壊し方を記録していないかを確かめてください。",
      "::warning file=mutator.accepted.json,title=ミューテーションテストの設定が変わった::mutator.accepted.jsonが変わりました。検査する範囲が狭まっていないか、動作の変わる壊し方を記録していないかを確かめてください。",
      "::warning file=mutator.config.ts,title=ミューテーションテストの設定が変わった::mutator.config.tsが変わりました。検査する範囲が狭まっていないか、動作の変わる壊し方を記録していないかを確かめてください。"
    ])
  })

  it("根にない同名のファイルや、空の行は警告しない", () => {
    expect(reviewSettingChanges(["", "docs/mutator.config.json", "src/mutator.accepted.json", "mutator.configs"])).toEqual([])
  })

  it("テストの設定と準備のファイル、判定のスクリプトが変わったら、人が確かめるように警告する", () => {
    expect(
      reviewSettingChanges(
        [
          "vitest.config.ts",
          "test/setup.ts",
          "src/core/note.ts",
          "scripts/mutation-diff.ts",
          "scripts/mutation-report.ts",
          "docs/vitest.config.ts"
        ],
        ["test/setup.ts"]
      )
    ).toEqual([
      "::warning file=vitest.config.ts,title=テストの設定が変わった::vitest.config.tsが変わりました。テストの設定と準備のファイルは、expectを無力化するなどして、テストを弱めずに判定を外せます。人が確かめてください。",
      "::warning file=test/setup.ts,title=テストの設定が変わった::test/setup.tsが変わりました。テストの設定と準備のファイルは、expectを無力化するなどして、テストを弱めずに判定を外せます。人が確かめてください。",
      "::warning file=scripts/mutation-diff.ts,title=テストを弱めた変更の判定が変わった::scripts/mutation-diff.tsが変わりました。判定を書き換えると、テストを弱めた変更を通せます。人が確かめてください。",
      "::warning file=scripts/mutation-report.ts,title=テストを弱めた変更の判定が変わった::scripts/mutation-report.tsが変わりました。判定を書き換えると、テストを弱めた変更を通せます。人が確かめてください。"
    ])
  })
})

describe("設定を狭めた変更", () => {
  it("分岐点にあって今に無いものだけを、分岐点の並びで返す", () => {
    expect(missingFrom(["a.test.ts", "b.test.ts", "c.test.ts"], ["c.test.ts", "a.test.ts", "d.test.ts"])).toEqual(["b.test.ts"])
  })

  it("集めなくなったテストファイルと、対象から外れたソースを、ファイルに付けたエラーにする", () => {
    expect(reviewDroppedTests(["src/core/note.test.ts"])).toEqual([
      "::error file=src/core/note.test.ts,title=テストファイルを集めなくなった::src/core/note.test.tsは、分岐点のVitestの設定では集めていたのに、今の設定では集めていません。テストファイルを残したまま対象から外すと、そのテストを消したのと同じになり、テストを弱めた変更として検出できません。vitest.config.*のincludeとexcludeを戻してください。"
    ])
    expect(reviewDroppedSources(["src/core/note.ts"])).toEqual([
      "::error file=src/core/note.ts,title=ミューテーションテストの対象から外れた::src/core/note.tsは、分岐点のmutatorの設定では対象だったのに、今の設定では対象外です。対象から外すと、そのコードのテストを弱めても検出できません。mutator.config.*のincludeとexcludeを戻してください。"
    ])
  })
})

describe("reviewUnreadableReport", () => {
  it("形の違うレポートを、エラーの注釈にする", () => {
    expect(reviewUnreadableReport("mutation.json", "Missing key")).toBe(
      "::error title=ミューテーションテストの結果を読めなかった::mutation.jsonの形が、判定の想定と違います。mutatorを上げたときは、scripts/mutation-report.tsのMutationReportを合わせてください。Missing key"
    )
  })
})

describe("parseOptions", () => {
  it("基準のrefと2つの指定を読む", () => {
    expect(parseOptions([])).toEqual({ ref: "origin/main", killMatrix: false, skipWithoutBase: false })
    expect(parseOptions(["origin/dev", "--kill-matrix"])).toEqual({ ref: "origin/dev", killMatrix: true, skipWithoutBase: false })
    expect(parseOptions(["--skip-without-base"])).toEqual({ ref: "origin/main", killMatrix: false, skipWithoutBase: true })
  })

  it("知らない指定と、2つ以上のrefは、黙って無視せずに理由を返す", () => {
    expect(parseOptions(["--kill-matrx"])).toBe("知らない指定です: --kill-matrx")
    expect(parseOptions(["origin/main", "origin/dev"])).toBe("基準のrefは1つだけ指定できます: origin/main origin/dev")
  })
})
