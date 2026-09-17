import "@fastify/jwt";
import { UserRole } from "@prisma/client";

declare module "@fastify/jwt"{
    interface FastifyJWT {
        payload: {
            userId: string;
            merchantId: string | null;
            role: UserRole;
            email: string
        };

        user: {
            userId: string;
            merchantId: string | null;
            role: UserRole;
            email: string
        }
    }
}