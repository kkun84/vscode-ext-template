import { Context } from "effect"
import type { Effect, Option } from "effect"
import type { CommandError, NoteWriteFailed, NotesFolderReadFailed, NoWorkspaceFolder } from "./errors.ts"
import type { NoteSettings } from "./settings.ts"

/** 検証済みの設定。 */
export class Settings extends Context.Service<
  Settings,
  {
    readonly read: Effect.Effect<NoteSettings>
  }
>()("vscode-ext-template/Settings") {}

/** 題名を入力欄で尋ねる。取り消されたら`None`。 */
export class TitlePrompt extends Context.Service<
  TitlePrompt,
  {
    readonly ask: Effect.Effect<Option.Option<string>>
  }
>()("vscode-ext-template/TitlePrompt") {}

/** ワークスペースの最初のフォルダの中のファイル。パスはワークスペースからの相対パス。 */
export class WorkspaceFiles extends Context.Service<
  WorkspaceFiles,
  {
    /** フォルダの中のファイル名。フォルダが無ければ空。 */
    readonly list: (folder: string) => Effect.Effect<ReadonlyArray<string>, NoWorkspaceFolder | NotesFolderReadFailed>
    /** フォルダが無ければ作ってから書き込み、ワークスペースからの相対パスを返す。 */
    readonly write: (folder: string, fileName: string, content: string) => Effect.Effect<string, NoWorkspaceFolder | NoteWriteFailed>
    readonly open: (relativePath: string) => Effect.Effect<void>
  }
>()("vscode-ext-template/WorkspaceFiles") {}

/** 利用者への通知。文言への翻訳は実装が行う。 */
export class Notifier extends Context.Service<
  Notifier,
  {
    readonly noteCreated: (relativePath: string) => Effect.Effect<void>
    readonly failed: (error: CommandError) => Effect.Effect<void>
  }
>()("vscode-ext-template/Notifier") {}

/** OSのユーザー名。取得できない環境では`None`。 */
export class UserName extends Context.Service<
  UserName,
  {
    readonly get: Effect.Effect<Option.Option<string>>
  }
>()("vscode-ext-template/UserName") {}

/** 拡張機能の実行環境が提供するサービス。 */
export type AppServices = Settings | TitlePrompt | WorkspaceFiles | Notifier | UserName
