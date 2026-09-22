import type { Prisma } from "@prisma/client";
import { OutboxStatus } from "@prisma/client";
import type { DomainEvent } from "./event.types.js";

/**
 * Inserts an event into the outbox table inside an existing database transaction.
 * Guarantees zero dual-write bugs.
 */
export async function insertOutboxEvent(
  tx: Prisma.TransactionClient,
  event: DomainEvent
) {
  return tx.outboxEvent.create({
    data: {
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.payload as any,
      status: OutboxStatus.PENDING,
    },
  });
}
