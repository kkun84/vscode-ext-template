// E2Eで本物のエディタを起動する。
//
// 準備はすべて起動前のファイルで行う。ユーザー設定はuser-data-dirのsettings.jsonに、
// 開くファイルは一時的なワークスペースに書く。起動後にVS CodeのAPIで準備する必要が
// 出てきたら、テスト専用の拡張機能を足す(docs/design.mdの「E2Eの決まり」)。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test"

export type ExtensionKind = "desktop" | "web"

export interface LaunchOptions {
  readonly kind: ExtensionKind
  readonly settings: Readonly<Record<string, unknown>>
  /** ワークスペースに置くファイル。キーはワークスペースからの相対パス。 */
  readonly files: Readonly<Record<string, string>>
  /** falseならフォルダを開かずに起動する。 */
  readonly openFolder: boolean
}

export interface Editor {
  readonly app: ElectronApplication
  readonly window: Page
  readonly workspace: string
  readonly close: () => Promise<void>
}

const repository = resolve(import.meta.dirname, "..")

// 実行ファイルはglobal-setup.tsが用意する。
const executable = (): string => {
  const path = process.env["VSCODE_EXECUTABLE"]
  if (path === undefined) {
    throw new Error("VSCODE_EXECUTABLE is not set. Run the E2E tests with playwright.config.ts, whose globalSetup sets it.")
  }
  return path
}

const writeFiles = async (root: string, files: Readonly<Record<string, string>>): Promise<void> => {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
}

export const launch = async (options: LaunchOptions): Promise<Editor> => {
  // macOSはソケットのパスが約103文字までなので、一時ディレクトリの名前を短くする。
  const profile = await mkdtemp(join(tmpdir(), "e2e-"))
  const workspace = join(profile, "w")
  await writeFiles(profile, {
    "u/User/settings.json": JSON.stringify({
      "workbench.startupEditor": "none",
      "workbench.tips.enabled": false,
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoUpdate": false,
      ...options.settings
    })
  })
  await writeFiles(workspace, { ".keep": "", ...options.files })

  // 他のツールがELECTRON_RUN_AS_NODEを設定していると、エディタがNode.jsとして起動してしまう。
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== "ELECTRON_RUN_AS_NODE" && value !== undefined) {
      env[key] = value
    }
  }
  const app = await electron.launch({
    executablePath: executable(),
    env,
    args: [
      ...(options.openFolder ? [workspace] : []),
      `--extensionDevelopmentPath=${repository}`,
      ...(options.kind === "web" ? ["--extensionDevelopmentKind=web"] : []),
      `--user-data-dir=${join(profile, "u")}`,
      `--extensions-dir=${join(profile, "x")}`,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-gpu",
      "--no-sandbox",
      "--password-store=basic",
      "--locale=en"
    ]
  })
  return {
    app,
    window: await app.firstWindow(),
    workspace,
    close: async () => {
      await app.close()
      await rm(profile, { recursive: true, force: true, maxRetries: 3 })
    }
  }
}
