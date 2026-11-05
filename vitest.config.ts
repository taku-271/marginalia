import { defineConfig } from "vitest/config";

// vite.config.ts(root: web)とは別に、リポジトリ直下の tests/ を対象にする
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
