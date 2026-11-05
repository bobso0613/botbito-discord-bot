import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { handleUncaughtDiscordWebSocketError } from "./discord-websocket-error.js";
import { logger } from "./logger.js";

describe("handleUncaughtDiscordWebSocketError", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    "/home/bot/node_modules/ws/lib/websocket.js:890:7",
    "E:\\bot\\node_modules\\ws\\lib\\websocket.js:890:7",
  ])("keeps running after the known ws timeout at %s", (source) => {
    const error = new Error("Opening handshake has timed out");
    error.stack = `${error.name}: ${error.message}\n    at ClientRequest.<anonymous> (${source})`;
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const exit = jest.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("Unexpected process exit");
    });

    handleUncaughtDiscordWebSocketError(error, "uncaughtException");

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("keeping the bot running"),
      error,
    );
    expect(exit).not.toHaveBeenCalled();
  });

  test.each([
    [
      "Unrelated failure",
      "/home/bot/node_modules/ws/lib/websocket.js:890:7",
      "uncaughtException",
    ],
    [
      "Opening handshake has timed out",
      "/home/bot/src/index.js:10:1",
      "uncaughtException",
    ],
    ["Opening handshake has timed out", undefined, "uncaughtException"],
    [
      "Opening handshake has timed out",
      "/home/bot/node_modules/ws/lib/websocket.js:890:7",
      "unhandledRejection",
    ],
  ] as const)(
    "keeps other failures fatal (%s, %s, %s)",
    (message, stack, origin) => {
      const error = new Error(message);
      error.stack = stack;
      const fatalLog = jest
        .spyOn(logger, "error")
        .mockImplementation(() => undefined);
      const exit = jest.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("Process exited");
      });

      expect(() => handleUncaughtDiscordWebSocketError(error, origin)).toThrow(
        "Process exited",
      );
      expect(fatalLog).toHaveBeenCalledWith(`Fatal ${origin}:`, error);
      expect(exit).toHaveBeenCalledWith(1);
    },
  );
});
