// E2Eのフィクスチャ。テストごとに新しいエディタを起動し、終わったら閉じる。
//
// テスト本体が使えるのは、画面を操作するworkbenchと、拡張機能が書いたファイルを
// 確かめるためのworkspaceのパスだけ。準備はsettings、files、openFolderのオプションで行う。
import { test as base } from "@playwright/test"
import { Workbench } from "./pages/workbench.ts"
import { launch, type Editor, type ExtensionKind } from "./vscode.ts"

interface Options {
  readonly extensionKind: ExtensionKind
  readonly settings: Readonly<Record<string, unknown>>
  readonly files: Readonly<Record<string, string>>
  readonly openFolder: boolean
}

interface Fixtures {
  readonly editor: Editor
  readonly workbench: Workbench
  readonly workspace: string
}

export const test = base.extend<Options & Fixtures>({
  extensionKind: ["desktop", { option: true }],
  settings: [{}, { option: true }],
  files: [{}, { option: true }],
  openFolder: [true, { option: true }],
  editor: async ({ extensionKind, settings, files, openFolder }, use) => {
    const editor = await launch({ kind: extensionKind, settings, files, openFolder })
    await use(editor)
    await editor.close()
  },
  workbench: async ({ editor }, use) => {
    // 拡張機能のコマンドは、エディタの画面ができてから登録される。
    await editor.window.locator(".monaco-workbench").waitFor()
    await use(new Workbench(editor.window))
  },
  workspace: async ({ editor }, use) => {
    await use(editor.workspace)
  }
})

export { expect } from "@playwright/test"
