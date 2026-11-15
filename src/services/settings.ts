import { Schema } from "effect"

export const DEFAULT_NOTES_FOLDER = "notes"

export interface NoteSettings {
  readonly folder: string
  /** 空文字は「設定されていない」。 */
  readonly author: string
}

const isAbsolute = (value: string): boolean => /^(?:[/\\]|[A-Za-z]:[/\\])/u.test(value)

/** ワークスペースの中を指す、空でない相対パス。 */
export const NotesFolder = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value: string) =>
      value.trim() !== "" && !value.split(/[/\\]/u).includes("..") && !isAbsolute(value)
        ? undefined
        : "must be a relative folder inside the workspace"
    )
  )
)

export const NotesAuthor = Schema.String
