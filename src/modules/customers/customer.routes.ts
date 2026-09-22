import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from "fastify";
import { authenticate, requireRole, requireMerchantContext } from "../../shared/middlewares/auth.middleware.js";
import { createCustomer, listCustomers, getCustomerById, updateCustomer, deleteCustomer } from "./customer.service.js";
import { UserRole, CustomerStatus } from "@prisma/client";

interface CreateCustomerBody {
    name: string;
    email: string;
    phone?: string | undefined;
   
}

interface UpdateCustomerBody {
    name?: string | undefined;
    email?: string | undefined;
    phone?: string | null | undefined;
    status?: CustomerStatus | undefined;
}

interface CustomerParams {
    id: string;
    
}

export async function customerRoutes(app: FastifyInstance, options: FastifyPluginOptions) {

    // Common gaurds for customer routes
    app.addHook("preHandler", authenticate);
    app.addHook("preHandler", requireRole([UserRole.MERCHANT_ADMIN, UserRole.OPS_ADMIN]));
    app.addHook("preHandler", requireMerchantContext);

   // 1. Create a customer for the authenticated merchant
    app.post(
        "/customers",
        async (request: FastifyRequest<{ Body: CreateCustomerBody }>, reply: FastifyReply) => {
            const { name, email, phone } = request.body || {};
            if (!name || !email) {
                return reply.status(400).send({
                    error: "Bad Request",
                    message: "Name and email are required"
                });
            }
            try {
                const customer = await createCustomer({
                    merchantId: request.merchant!.id,
                    name,
                    email,
                    phone
                });
                return reply.status(201).send({
                    message: "Customer created successfully",
                    customer
                });
            } catch (error: any) {
                const status = error.status || 500;
                return reply.status(status).send({
                    error: status === 409 ? "Conflict" : "Internal Server Error",
                    message: error.message || "An unexpected error occurred"
                });
            }
        }
    );

    // 2. Get all customers belonging to the authenticated merchant
    app.get(
        "/customers",
        async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                const customers = await listCustomers(request.merchant!.id);
                return reply.status(200).send({
                    count: customers.length,
                    customers
                });
            } catch (error: any) {
                const status = error.status || 500;
                return reply.status(status).send({
                    error: "Internal Server Error",
                    message: error.message || "Failed to fetch customers"
                });
            }
        }
    );
    // 3. Get single customer by ID (strictly isolated to the authenticated merchant)
    app.get(
        "/customers/:id",
        async (request: FastifyRequest<{ Params: CustomerParams }>, reply: FastifyReply) => {
            const { id } = request.params;
            try {
                const customer = await getCustomerById(request.merchant!.id, id);
                return reply.status(200).send({
                    customer
                });
            } catch (error: any) {
                const status = error.status || 500;
                return reply.status(status).send({
                    error: status === 404 ? "Not Found" : "Internal Server Error",
                    message: error.message || "Failed to retrieve customer"
                });
            }
        }
    );

    // 4. Update customer by ID (strictly isolated to the authenticated merchant)
    app.patch(
        "/customers/:id",
        async (request: FastifyRequest<{ Params: CustomerParams; Body: UpdateCustomerBody }>, reply: FastifyReply) => {
            const { id } = request.params;
            const { name, email, phone, status } = request.body || {};

            if (name === undefined && email === undefined && phone === undefined && status === undefined) {
                return reply.status(400).send({
                    error: "Bad Request",
                    message: "At least one field (name, email, phone, status) must be provided for update"
                });
            }

            try {
                const customer = await updateCustomer({
                    merchantId: request.merchant!.id,
                    customerId: id,
                    name,
                    email,
                    phone,
                    status
                });
                return reply.status(200).send({
                    message: "Customer updated successfully",
                    customer
                });
            } catch (error: any) {
                const statusCode = error.status || 500;
                let errorTitle = "Internal Server Error";
                if (statusCode === 404) errorTitle = "Not Found";
                else if (statusCode === 409) errorTitle = "Conflict";

                return reply.status(statusCode).send({
                    error: errorTitle,
                    message: error.message || "Failed to update customer"
                });
            }
        }
    );

    // 5. Delete customer by ID (strictly isolated to the authenticated merchant)
    app.delete(
        "/customers/:id",
        async (request: FastifyRequest<{ Params: CustomerParams }>, reply: FastifyReply) => {
            const { id } = request.params;
            try {
                await deleteCustomer(request.merchant!.id, id);
                return reply.status(200).send({
                    message: "Customer deleted successfully"
                });
            } catch (error: any) {
                const status = error.status || 500;
                return reply.status(status).send({
                    error: status === 404 ? "Not Found" : "Internal Server Error",
                    message: error.message || "Failed to delete customer"
                });
            }
        }
    );
}