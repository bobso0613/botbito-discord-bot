import type { InteractionContext } from "../types/interaction-context.js";
import { getEmbedFooter } from "./payout-embed.js";

const context: InteractionContext = {
  userId: "1",
  username: "user",
  discordTag: "user",
  displayName: "User",
  userAvatarUrl: "https://example.com/avatar.png",
  guildId: "2",
  guildName: "Guild",
  guildIconUrl: "https://example.com/icon.png",
};

describe("getEmbedFooter", () => {
  it("includes the guild icon when available", () => {
    expect(getEmbedFooter(context)).toEqual({
      text: "Guild",
      iconURL: "https://example.com/icon.png",
    });
  });

  it("uses a direct message fallback without an icon", () => {
    expect(
      getEmbedFooter({ ...context, guildName: null, guildIconUrl: null }),
    ).toEqual({ text: "Direct Message" });
  });
});
