import { symlinkSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"
import { isLockfileName, listFiles, report } from "./files.ts"
import { useTempDir } from "./temp-dir.ts"

const dir = useTempDir("lint-files-")
const names = (files: ReadonlyArray<string>): ReadonlyArray<string> =>
  files.map((file) => relative(dir.root(), file).replaceAll(sep, "/")).toSorted()

describe("isLockfileName", () => {
  it("ロックファイルを見分ける", () => {
    expect(isLockfileName("pnpm-lock.yaml")).toBe(true)
    expect(isLockfileName("flake.lock")).toBe(true)
    expect(isLockfileName("README.md")).toBe(false)
  })
})

describe("listFiles", () => {
  it("パスが無ければ全体を探し、生成物、ロックファイル、シンボリックリンクを除く", () => {
    dir.write("a.md")
    dir.write("src/b.ts")
    dir.write("node_modules/c.md")
    dir.write("dist/d.md")
    dir.write("pnpm-lock.yaml")
    symlinkSync(join(dir.root(), "a.md"), join(dir.root(), "link.md"))
    expect(names(listFiles([], dir.root()))).toStrictEqual(["a.md", "src/b.ts"])
  })

  it("渡したファイルとディレクトリだけを探し、無いパスは無視する", () => {
    const one = dir.write("one.md")
    dir.write("dir/two.ts")
    dir.write("other.md")
    expect(names(listFiles([one, join(dir.root(), "dir"), join(dir.root(), "missing.md")], dir.root()))).toStrictEqual([
      "dir/two.ts",
      "one.md"
    ])
  })
})

describe("report", () => {
  it("違反が無ければ終了コード0", () => {
    expect(report("x", [])).toStrictEqual({ output: "x: no violations found\n", exitCode: 0 })
  })

  it("違反があれば一覧と件数を出し、終了コード1", () => {
    expect(report("x", ["a", "b"])).toStrictEqual({ output: "a\nb\nx: 2 violation(s) found\n", exitCode: 1 })
  })
})
