import { spawnSync } from "node:child_process"

// @effect/tsgoはEffectの診断を足したtsgoを同梱している。その実在パスを
// `get-exe-path`で取り、プロジェクトのtsconfig.jsonを検査する。
const located = spawnSync("effect-tsgo", ["get-exe-path"], { encoding: "utf8", shell: process.platform === "win32" })
const tsgo = located.stdout.trim().split("\n").at(-1) ?? ""

if (located.status !== 0 || tsgo === "") {
  process.stderr.write("effect-tsgo get-exe-pathに失敗しました。\n")
  process.stderr.write(located.stderr)
  process.exitCode = 1
} else {
  process.exitCode = spawnSync(tsgo, ["-p", "tsconfig.json"], { stdio: "inherit" }).status === 0 ? 0 : 1
}
