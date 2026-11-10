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

  it("uses a direct message fallback when guild metadata is absent", () => {
    expect(
      getEmbedFooter({
        ...context,
        guildName: undefined,
        guildIconUrl: undefined,
      }),
    ).toEqual({ text: "Direct Message" });
  });

  it.each([
    [null, "https://example.com/icon.png", "Direct Message", true],
    ["Guild", null, "Guild", false],
  ] as const)(
    "combines guild name %s with icon presence %s",
    (guildName, guildIconUrl, text, includesIcon) => {
      const footer = getEmbedFooter({ ...context, guildName, guildIconUrl });
      expect(footer.text).toBe(text);
      expect("iconURL" in footer).toBe(includesIcon);
    },
  );
});
