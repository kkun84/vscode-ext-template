import { Layer } from "effect"
import { LoggerLive } from "./logger.ts"
import { NotifierLive } from "./notifier.ts"
import { SettingsLive } from "./settings.ts"
import { TitlePromptLive } from "./title-prompt.ts"
import { WorkspaceFilesLive } from "./workspace-files.ts"

/** VS Code APIで書いた実装。desktop版とweb版の両方で動く。 */
export const vscodeLayer = Layer.mergeAll(LoggerLive, NotifierLive, SettingsLive, TitlePromptLive, WorkspaceFilesLive)
