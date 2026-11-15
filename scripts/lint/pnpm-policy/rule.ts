// 経緯と、許可したパッケージの理由は./README.mdにある。
// pnpmの供給網対策の設定が、消されたり緩められたりしていないかを判定する。
// ファイルを読むのはcli.tsで、ここは文字列を受け取って違反を返すだけにする。
import { parse } from "yaml"

/** インストールスクリプトを動かしてよいパッケージ。増やすときはREADME.mdに理由を書く。 */
const ALLOWED_BUILDS: ReadonlySet<string> = new Set(["lefthook"])

const MINIMUM_RELEASE_AGE = 10_080

const REQUIRED: ReadonlyArray<readonly [key: string, ok: (value: unknown) => boolean, expected: string]> = [
  ["minimumReleaseAge", (value) => typeof value === "number" && value >= MINIMUM_RELEASE_AGE, `>= ${MINIMUM_RELEASE_AGE}`],
  ["engineStrict", (value) => value === true, "true"],
  ["trustPolicy", (value) => value === "no-downgrade", "no-downgrade"],
  ["blockExoticSubdeps", (value) => value === true, "true"]
]

// 方針の例外を作る設定。どこにも書かせない。
const FORBIDDEN_KEYS: ReadonlyArray<string> = [
  "minimumReleaseAgeExclude",
  "trustPolicyExclude",
  "trustPolicyIgnoreAfter",
  "dangerouslyAllowAllBuilds",
  "onlyBuiltDependencies"
]

// コマンドラインで上の設定を上書きする書き方。
const POLICY_KEYS: ReadonlyArray<string> = [...REQUIRED.map(([key]) => key), ...FORBIDDEN_KEYS, "allowBuilds"]

const kebab = (key: string): string => key.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)

const FORBIDDEN_OPTIONS: ReadonlyArray<string> = [
  ...POLICY_KEYS.flatMap((key) => [`--config.${key}`, `--config.${kebab(key)}`, `--${kebab(key)}`, `--no-${kebab(key)}`]),
  "--no-frozen-lockfile"
]

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** pnpm-workspace.yamlの中身を検査する。 */
export const checkWorkspace = (source: string): ReadonlyArray<string> => {
  const parsed: unknown = parse(source)
  const config = isRecord(parsed) ? parsed : {}
  const required = REQUIRED.filter(([key, ok]) => !ok(config[key])).map(
    ([key, , expected]) => `pnpm-workspace.yaml: ${key} must be ${expected}`
  )
  const forbidden = FORBIDDEN_KEYS.filter((key) => key in config).map((key) => `pnpm-workspace.yaml: ${key} is not allowed`)
  const builds = isRecord(config["allowBuilds"]) ? Object.entries(config["allowBuilds"]) : []
  const unexpectedBuilds = builds
    .filter(([name, allowed]) => allowed !== false && !ALLOWED_BUILDS.has(name))
    .map(([name]) => `pnpm-workspace.yaml: allowBuilds must not enable ${name}`)
  return [...required, ...forbidden, ...unexpectedBuilds]
}

/** package.jsonにpnpmの設定が無いことを検査する。設定はpnpm-workspace.yamlだけに置く。 */
export const checkPackageJson = (source: string): ReadonlyArray<string> => {
  const parsed: unknown = JSON.parse(source)
  return isRecord(parsed) && "pnpm" in parsed ? ['package.json: move the "pnpm" settings to pnpm-workspace.yaml'] : []
}

/** .npmrcで方針の設定を上書きしていないことを検査する。 */
export const checkNpmrc = (source: string): ReadonlyArray<string> =>
  source
    .split("\n")
    .map((line) => line.split("=")[0]?.trim() ?? "")
    .filter((key) => POLICY_KEYS.some((policy) => key === policy || key === kebab(policy)))
    .map((key) => `.npmrc: ${key} must be set only in pnpm-workspace.yaml`)

/** スクリプトやworkflowの本文に、方針を上書きするオプションが無いことを検査する。 */
export const checkCommands = (file: string, source: string): ReadonlyArray<string> =>
  source
    .split("\n")
    .flatMap((line, index) =>
      FORBIDDEN_OPTIONS.filter((option) => new RegExp(`${option.replaceAll(".", "\\.")}(?![\\w-])`, "u").test(line)).map(
        (option) => `${file}:${index + 1}: ${option} overrides the pnpm supply-chain policy`
      )
    )
