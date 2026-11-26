import { readFileSync } from "node:fs"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  formatAnnotation,
  isEnvironmentFile,
  isSettingFile,
  missingFrom,
  MutationReport,
  parseOptions,
  regressionAdvice,
  reviewBaselineFailure,
  reviewDroppedSources,
  reviewDroppedTests,
  reviewFindings,
  pendingKeys,
  recheckTargets,
  reviewDroppedMutants,
  reviewNotRun,
  reviewRunLimits,
  reviewTrackedMutator,
  reviewUnselected,
  reviewSettingChanges,
  reviewSkippedTests,
  reviewUnreadableReport,
  snapshotDeps,
  snapshotRows,
  summarize,
  touchedTests,
  unselectedCandidates
} from "./mutation-report.ts"

const decode = Schema.decodeUnknownSync(MutationReport)

// mutator 0.4.5が実際に書いたレポートの抜粋。テストを1つ弱め、何も確かめないテストを1つ足して、
// pnpm mutation:diffで作った。判定に使わない項目（sourceなど）とミュータントは省いた。
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8"))

const mutant = (id: string, line: number, status = "Killed", killedBy: ReadonlyArray<string> = []) => ({
  id,
  mutatorName: "StringLiteral",
  replacement: '""',
  location: { start: { line } },
  status,
  killedBy
})

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
    expect(review.lines).toEqual([
      `::error file=src/core/note.ts,line=24,title=テストが弱くなった::変わっていないコードのミュータントlri4646151（StringLiteralで""に置き換え）を、前は「src/core/note.test.ts#formatDate > 年が3桁なら0で埋める」が検出していましたが、今はどのテストも検出しません。${regressionAdvice}`,
      "::warning title=何も検出しない新しいテスト::「src/core/note.test.ts#呼ぶだけ > 何も確かめない」は、どのミュータントも検出しません。振る舞いを確かめるアサーションがあるかを見直してください。"
    ])
    expect(summarize(review.lines, review.counts)).toEqual({
      line: "判定の結果: エラー1件、警告1件（うちmutatorの報告: テストが弱くなった箇所1件、何も検出しない新しいテスト1件、テストが検出できないミュータント0件）。エラーがあるので失敗にします。",
      exitCode: 1
    })
  })

  it("変更の無いときは、何も出さずに成功する", () => {
    const review = reviewFindings(decode(fixture("mutation-report-unchanged.json")), "mutation.json")
    expect(review).toEqual({ lines: [], counts: { regressions: 0, idle: 0, gaps: 0 } })
    expect(summarize(review.lines, review.counts).exitCode).toBe(0)
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
    expect(review.counts?.regressions).toBe(2)
  })

  it("失敗したときの案内は、mutator acceptで通さず、テストを戻すか足すように言う", () => {
    expect(regressionAdvice).toContain("mutator acceptで通さない")
    expect(regressionAdvice).toContain("弱めたテストを戻すか、同じ振る舞いを確かめるテストを足して")
  })

  it("基準を作ったのに比べられなかったら、仕組みの故障として失敗する", () => {
    const review = reviewFindings(report([], "unavailable"), "mutation.json")
    expect(review.lines[0]).toMatch(/^::error title=基準と比べられなかった::/u)
    expect(summarize(review.lines, review.counts).exitCode).toBe(1)
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
      lines: [expect.stringMatching(/^::warning /u), expect.stringContaining("失敗にしません")],
      counts: { regressions: 0, idle: 0, gaps: 1 }
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
        "::warning title=ミューテーションテストの結果を疑わせる事情::child process"
      ],
      counts: { regressions: 0, idle: 0, gaps: 0 }
    })
  })

  it("結果のファイルが無ければ、エラーにして失敗する", () => {
    expect(reviewFindings(undefined, ".mutator/report/mutation.json")).toEqual({
      lines: [
        "::error title=ミューテーションテストの結果が無い::.mutator/report/mutation.jsonがありません。先にmutatorを--reporter jsonを付けて実行してください。"
      ]
    })
  })
})

describe("summarize", () => {
  it("判定が自分で出したエラーも数え、エラーが1件でもあれば失敗にする", () => {
    const review = reviewFindings(report([]), "mutation.json")
    const lines = [
      ...reviewDroppedTests(["src/core/note.test.ts"]),
      ...reviewNotRun("not run: 3 over the time budget (--time-budget)\n"),
      ...reviewSettingChanges(["mutator.config.json"]),
      ...review.lines
    ]
    expect(summarize(lines, review.counts)).toEqual({
      line: "判定の結果: エラー2件、警告1件（うちmutatorの報告: テストが弱くなった箇所0件、何も検出しない新しいテスト0件、テストが検出できないミュータント0件）。エラーがあるので失敗にします。",
      exitCode: 1
    })
  })

  it("mutatorのレポートまで進まなかったときは、mutatorの件数を出さない。警告だけなら成功する", () => {
    expect(summarize([reviewBaselineFailure("取り出せませんでした。")])).toEqual({
      line: "判定の結果: エラー1件、警告0件。エラーがあるので失敗にします。",
      exitCode: 1
    })
    expect(summarize(reviewSettingChanges(["vitest.config.ts"]), { regressions: 0, idle: 0, gaps: 0 }).exitCode).toBe(0)
    expect(summarize([]).line).toBe("判定の結果: エラー0件、警告0件。エラーはありません。")
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

describe("isSettingFile", () => {
  it("写す環境のファイルのうち、依存ではなく、テストとmutatorと型検査の設定を選ぶ", () => {
    expect(
      [
        "package.json",
        "pnpm-lock.yaml",
        ".npmrc",
        "tsconfig.json",
        "tsconfig.build.json",
        "vitest.config.ts",
        "mutator.config.json"
      ].filter((name) => isSettingFile(name))
    ).toEqual(["tsconfig.json", "tsconfig.build.json", "vitest.config.ts", "mutator.config.json"])
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
    expect(
      reviewSettingChanges(["", "docs/mutator.config.json", "src/mutator.accepted.json", "mutator.configs", "e2e/tsconfig.json"])
    ).toEqual([])
  })

  it("TypeScriptの設定が変わったら、CompileErrorで比べる対象から外れうるので警告する", () => {
    expect(reviewSettingChanges(["tsconfig.json", "tsconfig.build.json"])).toEqual([
      "::warning file=tsconfig.json,title=TypeScriptの設定が変わった::tsconfig.jsonが変わりました。型の合わないミュータントはCompileErrorになって比べる対象から外れるので、検査する範囲が狭まっていないかを確かめてください。",
      "::warning file=tsconfig.build.json,title=TypeScriptの設定が変わった::tsconfig.build.jsonが変わりました。型の合わないミュータントはCompileErrorになって比べる対象から外れるので、検査する範囲が狭まっていないかを確かめてください。"
    ])
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
          "docs/vitest.config.ts",
          ".github/workflows/ci.yml"
        ],
        ["test/setup.ts"]
      )
    ).toEqual([
      "::warning file=vitest.config.ts,title=テストの設定が変わった::vitest.config.tsが変わりました。テストの設定と準備のファイルは、expectを無力化するなどして、テストを弱めずに判定を外せます。人が確かめてください。",
      "::warning file=test/setup.ts,title=テストの設定が変わった::test/setup.tsが変わりました。テストの設定と準備のファイルは、expectを無力化するなどして、テストを弱めずに判定を外せます。人が確かめてください。",
      "::warning file=scripts/mutation-diff.ts,title=テストを弱めた変更の判定が変わった::scripts/mutation-diff.tsが変わりました。判定のスクリプトや、それを呼ぶ所（package.jsonのscripts、lefthook.yml、ワークフロー）を書き換えると、テストを弱めた変更を通せます。人が確かめてください。",
      "::warning file=scripts/mutation-report.ts,title=テストを弱めた変更の判定が変わった::scripts/mutation-report.tsが変わりました。判定のスクリプトや、それを呼ぶ所（package.jsonのscripts、lefthook.yml、ワークフロー）を書き換えると、テストを弱めた変更を通せます。人が確かめてください。",
      "::warning file=.github/workflows/ci.yml,title=テストを弱めた変更の判定が変わった::.github/workflows/ci.ymlが変わりました。判定のスクリプトや、それを呼ぶ所（package.jsonのscripts、lefthook.yml、ワークフロー）を書き換えると、テストを弱めた変更を通せます。人が確かめてください。"
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
  it("基準のrefと指定を読む", () => {
    expect(parseOptions([])).toEqual({ ref: "origin/main", skipWithoutBase: false })
    expect(parseOptions(["origin/dev"])).toEqual({ ref: "origin/dev", skipWithoutBase: false })
    expect(parseOptions(["--skip-without-base"])).toEqual({ ref: "origin/main", skipWithoutBase: true })
  })

  it("知らない指定と、2つ以上のrefは、黙って無視せずに理由を返す", () => {
    expect(parseOptions(["--kill-matrix"])).toBe("知らない指定です: --kill-matrix")
    expect(parseOptions(["origin/main", "origin/dev"])).toBe("基準のrefは1つだけ指定できます: origin/main origin/dev")
  })
})

const row = (status: string, matrix = false, scopeHash = "h") => ({ scopeHash, status, matrix })

describe("差分の実行で選ばれないミュータントの確かめ", () => {
  const killer = "src/core/word.test.ts#単語 > 英小文字だけなら単語"
  const base = {
    ...report([]),
    files: {
      "src/core/word.ts": { mutants: [mutant("top", 1, "Killed", [killer]), mutant("other", 2, "Killed", ["src/a.test.ts#変えていない"])] }
    }
  }
  const current = report([])
  const touched = (test: string): boolean => test === killer
  const baseRows = new Map([
    ["top", row("Killed")],
    ["other", row("Killed")]
  ])

  it("基準で検出したテストに変わったテストを含み、今回確かめていない（使い回したか実行していない）ものを選ぶ", () => {
    expect(
      unselectedCandidates(
        base,
        current,
        baseRows,
        new Map([
          ["top", row("Killed")],
          ["other", row("Killed")]
        ]),
        touched
      )
    ).toEqual(["top"])
    expect(unselectedCandidates(base, current, baseRows, new Map([["top", row("Pending")]]), touched)).toEqual(["top"])
    // 今は無いミュータント（ファイルごと消したなど）は、実行し直せないので選ばない。
    expect(unselectedCandidates(base, current, baseRows, new Map(), touched)).toEqual([])
  })

  it("検出したテストが変わっていなければ、今のsnapshotでPendingでも選ばない", () => {
    expect(
      unselectedCandidates(
        base,
        current,
        baseRows,
        new Map([
          ["top", row("Pending")],
          ["other", row("Pending")]
        ]),
        () => false
      )
    ).toEqual([])
  })

  it("--kill-matrixで実行し直した「検出した」、関数の中身が変わったもの、mutatorが報告したものは選ばない", () => {
    expect(unselectedCandidates(base, current, baseRows, new Map([["top", row("Killed", true)]]), touched)).toEqual([])
    expect(unselectedCandidates(base, current, baseRows, new Map([["top", row("Killed", false, "changed")]]), touched)).toEqual([])
    expect(
      unselectedCandidates(
        base,
        { ...current, findings: [{ kind: "detectionRegression", key: "top" }] },
        baseRows,
        new Map([["top", row("Killed")]]),
        touched
      )
    ).toEqual([])
  })

  it("実行し直して検出されなければテストを弱めた変更、想定外の状態も失敗、検出されれば何も出さない", () => {
    const rerun = (status: string) => ({ ...report([]), files: { "src/core/word.ts": { mutants: [mutant("top", 1, status)] } } })
    expect(reviewUnselected(base, ["top"], rerun("Survived"))).toEqual([
      `::error file=src/core/word.ts,line=1,title=テストが弱くなった::変わっていないコードのミュータントtop（StringLiteralで""に置き換え）を、前は「${killer}」が検出していましたが、差分の実行で選ばれなかったため実行し直すと、どのテストも検出しませんでした。${regressionAdvice}`
    ])
    expect(reviewUnselected(base, ["top"], rerun("NoCoverage"))[0]).toContain("title=テストが弱くなった::")
    expect(reviewUnselected(base, ["top"], rerun("Pending"))).toEqual([
      "::error file=src/core/word.ts,line=1,title=実行し直しの結果が想定外::ミュータントtopを実行し直した結果が「Pending」でした。テストが弱くなったかを確かめられないので失敗にします。"
    ])
    expect(reviewUnselected(base, ["top"], rerun("Ignored"))[0]).toContain("title=実行し直しの結果が想定外::")
    expect(reviewUnselected(base, ["top"], report([]))[0]).toContain("「結果なし」")
    expect(reviewUnselected(base, ["top"], rerun("Killed"))).toEqual([])
    expect(reviewUnselected(base, ["top"], rerun("Timeout"))).toEqual([])
    expect(reviewUnselected(base, ["top"], rerun("RuntimeError"))).toEqual([])
  })

  it("ソースの型を変えて、前はKilledだったミュータントがコンパイルできなくなっても、検出とみなして失敗にしない", () => {
    const rerun = { ...report([]), files: { "src/core/word.ts": { mutants: [mutant("top", 1, "CompileError")] } } }
    expect(reviewUnselected(base, ["top"], rerun)).toEqual([])
  })
})

describe("reviewNotRun", () => {
  it("実行しなかったミュータントがあれば失敗にする", () => {
    expect(reviewNotRun("score: 100%\nnot run: 3 over the time budget (--time-budget)\n")).toEqual([
      "::error title=実行しなかったミュータントがある::差分の実行で、実行しなかったミュータントがあります（3 over the time budget (--time-budget)）。テストが弱くなったかを確かめきれないので失敗にします。mutator.config.*のtimeBudgetやmutantsPerLineを外してください。"
    ])
    expect(reviewNotRun("score: 100%\n")).toEqual([])
  })
})

describe("reviewTrackedMutator", () => {
  it(".mutatorが追跡されていたら失敗にする", () => {
    expect(reviewTrackedMutator([".mutator/snapshot.json", ".mutator/scopes/a.json"])).toEqual([
      "::error file=.mutator/snapshot.json,title=.mutatorが追跡されている::.mutatorの中のファイル（2件）がGitで追跡されています。.mutatorは実行のたびに作り直す結果なので、git rm -r --cached .mutatorで追跡を外してください。"
    ])
    expect(reviewTrackedMutator([])).toEqual([])
  })
})

describe("reviewRunLimits", () => {
  it("実行するミュータントを減らすか、結果の置き場所を変える設定を、名前を挙げて失敗にする", () => {
    expect(reviewRunLimits({ include: ["src/**"], since: "HEAD", timeBudget: 6 }, "mutator.config.json")).toEqual([
      "::error file=mutator.config.json,title=判定と合わないmutatorの設定::mutator.config.jsonにsince（実行するミュータントを減らす）、timeBudget（実行するミュータントを減らす）があります。テストを弱めた変更を確かめきれないので、外してください。"
    ])
    expect(reviewRunLimits({ mutantsPerLine: 1, shard: "1/2", reportDir: "out" }, "m.json")[0]).toContain(
      "mutantsPerLine（実行するミュータントを減らす）、shard（実行するミュータントを減らす）、reportDir（結果の置き場所を変える）"
    )
    expect(reviewRunLimits({ include: ["src/**"], excludedMutators: ["Regex"] }, "mutator.config.json")).toEqual([])
    expect(reviewRunLimits(undefined, "mutator.config.*")).toEqual([])
  })

  it("基準と今で結果を共有する設定と、判定と違う設定でテストを集める設定も、失敗にする", () => {
    expect(reviewRunLimits({ sharedCache: true }, "mutator.config.json")[0]).toContain(
      "sharedCache（基準と今の結果を同じ置き場所（.git/mutator）に読み書きする）"
    )
    expect(
      reviewRunLimits(
        { runner: "vitest", vitestConfig: "vitest.other.ts", jestConfig: "jest.config.js", playwrightConfig: "p.ts" },
        "mutator.config.json"
      )[0]
    ).toContain(
      "runner（判定がテストを集める設定と食い違う）、vitestConfig（判定がテストを集める設定と食い違う）、jestConfig（判定がテストを集める設定と食い違う）、playwrightConfig（判定がテストを集める設定と食い違う）"
    )
  })
})

describe("pendingKeys", () => {
  it("実行しなかったミュータントのキーを返す", () => {
    const pending = { ...report([]), files: { "src/core/note.ts": { mutants: [mutant("a", 1, "Pending"), mutant("b", 2, "Killed")] } } }
    expect(pendingKeys(pending)).toEqual(["a"])
    expect(pendingKeys(report([]))).toEqual([])
  })
})

describe("reviewDroppedMutants", () => {
  const killer = "src/core/word.test.ts#単語"
  const original = {
    ...report([]),
    files: {
      "src/core/word.ts": {
        mutants: [
          mutant("weak", 1, "Killed", [killer]),
          mutant("kept", 2, "Killed", ["src/core/other.test.ts#変えていない"]),
          mutant("survived", 3, "Survived"),
          mutant("pending", 4, "Pending"),
          mutant("timeout", 5, "Timeout", [killer])
        ]
      }
    }
  }
  const touched = (test: string): boolean => test === killer
  const now = (status: string) => ({
    listed: new Set(["weak"]),
    report: { ...report([]), files: { "src/core/word.ts": { mutants: [mutant("weak", 1, status)] } } }
  })

  it("実行し直すのは、分岐点の設定でKilledで、検出したテストが変わったものだけ", () => {
    expect(recheckTargets(original, ["weak", "kept", "survived", "pending", "timeout", "missing"], touched)).toEqual(["weak"])
  })

  it("今の作業ツリーを分岐点の設定のまま実行し直して、検出されなければ失敗にする", () => {
    expect(reviewDroppedMutants(original, ["weak", "kept", "survived"], touched, now("Survived"))).toEqual([
      `::error file=src/core/word.ts,line=1,title=テストを弱めて、設定で比べる対象から外した::ミュータントweak（StringLiteralで""に置き換え）は、分岐点の設定では「${killer}」が検出していましたが、今の設定では比べる対象から外れています。今の作業ツリーを分岐点の設定のまま実行し直すと、どのテストも検出しませんでした。${regressionAdvice}テストを弱めていないのに失敗するときは、設定の変更を別のPRに分けてください。`,
      "::warning title=ミュータントが設定で外れた::今のmutatorかテストの設定で、分岐点の設定では検出していたミュータントが1件、比べる対象から外れました（kept）。それを検出していたテストは変わっていないか、今も検出しますが、検査する範囲が狭まっていないかを確かめてください。"
    ])
    expect(reviewDroppedMutants(original, ["weak"], touched, now("NoCoverage"))[0]).toContain(
      "title=テストを弱めて、設定で比べる対象から外した::"
    )
  })

  it("設定とソースを同じPRで変えても、今のテストが分岐点の設定で検出すれば失敗にしない", () => {
    for (const status of ["Killed", "Timeout", "RuntimeError", "CompileError"]) {
      expect(reviewDroppedMutants(original, ["weak", "kept"], touched, now(status))).toEqual([
        expect.stringContaining(
          "::warning title=ミュータントが設定で外れた::今のmutatorかテストの設定で、分岐点の設定では検出していたミュータントが2件、比べる対象から外れました（weak、kept）。"
        )
      ])
    }
  })

  it("ソースが変わって今の作業ツリーに無いものは、確かめずに警告にする", () => {
    expect(reviewDroppedMutants(original, ["weak"], touched, { listed: new Set() })).toEqual([
      "::warning title=設定で外れ、ソースも変わったミュータント::設定で比べる対象から外れたミュータントのうち1件は、ソースが変わって今の作業ツリーに無いので、テストが弱くなったかを確かめていません（weak）。ソースの変更は判定の対象外です。"
    ])
  })

  it("実行し直した結果が無いか、実行しなかったか、Ignoredなら、確かめられないので失敗にする", () => {
    const lines = reviewDroppedMutants(original, ["pending", "missing"], () => false)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain("title=設定で外れたミュータントを確かめられなかった::")
    expect(lines[0]).toContain("基準のコミットで分岐点の設定のまま実行し直した結果が「Pending」")
    expect(lines[1]).toContain("「結果なし」")
    expect(lines[1]).toContain("設定の変更を別のPRに分けてください")
    expect(reviewDroppedMutants(original, ["weak"], touched, now("Ignored"))[0]).toContain(
      "今の作業ツリーで分岐点の設定のまま実行し直した結果が「Ignored」"
    )
    expect(reviewDroppedMutants(original, ["weak"], touched, { listed: new Set(["weak"]) })[0]).toContain("「結果なし」")
  })

  it("分岐点の設定でもKilledでなかったものは、設定で外れたものに数えない", () => {
    expect(reviewDroppedMutants(original, ["survived", "timeout"], touched)).toEqual([])
  })

  it("警告に並べるのは5件までにする", () => {
    const many = { ...report([]), files: { "a.ts": { mutants: ["1", "2", "3", "4", "5", "6"].map((id) => mutant(id, 1, "Killed")) } } }
    expect(reviewDroppedMutants(many, ["1", "2", "3", "4", "5", "6"], () => false)[0]).toContain(
      "6件、比べる対象から外れました（1、2、3、4、5など）"
    )
  })
})

describe("snapshotRows", () => {
  it("snapshotの行から、関数の中身のハッシュと状態と--kill-matrixの印を読む", () => {
    expect(
      snapshotRows({
        format: 2,
        rows: [
          ["a", 0, 4, "h1", "Killed", [], [], 1.5, 0, 1],
          ["b", 0, 4, "h2", "Survived", [], []],
          [1, 2]
        ]
      })
    ).toEqual(
      new Map([
        ["a", { scopeHash: "h1", status: "Killed", matrix: true }],
        ["b", { scopeHash: "h2", status: "Survived", matrix: false }]
      ])
    )
  })
})

describe("touchedTests", () => {
  it("変わったテストは、mutatorが挙げたものと、ファイルか読み込むファイルが差分にあるもの", () => {
    const withChanges = {
      ...report([]),
      testChanges: { added: [], changed: ["src/a.test.ts#変えた"], removed: ["src/gone.test.ts#消した"] },
      selectionReasons: [{ key: "k", tests: ["src/b.test.ts#選んだ"] }]
    }
    const deps = snapshotDeps({ deps: { "src/core/word.test.ts": ["src/core/word.ts", "src/testing/expect-word.ts"] } })
    const touchedBy = touchedTests(withChanges, ["src/testing/expect-word.ts", "src/c.test.ts"], [new Map(), deps])
    expect(
      [
        "src/a.test.ts#変えた",
        "src/gone.test.ts#消した",
        "src/b.test.ts#選んだ",
        "src/core/word.test.ts#ヘルパーが変わった",
        "src/c.test.ts#ファイルが変わった",
        "src/a.test.ts#変えていない",
        "src/d.test.ts#変えていない"
      ].filter((test) => touchedBy(test))
    ).toEqual([
      "src/a.test.ts#変えた",
      "src/gone.test.ts#消した",
      "src/b.test.ts#選んだ",
      "src/core/word.test.ts#ヘルパーが変わった",
      "src/c.test.ts#ファイルが変わった"
    ])
    expect(touchedTests(undefined, [], [])("src/a.test.ts#a")).toBe(false)
    expect(snapshotDeps({ rows: [] })).toEqual(new Map())
  })
})
