// E2Eで起動するVS Codeを、テストの前に一度だけ用意する。
//
// ワーカーごとにダウンロードすると、同じ.vscode-testに同時に展開し、片方が書き込み中の
// Code.exeをもう片方が起動して、Windowsで「Process failed to launch!」になる。
// globalSetupはワーカーを起動する前にrunnerのプロセスで動き、ワーカーはrunnerの
// process.envを引き継ぐので、パスを環境変数で渡せる。
import { downloadAndUnzipVSCode } from "@vscode/test-electron"

export default async (): Promise<void> => {
  // LinuxのCIではNixがnixpkgsのVSCodiumを渡す。無ければ最新の安定版のVS Codeを取ってくる。
  process.env["VSCODE_EXECUTABLE"] ??= await downloadAndUnzipVSCode("stable")
}
