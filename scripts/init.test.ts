import { describe, expect, it } from "vitest"
import { rename, type Names } from "./init.ts"

const names: Names = {
  name: "note-taker",
  publisher: "alice",
  prefix: "noteTaker",
  displayName: "Note Taker",
  displayNameJa: "ノート取り",
  repository: "alice/note-taker"
}

describe("rename", () => {
  it("拡張機能のIDとリポジトリを置き換える", () => {
    expect(
      rename('"name": "vscode-ext-template", "url": "https://github.com/kkun84/vscode-ext-template", "publisher": "kkun84"', names)
    ).toBe('"name": "note-taker", "url": "https://github.com/alice/note-taker", "publisher": "alice"')
  })

  it("コマンドと設定の接頭辞を置き換える", () => {
    expect(rename('getConfiguration("extTemplate"), "extTemplate.createNote"', names)).toBe(
      'getConfiguration("noteTaker"), "noteTaker.createNote"'
    )
  })

  it("長い表示名を先に置き換える", () => {
    expect(rename("VS Code Extension Template / Extension Template: Create Note", names)).toBe("Note Taker / Note Taker: Create Note")
    expect(rename("VS Code拡張機能の雛形 / 拡張機能の雛形", names)).toBe("ノート取り / ノート取り")
  })

  it("サービスの名前空間を置き換える", () => {
    expect(rename('Context.Service<X, Y>()("vscode-ext-template/Settings")', names)).toBe('Context.Service<X, Y>()("note-taker/Settings")')
  })
})
