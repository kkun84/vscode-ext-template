import * as vscode from "vscode"
import { Effect, Layer, Option } from "effect"
import { TitlePrompt } from "../../services/ports.ts"

export const TitlePromptLive = Layer.succeed(TitlePrompt, {
  ask: Effect.promise(async () =>
    Option.fromUndefinedOr(
      await vscode.window.showInputBox({
        prompt: vscode.l10n.t("Note title"),
        placeHolder: vscode.l10n.t("For example: Meeting notes")
      })
    )
  )
})
