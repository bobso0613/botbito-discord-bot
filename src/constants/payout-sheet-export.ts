/** Column-scoped identity used to reconcile exports without relying on column letters. */
export const PAYOUT_EXPORT_METADATA_KEY = "botbito-payout-export-v1";

/** Pending share background (#8E7CC3), using Sheets API RGB components. */
export const PENDING_SHARE_COLOR = {
  red: 142 / 255,
  green: 124 / 255,
  blue: 195 / 255,
};

/** Neutral background for unoccupied run cells. */
export const EMPTY_SHARE_COLOR = { red: 1, green: 1, blue: 1 };

/** Clear backgroundColorStyle too, so it cannot override an explicit RGB background. */
export const PAYOUT_BACKGROUND_FIELDS =
  "userEnteredFormat.backgroundColor,userEnteredFormat.backgroundColorStyle";

export const PAYOUT_VALUE_AND_BACKGROUND_FIELDS = `userEnteredValue,${PAYOUT_BACKGROUND_FIELDS}`;
