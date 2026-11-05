import { Status, type Client } from "discord.js";
import { logger } from "./logger.js";

const GATEWAY_RECOVERY_TIMEOUT_MS = 120_000;

const exitWithFatalError = (
  message: string,
  ...additionalArguments: readonly unknown[]
): never => {
  try {
    logger.fatal(message, ...additionalArguments);
  } finally {
    process.exit(1);
  }
};

export const createUncaughtDiscordWebSocketErrorHandler = (
  client: Pick<Client, "isReady" | "ws">,
): ((error: Error, origin: NodeJS.UncaughtExceptionOrigin) => void) => {
  let recoveryWatchdog: ReturnType<typeof setTimeout> | undefined;

  return (error, origin): void => {
    const isHandshakeTimeout =
      origin === "uncaughtException" &&
      error.message === "Opening handshake has timed out" &&
      /[\\/]node_modules[\\/]ws[\\/]lib[\\/]websocket\.js:\d+:\d+/.test(
        error.stack ?? "",
      );

    if (!isHandshakeTimeout) {
      exitWithFatalError(`Fatal ${origin}:`, error);
    }

    logger.warn(
      "Caught an unhandled Discord WebSocket handshake timeout; keeping the bot running with a 120-second gateway recovery watchdog.",
      error,
    );

    recoveryWatchdog ??= setTimeout(() => {
      recoveryWatchdog = undefined;
      if (
        client.isReady() &&
        client.ws.shards.size > 0 &&
        client.ws.shards.every((shard) => shard.status === Status.Ready)
      ) {
        logger.log("Discord gateway recovery verified; bot is ready.");
        return;
      }

      exitWithFatalError(
        "Discord gateway did not recover within 120 seconds; exiting for supervisor restart.",
      );
    }, GATEWAY_RECOVERY_TIMEOUT_MS);
    recoveryWatchdog.unref();
  };
};
