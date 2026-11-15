// .vsix に入るファイルが、許可した一覧のものだけであることを確かめる。
// E2E用のdriver拡張、ソース、テストが配布物に混ざるのを防ぐ。
import { fileURLToPath } from "node:url"
import { listFiles, PackageManager } from "@vscode/vsce"

const allowed = (file: string): boolean =>
  [
    "dist/node/extension.js",
    "dist/web/extension.js",
    "package.json",
    "package.nls.json",
    "package.nls.ja.json",
    "README.md",
    "LICENSE"
  ].includes(file) || /^l10n\/bundle\.l10n(?:\.[\w-]+)?\.json$/u.test(file)

const files = await listFiles({ cwd: fileURLToPath(new URL("../", import.meta.url)), packageManager: PackageManager.None })
const unexpected = files.filter((file) => !allowed(file))

if (unexpected.length > 0) {
  console.error(`.vsixに許可していないファイルが入ります。.vscodeignoreを直してください:\n${unexpected.join("\n")}`)
  process.exitCode = 1
} else {
  console.log(`.vsixの中身を確かめました(${files.length}ファイル)`)
}
