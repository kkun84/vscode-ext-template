import { Clock, Effect, Option } from "effect"
import { nextAvailableName, noteFileName, renderNote } from "../core/note.ts"
import type { CreateNoteError } from "./errors.ts"
import { Notifier, Settings, TitlePrompt, UserName, WorkspaceFiles } from "./ports.ts"

export interface CreateNoteArguments {
  readonly title: string
}

/**
 * 題名を決め、設定のフォルダにMarkdownのノートを作り、開いて知らせる。
 *
 * 入力欄で取り消されたら`None`を返す。失敗は型付きのエラーのまま返し、
 * 利用者への通知はコマンドの境界に任せる。
 */
export const createNote = Effect.fn("createNote")(function* (args: CreateNoteArguments | undefined) {
  const title = args === undefined ? yield* (yield* TitlePrompt).ask : Option.some(args.title)
  if (Option.isNone(title)) {
    return Option.none<string>()
  }

  const settings = yield* (yield* Settings).read
  const author = settings.author === "" ? Option.getOrUndefined(yield* (yield* UserName).get) : settings.author
  const date = new Date(yield* Clock.currentTimeMillis)

  const files = yield* WorkspaceFiles
  const existing = yield* files.list(settings.folder)
  const fileName = nextAvailableName(noteFileName(title.value, date), existing)
  const relativePath = yield* files.write(settings.folder, fileName, renderNote({ title: title.value, author, date }))

  yield* files.open(relativePath)
  yield* (yield* Notifier).noteCreated(relativePath)
  return Option.some(relativePath)
}) satisfies (args: CreateNoteArguments | undefined) => Effect.Effect<Option.Option<string>, CreateNoteError, unknown>
