import pino, { type Logger } from "pino";
import type { Env } from "../config/env.js";

export function createLogger(env: Pick<Env, "logLevel" | "nodeEnv">): Logger {
  return pino({
    level: env.logLevel
  });
}
