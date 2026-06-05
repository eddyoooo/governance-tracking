import { env } from "./config/env.js";
import { createApp } from "./server.js";
import { startScheduler } from "./scheduler/scheduler.js";

const { app, context } = createApp({ env });
const scheduledTask = startScheduler(context);
const server = app.listen(env.port, () => {
  context.logger.info({ port: env.port }, "Governance tracking backend listening");
});

function shutdown(signal: string): void {
  context.logger.info({ signal }, "Shutting down backend");
  scheduledTask?.stop();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
