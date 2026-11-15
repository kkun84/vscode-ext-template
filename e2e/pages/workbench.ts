// VS Codeの画面の操作をまとめたページオブジェクト。
// VS Codeの画面の構造は公開APIではないので、版が変わって壊れたらここだけを直す。
import { expect, type Locator, type Page } from "@playwright/test"

export class Workbench {
  private readonly window: Page

  constructor(window: Page) {
    this.window = window
  }

  /** コマンドパレットからコマンドを実行する。`title`は「カテゴリ: 名前」の形。 */
  async runCommand(title: string): Promise<void> {
    const option = this.window.getByRole("option", { name: new RegExp(`^${title}`, "u") })
    // 起動の直後は、拡張機能のコマンドがまだパレットに載っていないことがある。載るまで開き直す。
    await expect(async () => {
      await this.window.keyboard.press("Escape")
      await this.window.keyboard.press("F1")
      await this.quickInput.fill(`>${title}`, { timeout: 2000 })
      await expect(option).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 30_000 })
    await option.click()
  }

  /** 拡張機能が出した入力欄に答える。 */
  async answerInput(text: string): Promise<void> {
    await this.quickInput.fill(text)
    await this.quickInput.press("Enter")
  }

  /** 右下に出た通知。 */
  notification(text: string | RegExp): Locator {
    return this.window.locator(".notifications-toasts").getByText(text)
  }

  /** エディタのタブ。 */
  editorTab(name: string | RegExp): Locator {
    return this.window.getByRole("tab", { name })
  }

  private get quickInput(): Locator {
    return this.window.locator(".quick-input-widget").getByRole("textbox")
  }
}
