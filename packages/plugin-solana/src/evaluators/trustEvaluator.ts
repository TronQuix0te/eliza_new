import {
    EvaluationExample,
    Evaluator,
    IAgentRuntime,
    Memory,
    Content,
    State,
    ModelClass,
    generateTrueOrFalse,
    generateObjectArray,
    composeContext,
    MemoryManager
} from "@elizaos/core";
import { Connection } from "@solana/web3.js";
import { TokenProvider } from "../providers/token";
import { WalletProvider } from "../providers/wallet";
import { getWalletKey } from "../keypairUtils";
import { TrustScoreDatabase } from "@elizaos/plugin-trustdb";
import { TrustScoreManager } from "../providers/trustScoreProvider";

// Processing state management
const processingTokens = new Map<string, boolean>();

interface HandlerState extends State {
    agentId: string;
    roomId: string;
    recentMessages: any[];
    walletInfo?: any;
}

// Helper function to format recommendations for context
const formatRecommendations = (recommendations: Memory[]): string => {
    const messageStrings = recommendations
        .reverse()
        .map((rec: Memory) => `${(rec.content as Content)?.content}`);
    return messageStrings.join("\n");
};

// Templates for LLM interactions
const shouldProcessTemplate = `# Task: Decide if the recent messages should be processed for token recommendations.

Look for messages that:
- Request token recommendations
- Contain specific token symbols
- Ask about tokens being recommended or trending

Based on the following conversation, should the message be processed for recommendations? YES or NO

{{recentMessages}}

Should the message be processed for recommendations? YES or NO`;

const recommendationTemplate = `TASK: Extract recommendations to buy or sell memecoins from the conversation as an array of objects in JSON format.

Memecoins usually have a ticker and a contract address. Additionally, recommenders may make recommendations with some amount of conviction. The amount of conviction in their recommendation can be none, low, medium, or high. Recommenders can make recommendations to buy, not buy, sell and not sell.

# START OF EXAMPLES
These are examples of the expected output of this task:
{{evaluationExamples}}
# END OF EXAMPLES

# INSTRUCTIONS
Extract any new recommendations from the conversation that are not already present in the list of known recommendations below:
{{recentRecommendations}}

- Include the recommender's username
- Try not to include already-known recommendations. If you think a recommendation is already known, but you're not sure, respond with alreadyKnown: true.
- Set the conviction to 'none', 'low', 'medium' or 'high'
- Set the recommendation type to 'buy', 'dont_buy', 'sell', or 'dont_sell'
- Include the contract address and/or ticker if available

Recent Messages:
{{recentMessages}}

Response should be a JSON object array inside a JSON markdown block. Correct response format:
\`\`\`json
[
  {
    "recommender": string,
    "ticker": string | null,
    "contractAddress": string | null,
    "type": enum<buy|dont_buy|sell|dont_sell>,
    "conviction": enum<none|low|medium|high>,
    "alreadyKnown": boolean
  },
  ...
]
\`\`\``;

// Helper functions for processing control
const getProcessingKey = (message: Memory): string => {
    return `${message.userId}-${message.roomId}-${Date.now()}`;
};

const isProcessing = (key: string): boolean => {
    return processingTokens.get(key) || false;
};

const markAsProcessing = (key: string) => {
    processingTokens.set(key, true);
};

const markAsComplete = (key: string) => {
    processingTokens.delete(key);
};

// Main evaluator action
export const newTrustEvaluator: Evaluator = {
    name: "EXTRACT_RECOMMENDATIONS",
    similes: ["GET_RECOMMENDATIONS", "EXTRACT_TOKEN_RECS", "EXTRACT_MEMECOIN_RECS"],
    alwaysRun: true,

    validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        if (message.content.text.length < 5) {
            return false;
        }

        if (message.userId === message.agentId) {
            return false;
        }

        const recommendationPatterns = [
            /\$[A-Z]+/i,  // Token symbols with $
            /metrics for/i,
            /token metrics/i,
            /analyze token/i
        ];

        return recommendationPatterns.some(pattern => pattern.test(message.content.text));
    },

    handler: async (runtime: IAgentRuntime, message: Memory, initialState?: HandlerState): Promise<any> => {
        console.log("Evaluating for trust");

        const processingKey = getProcessingKey(message);
        if (isProcessing(processingKey)) {
            console.log("Already processing this message");
            return [];
        }

        markAsProcessing(processingKey);

        try {
            // Initialize state properly
            let state: HandlerState;
            if (!initialState) {
                state = (await runtime.composeState(message)) as HandlerState;
            } else {
                state = await runtime.updateRecentMessageState(initialState) as HandlerState;
            }

            const { agentId, roomId } = state;

            // Check for metrics request first
            const text = message.content.text.toLowerCase();
            const metricsMatch = text.match(/metrics for (\w+)/i);

            if (metricsMatch) {
                const symbol = metricsMatch[1].toUpperCase();
                console.log(`Processing metrics for ${symbol}`);

                try {
                    const { publicKey } = await getWalletKey(runtime, false);
                    const connection = new Connection(runtime.getSetting("RPC_URL") || "https://api.mainnet-beta.solana.com");
                    const walletProvider = WalletProvider.getInstance(connection, publicKey);

                    const tokenProvider = new TokenProvider(null, walletProvider, runtime.cacheManager);
                    let tokenAddress = await tokenProvider.getTokenFromWallet(runtime, symbol);

                    if (!tokenAddress) {
                        console.log("Token not in wallet, searching DexScreener");
                        const result = await tokenProvider.searchDexScreenerData(symbol);
                        if (result?.baseToken?.address) {
                            tokenAddress = result.baseToken.address;
                        }
                    }

                    if (!tokenAddress) {
                        await runtime.reply(message, `Could not find token ${symbol}. Are you sure that's the right symbol?`);
                        return [];
                    }

                    const metricsProvider = new TokenProvider(tokenAddress, walletProvider, runtime.cacheManager);
                    const processedData = await metricsProvider.getProcessedTokenData(runtime);
                    const formattedData = metricsProvider.formatTokenData(runtime, processedData);

                    await runtime.reply(message, formattedData);
                    return [];
                } catch (error) {
                    console.error("Error getting token metrics:", error);
                    await runtime.reply(message, `Error fetching metrics: ${error.message}`);
                    return [];
                }
            }

            // For recommendations path, check if we should process
            const shouldProcessContext = composeContext({
                state: {
                    agentId,
                    roomId,
                    recentMessages: state.recentMessages,
                    ...state
                },
                template: shouldProcessTemplate
            });

            const shouldProcess = await generateTrueOrFalse({
                context: shouldProcessContext,
                modelClass: ModelClass.SMALL,
                runtime,
            });

            if (!shouldProcess) {
                console.log("Skipping recommendation processing");
                return [];
            }

            // Get recent recommendations
            const recommendationsManager = new MemoryManager({
                runtime,
                tableName: "recommendations",
            });

            const recentRecommendations = await recommendationsManager.getMemories({
                roomId,
                count: 20,
            });

            const context = composeContext({
                state: {
                    ...state,
                    recentRecommendations: formatRecommendations(recentRecommendations),
                },
                template: recommendationTemplate,
            });

            const recommendations = await generateObjectArray({
                runtime,
                context,
                modelClass: ModelClass.LARGE,
            });

            if (!recommendations) {
                return [];
            }

            // Filter invalid recommendations
            const filteredRecommendations = recommendations.filter((rec) => {
                return (
                    !rec.alreadyKnown &&
                    (rec.ticker || rec.contractAddress) &&
                    rec.recommender &&
                    rec.conviction &&
                    rec.recommender.trim() !== ""
                );
            });

            const { publicKey } = await getWalletKey(runtime, false);

            // Process each filtered recommendation
            for (const rec of filteredRecommendations) {
                try {
                    let resolvedAddress = rec.contractAddress;

                    const walletProvider = WalletProvider.getInstance(
                        new Connection(runtime.getSetting("RPC_URL") || "https://api.mainnet-beta.solana.com"),
                        publicKey
                    );

                    if (!resolvedAddress && rec.ticker) {
                        const tempProvider = new TokenProvider(null, walletProvider, runtime.cacheManager);
                        resolvedAddress = await tempProvider.getTokenFromWallet(runtime, rec.ticker);

                        if (!resolvedAddress) {
                            const result = await tempProvider.searchDexScreenerData(rec.ticker);
                            resolvedAddress = result?.baseToken?.address;
                        }

                        if (!resolvedAddress) {
                            console.warn(`Could not find contract address for ${rec.ticker}, skipping`);
                            continue;
                        }
                        rec.contractAddress = resolvedAddress;
                    }

                    // Process recommendation with simulation selling service
                    const tokenProvider = new TokenProvider(
                        resolvedAddress,
                        walletProvider,
                        runtime.cacheManager
                    );

                    const trustScoreDb = new TrustScoreDatabase(runtime.databaseAdapter.db);
                    const trustScoreManager = new TrustScoreManager(
                        runtime,
                        tokenProvider,
                        trustScoreDb
                    );

                    const participants = await runtime.databaseAdapter.getParticipantsForRoom(message.roomId);
                    const user = participants.find(async (actor) => {
                        const user = await runtime.databaseAdapter.getAccountById(actor);
                        return user.name.toLowerCase().trim() === rec.recommender.toLowerCase().trim();
                    });

                    if (!user) {
                        console.warn("Could not find user:", rec.recommender);
                        continue;
                    }

                    const account = await runtime.databaseAdapter.getAccountById(user);
                    const userId = account.id;

                    const recMemory = {
                        userId,
                        agentId,
                        content: { text: JSON.stringify(rec) },
                        roomId,
                        createdAt: Date.now(),
                    };

                    await recommendationsManager.createMemory(recMemory, true);

                    // Process token recommendation
                    const buyAmounts = await tokenProvider.calculateBuyAmounts();
                    let buyAmount = buyAmounts[rec.conviction.toLowerCase().trim()];
                    if (!buyAmount) {
                        buyAmount = 10; // Default fallback
                    }

                    const shouldTrade = tokenProvider.getTokenAddress() != null ? true : null;
                    if (!shouldTrade) {
                        console.warn("There might be a problem with the token, not trading");
                        continue;
                    }

                    switch (rec.type) {
                        case "buy":
                            if (!rec.contractAddress) {
                                console.warn("No valid contract address found, skipping trade");
                                continue;
                            }

                            await trustScoreManager.createTradePerformance(
                                runtime,
                                rec.contractAddress,
                                userId,
                                {
                                    buy_amount: buyAmount,
                                    is_simulation: true,
                                }
                            );
                            break;
                        case "sell":
                        case "dont_sell":
                        case "dont_buy":
                            console.warn("Not implemented");
                            break;
                    }
                } catch (error) {
                    console.error("Error processing recommendation:", error);
                }
            }

            return filteredRecommendations;
        } finally {
            markAsComplete(processingKey);
        }
    },

    description:
        "Extract recommendations to buy or sell memecoins/tokens from the conversation, including details like ticker, contract address, conviction level, and recommender username.",

    examples: [
        {
            context: `Actors in the scene:
{{user1}}: Experienced DeFi degen. Constantly chasing high yield farms.
{{user2}}: New to DeFi, learning the ropes.

Recommendations about the actors:
None`,
            messages: [
                {
                    user: "{{user1}}",
                    content: {
                        text: "Yo, have you checked out $SOLARUG? Dope new yield aggregator on Solana.",
                    },
                },
                {
                    user: "{{user2}}",
                    content: {
                        text: "Nah, I'm still trying to wrap my head around how yield farming even works haha. Is it risky?",
                    },
                },
                {
                    user: "{{user1}}",
                    content: {
                        text: "I mean, there's always risk in DeFi, but the $SOLARUG devs seem legit. Threw a few sol into the FCweoTfJ128jGgNEXgdfTXdEZVk58Bz9trCemr6sXNx9 vault, farming's been smooth so far.",
                    },
                },
            ],
            outcome: `\`\`\`json
[
  {
    "recommender": "{{user1}}",
    "ticker": "SOLARUG",
    "contractAddress": "FCweoTfJ128jGgNEXgdfTXdEZVk58Bz9trCemr6sXNx9",
    "type": "buy",
    "conviction": "medium",
    "alreadyKnown": false
  }
]
\`\`\``,
        }
    ] as EvaluationExample[],
};
