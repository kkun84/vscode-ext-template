import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect, Exit, Option } from "effect"
import { TestClock } from "effect/testing"
import { TestRecorder, testLayer, type TestOptions } from "../layers/test/index.ts"
import { createNote, type CreateNoteArguments } from "./create-note.ts"
import { NoteWriteFailed, NoWorkspaceFolder } from "./errors.ts"

// 地方時の正午にする。実行環境の時間帯によって日付がずれないように。
const NOON = new Date(2024, 0, 5, 12).getTime()

const run = (options: TestOptions, args?: CreateNoteArguments) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOON)
    const exit = yield* Effect.exit(createNote(args))
    return { exit, record: yield* (yield* TestRecorder).read }
  }).pipe(Effect.provide(testLayer(options)))

const failureOf = (exit: Exit.Exit<unknown, unknown>): unknown =>
  Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined

const body = (options: TestOptions) => run(options).pipe(Effect.map(({ record }) => record.files.get("notes/2024-01-05-test-note.md")))

describe("createNote", () => {
  it.effect("入力欄の題名でノートを作り、開いて知らせる", () =>
    Effect.gen(function* () {
      const { exit, record } = yield* run({ answer: Option.some("Hello World") })

      expect(exit).toStrictEqual(Exit.succeed(Option.some("notes/2024-01-05-hello-world.md")))
      expect(record.files.get("notes/2024-01-05-hello-world.md")).toBe("# Hello World\n\n- Created: 2024-01-05\n")
      expect(record.opened).toStrictEqual(["notes/2024-01-05-hello-world.md"])
      expect(record.created).toStrictEqual(["notes/2024-01-05-hello-world.md"])
    })
  )

  it.effect("入力欄で取り消されたら何もしない", () =>
    Effect.gen(function* () {
      const { exit, record } = yield* run({ answer: Option.none() })

      expect(exit).toStrictEqual(Exit.succeed(Option.none()))
      expect(record.files.size).toBe(0)
      expect(record.created).toStrictEqual([])
    })
  )

  it.effect("引数で題名が渡されたら入力欄を使わない", () =>
    Effect.gen(function* () {
      const { record } = yield* run({ answer: Option.none() }, { title: "From Argument" })

      expect(record.created).toStrictEqual(["notes/2024-01-05-from-argument.md"])
    })
  )

  it.effect("ワークスペースが無ければNoWorkspaceFolderで失敗する", () =>
    Effect.gen(function* () {
      const { exit, record } = yield* run({ workspace: false })

      expect(failureOf(exit)).toBeInstanceOf(NoWorkspaceFolder)
      expect(record.created).toStrictEqual([])
    })
  )

  it.effect("書き込みに失敗したらNoteWriteFailedで失敗し、開かない", () =>
    Effect.gen(function* () {
      const { exit, record } = yield* run({ failWrites: true })

      expect(failureOf(exit)).toBeInstanceOf(NoteWriteFailed)
      expect(failureOf(exit)).toMatchObject({ fileName: "2024-01-05-test-note.md" })
      expect(record.opened).toStrictEqual([])
    })
  )

  it.effect("同名のファイルがあれば-2を付け、元のファイルは変えない", () =>
    Effect.gen(function* () {
      const { record } = yield* run({ files: { "notes/2024-01-05-test-note.md": "old" } })

      expect(record.files.get("notes/2024-01-05-test-note.md")).toBe("old")
      expect(record.created).toStrictEqual(["notes/2024-01-05-test-note-2.md"])
    })
  )

  it.effect("設定のフォルダに保存する", () =>
    Effect.gen(function* () {
      const { record } = yield* run({ settings: { folder: "journal/2024" } })

      expect(record.created).toStrictEqual(["journal/2024/2024-01-05-test-note.md"])
    })
  )
})

describe("createNoteの著者", () => {
  it.effect("設定があればそれを使う", () =>
    Effect.gen(function* () {
      expect(yield* body({ settings: { author: "Alice" }, userName: "os-user" })).toBe(
        "# Test note\n\n- Author: Alice\n- Created: 2024-01-05\n"
      )
    })
  )

  it.effect("設定が空ならOSのユーザー名を使う", () =>
    Effect.gen(function* () {
      expect(yield* body({ userName: "os-user" })).toBe("# Test note\n\n- Author: os-user\n- Created: 2024-01-05\n")
    })
  )

  it.effect("設定が空でユーザー名も無ければ省く", () =>
    Effect.gen(function* () {
      expect(yield* body({})).toBe("# Test note\n\n- Created: 2024-01-05\n")
    })
  )
})
