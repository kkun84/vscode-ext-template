import { describe, expect, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { NotesFolder } from "./settings.ts"

const decode = Schema.decodeUnknownOption(NotesFolder)

describe("NotesFolder", () => {
  it.each(["notes", "journal/2024", "my notes", "a..b"])("ワークスペースの中の相対パス %sを受け入れる", (value) => {
    expect(decode(value)).toStrictEqual(Option.some(value))
  })

  it.each(["", "  ", "..", "../escape", "notes/../..", "/abs", "\\abs", "C:\\notes", "c:/notes", 1, undefined])(
    "%sは不正として拒む",
    (value) => {
      expect(Option.isNone(decode(value))).toBe(true)
    }
  )
})
