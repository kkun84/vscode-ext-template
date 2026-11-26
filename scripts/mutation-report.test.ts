import { describe, expect, it } from "vitest"
import { formatAnnotation, reviewFindings, reviewSettingChanges } from "./mutation-report.ts"

const files = {
  "src/core/note.ts": {
    mutants: [
      { id: "other", mutatorName: "BooleanLiteral", replacement: "true", location: { start: { line: 3 } } },
      { id: "weak", mutatorName: "StringLiteral", replacement: '""', location: { start: { line: 24 } } }
    ]
  }
}

describe("reviewFindings", () => {
  it("テストを弱めた変更を、ミュータントの行に付けたエラーにして失敗する", () => {
    const review = reviewFindings(
      {
        comparison: "available",
        findings: [
          { kind: "mutationGap", key: "weak" },
          { kind: "detectionRegression", key: "weak", previousKillers: ["src/core/note.test.ts#formatDate > 年が3桁なら0で埋める"] }
        ],
        files
      },
      "mutation.json"
    )
    expect(review).toEqual({
      lines: [
        '::error file=src/core/note.ts,line=24,title=テストが弱くなった::変わっていないコードのミュータントweak（StringLiteralで""に置き換え）を、前は「src/core/note.test.ts#formatDate > 年が3桁なら0で埋める」が検出していましたが、今はどのテストも検出しません。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。mutator acceptで記録して通してはいけません。',
        "テストが弱くなった箇所: 1件、何も検出しない新しいテスト: 0件",
        "テストが検出できなかったミュータント: 1件。失敗にはしません。テストが足りないのか、コードが要らないのかを見直してください。手順はnode_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.mdにあります。"
      ],
      exitCode: 1
    })
  })

  it("位置の分からないミュータントは、分かる所までを付けてエラーにする", () => {
    const review = reviewFindings(
      {
        findings: [
          { kind: "detectionRegression", key: "gone", previousKillers: [] },
          { kind: "detectionRegression", key: "weak", previousKillers: ["a.test.ts#一", "a.test.ts#二"] }
        ],
        files: { "src/core/note.ts": { mutants: [{ id: "weak" }] } }
      },
      "mutation.json"
    )
    expect(review.lines.slice(0, 2)).toEqual([
      "::error title=テストが弱くなった::変わっていないコードのミュータントgoneを、前はテストが検出していましたが、今はどのテストも検出しません。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。mutator acceptで記録して通してはいけません。",
      "::error file=src/core/note.ts,title=テストが弱くなった::変わっていないコードのミュータントweakを、前は「a.test.ts#一」、「a.test.ts#二」が検出していましたが、今はどのテストも検出しません。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。mutator acceptで記録して通してはいけません。"
    ])
    expect(review.exitCode).toBe(1)
  })

  it("何も検出しない新しいテストは、警告だけにして成功する", () => {
    expect(
      reviewFindings(
        {
          findings: [
            { kind: "newTestNoKills", test: "src/core/note.test.ts#呼ぶだけ" },
            { kind: "testNotMeasured", test: "src/core/note.test.ts#届かない" }
          ],
          files
        },
        "mutation.json"
      )
    ).toEqual({
      lines: [
        "::warning title=何も検出しない新しいテスト::「src/core/note.test.ts#呼ぶだけ」は、どのミュータントも検出しません。振る舞いを確かめるアサーションがあるかを見直してください。",
        "テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 1件"
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

describe("reviewFindingsの失敗にしない場合", () => {
  it("検出できなかったミュータントだけなら、件数を出して成功する", () => {
    const review = reviewFindings({ findings: [{ kind: "mutationGap", key: "other" }], files }, "mutation.json")
    expect(review.exitCode).toBe(0)
    expect(review.lines[1]).toContain("テストが検出できなかったミュータント: 1件。失敗にはしません。")
    expect(reviewFindings({}, "mutation.json")).toEqual({
      lines: ["テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 0件"],
      exitCode: 0
    })
  })

  it("前回の結果と比べられなかったことを、失敗にせず知らせる", () => {
    expect(reviewFindings({ comparison: "unavailable", findings: [] }, "mutation.json")).toEqual({
      lines: [
        "::notice title=比較の基準が無い::前回の結果が無いか、package.json、ロックファイル、tsconfig.json、Node.jsの版、mutatorの設定のどれかが変わったため、テストが弱くなったかは確かめていません。",
        "テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 0件"
      ],
      exitCode: 0
    })
    expect(reviewFindings({ comparison: "available", findings: [] }, "mutation.json").lines).toHaveLength(1)
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
})
