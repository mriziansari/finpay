import { redisClient } from "./redis.client";
import type { DomainEvent } from "../events/event.types.js";

export const EVENT_STREAM_KEY = "finpay:events:stream";

/**
 * Publishes a Domain Event into Redis Streams using XADD.
 * Arguments:
 * - key: finpay:events:stream
 * - ID: '*' (Redis auto-generates timestamp-sequence ID, e.g. 1727163000000-0)
 * - Field-value pairs: eventType, aggregateType, aggregateId, payload
 */
export async function publicEventsToStream(event: DomainEvent){
  try {
    const messageId = await redisClient.xadd(
      EVENT_STREAM_KEY,
      "*",
      "event_type", event.eventType,
      "aggregate_type", event.aggregateType,
      "aggregate_id", event.aggregateId,
      "payload", JSON.stringify(event.payload),
    )
    console.log(`[Redis Publisher] Published event ${event.eventType} with ID: ${messageId}`);
    return messageId;
  }catch(error){
    console.log(`[Redis Publisher] Failed to publish event to stream (XADD Event) ${event.eventType}:`, error);
    throw error;
  }
}