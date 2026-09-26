import { Redis } from "ioredis";
import { config } from "./config.js";
import { recordPaymentSettlement, recordRefundSettlement, recordPayoutSettlement } from "./ledger.engine.js";

const redis = new Redis(config.redisUrl);
let isRunning = false;

async function initConsumerGroup(): Promise<void> {
  try {
    await redis.xgroup("CREATE", config.streamKey, config.consumerGroup, "0", "MKSTREAM");
    console.log(`[LedgerService] Consumer group '${config.consumerGroup}' ready.`);
  } catch (err: any) {
    if (err.message.includes("BUSYGROUP")) {
      console.log(`[LedgerService] Consumer group '${config.consumerGroup}' already exists.`);
    } else {
      throw err;
    }
  }
}

export async function startLedgerWorker(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  await initConsumerGroup();
  console.log(`[LedgerWorker] Consuming from '${config.streamKey}' as '${config.consumerName}'...`);

  while (isRunning) {
    try {
      const response = await redis.xreadgroup(
        "GROUP", config.consumerGroup, config.consumerName,
        "COUNT", 10,
        "BLOCK", 2000,
        "STREAMS", config.streamKey, ">",
      );
      if (!response || response.length === 0) {
        continue;
      }
      const streamEntry = response[0];
      if (!streamEntry) {
        continue;
      }


      const [, messages] = streamEntry;
      for (const [messageId, fields] of messages) {
        if (!fields) {
          continue;
        }
        // Convert flat Redis array [k1, v1, k2, v2...] to key-value object
        const fieldMap: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          const key = fields[i];
          const val = fields[i + 1];
          if (key !== undefined && val !== undefined) {
            fieldMap[key] = val;
          }
        }

        const eventType = fieldMap["event_type"];
        const payload = JSON.parse(fieldMap["payload"] || "{}");

        if (eventType === "payment.completed") {
          console.log(`[LedgerWorker] Recording settlement for payment: ${payload.paymentId}`);
          await recordPaymentSettlement({
            paymentId: payload.paymentId,
            merchantId: payload.merchantId,
            amount: payload.amount,
            currency: payload.currency,
          });
        } else if (eventType === "refund.completed") {
          console.log(`[LedgerWorker] Recording reversal for refund: ${payload.refundId}`);
          await recordRefundSettlement({
            refundId: payload.refundId,
            paymentId: payload.paymentId,
            merchantId: payload.merchantId,
            amount: payload.amount,
            currency: payload.currency,
          });
        } else if (eventType === "payout.completed") {
          console.log(`[LedgerWorker] Recording withdrawal for payout: ${payload.payoutId}`);
          await recordPayoutSettlement({
            payoutId: payload.payoutId,
            merchantId: payload.merchantId,
            amount: payload.amount,
            currency: payload.currency,
          });
        }


        await redis.xack(config.streamKey, config.consumerGroup, messageId);
      }
    } catch (err) {
      console.error("[LedgerWorker] Error in stream worker loop:", err);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export function stopLedgerWorker(): void {
  isRunning = false;
  console.log("[LedgerWorker] Worker stopped.");
}
