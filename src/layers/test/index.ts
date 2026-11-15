import { Context, Effect, Layer, Option, Ref } from "effect"
import { NoteWriteFailed, NoWorkspaceFolder, type CommandError } from "../../services/errors.ts"
import { Notifier, Settings, TitlePrompt, UserName, WorkspaceFiles, type AppServices } from "../../services/ports.ts"
import { DEFAULT_NOTES_FOLDER, type NoteSettings } from "../../services/settings.ts"

export interface TestOptions {
  /** 入力欄の答え。`None`なら取り消し。 */
  readonly answer?: Option.Option<string>
  readonly settings?: Partial<NoteSettings>
  readonly userName?: string
  readonly workspace?: boolean
  /** 最初からあるファイル。キーはワークスペースからの相対パス。 */
  readonly files?: Readonly<Record<string, string>>
  readonly failWrites?: boolean
}

/** テストの後で確かめる、起きたことの記録。 */
interface TestRecord {
  readonly files: ReadonlyMap<string, string>
  readonly opened: ReadonlyArray<string>
  readonly created: ReadonlyArray<string>
  readonly failures: ReadonlyArray<CommandError>
}

/** 記録を読み出すためのサービス。テスト用の層だけが提供する。 */
export class TestRecorder extends Context.Service<TestRecorder, { readonly read: Effect.Effect<TestRecord> }>()(
  "vscode-ext-template/TestRecorder"
) {}

/** VS Codeの代わりにメモリ上で動く層。 */
export const testLayer = (options: TestOptions = {}): Layer.Layer<AppServices | TestRecorder> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const record = yield* Ref.make<TestRecord>({
        files: new Map(Object.entries(options.files ?? {})),
        opened: [],
        created: [],
        failures: []
      })
      const requireWorkspace = options.workspace === false ? Effect.fail(new NoWorkspaceFolder()) : Effect.void

      return Layer.mergeAll(
        Layer.succeed(Settings, { read: Effect.succeed({ folder: DEFAULT_NOTES_FOLDER, author: "", ...options.settings }) }),
        Layer.succeed(TitlePrompt, { ask: Effect.succeed(options.answer ?? Option.some("Test note")) }),
        Layer.succeed(UserName, { get: Effect.succeed(Option.fromUndefinedOr(options.userName)) }),
        Layer.succeed(WorkspaceFiles, {
          list: (folder) =>
            requireWorkspace.pipe(
              Effect.andThen(Ref.get(record)),
              Effect.map(({ files }) =>
                [...files.keys()].filter((path) => path.startsWith(`${folder}/`)).map((path) => path.slice(folder.length + 1))
              )
            ),
          write: (folder, fileName, content) =>
            requireWorkspace.pipe(
              Effect.andThen(options.failWrites === true ? Effect.fail(new NoteWriteFailed({ fileName, detail: "test" })) : Effect.void),
              Effect.andThen(
                Ref.modify(record, (current) => {
                  const path = `${folder}/${fileName}`
                  return [path, { ...current, files: new Map(current.files).set(path, content) }]
                })
              )
            ),
          open: (path) => Ref.update(record, (current) => ({ ...current, opened: [...current.opened, path] }))
        }),
        Layer.succeed(Notifier, {
          noteCreated: (path) => Ref.update(record, (current) => ({ ...current, created: [...current.created, path] })),
          failed: (error) => Ref.update(record, (current) => ({ ...current, failures: [...current.failures, error] }))
        }),
        Layer.succeed(TestRecorder, { read: Ref.get(record) })
      )
    })
  )
