import * as vscode from "vscode"
import { Effect, Layer, Match } from "effect"
import type { CommandError } from "../../services/errors.ts"
import { Notifier } from "../../services/ports.ts"

const errorMessage = Match.type<CommandError>().pipe(
  Match.tagsExhaustive({
    NoWorkspaceFolder: () => vscode.l10n.t("Open a folder to create a note."),
    NotesFolderReadFailed: () => vscode.l10n.t("Could not read the notes folder."),
    NoteWriteFailed: () => vscode.l10n.t("Could not save the note."),
    InvalidCommandArguments: () => vscode.l10n.t("Invalid arguments for this command."),
    UnexpectedFailure: () => vscode.l10n.t("The command failed. See the log for details.")
  })
)

// 通知は利用者の操作を待たずに終える。ボタンを付けたら結果を待つ形に変える。
export const NotifierLive = Layer.succeed(Notifier, {
  noteCreated: (relativePath) =>
    Effect.sync(() => void vscode.window.showInformationMessage(vscode.l10n.t("Note created: {0}", relativePath))),
  failed: (error) => Effect.sync(() => void vscode.window.showErrorMessage(errorMessage(error)))
})
