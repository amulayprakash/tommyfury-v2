import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    env: {
      NODE_ENV: "test",
      PORT: "4001",
      DATABASE_URL: "mysql://root:password@localhost:3306/tf_api_test",
      ALLOWED_ORIGINS: "http://localhost:8080",
      ENABLE_DEBUG_PAYLOAD: "false",
      LOG_LEVEL: "silent",
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
