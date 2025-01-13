import {
    ActionExample,
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    generateObject,
    generateText,
    composeContext,
    type Action,
} from "@elizaos/core";
import { TokenProvider } from "../providers/token.ts";
import { WalletProvider } from "../providers/wallet.ts";
import { Connection, PublicKey } from "@solana/web3.js";
import { getWalletKey } from "../keypairUtils.ts";

export const findNewlyListedTokens: Action = {
    name: "FIND_NEWLY_LISTED_TOKENS",
    similes: ["FIND_NEW_TOKENS", "NEWLY_LISTED_TOKENS"],
    description: "Search for tokens that have been newly listed on the Solana blockchain.",
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        const keywords = ["new", "list", "find", "launch", "token", "pump"];
        const messageText = (
            message.content as { text: string }
        ).text.toLowerCase();

        // If any keyword is found in the message, assume it's valid for this action
        const isValid = keywords.some((keyword) =>
            messageText.includes(keyword)
        );

        // Optionally, check if the user has permission or if there are limits on how often this can be done
        /*const user = await runtime.databaseAdapter.getAccountById(
            message.userId
        );
        if (!user) {
            console.warn(
                `User not found for message.userId: ${message.userId}`
            );
            return false;
        }*/

        // Example: Check if the user hasn't exceeded their gem hunt requests for the day
        /*const lastGemHunt = await runtime.databaseAdapter.getUserLastActionTime(
            message.userId,
            "FIND_NEWLY_LISTED_TOKENS"
        );
        if (lastGemHunt && Date.now() - lastGemHunt < 24 * 60 * 60 * 1000) {
            // 24 hours in milliseconds
            console.log("User has already hunted gems today");
            return false; // User has already performed this action today
        }*/

        return isValid;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        try {
            const { publicKey } = await getWalletKey(runtime, false);
            const connection = new Connection(
                runtime.getSetting("RPC_URL") ||
                    "https://api.mainnet-beta.solana.com"
            );
            const walletProvider = WalletProvider.getInstance(
                connection,
                publicKey
            );
            const tokenProvider = new TokenProvider(
                null,
                walletProvider,
                runtime.cacheManager
            ); // Ensure walletProvider is initialized correctly
            const criteria = {
                volumeThreshold: 20000, // Example threshold, adjust based on need
                holderThreshold: 100, // Example threshold for new holders in 24h
                liquidityThreshold: 250000, // Example liquidity threshold
                priceSurgeThreshold: 50, // Example for price surge in percent
                maxMarketCap: 50000000, // Example max market cap in USD
            };
            const gems = await tokenProvider.findGemTokens(runtime, criteria);

            const results = await Promise.all(
                gems.map(async (gem) => {
                    const gemScore = await tokenProvider.calculateGemScore(gem, criteria); // Should return number
                    const analysis = await tokenProvider.provideDeeperAnalysis(gem, criteria); // Should return string
                    const recommendation = tokenProvider.provideRecommendation(gem, gemScore); // Should return string
                    const risk = tokenProvider.assessRisk(gem, criteria); // Should return string

                    return {
                        name: gem.name,
                        symbol: gem.symbol,
                        analysis,
                        score: gemScore,
                        recommendation,
                        risk,
                    };
                })
            ).then(results => results.filter(result => result.score >= 80));

            if (callback) {
                callback({
                    text: `Found ${gems.length} potential gem tokens:\n${results
                        .map(
                            (result) =>
                                `**${result.name} (${result.symbol})**\n` +
                                `- ${result.analysis}\n` +
                                `- **Score:** ${result.score}\n` +
                                `- ${result.recommendation}\n` +
                                `- ${result.risk}`
                        )
                        .join("\n\n")}`,
                    content: { gems: results },
                });
            }
            return true;
        } catch (error) {
            if (callback) {
                callback({
                    text: `Error hunting gem tokens: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Can you look for any gem tokens in my portfolio?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Searching for gems...",
                    action: "HUNT_GEM_TOKENS",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Let me scan for tokens showing key **gem indicators**...\n\n🔍 **Scanning for:**\n• Rising volume\n• Growing holder base\n• Strong liquidity metrics\n• Technical breakouts\n• Low market cap\n\nGiving this a thorough analysis to find **legitimate opportunities**! Stand by for results...\n\nFound **20 potential gem tokens**:\nStealthSDK (STEALTH) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nPippin (pippin) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nai16z (ai16z) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nCHIP (CHIP) - Matches: Recent Price Surge, Low Market Cap\nPudgy Penguins (PENGU) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nButthole Coin (Butthole) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nCUM PROCESSING UNIT (CPU) - Matches: Recent Price Surge, Low Market Cap\nswarms (swarms) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nHive AI (BUZZ) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nAI Rig Complex (arc) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nzerebro (ZEREBRO) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nBUILD (BUILD) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nJupiter (JUP) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nElon Trump Fart (ETF500) - Matches: Recent Price Surge, Low Market Cap\nReal AIOS Foundation (AIOS) - Matches: Recent Price Surge, Low Market Cap\ntest griffain.com (GRIFFAIN) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nAva AI (AVA) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nFWOG (FWOG) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nUnicorn Fart Dust (UFD) - Matches: High Liquidity, Recent Price Surge, Low Market Cap\nPOPCAT (POPCAT) - Matches: High Liquidity, Recent Price Surge, Low Market Cap",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
