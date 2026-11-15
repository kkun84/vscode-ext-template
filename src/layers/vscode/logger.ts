import * as vscode from "vscode"
import { Effect, Layer, Logger } from "effect"
import type * as LogLevel from "effect/LogLevel"

// Effectのログの段階を、LogOutputChannelのどのメソッドで書くか。
const methods = {
  Fatal: "error",
  Error: "error",
  Warn: "warn",
  Info: "info",
  Debug: "debug",
  Trace: "trace",
  All: "trace",
  None: "trace"
} as const satisfies Record<LogLevel.LogLevel, keyof vscode.LogOutputChannel>

/**
 * 出力チャネルを作り、Effectのログをそこへ流す。
 *
 * チャネルは`ManagedRuntime`を破棄すると閉じる。ログの段階の絞り込みは、
 * 利用者がVS Code側でチャネルごとに設定する。
 */
export const LoggerLive = Layer.unwrap(
  Effect.gen(function* () {
    const channel = yield* Effect.acquireRelease(
      Effect.sync(() => vscode.window.createOutputChannel(vscode.l10n.t("Extension Template"), { log: true })),
      (opened) =>
        Effect.sync(() => {
          opened.dispose()
        })
    )
    const logger = Logger.make<unknown, void>((options) => {
      channel[methods[options.logLevel]](Logger.formatSimple.log(options))
    })
    return Logger.layer([logger])
  })
)
