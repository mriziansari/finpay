import Fastify from "fastify"
import { fastifyJwt } from "@fastify/jwt";
import { prisma } from "./shared/database/prisma.js";


import { authRoutes, merchantRoutes } from "./modules/identity/index.js";
import { customerRoutes } from "./modules/customers/index.js";
import { paymentRoutes } from "./modules/payments/index.js";
import { ledgerRoutes } from "./modules/ledgers/index.js";
import { payoutRoutes } from "./modules/payouts/index.js"
import { webhookRoutes } from "./modules/webhooks/index.js";



export function buildApp(){

    const app = Fastify({
        logger:true
    })
    app.get("/health",async()=>{
        return {
            "status":"up",
            "service":"fin-pay",
            "timestamp":new Date().toISOString()
        }
    })

    app.get("/health/db", async () => {
        await prisma.$queryRaw`SELECT 1`;
        return { 
            status: "up",
            database: "connected"
         };
    } );

    

    app.register(fastifyJwt, {
        secret:process.env.JWT_SECRET || "default_fallback_secret_for_dev_only"
    });
    app.register(authRoutes, {prefix: "/api/v1"});
    app.register(merchantRoutes, {prefix: "/api/v1"});
    app.register(customerRoutes, {prefix: "/api/v1"});
    app.register(paymentRoutes, {prefix: "/api/v1"});
    app.register(ledgerRoutes, { prefix: "/api/v1" });
    app.register(payoutRoutes, { prefix: "/api/v1" });
    app.register(webhookRoutes, { prefix: "/api/v1" });


    return app
}