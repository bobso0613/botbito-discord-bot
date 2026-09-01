export interface PayoutDetails {
  recipient: string;
  amount: number;
  currency: string;
  status: string;
}

// Placeholder until the real payout data source is wired up.
export const getPayoutDetails = async (
  userId: string,
): Promise<PayoutDetails> => {
  return {
    recipient: userId,
    amount: 0,
    currency: "USD",
    status: "pending",
  };
};
