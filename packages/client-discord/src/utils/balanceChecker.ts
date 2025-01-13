import { Client, TextChannel } from "discord.js";
import { elizaLogger, IAgentRuntime } from "@elizaos/core";
import { TokenProvider } from "../../../plugin-solana/src/providers/token";
import { getWalletKey } from "../../../plugin-solana/src/keypairUtils";
import { Connection } from "@solana/web3.js";

class BalanceChecker {
    private client: Client;
    private runtime: IAgentRuntime;
    private channelId: string;

    constructor(client: Client, runtime: IAgentRuntime, channelId: string) {
        this.client = client;
        this.runtime = runtime;
        this.channelId = channelId;
    }

    async start() {
        const checkBalanceLoop = async () => {
            const lastCheck = await this.runtime.cacheManager.get<{
                timestamp: number;
            }>("discord/" + this.channelId + "/lastBalanceCheck");

            const lastCheckTimestamp = lastCheck?.timestamp ?? 0;
            // Assuming a fixed interval of 5 minutes for balance checks
            const intervalMinutes = 5;
            const delay = intervalMinutes * 60 * 1000;

            if (Date.now() > lastCheckTimestamp + delay) {
                await this.checkAndPostBalance();
                await this.runtime.cacheManager.set(
                    "discord/" + this.channelId + "/lastBalanceCheck",
                    { timestamp: Date.now() }
                );
            }

            setTimeout(() => {
                checkBalanceLoop(); // Set up next iteration
            }, delay);

            console.log(
                `Next balance check scheduled in ${intervalMinutes} minutes`
            );
        };

        // Start the loop immediately
        checkBalanceLoop();
    }

    private async checkAndPostBalance() {
        try {
            const { publicKey } = await getWalletKey(this.runtime, false);
            const walletAddress = publicKey.toBase58();

            const connection = new Connection(
                this.runtime.getSetting("RPC_URL") ||
                    "https://api.mainnet-beta.solana.com"
            );
            const tokenProvider = new TokenProvider(
                null,
                null,
                this.runtime.cacheManager
            );

            const balances = await tokenProvider.getTokensInWallet(
                this.runtime
            );

            const balanceMessage = balances
                .map((token) => {
                    return `**${token.name} (${token.symbol})**: ${token.uiAmount} tokens ($${token.valueUsd})`;
                })
                .join("\n");

            const message = `Current balances for wallet ${walletAddress}:\n${balanceMessage}`;

            const channel = this.client.channels.cache.get(
                this.channelId
            ) as TextChannel;
            if (channel) {
                await channel.send(message);
                console.log(
                    `Balance posted to Discord channel: ${this.channelId}`
                );
            } else {
                console.warn(
                    `Channel with ID ${this.channelId} not found in cache.`
                );
            }
        } catch (error) {
            console.error("Error checking wallet balance:", error);
        }
    }
}

export { BalanceChecker };
