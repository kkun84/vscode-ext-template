import { Schema } from "effect"

/** ワークスペースのフォルダが開かれていない。 */
export class NoWorkspaceFolder extends Schema.TaggedError<NoWorkspaceFolder, { readonly brand: unique symbol }>()(
  "NoWorkspaceFolder",
  {}
) {}

/** ノートのフォルダを読めなかった。 */
export class NotesFolderReadFailed extends Schema.TaggedError<NotesFolderReadFailed, { readonly brand: unique symbol }>()(
  "NotesFolderReadFailed",
  {
    folder: Schema.String,
    detail: Schema.String
  }
) {}

/** ノートを保存できなかった。 */
export class NoteWriteFailed extends Schema.TaggedError<NoteWriteFailed, { readonly brand: unique symbol }>()("NoteWriteFailed", {
  fileName: Schema.String,
  detail: Schema.String
}) {}

/** コマンドの引数をSchemaでdecodeできなかった。 */
export class InvalidCommandArguments extends Schema.TaggedError<InvalidCommandArguments, { readonly brand: unique symbol }>()(
  "InvalidCommandArguments",
  {
    command: Schema.String,
    detail: Schema.String
  }
) {}

/** 想定外の欠陥でコマンドが失敗した。詳細はログにだけ残す。 */
export class UnexpectedFailure extends Schema.TaggedError<UnexpectedFailure, { readonly brand: unique symbol }>()("UnexpectedFailure", {
  command: Schema.String
}) {}

/** `createNote`が型付きで失敗する理由。 */
export type CreateNoteError = NoWorkspaceFolder | NotesFolderReadFailed | NoteWriteFailed

/** コマンドの境界で利用者に知らせるエラー。 */
export type CommandError = CreateNoteError | InvalidCommandArguments | UnexpectedFailure
