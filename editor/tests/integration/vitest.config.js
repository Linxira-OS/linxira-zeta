import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    setupFiles: ["./setup.js"],
    testTimeout: 30000,
    hookTimeout: 15000,
    teardownTimeout: 30000,
  },
});
