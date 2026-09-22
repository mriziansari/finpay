import { prisma } from "../database/prisma.js";
import { OutboxStatus } from "@prisma/client";
import { eventBus } from "./event-bus.js";
import type { DomainEvent } from "./event.types.js";

const BATCH_SIZE = 10;
const POLL_INTERVAL_MS = 2000; // Poll every 2 seconds

let isRunning = false;
let intervalTimer: NodeJS.Timeout | null = null;

/**
 * Process a single batch of PENDING outbox events.
 */
export async function processOutboxBatch(): Promise<number> {
  // 1. Fetch pending events ordered by creation date
  const events = await prisma.outboxEvent.findMany({
    where: { status: OutboxStatus.PENDING },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  if (events.length === 0) {
    return 0;
  }

  for (const record of events) {
    // 2. Mark as PROCESSING to avoid duplicate handling
    await prisma.outboxEvent.update({
      where: { id: record.id },
      data: { status: OutboxStatus.PROCESSING },
    });

    try {
      // 3. Construct DomainEvent and publish to internal EventBus
      const domainEvent: DomainEvent = {
        aggregateType: record.aggregateType as any,
        aggregateId: record.aggregateId,
        eventType: record.eventType as any,
        payload: record.payload as any,
      };

      await eventBus.publish(domainEvent);

      // 4. Mark as PUBLISHED upon success
      await prisma.outboxEvent.update({
        where: { id: record.id },
        data: {
          status: OutboxStatus.PUBLISHED,
          processedAt: new Date(),
        },
      });

      console.log(`[OutboxDispatcher] Published event ${record.eventType} (${record.id})`);
    } catch (error: any) {
      console.error(`[OutboxDispatcher] Failed to dispatch event ${record.id}:`, error);

      // 5. On failure, increment retry count and record error
      await prisma.outboxEvent.update({
        where: { id: record.id },
        data: {
          status: record.retryCount >= 3 ? OutboxStatus.FAILED : OutboxStatus.PENDING,
          retryCount: { increment: 1 },
          errorMessage: error?.message || "Unknown dispatch error",
        },
      });
    }
  }

  return events.length;
}

/**
 * Starts the background outbox dispatcher loop.
 */
export function startOutboxDispatcher(): void {
  if (isRunning) return;
  isRunning = true;

  console.log("[OutboxDispatcher] Background outbox worker started (polling every 2s)...");

  intervalTimer = setInterval(async () => {
    try {
      await processOutboxBatch();
    } catch (err) {
      console.error("[OutboxDispatcher] Error in polling loop:", err);
    }
  }, POLL_INTERVAL_MS);
}

/**
 * Stops the outbox dispatcher (useful for graceful shutdown).
 */
export function stopOutboxDispatcher(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  isRunning = false;
  console.log("[OutboxDispatcher] Background worker stopped.");
}
