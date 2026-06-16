import pino from "pino";
import { env } from "@/config/env.ts";

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
    },
  }),
  redact: {
    paths: [
      "*.authorization",
      "*.password",
      "*.Password",
      "*.client_secret",
      "*.access_token",
      "*.token",
      "*.CLIENT_SECRET",
      "*.CLIENT_ID",
      "*.ICICI_AES_KEY",
      "*.ICICI_PASSWORD",
    ],
    censor: "[REDACTED]",
  },
});
