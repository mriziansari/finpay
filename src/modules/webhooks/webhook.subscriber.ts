import { prisma } from "../../shared/database/prisma.js";
import { eventBus } from "../../shared/events/index.js";
import { deliverWebhook } from "./webhook.service.js";

/**
 * Helper to dispatch an event to all active endpoints registered by a merchant
 * that subscribe to this eventType (or subscribe to all "*").
 */
async function dispatchToMerchantEndpoints(merchantId: string, eventType: string, payload: any) {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      merchantId,
      isActive: true,
      OR: [
        { events: { has: eventType } },
        { events: { has: "*" } },
      ],
    },
  });

  if (endpoints.length === 0) {
    return;
  }

  console.log(`[WebhookSubscriber] Dispatching ${eventType} to ${endpoints.length} endpoint(s) for merchant ${merchantId}`);

  // Deliver to each endpoint asynchronously
  for (const endpoint of endpoints) {
    try {
      const result = await deliverWebhook({
        endpoint,
        eventType,
        payload,
      });
      console.log(`[WebhookSubscriber] Delivery to ${endpoint.url} finished with status: ${result.status} (HTTP ${result.statusCode})`);
    } catch (err) {
      console.error(`[WebhookSubscriber] Failed to deliver to ${endpoint.url}:`, err);
    }
  }
}

/**
 * Registers listeners for domain events that merchants should be notified of.
 */
export function initWebhookSubscribers(): void {
  // 1. Listen for completed payments
  eventBus.subscribe("payment.completed", async (payload) => {
    await dispatchToMerchantEndpoints(payload.merchantId, "payment.completed", payload);
  });

  // 2. Listen for failed payments
  eventBus.subscribe("payment.failed", async (payload) => {
    await dispatchToMerchantEndpoints(payload.merchantId, "payment.failed", payload);
  });

  // 3. Listen for completed refunds
  eventBus.subscribe("refund.completed", async (payload) => {
    await dispatchToMerchantEndpoints(payload.merchantId, "refund.completed", payload);
  });

  console.log("[WebhookSubscriber] Webhook subscribers initialized for payment and refund events.");
}
