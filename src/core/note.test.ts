import { describe, expect, it } from "vitest"
import { formatDate, nextAvailableName, noteFileName, renderNote, slugify } from "./note.ts"

/** 地方時の正午を作る。実行環境の時間帯で日付がずれないようにする。 */
const atNoon = (year: number, month: number, day: number): Date => new Date(year, month - 1, day, 12)

describe("slugify", () => {
  it("空文字と記号だけの題名はnoteになる", () => {
    expect(slugify("")).toBe("note")
    expect(slugify("---")).toBe("note")
    expect(slugify("!?*")).toBe("note")
  })

  it("前後の記号を除く", () => {
    expect(slugify("  Hello World!  ")).toBe("hello-world")
    expect(slugify("!!Hello!!")).toBe("hello")
  })

  it("日本語の文字と数字を残す", () => {
    expect(slugify("日本語の題名")).toBe("日本語の題名")
    expect(slugify("会議 2024 メモ")).toBe("会議-2024-メモ")
  })

  it("英字を小文字にする", () => {
    expect(slugify("Hello WORLD")).toBe("hello-world")
  })

  it("記号の連続を1つのハイフンにする", () => {
    expect(slugify("a---b")).toBe("a-b")
    expect(slugify("a___b...c")).toBe("a-b-c")
  })
})

describe("formatDate", () => {
  it("月日が1桁なら0で埋める", () => {
    expect(formatDate(atNoon(2024, 1, 5))).toBe("2024-01-05")
  })

  it("年末の日付をそのまま返す", () => {
    expect(formatDate(atNoon(2024, 12, 31))).toBe("2024-12-31")
  })
})

describe("noteFileName", () => {
  it("日付とslugからファイル名を作る", () => {
    expect(noteFileName("Hello World", atNoon(2024, 1, 5))).toBe("2024-01-05-hello-world.md")
  })
})

describe("nextAvailableName", () => {
  it("空いていれば元の名前を返す", () => {
    expect(nextAvailableName("note.md", [])).toBe("note.md")
  })

  it("埋まっていれば-2を付ける", () => {
    expect(nextAvailableName("note.md", ["note.md"])).toBe("note-2.md")
  })

  it("-2まで埋まっていれば-3を付ける", () => {
    expect(nextAvailableName("note.md", ["note.md", "note-2.md"])).toBe("note-3.md")
  })

  it("拡張子が無くても衝突を避ける", () => {
    expect(nextAvailableName("note", ["note", "note-2"])).toBe("note-3")
  })
})

describe("renderNote", () => {
  it("著者があれば2行目に出す", () => {
    expect(renderNote({ title: "打ち合わせ", author: "Alice", date: atNoon(2024, 1, 5) })).toBe(
      "# 打ち合わせ\n\n- Author: Alice\n- Created: 2024-01-05\n"
    )
  })

  it("著者が無ければ著者の行を出さない", () => {
    expect(renderNote({ title: "打ち合わせ", author: undefined, date: atNoon(2024, 12, 31) })).toBe(
      "# 打ち合わせ\n\n- Created: 2024-12-31\n"
    )
  })

  it("著者が空文字でも著者の行を出さない", () => {
    expect(renderNote({ title: "打ち合わせ", author: "", date: atNoon(2024, 1, 5) })).toBe("# 打ち合わせ\n\n- Created: 2024-01-05\n")
  })
})
