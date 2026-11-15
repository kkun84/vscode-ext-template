// ja-spaceが検査するファイルと、その拡張子に合わせた検査の仕方。
import { extname } from "node:path"
import { listFiles } from "../shared/files.ts"
import { type MaskMode, modeForExtension } from "./rule.ts"

export interface FoundFile {
  readonly path: string
  readonly mode: MaskMode
}

/** 検査できる拡張子のファイルだけを、検査の仕方と組にして返す。 */
export const findFiles = (paths: ReadonlyArray<string>, root: string): ReadonlyArray<FoundFile> =>
  listFiles(paths, root).flatMap((path) => {
    const mode = modeForExtension(extname(path))
    return mode === null ? [] : [{ path, mode }]
  })
