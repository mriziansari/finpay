import { ledgerDb } from "./db.js";
import { LedgerAccountType, LedgerEntryDirection, Prisma } from "@prisma/ledger-client";
const { Decimal } = Prisma;

export const ACCOUNT_NAMES = {
  MERCHANT_SETTLEMENT: "MERCHANT_SETTLEMENT",
  PLATFORM_REVENUE: "PLATFORM_REVENUE",
  GATEWAY_RECEIVABLE: "GATEWAY_RECEIVABLE",
  PLATFORM_BANK_CASH: "PLATFORM_BANK_CASH",
} as const;

export async function getOrCreateAccount(
  tx: Prisma.TransactionClient,
  params: {
    merchantId: string | null;
    name: string;
    type: LedgerAccountType;
    currency: string;
  }
) {
  const { merchantId, name, currency, type } = params;
  let account = await tx.ledgerAccount.findFirst({
    where: { merchantId, name, currency },
  });

  if (!account) {
    account = await tx.ledgerAccount.create({
      data: { merchantId, name, type, currency },
    });
  }
  return account;
}

/**
 * 1. Payment Settlement:
 *    DEBIT  GATEWAY_RECEIVABLE (Asset increases)
 *    CREDIT MERCHANT_SETTLEMENT (Liability increases, what we owe merchant)
 *    CREDIT PLATFORM_REVENUE (Revenue increases, 3% fee)
 */
export async function recordPaymentSettlement(params: {
  paymentId: string;
  merchantId: string;
  amount: string;
  currency: string;
}) {
  const { paymentId, merchantId, currency } = params;
  const amount = new Decimal(params.amount);

  return ledgerDb.$transaction(async (tx) => {
    const existing = await tx.ledgerTransaction.findUnique({
      where: {
        referenceType_referenceId: {
          referenceType: "PAYMENT",
          referenceId: paymentId,
        },
      },
    });
    if (existing) return existing;

    const takeRate = new Decimal("0.03");
    const platformFee = amount.mul(takeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const merchantNet = amount.sub(platformFee);

    const gatewayReceivable = await getOrCreateAccount(tx, {
      merchantId: null,
      name: ACCOUNT_NAMES.GATEWAY_RECEIVABLE,
      type: LedgerAccountType.ASSET,
      currency,
    });
    const merchantSettlement = await getOrCreateAccount(tx, {
      merchantId,
      name: ACCOUNT_NAMES.MERCHANT_SETTLEMENT,
      type: LedgerAccountType.LIABILITY,
      currency,
    });
    const platformRevenue = await getOrCreateAccount(tx, {
      merchantId: null,
      name: ACCOUNT_NAMES.PLATFORM_REVENUE,
      type: LedgerAccountType.REVENUE,
      currency,
    });

    const totalDebits = amount;
    const totalCredits = merchantNet.add(platformFee);
    if (!totalDebits.equals(totalCredits)) {
      throw new Error(`Double-entry unbalance: Debits (${totalDebits}) != Credits (${totalCredits})`);
    }

    return tx.ledgerTransaction.create({
      data: {
        merchantId,
        referenceType: "PAYMENT",
        referenceId: paymentId,
        description: `Settlement for Payment ${paymentId}`,
        entries: {
          create: [
            { accountId: gatewayReceivable.id, direction: LedgerEntryDirection.DEBIT, amount: totalDebits },
            { accountId: merchantSettlement.id, direction: LedgerEntryDirection.CREDIT, amount: merchantNet },
            { accountId: platformRevenue.id, direction: LedgerEntryDirection.CREDIT, amount: platformFee },
          ],
        },
      },
    });
  });
}

/**
 * 2. Refund Reversal:
 *    DEBIT  MERCHANT_SETTLEMENT (Takes back merchant net)
 *    DEBIT  PLATFORM_REVENUE    (Takes back platform fee)
 *    CREDIT GATEWAY_RECEIVABLE  (Returns money to customer)
 */
export async function recordRefundSettlement(params: {
  refundId: string;
  paymentId: string;
  merchantId: string;
  amount: string;
  currency: string;
}) {
  const { refundId, paymentId, merchantId, currency } = params;
  const amount = new Decimal(params.amount);

  return ledgerDb.$transaction(async (tx) => {
    const existing = await tx.ledgerTransaction.findUnique({
      where: {
        referenceType_referenceId: {
          referenceType: "REFUND",
          referenceId: refundId,
        },
      },
    });
    if (existing) return existing;

    const takeRate = new Decimal("0.03");
    const platformFeeReversal = amount.mul(takeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const merchantNetReversal = amount.sub(platformFeeReversal);

    const gatewayReceivable = await getOrCreateAccount(tx, {
      merchantId: null,
      name: ACCOUNT_NAMES.GATEWAY_RECEIVABLE,
      type: LedgerAccountType.ASSET,
      currency,
    });
    const merchantSettlement = await getOrCreateAccount(tx, {
      merchantId,
      name: ACCOUNT_NAMES.MERCHANT_SETTLEMENT,
      type: LedgerAccountType.LIABILITY,
      currency,
    });
    const platformRevenue = await getOrCreateAccount(tx, {
      merchantId: null,
      name: ACCOUNT_NAMES.PLATFORM_REVENUE,
      type: LedgerAccountType.REVENUE,
      currency,
    });

    return tx.ledgerTransaction.create({
      data: {
        merchantId,
        referenceType: "REFUND",
        referenceId: refundId,
        description: `Refund reversal for Payment ${paymentId}`,
        entries: {
          create: [
            { accountId: merchantSettlement.id, direction: LedgerEntryDirection.DEBIT, amount: merchantNetReversal },
            { accountId: platformRevenue.id, direction: LedgerEntryDirection.DEBIT, amount: platformFeeReversal },
            { accountId: gatewayReceivable.id, direction: LedgerEntryDirection.CREDIT, amount },
          ],
        },
      },
    });
  });
}

/**
 * 3. Live Available Merchant Balance:
 *    Calculated from LIABILITY account (MERCHANT_SETTLEMENT): CREDITS - DEBITS
 */
export async function getMerchantBalance(merchantId: string, currency: string = "USD") {
  const settlementAccount = await ledgerDb.ledgerAccount.findFirst({
    where: { merchantId, name: ACCOUNT_NAMES.MERCHANT_SETTLEMENT, currency },
  });

  if (!settlementAccount) {
    return {
      currency,
      settlementBalance: "0.00",
      totalCredited: "0.00",
      totalDebited: "0.00",
    };
  }

  const entries = await ledgerDb.ledgerEntry.findMany({
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

/**
 * 4. Payout Settlement:
 *    DEBIT  MERCHANT_SETTLEMENT (Decreases what we owe merchant)
 *    CREDIT PLATFORM_BANK_CASH  (Decreases platform cash reserves)
 */
export async function recordPayoutSettlement(params: {
  payoutId: string;
  merchantId: string;
  amount: string;
  currency: string;
}) {
  const { payoutId, merchantId, currency } = params;
  const amount = new Decimal(params.amount);

  return ledgerDb.$transaction(async (tx) => {
    const existing = await tx.ledgerTransaction.findUnique({
      where: {
        referenceType_referenceId: {
          referenceType: "PAYOUT",
          referenceId: payoutId,
        },
      },
    });
    if (existing) return existing;

    const merchantSettlement = await getOrCreateAccount(tx, {
      merchantId,
      name: ACCOUNT_NAMES.MERCHANT_SETTLEMENT,
      type: LedgerAccountType.LIABILITY,
      currency,
    });
    const bankCash = await getOrCreateAccount(tx, {
      merchantId: null,
      name: ACCOUNT_NAMES.PLATFORM_BANK_CASH,
      type: LedgerAccountType.ASSET,
      currency,
    });

    return tx.ledgerTransaction.create({
      data: {
        merchantId,
        referenceType: "PAYOUT",
        referenceId: payoutId,
        description: `Payout withdrawal for Merchant ${merchantId}`,
        entries: {
          create: [
            { accountId: merchantSettlement.id, direction: LedgerEntryDirection.DEBIT, amount },
            { accountId: bankCash.id, direction: LedgerEntryDirection.CREDIT, amount },
          ],
        },
      },
    });
  });
}
