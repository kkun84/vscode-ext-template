import * as vscode from "vscode"
import { Effect, Layer } from "effect"
import { NoteWriteFailed, NotesFolderReadFailed, NoWorkspaceFolder } from "../../services/errors.ts"
import { WorkspaceFiles } from "../../services/ports.ts"

// ファイル操作はvscode.workspace.fsで行う。Node.jsのfsと違い、web版でも動く。

const root = Effect.suspend(() => {
  const folder = vscode.workspace.workspaceFolders?.[0]
  return folder === undefined ? Effect.fail(new NoWorkspaceFolder()) : Effect.succeed(folder.uri)
})

const exists = (uri: vscode.Uri): Effect.Effect<boolean> =>
  Effect.promise(() => Promise.resolve(vscode.workspace.fs.stat(uri))).pipe(
    Effect.as(true),
    Effect.catchDefect(() => Effect.succeed(false))
  )

const list = (folder: string) =>
  Effect.gen(function* () {
    const directory = vscode.Uri.joinPath(yield* root, folder)
    if (!(yield* exists(directory))) {
      return []
    }
    const entries = yield* Effect.tryPromise({
      try: () => Promise.resolve(vscode.workspace.fs.readDirectory(directory)),
      catch: (error) => new NotesFolderReadFailed({ folder, detail: String(error) })
    })
    return entries.map(([name]) => name)
  })

const write = (folder: string, fileName: string, content: string) =>
  Effect.gen(function* () {
    const file = vscode.Uri.joinPath(yield* root, folder, fileName)
    yield* Effect.tryPromise({
      // writeFileは親フォルダが無ければ作る。
      try: () => Promise.resolve(vscode.workspace.fs.writeFile(file, new TextEncoder().encode(content))),
      catch: (error) => new NoteWriteFailed({ fileName, detail: String(error) })
    })
    return vscode.workspace.asRelativePath(file, false)
  })

const open = (relativePath: string) =>
  Effect.gen(function* () {
    const file = vscode.Uri.joinPath(yield* root, relativePath)
    yield* Effect.promise(() => Promise.resolve(vscode.window.showTextDocument(file)))
  }).pipe(Effect.catch((error) => Effect.logWarning("Could not open the note.", error)))

export const WorkspaceFilesLive = Layer.succeed(WorkspaceFiles, { list, write, open })
