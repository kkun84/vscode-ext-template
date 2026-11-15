// pnpmの供給網対策の検査を、リポジトリのファイルに対して実行する。
// 判定はrule.ts、説明と経緯はREADME.mdにある。
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { checkCommands, checkNpmrc, checkPackageJson, checkWorkspace } from "./rule.ts"

const root = resolve(import.meta.dirname, "../../..")
const read = (file: string): string | undefined => (existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : undefined)

const workflows = existsSync(join(root, ".github/workflows"))
  ? readdirSync(join(root, ".github/workflows"))
      .filter((name) => /\.ya?ml$/u.test(name))
      .map((name) => `.github/workflows/${name}`)
  : []

const findings = [
  ...checkWorkspace(read("pnpm-workspace.yaml") ?? ""),
  ...checkPackageJson(read("package.json") ?? "{}"),
  ...checkNpmrc(read(".npmrc") ?? ""),
  ...["package.json", "lefthook.yml", ...workflows].flatMap((file) => checkCommands(file, read(file) ?? ""))
]

if (findings.length > 0) {
  console.error(findings.join("\n"))
  process.exitCode = 1
} else {
  console.log("pnpm-policy: no violations found")
}
