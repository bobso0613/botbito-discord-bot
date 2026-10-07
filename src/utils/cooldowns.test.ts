import { describe, expect, it } from "@jest/globals";
import {
  parseInstanceTypes,
  extractMultiplierFromTitle,
  countCooldowns,
} from "./cooldowns.js";
import { COOLDOWN_INSTANCE_TYPES } from "../constants/cooldowns.js";
import type { GuildSchedule } from "../types/guild-schedule.js";

const combinedRunNames = [
  ...["ET", "Endless Tower"].flatMap((tower) =>
    ["EC", "Endless Cellar"].flatMap((cellar) =>
      ["+", " ", " and ", " 'and' ", " & ", "/", "-", "_", ",", " + "].flatMap(
        (separator) => [
          `${tower}${separator}${cellar}`,
          `${cellar}${separator}${tower}`,
        ],
      ),
    ),
  ),
  "ETEC",
  "ECET",
  "etec",
  "ecet",
  "ETECET",
  "ECETEC",
  "Endless Cellar+Endless Tower Thursday",
];

describe("Cooldowns Utils", () => {
  describe("parseInstanceTypes", () => {
    it.each(["secret meetup", "ETECetera", "preECET", "ETEC2", "ECETting"])(
      "does not match abbreviations inside unrelated words: %s",
      (title) => {
        expect(parseInstanceTypes(title)).toEqual([]);
      },
    );
    it.each(combinedRunNames)("parses both instance types from %s", (title) => {
      expect(parseInstanceTypes(title).map((type) => type.name)).toEqual([
        "Endless Tower",
        "Endless Cellar",
      ]);
    });
    it.each([
      { input: "ET speedrun trial", expectedName: "Endless Tower" },
      { input: "Endless Tower run", expectedName: "Endless Tower" },
      { input: "Eternal Bastion", expectedName: "Eternal Bastion" },
    ])(
      "parses a single instance type from $input",
      ({ input, expectedName }) => {
        const result = parseInstanceTypes(input);
        expect(result).toHaveLength(1);
        expect(result[0]?.name).toBe(expectedName);
      },
    );

    it("should parse multiple matching instance types", () => {
      const result = parseInstanceTypes("ET EC speedrun");
      expect(result).toHaveLength(2);
      expect(result.map((t) => t.name)).toEqual([
        "Endless Tower",
        "Endless Cellar",
      ]);
    });

    it("should return empty array if no match", () => {
      const result = parseInstanceTypes("Random Schedule");
      expect(result).toHaveLength(0);
    });

    it("should be case insensitive", () => {
      const result1 = parseInstanceTypes("et run");
      const result2 = parseInstanceTypes("ET run");
      expect(result1).toEqual(result2);
    });
  });

  describe("extractMultiplierFromTitle", () => {
    it("should extract multiplier from title", () => {
      const bastion = COOLDOWN_INSTANCE_TYPES.find(
        (t) => t.name === "Eternal Bastion",
      );
      const multiplier = extractMultiplierFromTitle("EB 2x run", bastion!);
      expect(multiplier).toBe(2);
    });

    it("should return 4 for Sealed Shrine with minimum text", () => {
      const shrine = COOLDOWN_INSTANCE_TYPES.find(
        (t) => t.name === "Sealed Shrine",
      );
      const multiplier = extractMultiplierFromTitle(
        "Sealed Shrine (minimum 2-3 runs)",
        shrine!,
      );
      expect(multiplier).toBe(4);
    });

    it("should return 1 for instances that don't support multiplier", () => {
      const et = COOLDOWN_INSTANCE_TYPES.find(
        (t) => t.name === "Endless Tower",
      );
      const multiplier = extractMultiplierFromTitle("ET 4x", et!);
      expect(multiplier).toBe(1);
    });

    it("should return 1 if no multiplier found", () => {
      const bastion = COOLDOWN_INSTANCE_TYPES.find(
        (t) => t.name === "Eternal Bastion",
      );
      const multiplier = extractMultiplierFromTitle("EB run", bastion!);
      expect(multiplier).toBe(1);
    });
  });

  describe("countCooldowns", () => {
    it.each([
      { title: "EB 3x", selected: ["Eternal Bastion"], expected: 3 },
      { title: "EB 3x", selected: [], expected: 0 },
    ])(
      "preserves metadata precedence and title multipliers: $selected",
      ({ title, selected, expected }) => {
        const result = countCooldowns([
          {
            title,
            instanceTypes: selected,
            timestamp: "<t:1234567890:F>",
            channelName: "signups",
            channelUrl: "https://discord.com/channels/123/456",
            isSignedUp: true,
            isReserve: false,
            guildName: "TestGuild",
          },
        ]);
        expect(result.get("Eternal Bastion")?.count).toBe(expected);
        expect(result.get("Others")?.count).toBe(selected.length === 0 ? 1 : 0);
      },
    );
    it.each([
      ...combinedRunNames.flatMap((name) => [
        { title: `${name} back 2 back Friday`, instanceTypes: undefined },
        { title: "Friday run", instanceTypes: [name] },
      ]),
      { title: "Friday run", instanceTypes: ["ET", "endless cellar"] },
      { title: "Friday run", instanceTypes: ["EC+ET"] },
    ])(
      "counts both combined cooldowns for $title / $instanceTypes",
      ({ title, instanceTypes }) => {
        const result = countCooldowns([
          {
            title,
            instanceTypes,
            timestamp: "<t:1234567890:F>",
            channelName: "signups",
            channelUrl: "https://discord.com/channels/123/456",
            isSignedUp: true,
            isReserve: false,
            guildName: "TestGuild",
          },
        ]);
        expect(result.get("Endless Tower")?.count).toBe(1);
        expect(result.get("Endless Cellar")?.count).toBe(1);
      },
    );

    it("uses explicit types instead of a conflicting title without duplicate counts", () => {
      const result = countCooldowns([
        {
          title: "EC run",
          instanceTypes: ["ET", "Endless Tower"],
          timestamp: "<t:1234567890:F>",
          channelName: "signups",
          channelUrl: "https://discord.com/channels/123/456",
          isSignedUp: true,
          isReserve: false,
          guildName: "TestGuild",
        },
      ]);
      expect(result.get("Endless Tower")?.count).toBe(1);
      expect(result.get("Endless Cellar")?.count).toBe(0);
    });

    it("should initialize all instance types with 0", () => {
      const schedules: Array<GuildSchedule & { guildName: string }> = [];
      const result = countCooldowns(schedules);

      expect(result.size).toBe(COOLDOWN_INSTANCE_TYPES.length);
      for (const instanceType of COOLDOWN_INSTANCE_TYPES) {
        expect(result.get(instanceType.name)?.count).toBe(0);
      }
    });

    it("should count single signup correctly", () => {
      const mockSchedule: GuildSchedule & { guildName: string } = {
        title: "ET speedrun",
        timestamp: "<t:1234567890:F>",
        channelName: "signups",
        channelUrl: "https://discord.com/channels/123/456",
        isSignedUp: true,
        isReserve: false,
        charNote: "",
        guildName: "TestGuild",
      } as any;

      const result = countCooldowns([mockSchedule]);
      expect(result.get("Endless Tower")?.count).toBe(1);
    });

    it("should count multiple signups for same instance", () => {
      const mockSchedules: Array<GuildSchedule & { guildName: string }> = [
        {
          title: "ET 2x run",
          timestamp: "<t:1234567890:F>",
          channelName: "signups",
          channelUrl: "https://discord.com/channels/123/456",
          isSignedUp: true,
          isReserve: false,
          charNote: "",
          guildName: "TestGuild",
        } as any,
        {
          title: "EB 3x run",
          timestamp: "<t:1234567890:F>",
          channelName: "signups",
          channelUrl: "https://discord.com/channels/123/456",
          isSignedUp: true,
          isReserve: false,
          charNote: "",
          guildName: "TestGuild",
        } as any,
      ];

      const result = countCooldowns(mockSchedules);
      expect(result.get("Endless Tower")?.count).toBe(1); // ET doesn't have multiplier
      expect(result.get("Eternal Bastion")?.count).toBe(3); // EB with 3x multiplier
    });

    it("should count multi-type signups", () => {
      const mockSchedule: GuildSchedule & { guildName: string } = {
        title: "ET EC speedrun",
        timestamp: "<t:1234567890:F>",
        channelName: "signups",
        channelUrl: "https://discord.com/channels/123/456",
        isSignedUp: true,
        isReserve: false,
        charNote: "",
        guildName: "TestGuild",
      } as any;

      const result = countCooldowns([mockSchedule]);
      expect(result.get("Endless Tower")?.count).toBe(1);
      expect(result.get("Endless Cellar")?.count).toBe(1);
    });

    it("should count unrecognized schedules as Others", () => {
      const mockSchedule: GuildSchedule & { guildName: string } = {
        title: "Random Event",
        timestamp: "<t:1234567890:F>",
        channelName: "signups",
        channelUrl: "https://discord.com/channels/123/456",
        isSignedUp: true,
        isReserve: false,
        charNote: "",
        guildName: "TestGuild",
      } as any;

      const result = countCooldowns([mockSchedule]);
      expect(result.get("Others")?.count).toBe(1);
    });
  });
});
