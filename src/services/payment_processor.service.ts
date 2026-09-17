import crypto from "crypto";
import { Decimal } from "@prisma/client/runtime/library"

export type MockProcessorScenario = 
    | "INSUFFICIENT_FUNDS"
    | "CARD_DECLINED"
    | "GATEWAY_TIMEOUT";

export interface ProcessChargeInput {
    paymentId: string;
    merchantId: string;
    customerId: string;
    amount: Decimal;
    currency: string;
    mockScenario?: MockProcessorScenario;
}

export interface ProcessChargeResult {
    success: boolean;
    processorReference: string;
    failureReason?: string;
    isRetryable?: boolean;
}

export async function processPaymentGatewayCharge(input: ProcessChargeInput): Promise<ProcessChargeResult> {

    // 1. Handle explicit test/mock scenarios from headers
    if (input.mockScenario) {
        const scenario = input.mockScenario;
        const processorReference = `mock-${crypto.randomBytes(16).toString("hex")}`;

        if (scenario === "INSUFFICIENT_FUNDS") {
            return {
                success: false,
                processorReference,
                failureReason: "Insufficient funds in the account",
                isRetryable: false
            };
        }

        if (scenario === "CARD_DECLINED") {
            return {
                success: false,
                processorReference,
                failureReason: "Card was declined by the issuing bank",
                isRetryable: false
            };
        }

        if (scenario === "GATEWAY_TIMEOUT") {
            return {
                success: false,
                processorReference,
                failureReason: "Payment gateway timeout - please try again later",
                isRetryable: true
            };
        }
    }

    // 2- Normal excution: successful charge
    const processorReference = `ch_sim_${crypto.randomBytes(12).toString("hex")}`;
    return {
        success: true,
        processorReference
    }
    
}