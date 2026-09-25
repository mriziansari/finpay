import { PrismaClient, WebhookDeliveryStatus, type WebhookEndpoint, type WebhookDelivery } from "@prisma/client";
import { signWebhookPayload } from "./crypto.js";

const prisma = new PrismaClient();
/**
 *deliver to webhook endpoint 
 * creates a WebhookDelivery log, calls the merchant's webhook URL with HTTP POST
 * - param (webhook endpoint to use, event type, payload)
 * - returns promise containing the WebhookDelivery object
*/
export async function deliverToEndpoint(param: {
    endpoint: WebhookEndpoint;
    eventType: string;
    payload: any;
}): Promise<WebhookDelivery>{
    const {endpoint, eventType, payload} = param;
    const payloadString = JSON.stringify(payload);
    const signature = signWebhookPayload(payloadString, endpoint.secret);

    // 1. Create PENDING delivery log
    const delivery = await prisma.webhookDelivery.create({
        data: {
            endpointId: endpoint.id,
            eventType: eventType,
            payload: payload,
            status: WebhookDeliveryStatus.PENDING,
            attempts: 1
        },
    });

    try {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 10000); //10 sec timeout

        const response = await fetch(endpoint.url, {
             method: "POST",
           headers: {
                "Content-Type": "application/json",
                "X-FinPay-Signature": signature,
                "X-FinPay-Event": eventType,
                "User-Agent": "FinPay-Webhook-Service/1.0",
            },
            body: payloadString,
            signal: abortController.signal,
        });
        clearTimeout(timeoutId);
        const responseText = await response.text();
        const isSuccess = response.ok;

        return prisma.webhookDelivery.update({
            where: {id: delivery.id},
            data: {
                statusCode: response.status,
                responseBody: responseText.slice(0, 1000),
                status: isSuccess ? WebhookDeliveryStatus.SUCCESS : WebhookDeliveryStatus.FAILURE,
            },
        });
        
    } catch (error: any) {
        return prisma.webhookDelivery.update({
            where: {id: delivery.id},
            data: {
                statusCode: 0,
                responseBody: error?.message || "Connection refused or timed out",
                status: WebhookDeliveryStatus.FAILURE
            },
        });
    }
}

/**
 * process webhook messages from the redis stream 
 */

export async function processEventForWebhooks(merchantId: string, eventType: string, payload: any) {
   
        const endPoints = await prisma.webhookEndpoint.findMany({
            where: {
                merchantId,
                isActive: true,
                OR: [
                    { events: {has: eventType}},
                    { events: {has: "*"}}
                ]
            },
        });
        if(endPoints.length === 0) {
            return;
        }
    console.log(`[WebhookService] Dispatching ${eventType} to ${endPoints.length} endpoint(s) for merchant ${merchantId}`);

        for(const endpoint of endPoints) {
            try{
            const result = await deliverToEndpoint({
                endpoint,
                eventType,
                payload,
            });
            console.log(`[WebhookService] Delivered to ${endpoint.url}: HTTP ${result.statusCode} (${result.status})`);
        }catch(error){
            console.log(`Webhook dispatch failed for merchant ${merchantId}:`, error);
        }
    }
   
}