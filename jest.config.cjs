/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/src"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: "tsconfig.jest.json" }],
  },
  testMatch: ["**/*.test.ts"],
  clearMocks: true,
  collectCoverage: false,
  collectCoverageFrom: [
    "src/commands/help.command.ts",
    "src/commands/payout.command.ts",
    "src/commands/payout-summary.command.ts",
    "src/services/google-sheets.service.ts",
    "src/services/payout.service.ts",
    "src/utils/format-zeny.ts",
    "src/utils/guild-members.ts",
    "src/utils/interaction-context.ts",
    "src/utils/payout-embed.ts",
    "src/utils/payout-sheet.ts",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "text-summary", "html", "lcov"],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
