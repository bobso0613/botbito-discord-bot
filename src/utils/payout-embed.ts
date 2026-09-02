import type { InteractionContext } from "../types/interaction-context.js";

export const getEmbedFooter = (context: InteractionContext) =>
  context.guildIconUrl
    ? {
        text: context.guildName ?? "Direct Message",
        iconURL: context.guildIconUrl,
      }
    : { text: context.guildName ?? "Direct Message" };
