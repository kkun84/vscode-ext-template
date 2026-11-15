import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

// NixとWindowsのCIは、package.jsonに書いた版のNode.jsとpnpmを入れる決まりにしてある。
// 入っているものが食い違っていたら、ここで止める。
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
const asString = (value: unknown): string => (typeof value === "string" ? value : "")

const parsed: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const manifest = isRecord(parsed) ? parsed : {}
const engines = isRecord(manifest["engines"]) ? manifest["engines"] : {}

const expectedNode = asString(engines["node"])
const packageManager = asString(manifest["packageManager"])
const expectedPnpm = packageManager.startsWith("pnpm@") ? packageManager.slice("pnpm@".length) : ""

const found = spawnSync("pnpm", ["--version"], { encoding: "utf8", shell: process.platform === "win32" })
// pnpmが設定の案内などを同じ標準出力に書くことがあるので、版の形をした行だけを拾う。
const versionLine = /^\d+\.\d+\.\d+$/
const foundPnpm = found.stdout
  .split("\n")
  .map((line) => line.trim())
  .reduce((last, line) => (versionLine.test(line) ? line : last), "")

const problems: string[] = []

if (expectedNode === "" || process.versions.node !== expectedNode) {
  problems.push(`node: engines.node=${expectedNode || "(未設定)"} / 実際=${process.versions.node}`)
}

if (expectedPnpm === "" || foundPnpm !== expectedPnpm) {
  const actual = foundPnpm === "" ? `(取得できませんでした: 終了コード${found.status ?? "不明"})` : foundPnpm
  problems.push(`pnpm: packageManager=pnpm@${expectedPnpm || "(未設定)"} / 実際=${actual}`)
}

if (problems.length > 0) {
  process.stderr.write("開発環境の版がpackage.jsonと一致しません。\n")
  process.stderr.write(`${problems.join("\n")}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`開発環境はnode ${expectedNode}とpnpm ${expectedPnpm}で揃っています。\n`)
}
