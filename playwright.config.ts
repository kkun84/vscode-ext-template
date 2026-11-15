import { defineConfig } from "@playwright/test"
import type { ExtensionKind } from "./e2e/vscode.ts"

// E2EはPlaywrightで本物のエディタを起動する。ブラウザは使わないので、
// Playwrightのブラウザのダウンロードは要らない。
export default defineConfig<{ readonly extensionKind: ExtensionKind }>({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  // エディタの起動に時間がかかるので、1つのテストの上限を長めにする。
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 2,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["github"]],
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { extensionKind: "desktop" } },
    { name: "web", use: { extensionKind: "web" } }
  ]
})
