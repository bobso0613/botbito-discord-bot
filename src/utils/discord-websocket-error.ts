import { logger } from "./logger.js";

export const handleUncaughtDiscordWebSocketError = (
  error: Error,
  origin: NodeJS.UncaughtExceptionOrigin,
): void => {
  const isHandshakeTimeout =
    origin === "uncaughtException" &&
    error.message === "Opening handshake has timed out" &&
    /[\\/]node_modules[\\/]ws[\\/]lib[\\/]websocket\.js:\d+:\d+/.test(
      error.stack ?? "",
    );

  if (isHandshakeTimeout) {
    logger.warn(
      "Caught an unhandled Discord WebSocket handshake timeout; keeping the bot running. Gateway reconnection remains managed by discord.js.",
      error,
    );
    return;
  }

  logger.error(`Fatal ${origin}:`, error);
  process.exit(1);
};
