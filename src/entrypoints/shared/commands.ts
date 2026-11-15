import * as vscode from "vscode"
import { Cause, Effect, Option, Schema } from "effect"
import type { ManagedRuntime } from "effect"
import { createNote } from "../../services/create-note.ts"
import { InvalidCommandArguments, UnexpectedFailure, type CommandError } from "../../services/errors.ts"
import { Notifier, type AppServices } from "../../services/ports.ts"

/** コマンドのID、引数のSchema、処理のEffectを1組にした定義。 */
interface Command {
  readonly id: string
  readonly register: (runtime: ManagedRuntime.ManagedRuntime<AppServices, never>) => vscode.Disposable
}

/**
 * コマンドを定義する。
 *
 * 登録した関数は、引数をSchemaでdecodeし、処理を実行し、型付きのエラーなら
 * 対応する文言を、想定外の欠陥ならログに詳細を残して一般的な文言を通知する。
 */
const defineCommand = <A, E extends CommandError>(
  id: string,
  args: Schema.Codec<A>,
  run: (args: A) => Effect.Effect<unknown, E, AppServices>
): Command => {
  const execute = (raw: unknown): Effect.Effect<void, never, AppServices> =>
    Schema.decodeUnknownEffect(args)(raw).pipe(
      Effect.mapError((issue) => new InvalidCommandArguments({ command: id, detail: String(issue) })),
      Effect.flatMap(run),
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const notifier = yield* Notifier
          const failure = Cause.findErrorOption(cause)
          if (Option.isSome(failure)) {
            yield* Effect.logWarning(`${id} failed`, failure.value)
            return yield* notifier.failed(failure.value)
          }
          yield* Effect.logError(`${id} failed unexpectedly`, Cause.pretty(cause))
          return yield* notifier.failed(new UnexpectedFailure({ command: id }))
        })
      ),
      Effect.asVoid
    )
  return {
    id,
    register: (runtime) => vscode.commands.registerCommand(id, (raw: unknown) => runtime.runPromise(execute(raw)))
  }
}

export const commands: ReadonlyArray<Command> = [
  defineCommand("extTemplate.createNote", Schema.UndefinedOr(Schema.Struct({ title: Schema.String })), createNote)
]
