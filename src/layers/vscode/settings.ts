import * as vscode from "vscode"
import { Effect, Layer, Schema } from "effect"
import { Settings } from "../../services/ports.ts"
import { DEFAULT_NOTES_FOLDER, NotesAuthor, NotesFolder } from "../../services/settings.ts"

/** 設定値をdecodeする。不正なら、拒んだ理由と値を警告としてログに残し、既定値を使う。 */
const decodeSetting = <A>(key: string, schema: Schema.Codec<A>, fallback: A): Effect.Effect<A> => {
  const raw: unknown = vscode.workspace.getConfiguration("extTemplate").get(key)
  return Schema.decodeUnknownEffect(schema)(raw).pipe(
    Effect.catch((error) =>
      Effect.logWarning(`extTemplate.${key} is invalid. Using the default.`, String(error), raw).pipe(Effect.as(fallback))
    )
  )
}

export const SettingsLive = Layer.succeed(Settings, {
  read: Effect.gen(function* () {
    return {
      folder: yield* decodeSetting("notes.folder", NotesFolder, DEFAULT_NOTES_FOLDER),
      author: yield* decodeSetting("notes.author", NotesAuthor, "")
    }
  })
})
