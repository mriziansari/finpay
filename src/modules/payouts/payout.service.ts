import { prisma } from "../../shared/database/prisma.js";
import { PayoutStatus, type Payout } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { insertOutboxEvent } from "../../shared/events/index.js";
import { ledgerClient } from "../../shared/clients/ledger.client.js";

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

  // 2. Query Ledger Microservice via centralized client
  const availableBalance = await ledgerClient.getMerchantBalance(merchantId, currency);

  if (availableBalance.lt(payoutAmount)) {
    const error = new Error(
      `Insufficient balance. Available: ${availableBalance.toFixed(2)} ${currency}, Requested: ${payoutAmount.toFixed(2)} ${currency}`
    );
    (error as any).status = 400;
    throw error;
  }

  // 3. Atomically create Payout record and queue payout.completed in Outbox
  return prisma.$transaction(async (tx) => {
    const payout = await tx.payout.create({
      data: {
        merchantId,
        amount: payoutAmount,
        currency,
        status: PayoutStatus.PAID,
        idempotencyKey,
      },
    });

    // Queue domain event atomically in outbox table
    await insertOutboxEvent(tx, {
      eventType: "payout.completed",
      aggregateType: "Payout",
      aggregateId: payout.id,
      payload: {
        payoutId: payout.id,
        merchantId,
        amount: payoutAmount.toString(),
        currency,
      },
    });

    return {
      payout,
      isIdempotentReply: false,
    };
  });
}
