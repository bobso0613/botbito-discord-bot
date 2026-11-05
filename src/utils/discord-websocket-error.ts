import { Status, type Client } from "discord.js";
import { logger } from "./logger.js";

const GATEWAY_RECOVERY_TIMEOUT_MS = 120_000;
const GATEWAY_RECOVERY_RECHECK_INTERVAL_MS = 5_000;
const GATEWAY_RECOVERY_RECHECKS = 2;

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
  let recoveryRechecksRemaining = GATEWAY_RECOVERY_RECHECKS;

  const checkGatewayRecovery = (): void => {
    if (
      client.isReady() &&
      client.ws.shards.size > 0 &&
      client.ws.shards.every((shard) => shard.status === Status.Ready)
    ) {
      recoveryWatchdog = undefined;
      recoveryRechecksRemaining = GATEWAY_RECOVERY_RECHECKS;
      logger.log("Discord gateway recovery verified; bot is ready.");
      return;
    }

    if (recoveryRechecksRemaining > 0) {
      recoveryRechecksRemaining -= 1;
      logger.warn(
        `Discord gateway is not fully ready; checking again in ${GATEWAY_RECOVERY_RECHECK_INTERVAL_MS / 1000} seconds (${recoveryRechecksRemaining} recheck(s) remaining).`,
      );
      recoveryWatchdog = setTimeout(
        checkGatewayRecovery,
        GATEWAY_RECOVERY_RECHECK_INTERVAL_MS,
      );
      recoveryWatchdog.unref();
      return;
    }

    recoveryWatchdog = undefined;
    recoveryRechecksRemaining = GATEWAY_RECOVERY_RECHECKS;
    exitWithFatalError(
      "Discord gateway did not recover within the recovery window; exiting for supervisor restart.",
    );
  };

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
      "Caught an unhandled Discord WebSocket handshake timeout; keeping the bot running with a 120-second gateway recovery watchdog and two 5-second rechecks.",
      error,
    );

    recoveryWatchdog ??= setTimeout(() => {
      checkGatewayRecovery();
    }, GATEWAY_RECOVERY_TIMEOUT_MS);
    recoveryWatchdog.unref();
  };
};
