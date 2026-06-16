/// <reference types="vitest/config" />
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 8080,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    env: {
      VITE_LEGACY_API_URL: "https://legacy.test/api",
      VITE_VENDOR_API_URL: "http://localhost:4000/api/v1",
      VITE_IDLE_TIMEOUT_MIN: "30",
    },
  },
});
