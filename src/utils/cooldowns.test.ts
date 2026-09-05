import { describe, expect, it } from "@jest/globals";
import {
  parseInstanceTypes,
  extractMultiplierFromTitle,
  countCooldowns,
} from "./cooldowns.js";
import { COOLDOWN_INSTANCE_TYPES } from "../constants/cooldowns.js";
import type { GuildSchedule } from "../types/guild-schedule.js";

describe("Cooldowns Utils", () => {
  describe("parseInstanceTypes", () => {
    it("should parse single instance type with abbreviation", () => {
      const result = parseInstanceTypes("ET speedrun trial");
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("Endless Tower");
    });

    it("should parse single instance type with full name", () => {
      const result = parseInstanceTypes("Endless Tower run");
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("Endless Tower");
    });

    it("should parse multiple matching instance types", () => {
      const result = parseInstanceTypes("ET EC speedrun");
      expect(result).toHaveLength(2);
      expect(result.map((t) => t.name)).toEqual([
        "Endless Tower",
        "Endless Cellar",
      ]);
    });

    it("should not match partial abbreviations", () => {
      const result = parseInstanceTypes("Eternal Bastion");
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("Eternal Bastion");
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
