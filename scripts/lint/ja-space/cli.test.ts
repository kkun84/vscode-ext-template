import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { useTempDir } from "../shared/temp-dir.ts"
import { run } from "./cli.ts"

const SP = "\u0020"
const dir = useTempDir("ja-space-cli-")

describe("run", () => {
  it("reports violations and exits 1", () => {
    const file = dir.write("a.md", `日本語${SP}URL\n`)
    const { output, exitCode } = run([file])
    expect(exitCode).toBe(1)
    expect(output).toContain("a.md:1:4:")
    expect(output).toContain("1 violation(s) found")
  })

  it("exits 0 when there is nothing to fix", () => {
    const file = dir.write("clean.md", "日本語URL\n")
    const { output, exitCode } = run([file])
    expect(exitCode).toBe(0)
    expect(output).toContain("no violations found")
  })

  it("applies fixes in place with --fix", () => {
    const file = dir.write("b.md", `日本語${SP}URL\n`)
    const { output, exitCode } = run(["--fix", file])
    expect(exitCode).toBe(0)
    expect(output).toContain("fixed 1 violation(s) in 1 file(s)")
    expect(readFileSync(file, "utf8")).toBe("日本語URL\n")
  })
})
