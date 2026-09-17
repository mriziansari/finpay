import { buildApp } from "./app.js";
import "dotenv/config";

const app = buildApp();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const start = async () => {
    try {
        await app.listen({
            port: PORT,
            host:HOST
        })
    } catch (error) {
        console.log(error)
        process.exit(1)
    }
}

// Shutdown gracefully
const closeGracefully = async(signal: string)=>{
    app.log.info(`Received ${signal}, shutting down gracefully`);
    try{
        await app.close();
        process.exit(0);
    }catch(error){
        app.log.error(error);
        process.exit(1);
    }
};
process.on("SIGINT",()=> closeGracefully("SIGINT"))
process.on("SIGTERM",()=> closeGracefully("SIGTERM"))


start()