import type * as vscode from "vscode"
import { Layer, ManagedRuntime } from "effect"
import { vscodeLayer } from "../../layers/vscode/index.ts"
import type { UserName } from "../../services/ports.ts"
import { commands } from "./commands.ts"

/**
 * desktop版とweb版で共通の`activate`。
 *
 * 実行環境を作ってコマンドを登録する。VS Codeは拡張を止めるときに
 * `subscriptions`を破棄するので、そこで実行環境も破棄され、層が確保した
 * 出力チャネルなどの資源が解放される。
 */
export const activate = (context: vscode.ExtensionContext, platform: Layer.Layer<UserName>): void => {
  const runtime = ManagedRuntime.make(Layer.mergeAll(vscodeLayer, platform))
  context.subscriptions.push({ dispose: () => void runtime.dispose() }, ...commands.map((command) => command.register(runtime)))
}
