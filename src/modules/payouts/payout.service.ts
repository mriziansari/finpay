import { prisma } from "../../shared/database/prisma.js";
import { PayoutStatus, type Payout } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { getMerchantBalance, recordPayoutSettlement } from "../ledgers/index.js";

export interface CreatePayoutInput {
  merchantId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export interface CreatePayoutResult {
  payout: Payout;
  isIdempotentReply: boolean;
}

export async function createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
  const { merchantId, idempotencyKey } = input;
  const currency = input.currency.trim().toUpperCase();
  const payoutAmount = new Decimal(input.amount);

  if (payoutAmount.lte(0)) {
    const error = new Error("Payout amount must be greater than 0");
    (error as any).status = 400;
    throw error;
  }

  // 1. Idempotency check
  const existingPayout = await prisma.payout.findUnique({
    where: {
      merchantId_idempotencyKey: {
        merchantId,
        idempotencyKey,
      },
    },
  });

  if (existingPayout) {
    return {
      payout: existingPayout,
      isIdempotentReply: true,
    };
  }

  // 2. Atomic Balance Check & Execution inside a transaction
  return prisma.$transaction(async (tx) => {
    // Fetch live balance
    const currentBalance = await getMerchantBalance(merchantId, currency);
    const availableBalance = new Decimal(currentBalance.settlementBalance);

    // Invariant: Cannot withdraw more than earned
    if (availableBalance.lt(payoutAmount)) {
      const error = new Error(
        `Insufficient balance. Available: ${availableBalance.toFixed(2)} ${currency}, Requested: ${payoutAmount.toFixed(2)} ${currency}`
      );
      (error as any).status = 400;
      throw error;
    }

    // 3. Create the Payout record
    const payout = await tx.payout.create({
      data: {
        merchantId,
        amount: payoutAmount,
        currency,
        status: PayoutStatus.PAID, // In simulated mode, marked as PAID directly
        idempotencyKey,
      },
    });

    // 4. Post debit to Ledger
    await recordPayoutSettlement(
      {
        payoutId: payout.id,
        merchantId,
        amount: payoutAmount,
        currency,
      },
      tx
    );

    return {
      payout,
      isIdempotentReply: false,
    };
  });
}
