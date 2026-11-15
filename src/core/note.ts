/**
 * ノートの題名からファイル名と本文を作る純関数。
 *
 * I/Oも時刻の取得もしない。時刻は引数で受け取る。
 */

export interface NoteContent {
  readonly title: string
  readonly author: string | undefined
  readonly date: Readonly<Date>
}

/** 題名をファイル名に使える形にする。文字と数字以外の連続は`-`1つにする。 */
export const slugify = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
  return slug === "" ? "note" : slug
}

/** 地方時の日付を`YYYY-MM-DD`にする。 */
export const formatDate = (date: Readonly<Date>): string => {
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/** `YYYY-MM-DD-<slug>.md`のファイル名を作る。 */
export const noteFileName = (title: string, date: Readonly<Date>): string => `${formatDate(date)}-${slugify(title)}.md`

/** 同名のファイルがあれば`-2`、`-3`…を拡張子の前に付ける。 */
export const nextAvailableName = (baseName: string, existingNames: ReadonlyArray<string>): string => {
  const taken = new Set(existingNames)
  if (!taken.has(baseName)) {
    return baseName
  }
  const extensionStart = baseName.lastIndexOf(".")
  const stem = extensionStart > 0 ? baseName.slice(0, extensionStart) : baseName
  const extension = extensionStart > 0 ? baseName.slice(extensionStart) : ""
  let index = 2
  while (taken.has(`${stem}-${index}${extension}`)) {
    index += 1
  }
  return `${stem}-${index}${extension}`
}

/** Markdownの本文を組み立てる。著者が無ければ著者の行を出さない。 */
export const renderNote = ({ title, author, date }: NoteContent): string => {
  const lines = [`# ${title}`, ""]
  if (author !== undefined && author !== "") {
    lines.push(`- Author: ${author}`)
  }
  lines.push(`- Created: ${formatDate(date)}`)
  return `${lines.join("\n")}\n`
}
