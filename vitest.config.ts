import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Forces PETFORGE_HOME to a temp dir before any module loads, so the
    // suite can never resolve (and wipe) the real ~/.petforge.
    setupFiles: ["tests/setup/isolation.ts"],
    passWithNoTests: true,
    environment: "node",
  },
});
