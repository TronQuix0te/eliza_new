import {
    ActionExample,
    booleanFooter,
    composeContext,
    Content,
    elizaLogger,
    Evaluator,
    generateObjectArray,
    generateText,
    generateTrueOrFalse,
    IAgentRuntime,
    Memory,
    MemoryManager,
    ModelClass,
} from "@elizaos/core";
import { TrustScoreDatabase } from "@elizaos/plugin-trustdb";
import { Connection } from "@solana/web3.js";
import { getWalletKey } from "../keypairUtils.ts";
import { TokenProvider } from "../providers/token.ts";
import { TrustScoreManager } from "../providers/trustScoreProvider.ts";
import { WalletProvider } from "../providers/wallet.ts";

const shouldProcessTemplate =
    `# Task: Decide if the recent messages should be processed for token recommendations.

    Look for messages that:
    - Mention specific token tickers or contract addresses
    - Contain words related to buying, selling, or trading tokens
    - Express opinions or convictions about tokens

    Based on the following conversation, should the messages be processed for recommendations? YES or NO

    {{recentMessages}}

    Should the messages be processed for recommendations? ` + booleanFooter;

export const formatRecommendations = (recommendations: Memory[]) => {
    const messageStrings = recommendations
        .reverse()
        .map((rec: Memory) => `${(rec.content as Content)?.content}`);
    const finalMessageStrings = messageStrings.join("\n");
    return finalMessageStrings;
};

const recommendationTemplate = `TASK: Extract recommendations to buy or sell memecoins from the conversation as an array of objects in JSON format.

    Memecoins usually have a ticker and a contract address. Additionally, recommenders may make recommendations with some amount of conviction. The amount of conviction in their recommendation can be none, low, medium, or high. Recommenders can make recommendations to buy, not buy, sell and not sell.

# START OF EXAMPLES
These are an examples of the expected output of this task:
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

async function handler(runtime: IAgentRuntime, message: Memory) {
    console.log("Evaluating for trust");
    const state = await runtime.composeState(message);

    // if the database type is postgres, we don't want to run this because it relies on sql queries that are currently specific to sqlite. This check can be removed once the trust score provider is updated to work with postgres.
    if (runtime.getSetting("POSTGRES_URL")) {
        elizaLogger.warn("skipping trust evaluator because db is postgres");
        return [];
    }

    const { agentId, roomId } = state;

    // Check if we should process the messages
    const shouldProcessContext = composeContext({
        state,
        template: shouldProcessTemplate,
    });

    const shouldProcess = await generateTrueOrFalse({
        context: shouldProcessContext,
        modelClass: ModelClass.SMALL,
        runtime,
    });

    if (!shouldProcess) {
        console.log("Skipping process");
        return [];
    }

    console.log("Processing recommendations");

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

    console.log("recommendations", recommendations);

    if (!recommendations) {
        return [];
    }

    // If the recommendation is already known or corrupted, remove it
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

    async function findContractAddress(
        runtime: IAgentRuntime,
        ticker: string,
        walletProvider: WalletProvider
    ): Promise<string | null> {
        // Try to get address from wallet first
        const tempTokenProvider = new TokenProvider(
            null,
            walletProvider,
            runtime.cacheManager
        );

        let contractAddress = await tempTokenProvider.getTokenFromWallet(
            runtime,
            ticker
        );

        if (!contractAddress) {
            // If not in wallet, try DexScreener
            const result =
                await tempTokenProvider.searchDexScreenerData(ticker);
            contractAddress = result?.baseToken?.address;
        }

        return contractAddress;
    }

    for (const rec of filteredRecommendations) {
        // Get the contract address first before doing anything else
        let contractAddress = rec.contractAddress;

        const walletProvider = WalletProvider.getInstance(
            new Connection(
                runtime.getSetting("RPC_URL") ||
                    "https://api.mainnet-beta.solana.com"
            ),
            publicKey
        );

        if (!contractAddress) {
            contractAddress = await findContractAddress(
                runtime,
                rec.ticker,
                walletProvider
            );

            if (!contractAddress) {
                console.warn(
                    `Could not find contract address for ${rec.ticker}, skipping`
                );
                continue;
            }

            // Update the recommendation with the found address
            rec.contractAddress = contractAddress;
        }

        // Now create the real token provider with the guaranteed address
        const tokenProvider = new TokenProvider(
            contractAddress, // Now we know this isn't null
            walletProvider,
            runtime.cacheManager
        );
        console.log(
            "Created TokenProvider with address:",
            tokenProvider.getTokenAddress()
        );

        // TODO: Check to make sure the contract address is valid, it's the right one, etc

        //

        if (!rec.contractAddress) {
            const tokenAddress = await tokenProvider.getTokenFromWallet(
                runtime,
                rec.ticker
            );
            rec.contractAddress = tokenAddress;
            if (!tokenAddress) {
                // try to search for the symbol and return the contract address with they highest liquidity and market cap
                const result = await tokenProvider.searchDexScreenerData(
                    rec.ticker
                );
                const tokenAddress = result?.baseToken?.address;
                rec.contractAddress = tokenAddress;
                if (!tokenAddress) {
                    console.warn("Could not find contract address for token");
                    continue;
                }
            }
        }

        // create the trust score manager

        const trustScoreDb = new TrustScoreDatabase(runtime.databaseAdapter.db);
        const trustScoreManager = new TrustScoreManager(
            runtime,
            tokenProvider,
            trustScoreDb
        );

        // get actors from the database
        const participants =
            await runtime.databaseAdapter.getParticipantsForRoom(
                message.roomId
            );

        // find the first user Id from a user with the username that we extracted
        const user = participants.find(async (actor) => {
            const user = await runtime.databaseAdapter.getAccountById(actor);
            return (
                user.name.toLowerCase().trim() ===
                rec.recommender.toLowerCase().trim()
            );
        });

        if (!user) {
            console.warn("Could not find user: ", rec.recommender);
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

        console.log("recommendationsManager", rec);

        // - from here we just need to make sure code is right

        // buy, dont buy, sell, dont sell

        const buyAmounts = await tokenProvider.calculateBuyAmounts();

        let buyAmount = buyAmounts[rec.conviction.toLowerCase().trim()];
        if (!buyAmount) {
            // handle annoying cases
            // for now just put in 10 sol
            buyAmount = 10;
        }

        // TODO: is this is a buy, sell, dont buy, or dont sell?
        // Before calling shouldTradeToken, let's verify we still have the address
        console.log(
            "TokenProvider address before trade check:",
            tokenProvider.getTokenAddress()
        );

        const shouldTrade =
            tokenProvider.getTokenAddress() != null ? true : null; // await tokenProvider.shouldTradeToken();

        if (!shouldTrade) {
            console.warn(
                "There might be a problem with the token, not trading"
            );
            continue;
        }

        switch (rec.type) {
            case "buy":
                // Skip if we still don't have a contract address
                if (!rec.contractAddress) {
                    console.warn(
                        "No valid contract address found, skipping trade"
                    );
                    continue;
                }

                await trustScoreManager.createTradePerformance(
                    runtime,
                    rec.contractAddress,
                    userId,
                    {
                        buy_amount: buyAmount, // Use the calculated buyAmount based on conviction
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
    }

    return filteredRecommendations;
}

interface TokenContent extends Content {
    text: string;
    tokenAddress?: string;
    tokenSymbol?: string;
}

// Helper function to extract token address from message
async function extractTokenAddress(
    message: Memory,
    runtime: IAgentRuntime
): Promise<string | null> {
    try {
        const content = message.content as TokenContent;

        // If the address is directly in the message
        if (content?.tokenAddress) {
            return content.tokenAddress;
        }

        // If there's a token symbol, try to resolve it
        if (content?.tokenSymbol) {
            const tempProvider = new TokenProvider(
                null,
                null,
                runtime.cacheManager
            );
            return await tempProvider.getTokenFromWallet(
                runtime,
                content.tokenSymbol
            );
        }

        // Try to extract from text using regex
        const text = content?.text || "";

        // Look for addresses that match Solana format (base58, 32-44 chars)
        const addressMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
        if (addressMatch) {
            return addressMatch[0];
        }

        // Look for token symbols preceded by $
        const symbolMatch = text.match(/\$([A-Za-z0-9]+)/);
        if (symbolMatch) {
            const tempProvider = new TokenProvider(
                null,
                null,
                runtime.cacheManager
            );
            return await tempProvider.getTokenFromWallet(
                runtime,
                symbolMatch[1]
            );
        }

        return null;
    } catch (error) {
        console.error("Error extracting token address:", error);
        return null;
    }
}

export const trustEvaluator: Evaluator = {
    name: "EXTRACT_RECOMMENDATIONS",
    similes: [
        "GET_RECOMMENDATIONS",
        "EXTRACT_TOKEN_RECS",
        "EXTRACT_MEMECOIN_RECS",
    ],
    alwaysRun: true,
    validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        if (message.content.text.length < 5) {
            return false;
        }
        
        if (message.userId === message.agentId) {
            return false;
        }

        // Remove metrics check and only look for recommendation-related content
        const recommendationPatterns = [
            /\$[A-Z]+/i,  // Token symbols with $
            /ape in/i,
            /bullish/i,
            /buy/i,
            /sell/i,
            /contract/i,
            /token/i,
            /pump/i,
            /dump/i
        ];

        return recommendationPatterns.some(pattern => pattern.test(message.content.text));
    },
    description:
        "Extract recommendations to buy or sell memecoins/tokens from the conversation, including details like ticker, contract address, conviction level, and recommender username.",
    handler: handler, // Make sure handler is properly referenced
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
            ] as ActionExample[],
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
        },

        {
            context: `Actors in the scene:
{{user1}}: Solana maximalist. Believes Solana will flip Ethereum.
{{user2}}: Multichain proponent. Holds both SOL and ETH.

Recommendations about the actors:
{{user1}} has previously promoted $COPETOKEN and $SOYLENT.`,
            messages: [
                {
                    user: "{{user1}}",
                    content: {
                        text: "If you're not long $SOLVAULT at 7tRzKud6FBVFEhYqZS3CuQ2orLRM21bdisGykL5Sr4Dx, you're missing out. This will be the blackhole of Solana liquidity.",
                    },
                },
                {
                    user: "{{user2}}",
                    content: {
                        text: "Idk man, feels like there's a new 'vault' or 'reserve' token every week on Sol. What happened to $COPETOKEN and $SOYLENT that you were shilling before?",
                    },
                },
                {
                    user: "{{user1}}",
                    content: {
                        text: "$COPETOKEN and $SOYLENT had their time, I took profits near the top. But $SOLVAULT is different, it has actual utility. Do what you want, but don't say I didn't warn you when this 50x's and you're left holding your $ETH bags.",
                    },
                },
            ] as ActionExample[],
            outcome: `\`\`\`json
[
  {
    "recommender": "{{user1}}",
    "ticker": "COPETOKEN",
    "contractAddress": null,
    "type": "sell",
    "conviction": "low",
    "alreadyKnown": true
  },
  {
    "recommender": "{{user1}}",
    "ticker": "SOYLENT",
    "contractAddress": null,
    "type": "sell",
    "conviction": "low",
    "alreadyKnown": true
  },
  {
    "recommender": "{{user1}}",
    "ticker": "SOLVAULT",
    "contractAddress": "7tRzKud6FBVFEhYqZS3CuQ2orLRM21bdisGykL5Sr4Dx",
    "type": "buy",
    "conviction": "high",
    "alreadyKnown": false
  }
]
\`\`\``,
        },

        {
            context: `Actors in the scene:
{{user1}}: Self-proclaimed Solana alpha caller. Allegedly has insider info.
{{user2}}: Degen gambler. Will ape into any hyped token.

Recommendations about the actors:
None`,
            messages: [
                {
                    user: "{{user1}}",
                    content: {
                        text: "I normally don't do this, but I like you anon, so I'll let you in on some alpha. $ROULETTE at 48vV5y4DRH1Adr1bpvSgFWYCjLLPtHYBqUSwNc2cmCK2 is going to absolutely send it soon. You didn't hear it from me 🤐",
                    },
                },
                {
                    user: "{{user2}}",
                    content: {
                        text: "Oh shit, insider info from the alpha god himself? Say no more, I'm aping in hard.",
                    },
                },
            ] as ActionExample[],
            outcome: `\`\`\`json
[
  {
    "recommender": "{{user1}}",
    "ticker": "ROULETTE",
    "contractAddress": "48vV5y4DRH1Adr1bpvSgFWYCjLLPtHYBqUSwNc2cmCK2",
    "type": "buy",
    "conviction": "high",
    "alreadyKnown": false
  }
]
\`\`\``,
        },

        {
            context: `Actors in the scene:
{{user1}}: NFT collector and trader. Bullish on Solana NFTs.
{{user2}}: Only invests based on fundamentals. Sees all NFTs as worthless JPEGs.

Recommendations about the actors:
None
`,
            messages: [
                {
                    user: "{{user1}}",
                    content: {
                        text: "GM. I'm heavily accumulating $PIXELAPE, the token for the Pixel Ape Yacht Club NFT collection. 10x is inevitable.",
                    },
                },
                {
                    user: "{{user2}}",
                    content: {
                        text: "NFTs are a scam bro. There's no underlying value. You're essentially trading worthless JPEGs.",
                    },
                },
                {
                    user: "{{user1}}",
                    content: {
                        text: "Fun staying poor 🤡 $PIXELAPE is about to moon and you'll be left behind.",
                    },
                },
                {
                    user: "{{user2}}",
                    content: {
                        text: "Whatever man, I'm not touching that shit with a ten foot pole. Have fun holding your bags.",
                    },
                },
                {
                    user: "{{user1}}",
                    content: {
                        text: "Don't need luck where I'm going 😎 Once $PIXELAPE at 3hAKKmR6XyBooQBPezCbUMhrmcyTkt38sRJm2thKytWc takes off, you'll change your tune.",
                    },
                },
            ],
            outcome: `\`\`\`json
[
  {
    "recommender": "{{user1}}",
    "ticker": "PIXELAPE",
    "contractAddress": "3hAKKmR6XyBooQBPezCbUMhrmcyTkt38sRJm2thKytWc",
    "type": "buy",
    "conviction": "high",
    "alreadyKnown": false
  }
]
\`\`\``,
        },

        {
            context: `Actors in the scene:
{{user1}}: Contrarian investor. Bets against hyped projects.
{{user2}}: Trend follower. Buys tokens that are currently popular.

Recommendations about the actors:
None`,
            messages: [
                {
                    user: "{{user2}}",
                    content: {
                        text: "$SAMOYED is the talk of CT right now. Making serious moves. Might have to get a bag.",
                    },
                },
                {
                    user: "{{user1}}",
                    content: {
                        text: "Whenever a token is the 'talk of CT', that's my cue to short it. $SAMOYED is going to dump hard, mark my words.",
                    },
                },
                {
                    user: "{{user2}}",
                    content: {
                        text: "Idk man, the hype seems real this time. 5TQwHyZbedaH4Pcthj1Hxf5GqcigL6qWuB7YEsBtqvhr chart looks bullish af.",
                    },
                },
                {
                    user: "{{user1}}",
                    content: {
                        text: "Hype is always real until it isn't. I'm taking out a fat short position here. Don't say I didn't warn you when this crashes 90% and you're left holding the flaming bags.",
                    },
                },
            ],
            outcome: `\`\`\`json
[
  {
    "recommender": "{{user2}}",
    "ticker": "SAMOYED",
    "contractAddress": "5TQwHyZbedaH4Pcthj1Hxf5GqcigL6qWuB7YEsBtqvhr",
    "type": "buy",
    "conviction": "medium",
    "alreadyKnown": false
  },
  {
    "recommender": "{{user1}}",
    "ticker": "SAMOYED",
    "contractAddress": "5TQwHyZbedaH4Pcthj1Hxf5GqcigL6qWuB7YEsBtqvhr",
    "type": "dont_buy",
    "conviction": "high",
    "alreadyKnown": false
  }
]
\`\`\``,
        },
    ],
};
