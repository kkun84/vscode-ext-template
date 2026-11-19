import { describe, expect, it } from "@effect/vitest"
import { InvalidCommandArguments, NoteWriteFailed, NotesFolderReadFailed, NoWorkspaceFolder, UnexpectedFailure } from "./errors.ts"

describe("型付きのエラー", () => {
  it("タグで種類を見分けられる", () => {
    expect(new NoWorkspaceFolder()._tag).toBe("NoWorkspaceFolder")
    expect(new NotesFolderReadFailed({ folder: "notes", detail: "denied" })._tag).toBe("NotesFolderReadFailed")
    expect(new NoteWriteFailed({ fileName: "a.md", detail: "disk full" })._tag).toBe("NoteWriteFailed")
    expect(new InvalidCommandArguments({ command: "createNote", detail: "title" })._tag).toBe("InvalidCommandArguments")
    expect(new UnexpectedFailure({ command: "createNote" })._tag).toBe("UnexpectedFailure")
  })

  it("ログに出す値を保つ", () => {
    const read = new NotesFolderReadFailed({ folder: "notes", detail: "denied" })
    expect([read.folder, read.detail]).toStrictEqual(["notes", "denied"])

    const invalid = new InvalidCommandArguments({ command: "createNote", detail: "title" })
    expect([invalid.command, invalid.detail]).toStrictEqual(["createNote", "title"])

    expect(new UnexpectedFailure({ command: "createNote" }).command).toBe("createNote")
  })
})
