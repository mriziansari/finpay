import { prisma } from "../../shared/database/prisma.js";
import  { CustomerStatus } from "@prisma/client";


export interface CreateCustomerInput {
    merchantId:string;
    name:string;
    email:string;
    phone?:string | undefined;

}

export async function createCustomer(input: CreateCustomerInput) {
    const { merchantId, name, email, phone } = input;
    // Check if customer email already exists for this specific merchant
    const existing = await prisma.customer.findUnique({
        where: {
            merchantId_email: {
                merchantId,
                email
            }
        }
    });
    if (existing) {
        const error = new Error("Customer with this email already exists for your merchant account");
        (error as any).status = 409;
        throw error;
    }
    return prisma.customer.create({
        data: {
            merchantId,
            name,
            email,
            phone: phone ?? null,
            status: CustomerStatus.ACTIVE
        }
    });
}

// Get all customers for a specific merchant
export async function listCustomers( merchantId: string) {
    return prisma.customer.findMany({
        where: {
            merchantId
        }
    });
}

// Get a single customer by ID (only for the same merchant)
export async function getCustomerById(merchantId: string, customerId: string) {
    const customer = await prisma.customer.findFirst({
        where: {
            id: customerId,
            merchantId
        }
    });
    if (!customer) {
        const error = new Error("Customer not found");
        (error as any).status = 404;
        throw error;
    }
    return customer;
}

export interface UpdateCustomerInput {
    merchantId: string;
    customerId: string;
    name?: string | undefined;
    email?: string | undefined;
    phone?: string | null | undefined;
    status?: CustomerStatus | undefined;
}

// Update an existing customer (isolated to merchant)
export async function updateCustomer(input: UpdateCustomerInput) {
    const { merchantId, customerId, name, email, phone, status } = input;

    // Verify existence & ownership
    await getCustomerById(merchantId, customerId);

    // If email is changing, check uniqueness for this merchant
    if (email) {
        const conflict = await prisma.customer.findFirst({
            where: {
                merchantId,
                email,
                NOT: { id: customerId }
            }
        });
        if (conflict) {
            const error = new Error("Customer with this email already exists for your merchant account");
            (error as any).status = 409;
            throw error;
        }
    }

    return prisma.customer.update({
        where: { id: customerId },
        data: {
            ...(name !== undefined ? { name } : {}),
            ...(email !== undefined ? { email } : {}),
            ...(phone !== undefined ? { phone } : {}),
            ...(status !== undefined ? { status } : {})
        }
    });
}

// Delete a customer (isolated to merchant)
export async function deleteCustomer(merchantId: string, customerId: string) {
    // Verify existence & ownership
    await getCustomerById(merchantId, customerId);

    return prisma.customer.delete({
        where: { id: customerId }
    });
}

/**
 * Validates that a customer exists, belongs to the merchant, and is ACTIVE.
 * Used by the Payments module to verify customer eligibility.
 */
export async function validateCustomerForPayment(merchantId: string, customerId: string) {
    const customer = await prisma.customer.findFirst({
        where: {
            id: customerId,
            merchantId,
        },
    });
    if (!customer) {
        const error = new Error("Customer not found");
        (error as any).status = 404;
        throw error;
    }
    if (customer.status === CustomerStatus.INACTIVE) {
        const error = new Error("Customer is inactive");
        (error as any).status = 400;
        throw error;
    }
    return customer;
}