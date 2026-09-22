import { prisma } from "../../shared/database/prisma.js"
import { WebhookDeliveryStatus, type WebhookEndpoint, type WebhookDelivery } from "@prisma/client";
import { generateWebhookSecret, signWebhookPayload } from "./webhook.crypto.js";

export interface RegisterWebhookEndpointInput {
  merchantId: string;
  url: string;
  events?: string[]; 
}

// 1. Registers a new webhook endpoint for a merchant.
export async function registerWebhookEndpoint(input: RegisterWebhookEndpointInput):Promise<WebhookEndpoint> {

    const { merchantId, url, events = ["*"] } = input; 
    
    //Basic Url validation
    try{
        new URL(url);

    }catch{
        const error = new Error("Invalid webhook URL format");
        (error as any).status = 400; 
        throw error;
    }

    const secret = generateWebhookSecret();

return prisma.webhookEndpoint.create({
    data: {
      merchantId,
      url,
      secret,
      events,
      isActive: true,
    },
  });
}
    
// 2. Lists all webhook endpoints for a merchant.
export async function listWebhookEndpoints(merchantId: string): Promise<WebhookEndpoint[]> {
  return prisma.webhookEndpoint.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
  });
}

// 3. Delivers a webhook event to an endpoint via HTTP POST.

export async function deliverWebhook(params: {
  endpoint: WebhookEndpoint;
  eventType: string;
  payload: any;
}): Promise<WebhookDelivery> {
  const { endpoint, eventType, payload } = params;
  const payloadString = JSON.stringify(payload);
  const signature = signWebhookPayload(payloadString, endpoint.secret);
  
  // 1. Create a PENDING delivery record
  const delivery = await prisma.webhookDelivery.create({
    data: {
      endpointId: endpoint.id,
      eventType,
      payload: payload as any,
      status: WebhookDeliveryStatus.PENDING,
      attempts: 1,
    },
  });
  try {
    // 2. Perform HTTP POST using native Node.js fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second timeout
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FinPay-Signature": signature,
        "X-FinPay-Event": eventType,
        "User-Agent": "FinPay-Webhooks/1.0",
      },
      body: payloadString,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const responseText = await response.text();
    const isSuccess = response.ok; // HTTP 200–299
    // 3. Update delivery with outcome
    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        statusCode: response.status,
        responseBody: responseText.slice(0, 1000), // Keep first 1000 chars of response
        status: isSuccess ? WebhookDeliveryStatus.SUCCESS : WebhookDeliveryStatus.FAILURE,
      },
    });
  } catch (error: any) {
    // Network failure, timeout, or DNS failure
    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        statusCode: 0,
        responseBody: error?.message || "Connection refused or timed out",
        status: WebhookDeliveryStatus.FAILURE,
      },
    });
  }
}
