import { describe, expect, it } from "vitest"
import { checkCommands, checkNpmrc, checkPackageJson, checkWorkspace } from "./rule.ts"

const valid = [
  "minimumReleaseAge: 10080",
  "engineStrict: true",
  "trustPolicy: no-downgrade",
  "blockExoticSubdeps: true",
  "allowBuilds:",
  "  lefthook: true",
  '  "@vscode/vsce-sign": false'
].join("\n")

describe("checkWorkspace", () => {
  it("必須の設定が揃っていれば通す", () => {
    expect(checkWorkspace(valid)).toStrictEqual([])
  })

  it("必須の設定が無ければ指摘する", () => {
    expect(checkWorkspace("")).toHaveLength(4)
  })

  it("minimumReleaseAgeを緩めたら指摘する", () => {
    expect(checkWorkspace(valid.replace("10080", "10079"))).toStrictEqual(["pnpm-workspace.yaml: minimumReleaseAge must be >= 10080"])
  })

  it("除外の一覧を指摘する", () => {
    expect(checkWorkspace(`${valid}\nminimumReleaseAgeExclude:\n  - foo`)).toStrictEqual([
      "pnpm-workspace.yaml: minimumReleaseAgeExclude is not allowed"
    ])
  })

  it("許可していないパッケージのビルドを指摘する", () => {
    expect(checkWorkspace(`${valid}\n  esbuild: true`)).toStrictEqual(["pnpm-workspace.yaml: allowBuilds must not enable esbuild"])
  })
})

describe("checkPackageJson", () => {
  it("pnpmの設定があれば指摘する", () => {
    expect(checkPackageJson('{"pnpm": {}}')).toHaveLength(1)
    expect(checkPackageJson('{"name": "x"}')).toStrictEqual([])
  })
})

describe("checkNpmrc", () => {
  it("方針の設定の上書きを指摘する", () => {
    expect(checkNpmrc("minimum-release-age=0\nregistry=https://example.com")).toHaveLength(1)
  })
})

describe("checkCommands", () => {
  it("設定を上書きするオプションを行番号つきで指摘する", () => {
    expect(checkCommands("ci.yml", "run: pnpm install\nrun: pnpm install --config.minimumReleaseAge=0")).toStrictEqual([
      "ci.yml:2: --config.minimumReleaseAge overrides the pnpm supply-chain policy"
    ])
  })

  it("lockfileを無視するインストールを指摘する", () => {
    expect(checkCommands("ci.yml", "pnpm install --no-frozen-lockfile")).toHaveLength(1)
  })

  it("似た名前の別のオプションは指摘しない", () => {
    expect(checkCommands("ci.yml", "pnpm install --frozen-lockfile")).toStrictEqual([])
  })
})
