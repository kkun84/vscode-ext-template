import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "./fixtures.ts"

const created = /^Note created: (notes\/\d{4}-\d{2}-\d{2}-hello-e2e\.md)$/u

test("コマンドパレットからノートを作ると、ファイルが開き、通知が出る", async ({ workbench, workspace }) => {
  await workbench.runCommand("Extension Template: Create Note")
  await workbench.answerInput("Hello E2E")

  const notification = workbench.notification(created)
  await expect(notification).toBeVisible()
  await expect(workbench.editorTab(/hello-e2e\.md/u)).toBeVisible()

  // 通知に出たパスのファイルを、利用者が開いたときと同じように中身まで確かめる。
  const path = created.exec((await notification.textContent()) ?? "")?.[1] ?? ""
  expect(await readFile(join(workspace, path), "utf8")).toMatch(/^# Hello E2E\n/u)
})

test.describe("著者の設定がある場合", () => {
  test.use({ settings: { "extTemplate.notes.author": "Alice", "extTemplate.notes.folder": "journal" } })

  test("設定のフォルダに、著者入りのノートを作る", async ({ workbench, workspace }) => {
    await workbench.runCommand("Extension Template: Create Note")
    await workbench.answerInput("Hello E2E")

    const notification = workbench.notification(/^Note created: journal\//u)
    await expect(notification).toBeVisible()
    const path = (await notification.textContent())?.replace("Note created: ", "") ?? ""
    expect(await readFile(join(workspace, path), "utf8")).toContain("- Author: Alice\n")
  })
})

test.describe("フォルダを開いていない場合", () => {
  test.use({ openFolder: false })

  test("フォルダを開くよう通知する", async ({ workbench }) => {
    await workbench.runCommand("Extension Template: Create Note")
    await workbench.answerInput("Hello E2E")

    await expect(workbench.notification("Open a folder to create a note.")).toBeVisible()
  })
})
