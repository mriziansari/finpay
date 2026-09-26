import { PrismaClient } from "@prisma/ledger-client";

export const ledgerDb = new PrismaClient({
  datasources: {
    db: {
      url: process.env.LEDGER_DATABASE_URL,
    },
  },
});
