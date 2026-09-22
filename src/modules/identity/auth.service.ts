import { prisma } from "../../shared/database/prisma.js";
import { hashPassword } from "../../shared/utils/hash.js";
import { UserRole } from "@prisma/client";
import { comparePassword } from "../../shared/utils/hash.js";

export interface RegisterMerchantInput {
    merchantName:string;
    adminName:string;
    email:string;
    password:string;
}

export interface LoginInput {
    email: string;
    password: string
}

export async function registerMerchant(input:RegisterMerchantInput){
    const { merchantName , adminName , email , password } = input;

    // 1- check if email already exist
    const userExists = await prisma.user.findUnique({
        where:{
            email
        }
    })

    if(userExists) {
        const error = new Error("User already exists");
        (error as any).status = 409;
        throw error;
    }

    // 2 - Hash password
    const passwordHash = await hashPassword(password);

    // 3- Create merchant and admin user inside a transaction

    return prisma.$transaction(async(tx) => {
        const merchant  = await tx.merchant.create({
            data:{
                name:merchantName,
                status: "ACTIVE"
            }
        });

        const user = await tx.user.create({
            data: {
                merchantId: merchant.id,
                name:adminName,
                email,
                passwordHash,
                role:UserRole.MERCHANT_ADMIN
                
            },
            select: {
                id:true,
                email:true,
                name:true,
                role:true,
                merchant:true,
                createdAt:true
            }
        });
        return {merchant,user};
    });

    

    
}

export async function loginUser(input: LoginInput){
    const {email, password } = input;

    // 1 - Find user with merchant details. 
    const user = await prisma.user.findUnique({
        where: { email },
        include: {merchant: true},
    });
    
    if(!user){
        const error = new Error("Invalid email or password");
        (error as any).status = 401;
        throw error;
    }

  //  2 - Compare Password

  const isPasswordValid = await comparePassword(password, user.passwordHash)

  if (!isPasswordValid){
    const error = new Error("Invalid email or password");
    (error as any).status = 401;
    throw error;
  }

  // 3- Check Merchant Status (belong to one)

  if (user.merchant && user.merchant.status != "ACTIVE"){
    const error = new Error("Merchant account is not active");
    (error as any).status = 403;
    throw error;
  }

  // Return user info ready for token genration 
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    merchantId: user.merchantId,
     merchantName: user.merchant?.name ?? null
  };
}