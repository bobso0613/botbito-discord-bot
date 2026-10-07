import type { GuildSchedule } from "../types/guild-schedule.js";
import {
  COOLDOWN_INSTANCE_TYPES,
  MULTIPLIER_INSTANCE_TYPES,
  type InstanceType,
} from "../constants/cooldowns.js";

/**
 * Resolves short aliases only when they consume the complete alphanumeric token.
 * Joined aliases such as ETEC are accepted; unrelated word fragments are rejected.
 */
const parseAbbreviationSequence = (
  token: string,
  abbreviations: readonly string[],
): Set<string> => {
  const prefixes = new Map<number, Set<string>>([[0, new Set()]]);
  for (let offset = 0; offset < token.length; offset++) {
    const prefix = prefixes.get(offset);
    if (!prefix) continue;
    for (const abbreviation of abbreviations) {
      if (!token.startsWith(abbreviation, offset)) continue;
      const end = offset + abbreviation.length;
      const matches = new Set(prefixes.get(end));
      prefix.forEach((match) => matches.add(match));
      matches.add(abbreviation);
      prefixes.set(end, matches);
    }
  }
  return prefixes.get(token.length) ?? new Set();
};

/**
 * Matches configured names and keywords case-insensitively in titles or metadata.
 * Supports either order, separators, full names, and joined abbreviation sequences.
 * Returns each matching type once in configuration order, excluding Others.
 * @example parseInstanceTypes("EC+ET Friday")
 * @example parseInstanceTypes("ETEC")
 */
export const parseInstanceTypes = (
  title: string,
  instanceTypes: readonly InstanceType[] = COOLDOWN_INSTANCE_TYPES,
): InstanceType[] => {
  const matches: InstanceType[] = [];
  const abbreviations = [
    ...new Set(
      instanceTypes
        .filter((type) => type.name !== "Others")
        .flatMap((type) => [type.name, ...type.keywords])
        .filter((keyword) => keyword.length > 0 && keyword.length <= 3)
        .map((keyword) => keyword.toLowerCase()),
    ),
  ];
  const matchedAbbreviations = new Set(
    (title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).flatMap((token) => [
      ...parseAbbreviationSequence(token, abbreviations),
    ]),
  );

  for (const instanceType of instanceTypes) {
    if (instanceType.name === "Others") continue;

    for (const keyword of new Set([
      instanceType.name,
      ...instanceType.keywords,
    ])) {
      if (keyword.length <= 3) {
        if (matchedAbbreviations.has(keyword.toLowerCase())) {
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
 * Resolves selected instance metadata using the supplied guild definitions.
 * Missing metadata falls back to the title; empty or unknown metadata does not.
 * Multiple selections and combined aliases are deduplicated per instance type.
 */
export const getScheduleInstanceTypes = (
  schedule: GuildSchedule,
  instanceTypes: readonly InstanceType[],
): InstanceType[] => {
  const selectedTypes = schedule.instanceTypes;
  if (selectedTypes === undefined) {
    return parseInstanceTypes(schedule.title, instanceTypes);
  }
  const normalize = (value: string): string =>
    value.trim().replace(/\s+/g, " ").toLowerCase();
  const matchedTypes = new Set(
    selectedTypes.flatMap((name) =>
      name.split(/\s*\|\s*/).flatMap((selection) => {
        const normalizedName = normalize(selection);
        const exactMatch = instanceTypes.find((type) => {
          if (type.name === "Others") return false;
          const aliases = [type.name, ...type.keywords].map(normalize);
          return (
            aliases.includes(normalizedName) ||
            (selection.startsWith(`${type.emoji} `) &&
              aliases.includes(
                normalize(selection.slice(type.emoji.length)),
              ))
          );
        });
        return exactMatch
          ? [exactMatch]
          : parseInstanceTypes(selection, instanceTypes);
      }),
    ),
  );
  return instanceTypes.filter((type) => matchedTypes.has(type));
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
 * Selected metadata takes precedence; title matching is used only when it is absent.
 * Each run contributes once per resolved type before enabled title multipliers.
 * Unresolved runs increment Others when that type is configured.
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
    const matchedTypes = getScheduleInstanceTypes(schedule, instanceTypes);

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
