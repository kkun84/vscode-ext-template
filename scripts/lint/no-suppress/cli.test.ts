import { describe, expect, it } from "vitest"
import { useTempDir } from "../shared/temp-dir.ts"
import { run } from "./cli.ts"
import { suppressionDirectives } from "./rule.ts"

const OXLINT = suppressionDirectives()[0] ?? ""
const dir = useTempDir("lint-no-suppress-")
const { write } = dir

describe("run", () => {
  it("exits 1 and reports the directive", () => {
    const file = write("a.ts", `// ${OXLINT} lint: reason\n`)
    const { output, exitCode } = run([file])
    expect(exitCode).toBe(1)
    expect(output).toContain("a.ts:1:1:")
    expect(output).toContain(OXLINT)
    expect(output).toContain("1 violation(s) found")
  })

  it("exits 0 for a clean file", () => {
    const file = write("clean.ts", "export const x = 1;\n")
    const { output, exitCode } = run([file])
    expect(exitCode).toBe(0)
    expect(output).toContain("no violations found")
  })

  it("ignores unsupported extensions", () => {
    const file = write("notes.md", `\`${OXLINT}\` in prose\n`)
    const { exitCode } = run([file])
    expect(exitCode).toBe(0)
  })

  it("scans a directory recursively", () => {
    write("src/a.ts", `// ${OXLINT}\n`)
    write("src/b.ts", "const y = 2;\n")
    const { output, exitCode } = run([dir.root()])
    expect(exitCode).toBe(1)
    expect(output).toContain("1 violation(s) found")
  })
})
