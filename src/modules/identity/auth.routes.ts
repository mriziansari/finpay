import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from "fastify";
import {loginUser, registerMerchant, type LoginInput, type RegisterMerchantInput} from "./auth.service.js";
import { authenticate } from "../../shared/middlewares/auth.middleware.js";
import { prisma } from "../../shared/database/prisma.js";



export async function authRoutes(app:FastifyInstance,options:FastifyPluginOptions){

    app.post("/auth/register-merchant", async (request:FastifyRequest<{Body: RegisterMerchantInput}>, reply: FastifyReply) =>{

            const { merchantName , adminName , email, password } = request.body || {};

            if (!merchantName || !adminName || !email || !password){

                return reply.status(400).send({
                    message:"Missing required fields",
                    error: "Bad Request"
                });
                
            }

            try{
                const result = await registerMerchant({
                    merchantName,
                    adminName,
                    email,
                    password
                });

                reply.status(201).send({
                    message:"Merchant and admin user registered successfully",
                    data: result
                }); 

            }
            catch (error: any) {
                const statusCode = error.status || 500;
                return reply.status(statusCode).send({
                    error:statusCode == 409? "Conflict" : "Internal Server Error",
                    message: error.message || "An unexpected error occurred"
                })
            }            

            
         })

    // Login Route 
    app.post("/auth/login", async (request: FastifyRequest<{Body: LoginInput}>, reply:FastifyReply) => {

        const { email, password } = request.body || {};

        if (!email || !password){

            return reply.status(400).send({
                message:"Missing required fields",
                error:"Bad Request"
            });

        }
        try {
            const user = await loginUser({ email, password });

            // Generate JWT Token
            const token = app.jwt.sign(                         
                {
                    userId: user.id,
                    merchantId: user.merchantId,
                    email: user.email,
                    role: user.role
                },
                {
                    expiresIn: "1d"
                }   
            );
            return reply.status(200).send( {
                message: "Login Successful",
                token,
                user
                
            });
            
        } catch (error: any) {
            const statusCode = error.status || 500;
            return reply.status(statusCode).send({
                error:statusCode == 401? "Unauthorized" : "Internal Server Error",
                message: error.message || "An unexpected error occurred"
            });
        }
    });

    // Protected /me Route

    app.get("/auth/me", { preHandler: [authenticate]}, async (request: FastifyRequest, reply:FastifyReply) => {

        const { userId } = request.user; // populate by request.jwtVarify()

        // Fetch fresh user data from DB 
        const user = await prisma.user.findUnique({
            where:{
                id: userId
            },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                merchantId: true,
                createdAt: true,
                merchant: {
                    select: {
                        id: true,
                        name: true,
                        status: true
                    }
                }
            }
        });

        if (!user){
            return reply.status(404).send({
                message: "User not found",
                error: "Not Found"
            });
        }

        return reply.status(200).send({
            message:"User profile fetched successfully",
            user
        });
    });

    
        }