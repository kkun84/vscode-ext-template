// バンドルの大きさがbudgets.jsonの上限を超えていないか確かめる。先にbuildを実行しておく。
import { readFile, stat } from "node:fs/promises"
import { Schema } from "effect"

const Budgets = Schema.Struct({ size: Schema.Record(Schema.String, Schema.Finite) })

const root = new URL("../", import.meta.url)
const budgets = Schema.decodeUnknownSync(Budgets)(JSON.parse(await readFile(new URL("budgets.json", root), "utf8")))

const results = await Promise.all(
  Object.entries(budgets.size).map(async ([file, limit]) => ({ file, limit, size: (await stat(new URL(file, root))).size }))
)

for (const { file, size, limit } of results) {
  console.log(`${size <= limit ? "ok  " : "over"} ${file} ${size} / ${limit} bytes`)
}
process.exitCode = results.every(({ size, limit }) => size <= limit) ? 0 : 1
