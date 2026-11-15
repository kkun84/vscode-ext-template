// 配布用の .vsix を作る。先にbuildを実行しておく。
// 入れるファイルは .vscodeignore で決め、check-vsix.tsで検査する。
import { readFile } from "node:fs/promises"
import { createVSIX } from "@vscode/vsce"
import { Schema } from "effect"

const root = new URL("../", import.meta.url)
const Manifest = Schema.Struct({ name: Schema.String, version: Schema.String })
const manifest = Schema.decodeUnknownSync(Manifest)(JSON.parse(await readFile(new URL("package.json", root), "utf8")))

// 依存はバンドルに入っているので、node_modulesは同梱しない。
await createVSIX({ cwd: root.pathname, dependencies: false, packagePath: `${manifest.name}-${manifest.version}.vsix` })
