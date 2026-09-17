import Fastify from "fastify"
import {prisma} from "./lib/prisma.js";
import { authRoutes } from "./routes/auth.routes.js";
import { merchantRoutes } from "./routes/merchant.routes.js";
import { fastifyJwt } from "@fastify/jwt";
import {customerRoutes} from "./routes/customer.routes.js";
import { paymentRoutes } from "./routes/payment.routes.js";
import { ledgerRoutes } from "./routes/ledger.routes.js";
import { payoutRoutes } from "./routes/payout.routes.js";


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

    app.register(authRoutes, {prefix: "/api/v1"});

    app.register(fastifyJwt, {
        secret:process.env.JWT_SECRET || "default_fallback_secret_for_dev_only"
    });
    app.register(merchantRoutes, {prefix: "/api/v1"});
    
    app.register(customerRoutes, {prefix: "/api/v1"});

    app.register(paymentRoutes, {prefix: "/api/v1"});
    
    app.register(ledgerRoutes, { prefix: "/api/v1" });

    app.register(payoutRoutes, { prefix: "/api/v1" });

    return app
}