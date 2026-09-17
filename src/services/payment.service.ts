import { prisma } from "../lib/prisma.js";
import { PaymentStatus, type Payment, CustomerStatus, RiskDecision, PaymentAttemptStatus, Prisma} from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { evaluatePaymentRisk } from "./risk.service";
import { processPaymentGatewayCharge, type MockProcessorScenario } from "./payment_processor.service";
import { recordPaymentSettlement } from "./ledger.service.js";
 
//  Defined the allowd currencies

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "AUD","PKR"];
export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];

export interface CreatePaymentInput {
    merchantId: string;
    customerId: string;
    amount: number;
    currency: string;
    idempotencyKey :string;
    mockProcessorScenario?: MockProcessorScenario;
}

export interface CreatePaymentResult{
    payment: Payment;
    isIdempotentReply: boolean;
}

export async function createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {

    const {merchantId, customerId, amount , idempotencyKey} = input;
    const currency = input.currency.trim().toUpperCase() as SupportedCurrency;
    const MAX_ATTEMPTS = 3;

    // 1 - Validate Currency
    if (!SUPPORTED_CURRENCIES.includes(currency as SupportedCurrency)) {
       const error = new Error(
        `Currency ${currency} is not supported. Supported currencies are ${SUPPORTED_CURRENCIES.join(", ")}`
       );
       (error as any).status = 400;
       throw error;
    }

    // 2 - Customer exist, belong to merchant, status active
    const customer = await prisma.customer.findFirst({
        where:{
            id:customerId,
            merchantId:merchantId
            
        }
    });

    if (!customer) {
        const error = new Error("Customer not found");
        (error as any).status = 404;
        throw error;
    }
    if (customer.status === CustomerStatus.INACTIVE) {
        const error = new Error("Customer is inactive");
        (error as any).status = 400;
        throw error;
    }
    
    // 3 - check idempotency key

    const existingPayment = await prisma.payment.findUnique({
        where: {
            merchantId_idempotencyKey: {
                merchantId,
                idempotencyKey
            }
        }
    });
    if (existingPayment) {
      // Compare payload to ensure the client is retrying the EXACT same request
      const incomingAmount = new Decimal(amount);
      const amountMatch = existingPayment.amount.equals(incomingAmount);
      const currencyMatch = existingPayment.currency === currency;
      const customersMatch = existingPayment.customerId === customerId;

      if(amountMatch && currencyMatch && customersMatch) {
        return {
            payment: existingPayment,
            isIdempotentReply: true
        };
      }

      // Key collision: same key used with different data
        const error = new Error(
            "Idempotency key has already been used with different payment parameters"
        );
        (error as any).status = 409;
        throw error;
    }

    // 4 - Create the payment 
    const payment = await prisma.payment.create({
        data: {
            merchantId,
            customerId,
            amount: new Decimal(amount),
            currency,
            status: PaymentStatus.CREATED,
            idempotencyKey
        }
    });

    // 5 - Transition to RISK_CHECKING
    await prisma.payment.update({
    where: { id: payment.id },
    data: { status: PaymentStatus.RISK_CHECKING }
    });
    // 6. Evaluate Risk
    const riskResult = await evaluatePaymentRisk({
        merchantId,
        customerId,
        amount: payment.amount
    });

    // 7. If Risk is REJECTED, immediately terminate the payment lifecycle
    if (riskResult.riskDecision === RiskDecision.REJECTED) {
        const rejectedPayment = await prisma.payment.update({
            where: { id: payment.id },
            data: {
                status: PaymentStatus.REJECTED,
                riskScore: riskResult.riskScore,
                riskDecision: riskResult.riskDecision,
                failureReason: riskResult.reasons.join("; ")
            }
        });

        return {
            payment: rejectedPayment,
            isIdempotentReply: false
        }
    }

    // 8. Risk PASSED -> Transition to PROCESSING
    await prisma.payment.update({
        where: { id: payment.id },
        data: {
            riskScore: riskResult.riskScore,
            riskDecision: riskResult.riskDecision,
            status: PaymentStatus.PROCESSING
        }
    });


     // 9. Call the Processor Adapter
    

    let attemptNumber = 0;
    let paymentSuccess = false;
    let chargeResult : any = null;

    // Retry Loop: runs while under MAX_ATTEMPTS and failures are retryable
    while (attemptNumber < MAX_ATTEMPTS && !paymentSuccess) {
        attemptNumber++;
        // 9.1. Record an INITIATED attempt in database
        const attempt = await prisma.paymentAttempt.create({
            data: {
                paymentId: payment.id,
                attemptNumber,
                status: PaymentAttemptStatus.INITIATED
            }
        });

        // In real systems, on retries you might clear transient mock scenario or call backup gateway
        chargeResult = await processPaymentGatewayCharge({
            paymentId: payment.id,
            merchantId,
            customerId,
            amount: payment.amount,
            currency: payment.currency,
            mockScenario: input.mockProcessorScenario as MockProcessorScenario
        });
        
        // 9.2. Update the attempt audit record with the outcome
        await prisma.paymentAttempt.update({
            where: { id: attempt.id },
            data: {
                status: chargeResult.success ? PaymentAttemptStatus.SUCCESS : PaymentAttemptStatus.FAILURE,
                processorReference: chargeResult.processorReference,
                failureReason: chargeResult.failureReason,
                isRetryable: chargeResult.isRetryable ?? false
            }
        });
        if (chargeResult.success) {
            paymentSuccess = true;
            break;
        }
        // 9.3. Stop immediately if failure is Terminal (e.g. Card Declined)
        if (!chargeResult.isRetryable) {
            break;
        }
        // 9.4. If retryable and still have attempts, wait with brief backoff
        if (attemptNumber < MAX_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, 200)); // 200ms backoff
        }
    }

    // 10. Complete or Fail the payment
    // Ensure we have a processor result; if not, treat as failure
    if (!chargeResult) {
      const error = new Error('Processor did not return a result');
      (error as any).status = 500;
      throw error;
    }
    const finalPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: chargeResult.success
            ? {
                  status: PaymentStatus.COMPLETED,
                  processorReference: chargeResult.processorReference
              }
            : {
                  status: PaymentStatus.FAILED,
                  failureReason: chargeResult.failureReason || "Transaction declined by processor",
              },
        include: {
            attempts: true
        }
    });

    // 11. Record settlement ledger transaction (for successful payments)
    if (chargeResult.success) {
        await recordPaymentSettlement({
            paymentId: finalPayment.id,
            merchantId: finalPayment.merchantId,
            amount: finalPayment.amount,
            currency: finalPayment.currency,
        });
    }
    
    return {
        payment: finalPayment,
        isIdempotentReply: false
    }
    
}

