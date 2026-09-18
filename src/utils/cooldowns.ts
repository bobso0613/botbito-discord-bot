import type { GuildSchedule } from "../types/guild-schedule.js";
import {
  COOLDOWN_INSTANCE_TYPES,
  MULTIPLIER_INSTANCE_TYPES,
  type InstanceType,
} from "../constants/cooldowns.js";

/**
 * Parses all matching instance types from a schedule title.
 * Returns an array of all matching instance types or an empty array if none match.
 * Uses word boundaries for abbreviations (1-3 chars) and substring matching for full names.
 */
const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

export const parseInstanceTypes = (
  title: string,
  instanceTypes: readonly InstanceType[] = COOLDOWN_INSTANCE_TYPES,
): InstanceType[] => {
  const matches: InstanceType[] = [];

  for (const instanceType of instanceTypes) {
    if (instanceType.name === "Others") continue;

    for (const keyword of instanceType.keywords) {
      if (keyword.length <= 3) {
        const regex = new RegExp(
          String.raw`(?:^|\s)${escapeRegularExpression(keyword)}(?:\s|$)`,
          "i",
        );
        if (regex.test(title)) {
          matches.push(instanceType);
          break;
        }
      } else if (title.toUpperCase().includes(keyword.toUpperCase())) {
        matches.push(instanceType);
        break;
      }
    }
  }

  return matches;
};

/**
 * Extracts the multiplier from a schedule title (e.g., "2x", "4x", "3x").
 * Only applies multiplier for specific instance types.
 * Special case: Sealed Shrine with "(minimum 2-3 runs)" counts as 4x.
 * Returns the multiplier value or 1 if not found or not applicable.
 */
export const extractMultiplierFromTitle = (
  title: string,
  instanceType: InstanceType,
  multiplierInstanceTypes: readonly string[] = MULTIPLIER_INSTANCE_TYPES,
): number => {
  // Only apply multiplier for specific instance types
  const multiplierApplies = multiplierInstanceTypes.includes(instanceType.name);

  if (!multiplierApplies) return 1;

  // Special case: Sealed Shrine with "(minimum 2-3 runs)" counts as 4x
  if (
    instanceType.name === "Sealed Shrine" &&
    title.includes("(minimum 2-3 runs)")
  ) {
    return 4;
  }

  const match = /(?:^|\D)(\d+)x\b/i.exec(title);
  return match ? Number.parseInt(match[1], 10) : 1;
};

/**
 * Counts cooldowns by instance type from a list of schedules.
 * Initializes all instance types with 0 count and updates based on matched schedules.
 */
export const countCooldowns = (
  schedules: Array<GuildSchedule & { guildName: string }>,
  instanceTypes: readonly InstanceType[] = COOLDOWN_INSTANCE_TYPES,
  multiplierInstanceTypes: readonly string[] = MULTIPLIER_INSTANCE_TYPES,
): Map<
  string,
  {
    type: InstanceType | null;
    count: number;
  }
> => {
  // Initialize map with all instance types, starting with 0 count
  const cooldownMap = new Map<
    string,
    {
      type: InstanceType | null;
      count: number;
    }
  >();

  for (const instanceType of instanceTypes) {
    cooldownMap.set(instanceType.name, {
      type: instanceType,
      count: 0,
    });
  }

  // Count schedules
  for (const schedule of schedules) {
    const matchedTypes = parseInstanceTypes(schedule.title, instanceTypes);

    // If no types matched, add to "Others"
    if (matchedTypes.length === 0) {
      const existing = cooldownMap.get("Others");
      if (existing) {
        existing.count += 1;
      }
    } else {
      // Add to each matched type
      for (const matchedType of matchedTypes) {
        const multiplier = extractMultiplierFromTitle(
          schedule.title,
          matchedType,
          multiplierInstanceTypes,
        );
        const existing = cooldownMap.get(matchedType.name);
        if (existing) {
          existing.count += multiplier;
        }
      }
    }
  }

  return cooldownMap;
};
