import { prisma } from "../../shared/database/prisma.js";
import  { PaymentStatus, RiskDecision } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

export interface RiskEvaluationResults {
    riskScore: number;
    riskDecision: RiskDecision;
    reasons: string[];
}

export interface RiskAssesmentInput{
    merchantId: string,
    customerId: string,
    amount: Decimal

}

const RISK_REJECTION_THRESHOLD = 70;

export async function evaluatePaymentRisk(
    input: RiskAssesmentInput
): Promise<RiskEvaluationResults> {

    let riskScore = 0;
    const {merchantId, customerId, amount} = input;
    const reasons:string[] = [];
    const numAmount = amount.toNumber();

    // Rule 1 - Hight Amount Check
    if (numAmount >= 50000){
        riskScore += 80;
        reasons.push("Transaction amount exceeds extreme threshold ($50,000)");
    } else if (numAmount >= 10000){
        riskScore += 40;
        reasons.push("Transaction amount exceeds high threshold ($10,000)");
    } 

    // Rule 2: Velocity Check (Payments created in last 10 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentPaymentsCount = await prisma.payment.count({
        where: {
            merchantId,
            customerId,
            createdAt: { gte: tenMinutesAgo }
        }
    });
    if (recentPaymentsCount >= 5) {
        riskScore += 30;
        reasons.push("High transaction velocity: 5+ attempts in last 10 minutes");
    }


    // Rule 3: Prior Failures / Rejections in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentFailuresCount = await prisma.payment.count({
        where: {
            merchantId,
            customerId,
            status: { in: [PaymentStatus.REJECTED, PaymentStatus.FAILED] },
            createdAt: { gte: oneDayAgo }
        }
    });
    if (recentFailuresCount >= 2) {
        riskScore += 25;
        reasons.push("High failure rate: 2+ failed/rejected payments in last 24 hours");
    }

    // Cap score at 100
    riskScore = Math.min(riskScore, 100);
    const riskDecision =
        riskScore >= RISK_REJECTION_THRESHOLD
            ? RiskDecision.REJECTED
            : RiskDecision.APPROVED;
    return {
        riskScore,
        riskDecision,
        reasons
    };
}
    