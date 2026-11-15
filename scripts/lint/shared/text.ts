// 自作lintが共通で使う、文字列の位置の計算。

/** `input`の`index`文字目の、1から数えた行と列。 */
export const lineColumnAt = (input: string, index: number): { readonly line: number; readonly column: number } => {
  const before = input.slice(0, index).split("\n")
  return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 }
}
