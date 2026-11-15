import { userInfo } from "node:os"
import { Effect, Layer, Option } from "effect"
import { UserName } from "../../services/ports.ts"

/** desktop版はOSのユーザー名を使う。取れなければ無いものとして扱う。 */
export const userNameLayer = Layer.succeed(UserName, {
  get: Effect.try(() => userInfo().username).pipe(
    Effect.map((name) => (name === "" ? Option.none() : Option.some(name))),
    Effect.orElseSucceed(() => Option.none<string>())
  )
})
