import "@fastify/jwt";
import type { Merchant } from "@prisma/client";

declare module "fastify" {
    interface FastifyRequest{
        merchant?: Merchant;
    }
    
}