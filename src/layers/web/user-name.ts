import { Effect, Layer } from "effect"
import { UserName } from "../../services/ports.ts"

/** web版にはOSのユーザー名が無いので、常に無いものとして扱う。 */
export const userNameLayer = Layer.succeed(UserName, { get: Effect.succeedNone })
