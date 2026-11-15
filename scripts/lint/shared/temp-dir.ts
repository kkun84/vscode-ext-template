// 自作lintのテストで使う、一時ディレクトリ。テストごとに作って消す。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach } from "vitest"

export interface TempDir {
  readonly root: () => string
  /** ファイルを書き、その絶対パスを返す。親ディレクトリも作る。 */
  readonly write: (relativePath: string, content?: string) => string
}

export const useTempDir = (prefix: string): TempDir => {
  let root = ""
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), prefix))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root: () => root,
    write: (relativePath, content = "") => {
      const full = join(root, relativePath)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
      return full
    }
  }
}
