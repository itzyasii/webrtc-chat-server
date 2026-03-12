import http from "node:http";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { createApp } from "./app";
import { initSockets } from "./sockets";
import { connectMongo, disconnectMongo } from "./db/mongo";

async function main() {
  await connectMongo();

  const app = createApp();
  const server = http.createServer(app);

  initSockets(server);

  server.listen(env.PORT, () => {
    logger.info(`HTTP server listening on :${env.PORT}`);
  });

  const shutdown = async () => {
    try {
      server.close();
      await disconnectMongo();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
