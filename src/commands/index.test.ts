import { describe, expect, it } from "@jest/globals";
import { commands } from "./index.js";

describe("command registry", () => {
  it("registers every top-level command exactly once", () => {
    const names = commands.map((command) => command.data.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "guildsetting",
        "payout",
        "payoutsummary",
        "guildsched",
        "mysched",
        "mycooldowns",
        "help",
        "newrun",
        "change",
        "add",
        "ping",
      ]),
    );
    expect(new Set(names).size).toBe(names.length);
  });
});
