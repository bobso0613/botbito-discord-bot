import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set");
}

const rest = new REST().setToken(token);
const globalCommandBody = commands
  .filter((command) => !command.guildIds)
  .map((command) => command.data.toJSON());
const guildIds = [
  ...new Set(commands.flatMap((command) => command.guildIds ?? [])),
];
const excludedGuildIdsByClientId: Record<string, ReadonlySet<string>> = {
  "901721382214328350": new Set(["1115484031455346718"]),
};
const excludedGuildIds =
  excludedGuildIdsByClientId[clientId] ?? new Set<string>();

await rest.put(Routes.applicationCommands(clientId), {
  body: globalCommandBody,
});

for (const guildId of guildIds) {
  if (excludedGuildIds.has(guildId)) {
    console.warn(
      `Skipping guild ${guildId}: command deployment is excluded for application ${clientId}.`,
    );
    continue;
  }

  const guildCommandBody = commands
    .filter((command) => command.guildIds?.includes(guildId))
    .map((command) => command.data.toJSON());

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: guildCommandBody,
  });
}

console.log(
  `Registered ${globalCommandBody.length} global and guild-specific slash command(s) for ${guildIds.length} guild(s).`,
);
