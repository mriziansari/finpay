import { prisma } from "../../shared/database/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import { LedgerAccountType, LedgerEntryDirection, type Prisma } from "@prisma/client";

// Standard Account Names
export const ACCOUNT_NAMES = {
  // Merchant-specific liability account: what we owe the merchant
    MERCHANT_SETTLEMENT: "MERCHANT_SETTLEMENT",
  // Platform revenue account
    PLATFORM_REVENUE: "PLATFORM_REVENUE",
  // Gateway receivable account
    GATEWAY_RECEIVABLE: "GATEWAY_RECEIVABLE",
 // Platform Bank Cash account: platform's actual cash reserves
    PLATFORM_BANK_CASH: "PLATFORM_BANK_CASH",
} as const;

// Helper to get or lazily create an account
export async function getOrCreateAccount(
    tx: Prisma.TransactionClient,
    params: {
        merchantId: string | null;
        name: string;
        type: LedgerAccountType;
        currency: string;
    }
){
    const {merchantId, name, currency, type} = params;
    let account = await tx.ledgerAccount.findFirst({
        where:{
            merchantId,
            name,
            currency,
        }
    });
    if (!account){
        account = await tx.ledgerAccount.create({
            data:{
                merchantId,
                name,
                type,
                currency
            }
        });
    }
    return account;
}

export interface RecordPaymentSettlementInput {
  paymentId: string;
  merchantId: string;
  amount: Decimal;
  currency: string;
}


/**
 * Create a full transaction with all entries.
 * Ensures double-entry (total debit === total credit) for every transaction.
 */

export async function recordPaymentSettlement(
    input: RecordPaymentSettlementInput,
    externalTx?: Prisma.TransactionClient
){
    const {paymentId, merchantId, amount, currency} = input;

    const executePosting = async (tx: Prisma.TransactionClient) => {
    // 1. Check idempotency: Return if already posted for this payment
    const existing = await tx.ledgerTransaction.findUnique({
      where: {
        referenceType_referenceId: {
          referenceType: "PAYMENT",
          referenceId: paymentId,
        },
      },
      include: { entries: true },
    });
    if (existing) {
      return existing;
    }

    // 2. Fee Calculation 
    // 3% fee, min 0.01 if amount > 0
    const takeRate = new Decimal("0.03");
    const platformFee = amount.mul(takeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const merchantNet = amount.sub(platformFee);

    // 3. Resolve accounts
    const gatewayReceivableAccount = await getOrCreateAccount(tx, {
      merchantId: null, // Platform level
      name: ACCOUNT_NAMES.GATEWAY_RECEIVABLE,
      type: LedgerAccountType.ASSET,
      currency,
    });
    const merchantSettlementAccount = await getOrCreateAccount(tx, {
      merchantId: merchantId,
      name: ACCOUNT_NAMES.MERCHANT_SETTLEMENT,
      type: LedgerAccountType.LIABILITY,
      currency,
    });
    const platformRevenueAccount = await getOrCreateAccount(tx, {
      merchantId: null, // Platform level
      name: ACCOUNT_NAMES.PLATFORM_REVENUE,
      type: LedgerAccountType.REVENUE,
      currency,
    });

    // 4. Validate strict double-entry balance: Debits === Credits
    const totalDebits = amount;
    const totalCredits = merchantNet.add(platformFee);
    if (!totalDebits.equals(totalCredits)) {
      throw new Error(
        `Ledger unbalance error: Debits (${totalDebits}) does not equal Credits (${totalCredits})`
      );
    }
  // 5. Create Transaction and Entries atomically
    const ledgerTx = await tx.ledgerTransaction.create({
      data: {
        merchantId,
        referenceType: "PAYMENT",
        referenceId: paymentId,
        description: `Settlement for Payment ${paymentId}`,
        entries: {
          create: [
            {
              accountId: gatewayReceivableAccount.id,
              direction: LedgerEntryDirection.DEBIT,
              amount: totalDebits,
            },
            {
              accountId: merchantSettlementAccount.id,
              direction: LedgerEntryDirection.CREDIT,
              amount: merchantNet,
            },
            {
              accountId: platformRevenueAccount.id,
              direction: LedgerEntryDirection.CREDIT,
              amount: platformFee,
            },
          ],
        },
      },
      include: { entries: true },
    });
    return ledgerTx;
  };
  if (externalTx) {
    return executePosting(externalTx);
  } else {
    return prisma.$transaction(executePosting);
  }
}

/**
 * Calculates current available merchant balance from the ledger.
 * For a LIABILITY account (MERCHANT_SETTLEMENT), normal balance = CREDITS - DEBITS.
 */
export async function getMerchantBalance(merchantId: string, currency: string = "USD") {
  const settlementAccount = await prisma.ledgerAccount.findFirst({
    where: {
      merchantId,
      name: ACCOUNT_NAMES.MERCHANT_SETTLEMENT,
      currency,
    },
  });
  if (!settlementAccount) {
    return {
      currency,
      settlementBalance: "0.00",
      totalCredited: "0.00",
      totalDebited: "0.00",
    };
  }
  const entries = await prisma.ledgerEntry.findMany({
    where: { accountId: settlementAccount.id },
  });
  let totalCredited = new Decimal(0);
  let totalDebited = new Decimal(0);
  for (const entry of entries) {
    if (entry.direction === LedgerEntryDirection.CREDIT) {
      totalCredited = totalCredited.add(entry.amount);
    } else {
      totalDebited = totalDebited.add(entry.amount);
    }
  }
  const settlementBalance = totalCredited.sub(totalDebited);
  return {
    currency,
    settlementBalance: settlementBalance.toFixed(2),
    totalCredited: totalCredited.toFixed(2),
    totalDebited: totalDebited.toFixed(2),
  };
}

export interface RecordPayoutSettlementInput {
  payoutId: string;
  merchantId: string;
  amount: Decimal;
  currency: string;
}

/**
 * Records double-entry entries for a merchant payout/withdrawal:
 *  DEBIT  MERCHANT_SETTLEMENT (Liability decreases)
 *  CREDIT PLATFORM_BANK_CASH  (Asset decreases)
 */

export async function recordPayoutSettlement(
  input: RecordPayoutSettlementInput,
  externalTx?: Prisma.TransactionClient
) {
  const { payoutId, merchantId, amount, currency } = input;

  const executePosting = async (tx: Prisma.TransactionClient) => {

        // 1. Idempotency Check: Do not allow posting twice for the same payoutId.
        const existing = await tx.ledgerTransaction.findUnique({
            where: {
                referenceType_referenceId: {
                    referenceType: "PAYOUT",
                    referenceId: payoutId,
                },
            },
            include: { entries: true },
        });

        if (existing) {
            return existing;
        }

        // 2. Resolve accounts
        const merchantSettlementAccount = await getOrCreateAccount(tx, {
            merchantId: merchantId,
            name: ACCOUNT_NAMES.MERCHANT_SETTLEMENT,
            type: LedgerAccountType.LIABILITY,
            currency,
        });
        const bankCashAccount = await getOrCreateAccount(tx, {
            merchantId: null, // Platform level
            name: ACCOUNT_NAMES.PLATFORM_BANK_CASH,
            type: LedgerAccountType.ASSET,
            currency,
        });
        const ledgerTx = await tx.ledgerTransaction.create({

            data:{
                merchantId,
                referenceType: "PAYOUT",
                referenceId: payoutId,
                description: `Payout withdrawal for Merchant ${merchantId}`,
                entries: {
                    create: [
                        {
                            accountId: merchantSettlementAccount.id,
                            direction: LedgerEntryDirection.DEBIT, // Decreases what we owe merchant
                            amount: amount,
                        },
                        {
                        accountId: bankCashAccount.id,
                        direction: LedgerEntryDirection.CREDIT, // Decreases platform cash
                        amount: amount,
                    },
                ],
                },
            },
            include: { entries: true }, // Return the created entries for completeness
        });

        return ledgerTx;
  };
  if (externalTx) {
    return executePosting(externalTx);
  } else {
    return prisma.$transaction(executePosting);
  }
}

export interface RecordRefundSettlementInput {
  refundId: string;
  paymentId: string;
  merchantId: string;
  amount: Decimal;
  currency: string;
}
/**
 * Reverses ledger balances for a refund:
 *  DEBIT  MERCHANT_SETTLEMENT (Takes back merchant net)
 *  DEBIT  PLATFORM_REVENUE    (Takes back platform fee)
 *  CREDIT GATEWAY_RECEIVABLE  (Returns money to customer)
 */
    
export async function recordRefundSettlement(input: RecordRefundSettlementInput, externalTx?:Prisma.TransactionClient) {
    const {refundId, paymentId, merchantId, amount, currency} = input;
    
    const executePosting = async (tx: Prisma.TransactionClient) => {

        // 1. Idempotency: Check if this refund settlement has already been posted
        const existing = await tx.ledgerTransaction.findUnique({
            where: {
                referenceType_referenceId: {
                    referenceType: "REFUND",
                    referenceId: refundId
                }
            }
        });
        if (existing) {
            return existing;
        }

        // 2. Calculated the reversed fee (3% standard take-rate)
        const takeRate = new Decimal("0.03");
        const platformFeeReversal = amount.mul(takeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const merchantNetReversal = amount.sub(platformFeeReversal);

        // 3. Resolve accounts
    const gatewayReceivableAccount = await getOrCreateAccount(tx, {
      merchantId: null,
      name: ACCOUNT_NAMES.GATEWAY_RECEIVABLE,
      type: LedgerAccountType.ASSET,
      currency,
    });
    const merchantSettlementAccount = await getOrCreateAccount(tx, {
      merchantId,
      name: ACCOUNT_NAMES.MERCHANT_SETTLEMENT,
      type: LedgerAccountType.LIABILITY,
      currency,
    });
    const platformRevenueAccount = await getOrCreateAccount(tx, {
      merchantId: null,
      name: ACCOUNT_NAMES.PLATFORM_REVENUE,
      type: LedgerAccountType.REVENUE,
      currency,
    });
    // 4. Validate double-entry equality
    const totalDebits = merchantNetReversal.add(platformFeeReversal);
    const totalCredits = amount;
    if (!totalDebits.equals(totalCredits)) {
      throw new Error(
        `Ledger unbalance error: Debits (${totalDebits}) does not equal Credits (${totalCredits})`
      );
    }
    // 5. Post atomic transaction with reverse directions
    const ledgerTx = await tx.ledgerTransaction.create({
      data: {
        merchantId,
        referenceType: "REFUND",
        referenceId: refundId,
        description: `Refund reversal for Payment ${paymentId}`,
        entries: {
          create: [
            {
              accountId: merchantSettlementAccount.id,
              direction: LedgerEntryDirection.DEBIT, // Decreases merchant settlement
              amount: merchantNetReversal,
            },
            {
              accountId: platformRevenueAccount.id,
              direction: LedgerEntryDirection.DEBIT, // Decreases platform revenue
              amount: platformFeeReversal,
            },
            {
              accountId: gatewayReceivableAccount.id,
              direction: LedgerEntryDirection.CREDIT, // Money leaving gateway to customer
              amount: totalCredits,
            },
          ],
        },
      },
      include: { entries: true },
    });
    return ledgerTx;
  };
  if (externalTx) {
    return executePosting(externalTx);
  } else {
    return prisma.$transaction(executePosting);
  }
}

    


