import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    // includeがtypoなどで1件も拾えていないときに、黙って成功させない。
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      // 入口とVS Code・Node.js・webに依存する層は、E2Eで確かめるので数えない。
      exclude: ["src/**/*.test.ts", "src/entrypoints/**", "src/layers/vscode/**", "src/layers/node/**", "src/layers/web/**"],
      thresholds: {
        "src/core/**": {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90
        }
      }
    }
  }
})
