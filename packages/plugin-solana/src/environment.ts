import { IAgentRuntime } from "@elizaos/core";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

export const solanaEnvSchema = z
    .object({
        WALLET_SECRET_SALT: z.string().optional(),
        MAIN_WALLET_ADDRESS: z.string().min(1, "Main wallet address is required"), // Add this line
    })
    .and(
        z.union([
            z.object({
                WALLET_SECRET_KEY: z
                    .string()
                    .min(1, "Wallet secret key is required"),
                WALLET_PUBLIC_KEY: z
                    .string()
                    .min(1, "Wallet public key is required"),
            }),
            z.object({
                WALLET_SECRET_SALT: z
                    .string()
                    .min(1, "Wallet secret salt is required"),
            }),
        ])
    )
    .and(
        z.object({
            SOL_ADDRESS: z.string().min(1, "SOL address is required"),
            SLIPPAGE: z.string().min(1, "Slippage is required"),
            RPC_URL: z.string().min(1, "RPC URL is required"),
            HELIUS_API_KEY: z.string().min(1, "Helius API key is required"),
            BIRDEYE_API_KEY: z.string().min(1, "Birdeye API key is required"),
        })
    );


// Add these lines after your schema definition
export const MAIN_WALLET_ADDRESS = process.env.MAIN_WALLET_ADDRESS || "";

export type SolanaConfig = z.infer<typeof solanaEnvSchema>;

export async function validateSolanaConfig(
    runtime: IAgentRuntime
): Promise<SolanaConfig> {
    try {
        const config = {
            MAIN_WALLET_ADDRESS:
                runtime.getSetting("MAIN_WALLET_ADDRESS") ||
                process.env.MAIN_WALLET_ADDRESS,
            WALLET_SECRET_SALT:
                runtime.getSetting("WALLET_SECRET_SALT") ||
                process.env.WALLET_SECRET_SALT,
            WALLET_SECRET_KEY:
                runtime.getSetting("WALLET_SECRET_KEY") ||
                process.env.WALLET_SECRET_KEY,
            WALLET_PUBLIC_KEY:
                runtime.getSetting("SOLANA_PUBLIC_KEY") ||
                runtime.getSetting("WALLET_PUBLIC_KEY") ||
                process.env.WALLET_PUBLIC_KEY,
            SOL_ADDRESS:
                runtime.getSetting("SOL_ADDRESS") || process.env.SOL_ADDRESS,
            SLIPPAGE: runtime.getSetting("SLIPPAGE") || process.env.SLIPPAGE,
            RPC_URL: runtime.getSetting("RPC_URL") || process.env.RPC_URL,
            HELIUS_API_KEY:
                runtime.getSetting("HELIUS_API_KEY") ||
                process.env.HELIUS_API_KEY,
            BIRDEYE_API_KEY:
                runtime.getSetting("BIRDEYE_API_KEY") ||
                process.env.BIRDEYE_API_KEY,
        };

        // Add wallet address validation
        try {
            if (config.MAIN_WALLET_ADDRESS) {
                new PublicKey(config.MAIN_WALLET_ADDRESS);
            } else {
                console.error("MAIN_WALLET_ADDRESS is not configured");
            }
        } catch (error) {
            console.error("Invalid MAIN_WALLET_ADDRESS format:", error);
        }

        return solanaEnvSchema.parse(config);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.errors
                .map((err) => `${err.path.join(".")}: ${err.message}`)
                .join("\n");
            throw new Error(
                `Solana configuration validation failed:\n${errorMessages}`
            );
        }
        throw error;
    }
}
