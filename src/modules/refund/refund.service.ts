import { prisma } from "../../shared/database/prisma.js";
import { PaymentStatus, RefundStatus, type Refund } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
// import { recordRefundSettlement } from "../ledgers/index.js";
import { getPaymentById, updatePaymentStatus } from "../payments/index.js";
import { insertOutboxEvent } from "../../shared/events/index.js";


export interface CreateRefundInput {
  paymentId: string;
  merchantId: string;
  amount?: number; // Optional: If omitted, full refund is assumed
  reason?: string;
  idempotencyKey: string;
}

export interface CreateRefundResult {
  refund: Refund;
  isIdempotentReply: boolean;
}

export async function createRefund(input: CreateRefundInput): Promise<CreateRefundResult> {
  const { paymentId, merchantId, reason, idempotencyKey } = input;

  // 1. Check idempotency
  const existingRefund = await prisma.refund.findUnique({
    where: {
      merchantId_idempotencyKey: {
        merchantId,
        idempotencyKey,
      },
    },
  });

  if (existingRefund) {
    return {
      refund: existingRefund,
      isIdempotentReply: true,
    };
  }

  // 2. Fetch payment and existing completed refunds
  const payment = await getPaymentById(merchantId, paymentId);

  if (!payment) {
    const error = new Error("Payment not found");
    (error as any).status = 404;
    throw error;
  }

  // Invariant: Must be in a refundable state
  const allowedStatuses: PaymentStatus[] = [
    PaymentStatus.COMPLETED,
    PaymentStatus.PARTIALLY_REFUNDED,
  ];

  if (!allowedStatuses.includes(payment.status)) {
    const error = new Error(`Payment cannot be refunded in '${payment.status}' status`);
    (error as any).status = 400;
    throw error;
  }

  // 3. Calculate remaining refundable amount
  const alreadyRefunded = payment.refunds.reduce(
    (sum, r) => sum.add(r.amount),
    new Decimal(0)
  );
  const remainingRefundable = payment.amount.sub(alreadyRefunded);

  // If no amount specified in request, default to full remaining amount
  const refundAmount = input.amount !== undefined ? new Decimal(input.amount) : remainingRefundable;

  if (refundAmount.lte(0)) {
    const error = new Error("Refund amount must be greater than 0");
    (error as any).status = 400;
    throw error;
  }

  if (refundAmount.gt(remainingRefundable)) {
    const error = new Error(
      `Refund amount exceeds remaining balance. Max refundable: ${remainingRefundable.toFixed(2)} ${payment.currency}`
    );
    (error as any).status = 400;
    throw error;
  }

  // 4. Atomically record refund, update payment status, and post to ledger
  return prisma.$transaction(async (tx) => {
    // 4.1 Create refund row
    const refund = await tx.refund.create({
      data: {
        paymentId: payment.id,
        merchantId,
        amount: refundAmount,
        currency: payment.currency,
        reason: reason ?? "Requested by merchant",
        status: RefundStatus.COMPLETED,
        idempotencyKey,
      },
    });

    // 4.2 Update payment status (REFUNDED if 100% refunded, else PARTIALLY_REFUNDED)
    const newTotalRefunded = alreadyRefunded.add(refundAmount);
    const newStatus = newTotalRefunded.equals(payment.amount)
      ? PaymentStatus.REFUNDED
      : PaymentStatus.PARTIALLY_REFUNDED;

    await updatePaymentStatus(payment.id, newStatus, tx);

    // 4.3 Post double-entry reversal to Ledger
        // 4.3 Write domain event to the Transactional Outbox
    await insertOutboxEvent(tx, {
      eventType: "refund.completed",
      aggregateType: "Refund",
      aggregateId: refund.id,
      payload: {
        refundId: refund.id,
        paymentId: payment.id,
        merchantId,
        amount: refundAmount.toFixed(2),
        currency: payment.currency,
      },
    });


    return {
      refund,
      isIdempotentReply: false,
    };
  });
}
