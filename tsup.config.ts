import { defineConfig } from "tsup";

// Spec §10 mentions "ESM + CJS + .d.ts" generically for tsup.
// PetForge ships only an ESM CLI binary (dist/index.js) — no library
// surface area imports it, so CJS and .d.ts would add ~3x output size
// for zero consumer benefit. Reverting to ESM+CJS+dts is a one-line change
// if PetForge ever exposes programmatic exports.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  shims: false,
  splitting: false,
  sourcemap: false,
  minify: false,
  // Pin NODE_ENV so React/Ink don't emit perf_hooks measures at every render.
  // Without this, `petforge watch` (8 FPS rerender) leaks ~1M perf entries
  // into the global buffer within hours and Node prints a memory-leak warning.
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});
