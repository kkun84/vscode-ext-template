/**
 * web版の入口。`dist/web/extension.js`としてCommonJSで出力する。
 */
import type * as vscode from "vscode"
import { userNameLayer } from "../../layers/web/user-name.ts"
import { activate as activateShared } from "../shared/extension.ts"

export const activate = (context: vscode.ExtensionContext): void => {
  activateShared(context, userNameLayer)
}
