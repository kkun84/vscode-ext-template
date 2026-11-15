// desktop版とweb版の2つのバンドルを作る。
//
// desktop版はESMにする。VS Code 1.100以降は"type": "module"の拡張をESMとして読み込む。
// web版はCommonJSのままにする。web版の拡張ホストでESMが使えることを確かめていないため。
import { mkdir, rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { rolldown } from "rolldown"

interface Target {
  readonly input: string
  readonly output: string
  readonly platform: "node" | "browser"
  readonly format: "esm" | "cjs"
}

const targets: ReadonlyArray<Target> = [
  { input: "src/entrypoints/node/extension.ts", output: "dist/node/extension.js", platform: "node", format: "esm" },
  { input: "src/entrypoints/web/extension.ts", output: "dist/web/extension.js", platform: "browser", format: "cjs" }
]

const path = (relative: string): string => fileURLToPath(new URL(`../${relative}`, import.meta.url))

const bundle = async (target: Target): Promise<void> => {
  const build = await rolldown({ input: path(target.input), platform: target.platform, external: ["vscode"], logLevel: "warn" })
  try {
    const { output } = await build.generate({ format: target.format, minify: true, comments: { legal: false }, codeSplitting: false })
    await mkdir(path(target.output.replace(/\/[^/]+$/u, "")), { recursive: true })
    await writeFile(path(target.output), output[0].code)
  } finally {
    await build.close()
  }
}

await rm(path("dist"), { recursive: true, force: true })
await Promise.all(targets.map((target) => bundle(target)))
