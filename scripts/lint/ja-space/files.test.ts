import { relative } from "node:path"
import { describe, expect, it } from "vitest"
import { useTempDir } from "../shared/temp-dir.ts"
import { findFiles } from "./files.ts"

const dir = useTempDir("ja-space-files-")

describe("findFiles", () => {
  it("検査できる拡張子のファイルを、検査の仕方と組にして返す", () => {
    dir.write("a.md")
    dir.write("b.ts")
    dir.write("image.png")
    const found = findFiles([], dir.root()).map((file) => ({ path: relative(dir.root(), file.path), mode: file.mode }))
    expect(found.toSorted((x, y) => x.path.localeCompare(y.path))).toStrictEqual([
      { path: "a.md", mode: "markdown" },
      { path: "b.ts", mode: "typescript" }
    ])
  })
})
