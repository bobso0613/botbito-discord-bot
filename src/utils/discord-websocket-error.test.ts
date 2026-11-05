import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Collection, Status } from "discord.js";
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
    ws: {
      status: Status.Ready,
      destroyed: false,
      shards: new Collection<number, { status: Status }>(),
    },
  };
  let handleError: ReturnType<
    typeof createUncaughtDiscordWebSocketErrorHandler
  >;

  beforeEach(() => {
    jest.useFakeTimers();
    client.isReady.mockImplementation(
      () => !client.ws.destroyed && client.ws.status === Status.Ready,
    );
    client.ws.status = Status.Ready;
    client.ws.destroyed = false;
    client.ws.shards.clear();
    client.ws.shards.set(0, { status: Status.Ready });
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
    const recoveringShard = { status: Status.Connecting };
    client.ws.shards.set(1, recoveringShard);
    handleError(createTimeoutError(), "uncaughtException");
    jest.advanceTimersByTime(119_999);
    recoveringShard.status = Status.Ready;

    jest.advanceTimersByTime(1);

    expect(logger.log).toHaveBeenCalledWith(
      "Discord gateway recovery verified; bot is ready.",
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  test.each([Status.Connecting, Status.Resuming, Status.Identifying])(
    "exits if one shard is stuck in status %s despite a Ready manager",
    (status) => {
      client.ws.shards.set(1, { status });
      const fatalLog = jest
        .spyOn(logger, "fatal")
        .mockImplementation(() => undefined);
      const exit = jest.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("Process exited");
      });
      handleError(createTimeoutError(), "uncaughtException");

      expect(() => jest.advanceTimersByTime(130_000)).toThrow("Process exited");
      expect(fatalLog).toHaveBeenCalledWith(
        expect.stringContaining("within the recovery window"),
      );
      expect(exit).toHaveBeenCalledWith(1);
      expect(client.ws.status).toBe(Status.Ready);
      expect(client.isReady()).toBe(true);
    },
  );

  test.each(["destroyed", "empty"])(
    "exits when the manager is %s despite a Ready manager status",
    (state) => {
      if (state === "destroyed") {
        client.ws.destroyed = true;
      } else {
        client.ws.shards.clear();
      }
      jest.spyOn(logger, "fatal").mockImplementation(() => undefined);
      const exit = jest.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("Process exited");
      });
      handleError(createTimeoutError(), "uncaughtException");

      expect(() => jest.advanceTimersByTime(130_000)).toThrow("Process exited");
      expect(exit).toHaveBeenCalledWith(1);
    },
  );

  test("repeated timeouts do not postpone the recovery deadline", () => {
    client.ws.shards.set(1, { status: Status.Connecting });
    jest.spyOn(logger, "fatal").mockImplementation(() => undefined);
    jest.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("Process exited");
    });
    handleError(createTimeoutError(), "uncaughtException");
    jest.advanceTimersByTime(60_000);
    handleError(createTimeoutError(), "uncaughtException");
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(60_000);
    expect(jest.getTimerCount()).toBe(1);
    expect(() => jest.advanceTimersByTime(10_000)).toThrow("Process exited");
  });

  test("allows an ordinary reconnect to finish during the recheck grace period", () => {
    const recoveringShard = { status: Status.Connecting };
    client.ws.shards.set(1, recoveringShard);
    handleError(createTimeoutError(), "uncaughtException");
    jest.advanceTimersByTime(120_000);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("checking again in 5 seconds"),
    );
    recoveringShard.status = Status.Ready;
    jest.advanceTimersByTime(5_000);

    expect(logger.log).toHaveBeenCalledWith(
      "Discord gateway recovery verified; bot is ready.",
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  test("does not extend the recovery rechecks when another timeout occurs", () => {
    client.ws.shards.set(1, { status: Status.Connecting });
    jest.spyOn(logger, "fatal").mockImplementation(() => undefined);
    jest.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("Process exited");
    });
    handleError(createTimeoutError(), "uncaughtException");
    jest.advanceTimersByTime(122_000);
    handleError(createTimeoutError(), "uncaughtException");

    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(3_000);
    expect(jest.getTimerCount()).toBe(1);
    expect(() => jest.advanceTimersByTime(5_000)).toThrow("Process exited");
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
