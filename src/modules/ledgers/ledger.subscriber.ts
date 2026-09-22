import { Decimal } from "@prisma/client/runtime/library";
import { eventBus } from "../../shared/events";
import { recordPaymentSettlement, recordRefundSettlement } from "./ledger.service";

// Registers listeners for domain events that the Ledger module cares about.

export function initLedgerSubscribers(): void {
  // Listen for completed payments
  eventBus.subscribe("payment.completed", async (payload) => {
    console.log(`[LedgerSubscriber] Handling payment.completed for payment ${payload.paymentId}`);
    await recordPaymentSettlement({
      paymentId: payload.paymentId,
      merchantId: payload.merchantId,
      amount: new Decimal(payload.amount),
      currency: payload.currency,
    });
    console.log(`[LedgerSubscriber] Successfully settled payment ${payload.paymentId}`);
  });

  // 2. Listen for completed refunds
  eventBus.subscribe("refund.completed", async (payload) => {
    console.log(`[LedgerSubscriber] Handling refund.completed for refund ${payload.refundId}`);
    await recordRefundSettlement({
      refundId: payload.refundId,
      paymentId: payload.paymentId,
      merchantId: payload.merchantId,
      amount: new Decimal(payload.amount),
      currency: payload.currency,
    });
    console.log(`[LedgerSubscriber] Successfully settled refund ${payload.refundId}`);
  });
}
