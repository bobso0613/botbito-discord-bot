import { describe, expect, it } from "@jest/globals";
import { commands } from "./index.js";

describe("command registry", () => {
  it("registers every top-level command exactly once per deployment scope", () => {
    const names = commands.map((command) => command.data.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "guildsetting",
        "export",
        "set",
        "payout",
        "payoutsummary",
        "stats",
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
    const scopedNames = commands.flatMap((command) =>
      (command.guildIds ?? ["global"]).map((scope) =>
        JSON.stringify([scope, command.data.name]),
      ),
    );
    expect(new Set(scopedNames).size).toBe(scopedNames.length);
    const setCommands = commands.filter(
      (command) => command.data.name === "set",
    );
    expect(setCommands).toHaveLength(1);
    expect(setCommands[0]?.guildIds).toBeDefined();
    expect(
      setCommands[0]?.data.toJSON().options?.map(({ name }) => name),
    ).toEqual(expect.arrayContaining(["share", "notification"]));
  });
});
