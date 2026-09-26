
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

const isLedger = process.argv.some((arg) => arg.includes("ledger"));

export default defineConfig({
  schema: isLedger ? "services/ledger-service/prisma/schema.prisma" : "prisma/schema.prisma",
  migrations: {
    path: isLedger ? "services/ledger-service/prisma/migrations" : "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: isLedger ? env("LEDGER_DATABASE_URL") : env("DATABASE_URL"),
  },
});

