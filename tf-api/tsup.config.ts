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
  // mysql2 (used by the NivaBupa module's own pool) resolves its optional
  // auth plugins and the Node crypto/net bindings through dynamic requires that
  // esbuild cannot statically follow, so it stays a runtime dependency like
  // @prisma/client. axios is external alongside it to keep the two NivaBupa
  // runtime deps consistent.
  external: ["@prisma/client", "mysql2", "axios"],
  esbuildOptions(options) {
    options.alias = {
      "@": "./src",
    };
  },
});
