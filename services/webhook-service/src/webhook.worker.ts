import { Redis } from "ioredis";
import { config } from "./config.js";
import { processEventForWebhooks } from "./webhook.delivery.js";

const redis = new Redis(config.redisUrl);
let isRunning = false;

/**
 * Initializes Consumer Group in Redis if it does not already exist.
 */

async function initConsumerGroup(): Promise<void>{
    try{
    // $ means: only consume new messages published after group creation
    // MKSTREAM automatically creates the stream key if it doesn't exist yet

    await redis.xgroup('CREATE', config.streamKey, config.consumerGroup, "0", 'MKSTREAM');

    console.log(`[WebhookService] Consumer group "${config.consumerGroup}" ready for stream "${config.streamKey}"`);
    }catch(error:any){
        if(error.message.includes('BUSYGROUP')){  // Already exists
            console.log(`[WebhookService] Consumer group "${config.consumerGroup}" already exists.`);
        }else{
            console.log(`[WebhookService] Error creating consumer group`, error);
            throw error;
        }
    }
    
}

/**
 * Continuous loop reading from Redis Stream via XREADGROUP.
 */

export async function startWebhookWorker(): Promise<void>{
    if (isRunning) return;
    isRunning = true;

    // 1. Ensure consumer group exists in Redis
    await initConsumerGroup();
    console.log(`[WebhookWorker] Started consuming from stream '${config.streamKey}' as '${config.consumerName}'...`);
    
    // 2. Start continuous reading loop
    while(isRunning){
        try{
            //Blocking read: wait up to 5 seconds for a new message.
            const response = await redis.xreadgroup(
                'GROUP', config.consumerGroup, config.consumerName,
                'COUNT', 10,
                'BLOCK', 2000,
                'STREAMS', config.streamKey, ">",
            );
            if (!response || response.length === 0) { 
                continue;
            }
            
            

      // response format: [[streamKey, [[messageId, [field1, val1, field2, val2...]]]]]
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
        const merchantId = payload.merchantId;
        console.log(`[WebhookWorker] Received ${eventType} (Message ID: ${messageId})`);
        if (merchantId && eventType) {
          await processEventForWebhooks(merchantId, eventType, payload);
        }
        // Acknowledge message so it leaves the Pending Entries List (PEL)
        await redis.xack(config.streamKey, config.consumerGroup, messageId);
      }
    } catch (err) {
      console.error("[WebhookWorker] Error in stream worker loop:", err);
      // Wait 1 second before retrying on redis connection errors
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
export function stopWebhookWorker(): void {
  isRunning = false;
  console.log("[WebhookWorker] Worker stopped.");
}
