import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Status } from "discord.js";
import { createUncaughtDiscordWebSocketErrorHandler } from "./discord-websocket-error.js";
import { logger } from "./logger.js";

const createTimeoutError = (): Error => {
  const error = new Error("Opening handshake has timed out");
  error.stack = "/home/bot/node_modules/ws/lib/websocket.js:890:7";
  return error;
};

describe("createUncaughtDiscordWebSocketErrorHandler", () => {
  const client = {
    isReady: jest.fn(() => true),
    ws: { status: Status.Ready },
  };
  let handleError: ReturnType<
    typeof createUncaughtDiscordWebSocketErrorHandler
  >;

  beforeEach(() => {
    jest.useFakeTimers();
    client.isReady.mockReturnValue(true);
    client.ws.status = Status.Ready;
    handleError = createUncaughtDiscordWebSocketErrorHandler(client as never);
    jest.spyOn(logger, "log").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
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

    handleError(error, "uncaughtException");

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("keeping the bot running"),
      error,
    );
    expect(exit).not.toHaveBeenCalled();
  });

  test("verifies that the whole gateway recovered before clearing the watchdog", () => {
    client.isReady.mockReturnValue(false);
    client.ws.status = Status.Connecting;
    handleError(createTimeoutError(), "uncaughtException");
    jest.advanceTimersByTime(119_999);
    client.isReady.mockReturnValue(true);
    client.ws.status = Status.Ready;

    jest.advanceTimersByTime(1);

    expect(logger.log).toHaveBeenCalledWith(
      "Discord gateway recovery verified; bot is ready.",
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  test.each([
    { ready: false, status: Status.Connecting },
    { ready: true, status: Status.Connecting },
    { ready: false, status: Status.Ready },
  ])(
    "exits if the gateway is stuck (ready=$ready, status=$status)",
    ({ ready, status }) => {
      client.isReady.mockReturnValue(ready);
      client.ws.status = status;
      const fatalLog = jest
        .spyOn(logger, "fatal")
        .mockImplementation(() => undefined);
      const exit = jest.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("Process exited");
      });
      handleError(createTimeoutError(), "uncaughtException");

      expect(() => jest.advanceTimersByTime(120_000)).toThrow("Process exited");
      expect(fatalLog).toHaveBeenCalledWith(
        expect.stringContaining("exiting for supervisor restart"),
      );
      expect(exit).toHaveBeenCalledWith(1);
    },
  );

  test("repeated timeouts do not postpone the recovery deadline", () => {
    client.isReady.mockReturnValue(false);
    jest.spyOn(logger, "fatal").mockImplementation(() => undefined);
    jest.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("Process exited");
    });
    handleError(createTimeoutError(), "uncaughtException");
    jest.advanceTimersByTime(60_000);
    handleError(createTimeoutError(), "uncaughtException");
    expect(jest.getTimerCount()).toBe(1);

    expect(() => jest.advanceTimersByTime(60_000)).toThrow("Process exited");
  });

  test("arms a new watchdog after a previous recovery was verified", () => {
    handleError(createTimeoutError(), "uncaughtException");
    jest.advanceTimersByTime(120_000);

    handleError(createTimeoutError(), "uncaughtException");

    expect(jest.getTimerCount()).toBe(1);
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
        .spyOn(logger, "fatal")
        .mockImplementation(() => undefined);
      const exit = jest.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("Process exited");
      });

      expect(() => handleError(error, origin)).toThrow("Process exited");
      expect(fatalLog).toHaveBeenCalledWith(`Fatal ${origin}:`, error);
      expect(exit).toHaveBeenCalledWith(1);
    },
  );
});
