import app from "./app";
import { logger } from "./lib/logger";
import { resolveHost, resolvePort } from "./lib/runtime";

const port = resolvePort();
const host = resolveHost();

app.listen(port, host, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ host, port }, "Server listening");
});
