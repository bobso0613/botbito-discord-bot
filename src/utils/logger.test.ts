import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { logger } from "./logger.js";

const originalProcessId = process.pid;

describe("logger", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("adds the process ID and server timestamp to informational logs", () => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest
      .spyOn(Date.prototype, "toLocaleString")
      .mockReturnValue("09/07/2026, 08:00:00 PM GMT+8");

    logger.log("message", { detail: true });

    expect(console.log).toHaveBeenCalledWith(
      `${originalProcessId} - [09/07/2026, 08:00:00 PM GMT+8] message`,
      { detail: true },
    );
  });

  it("delegates warnings and errors with additional arguments", () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(Date.prototype, "toLocaleString").mockReturnValue("timestamp");

    logger.warn("warning");
    logger.error("failure", new Error("boom"));

    expect(console.warn).toHaveBeenCalledWith(
      `${originalProcessId} - [timestamp] warning`,
    );
    expect(console.error).toHaveBeenCalledWith(
      `${originalProcessId} - [timestamp] failure`,
      expect.any(Error),
    );
  });
});
