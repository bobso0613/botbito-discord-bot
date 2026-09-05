/** Instance type definition for cooldown tracking. */
export interface InstanceType {
  name: string;
  keywords: string[];
  maxAttempts: number;
  emoji: string;
}

/** All defined instance types with their limits and keywords. */
export const COOLDOWN_INSTANCE_TYPES: readonly InstanceType[] = [
  {
    name: "Endless Tower",
    keywords: ["ET", "Endless Tower"],
    maxAttempts: 3,
    emoji: "🪜",
  },
  {
    name: "Endless Cellar",
    keywords: ["EC", "Endless Cellar"],
    maxAttempts: 3,
    emoji: "📉",
  },
  {
    name: "Eternal Bastion",
    keywords: ["EB", "Eternal Bastion"],
    maxAttempts: 2,
    emoji: "🔥",
  },
  {
    name: "Horror Toy Factory",
    keywords: ["HTF", "Horror Toy Factory"],
    maxAttempts: 3,
    emoji: "🎄",
  },
  {
    name: "Wolfchev's Laboratory",
    keywords: ["Wolfchev", "Wolfchev's Laboratory"],
    maxAttempts: 1,
    emoji: "🐺",
  },
  {
    name: "Sealed Shrine",
    keywords: ["Sealed Shrine"],
    maxAttempts: 6,
    emoji: "⛩️",
  },
  {
    name: "Others",
    keywords: [],
    maxAttempts: 0,
    emoji: "💀",
  },
] as const;

/** Multiplier types that support cooldown multipliers from title. */
export const MULTIPLIER_INSTANCE_TYPES = [
  "Eternal Bastion",
  "Horror Toy Factory",
  "Sealed Shrine",
] as const;
