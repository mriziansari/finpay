import { Decimal } from "@prisma/client/runtime/library";

const LEDGER_SERVICE_URL = process.env.LEDGER_SERVICE_URL || "http://localhost:3002";

export interface MerchantBalanceResponse {
  currency: string;
  settlementBalance: string;
  totalCredited: string;
  totalDebited: string;
}

export const ledgerClient = {
  async getMerchantBalance(merchantId: string, currency: string = "USD"): Promise<Decimal> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    try {
      const response = await fetch(
        `${LEDGER_SERVICE_URL}/internal/merchants/${merchantId}/balance?currency=${currency}`,
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ledger service returned HTTP ${response.status}`);
      }

      const json = (await response.json()) as { data: MerchantBalanceResponse };
      return new Decimal(json.data.settlementBalance);
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("[LedgerClient] Failed to query Ledger Service:", err.message);
      throw new Error("Ledger Service unavailable. Please try again later.");
    }
  },
};
