import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  shims: true,
  splitting: false,
  treeshake: true,
  external: ["@prisma/client"],
  esbuildOptions(options) {
    options.alias = {
      "@": "./src",
    };
  },
});
