/**
 * desktop版の入口。`dist/node/extension.js`としてESMで出力する。
 */
import type * as vscode from "vscode"
import { userNameLayer } from "../../layers/node/user-name.ts"
import { activate as activateShared } from "../shared/extension.ts"

export const activate = (context: vscode.ExtensionContext): void => {
  activateShared(context, userNameLayer)
}
