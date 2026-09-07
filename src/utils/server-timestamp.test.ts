import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { getServerTimestamp } from "./server-timestamp.js";

describe("getServerTimestamp", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("formats the current date with the server log format", () => {
    const toLocaleString = jest
      .spyOn(Date.prototype, "toLocaleString")
      .mockReturnValue("09/07/2026, 08:00:00 PM GMT+8");

    expect(getServerTimestamp()).toBe("09/07/2026, 08:00:00 PM GMT+8");
    expect(toLocaleString).toHaveBeenCalledWith("en-PH", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });
  });
});
