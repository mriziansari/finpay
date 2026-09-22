import crypto from "crypto";

//Generates a random cryptographic signing secret for a webhook endpoint.
export function generateWebhookSecret(): string {
    return `whs_${crypto.randomBytes(32).toString("hex")}`;
}

/**
 * Signs a webhook payload using HMAC-SHA256.
 * Header format follows the Stripe standard:
 *   t=<timestamp>,v1=<signature>
 */

export function signWebhookPayload(payload: string, secret: string): string {
    // Use the raw bytes of the secret as the HMAC key
    const timestamp = Math.floor(Date.now() / 1000);
    const payloadToSign = `${timestamp}.${payload}`;
    const hmac = crypto
        .createHmac('sha256', secret)
        .update(payloadToSign)
        .digest('hex');
    return `t=${timestamp},v1=${hmac}`;
}
