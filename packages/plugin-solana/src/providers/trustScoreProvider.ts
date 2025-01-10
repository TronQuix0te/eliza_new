import {
    elizaLogger,
    IAgentRuntime,
    Memory,
    Provider,
    settings,
    State,
} from "@elizaos/core";
import {
    RecommenderMetrics,
    TokenPerformance,
    TokenRecommendation,
    TradePerformance,
    TrustScoreDatabase,
} from "@elizaos/plugin-trustdb";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { v4 as uuidv4 } from "uuid";
import { ProcessedTokenData, TokenSecurityData } from "../types/token.ts";
import { SimulationSellingService } from "./simulationSellingService.ts";
import { TokenProvider } from "./token";
import { WalletProvider } from "./wallet";
import { getWalletKey } from "../keypairUtils";

interface TradeData {
    buy_amount: number;
    is_simulation: boolean;
}
interface sellDetails {
    sell_amount: number;
    sell_recommender_id: string | null;
}
interface _RecommendationGroup {
    recommendation: any;
    trustScore: number;
}

interface RecommenderData {
    recommenderId: string;
    trustScore: number;
    riskScore: number;
    consistencyScore: number;
    recommenderMetrics: RecommenderMetrics;
}

interface TokenRecommendationSummary {
    tokenAddress: string;
    averageTrustScore: number;
    averageRiskScore: number;
    averageConsistencyScore: number;
    recommenders: RecommenderData[];
}
export class TrustScoreManager {
    private tokenProvider: TokenProvider;
    private trustScoreDb: TrustScoreDatabase;
    private simulationSellingService: SimulationSellingService;
    private connection: Connection;
    private baseMint: PublicKey;
    private DECAY_RATE = 0.95;
    private MAX_DECAY_DAYS = 30;
    private backend;
    private backendToken;
    constructor(
        runtime: IAgentRuntime,
        tokenProvider: TokenProvider,
        trustScoreDb: TrustScoreDatabase
    ) {
        this.tokenProvider = tokenProvider;
        this.trustScoreDb = trustScoreDb;
        this.connection = new Connection(runtime.getSetting("RPC_URL"));
        this.baseMint = new PublicKey(
            runtime.getSetting("BASE_MINT") ||
                "So11111111111111111111111111111111111111112"
        );
        this.backend = runtime.getSetting("BACKEND_URL");
        this.backendToken = runtime.getSetting("BACKEND_TOKEN");
        this.simulationSellingService = new SimulationSellingService(
            runtime,
            this.trustScoreDb
        );
    }

    //getRecommenederBalance
    async getRecommenederBalance(recommenderWallet: string): Promise<number> {
        try {
            const tokenAta = await getAssociatedTokenAddress(
                new PublicKey(recommenderWallet),
                this.baseMint
            );
            const tokenBalInfo =
                await this.connection.getTokenAccountBalance(tokenAta);
            const tokenBalance = tokenBalInfo.value.amount;
            const balance = parseFloat(tokenBalance);
            return balance;
        } catch (error) {
            console.error("Error fetching balance", error);
            return 0;
        }
    }

    /**
     * Generates and saves trust score based on processed token data and user recommendations.
     * @param tokenAddress The address of the token to analyze.
     * @param recommenderId The UUID of the recommender.
     * @returns An object containing TokenPerformance and RecommenderMetrics.
     */
    async generateTrustScore(
        runtime: IAgentRuntime,
        tokenAddress: string,
        recommenderId: string,
        recommenderWallet: string
    ): Promise<{
        tokenPerformance: TokenPerformance;
        recommenderMetrics: RecommenderMetrics;
    }> {
        const processedData: ProcessedTokenData =
            await this.tokenProvider.getProcessedTokenData(runtime);
        console.log(`Fetched processed token data for token: ${tokenAddress}`);

        const recommenderMetrics =
            await this.trustScoreDb.getRecommenderMetrics(recommenderId);

        const isRapidDump = await this.isRapidDump(runtime, tokenAddress);
        const sustainedGrowth = await this.sustainedGrowth(
            runtime,
            tokenAddress
        );
        const suspiciousVolume = await this.suspiciousVolume(
            runtime,
            tokenAddress
        );
        const balance = await this.getRecommenederBalance(recommenderWallet);
        const virtualConfidence = balance / 1000000; // TODO: create formula to calculate virtual confidence based on user balance
        const lastActive = recommenderMetrics.lastActiveDate;
        const now = new Date();
        const inactiveDays = Math.floor(
            (now.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24)
        );
        const decayFactor = Math.pow(
            this.DECAY_RATE,
            Math.min(inactiveDays, this.MAX_DECAY_DAYS)
        );
        const decayedScore = recommenderMetrics.trustScore * decayFactor;
        const validationTrustScore =
            this.trustScoreDb.calculateValidationTrust(tokenAddress);

        return {
            tokenPerformance: {
                tokenAddress:
                    processedData.dexScreenerData.pairs[0]?.baseToken.address ||
                    "",
                priceChange24h:
                    processedData.tradeData.price_change_24h_percent,
                volumeChange24h: processedData.tradeData.volume_24h,
                trade_24h_change:
                    processedData.tradeData.trade_24h_change_percent,
                liquidity:
                    processedData.dexScreenerData.pairs[0]?.liquidity.usd || 0,
                liquidityChange24h: 0,
                holderChange24h:
                    processedData.tradeData.unique_wallet_24h_change_percent,
                rugPull: false,
                isScam: processedData.tokenCodex.isScam,
                marketCapChange24h: 0,
                sustainedGrowth: sustainedGrowth,
                rapidDump: isRapidDump,
                suspiciousVolume: suspiciousVolume,
                validationTrust: validationTrustScore,
                balance: balance,
                initialMarketCap:
                    processedData.dexScreenerData.pairs[0]?.marketCap || 0,
                lastUpdated: new Date(),
                symbol: "",
            },
            recommenderMetrics: {
                recommenderId: recommenderId,
                trustScore: recommenderMetrics.trustScore,
                totalRecommendations: recommenderMetrics.totalRecommendations,
                successfulRecs: recommenderMetrics.successfulRecs,
                avgTokenPerformance: recommenderMetrics.avgTokenPerformance,
                riskScore: recommenderMetrics.riskScore,
                consistencyScore: recommenderMetrics.consistencyScore,
                virtualConfidence: virtualConfidence,
                lastActiveDate: now,
                trustDecay: decayedScore,
                lastUpdated: new Date(),
            },
        };
    }

    async updateRecommenderMetrics(
        recommenderId: string,
        tokenPerformance: TokenPerformance,
        recommenderWallet: string
    ): Promise<void> {
        const recommenderMetrics =
            await this.trustScoreDb.getRecommenderMetrics(recommenderId);

        const totalRecommendations =
            recommenderMetrics.totalRecommendations + 1;
        const successfulRecs = tokenPerformance.rugPull
            ? recommenderMetrics.successfulRecs
            : recommenderMetrics.successfulRecs + 1;
        const avgTokenPerformance =
            (recommenderMetrics.avgTokenPerformance *
                recommenderMetrics.totalRecommendations +
                tokenPerformance.priceChange24h) /
            totalRecommendations;

        const overallTrustScore = this.calculateTrustScore(
            tokenPerformance,
            recommenderMetrics
        );
        const riskScore = this.calculateOverallRiskScore(
            tokenPerformance,
            recommenderMetrics
        );
        const consistencyScore = this.calculateConsistencyScore(
            tokenPerformance,
            recommenderMetrics
        );

        const balance = await this.getRecommenederBalance(recommenderWallet);
        const virtualConfidence = balance / 1000000; // TODO: create formula to calculate virtual confidence based on user balance
        const lastActive = recommenderMetrics.lastActiveDate;
        const now = new Date();
        const inactiveDays = Math.floor(
            (now.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24)
        );
        const decayFactor = Math.pow(
            this.DECAY_RATE,
            Math.min(inactiveDays, this.MAX_DECAY_DAYS)
        );
        const decayedScore = recommenderMetrics.trustScore * decayFactor;

        const newRecommenderMetrics: RecommenderMetrics = {
            recommenderId: recommenderId,
            trustScore: overallTrustScore,
            totalRecommendations: totalRecommendations,
            successfulRecs: successfulRecs,
            avgTokenPerformance: avgTokenPerformance,
            riskScore: riskScore,
            consistencyScore: consistencyScore,
            virtualConfidence: virtualConfidence,
            lastActiveDate: new Date(),
            trustDecay: decayedScore,
            lastUpdated: new Date(),
        };

        await this.trustScoreDb.updateRecommenderMetrics(newRecommenderMetrics);
    }

    calculateTrustScore(
        tokenPerformance: TokenPerformance,
        recommenderMetrics: RecommenderMetrics
    ): number {
        const riskScore = this.calculateRiskScore(tokenPerformance);
        const consistencyScore = this.calculateConsistencyScore(
            tokenPerformance,
            recommenderMetrics
        );

        return (riskScore + consistencyScore) / 2;
    }

    calculateOverallRiskScore(
        tokenPerformance: TokenPerformance,
        recommenderMetrics: RecommenderMetrics
    ) {
        const riskScore = this.calculateRiskScore(tokenPerformance);
        const consistencyScore = this.calculateConsistencyScore(
            tokenPerformance,
            recommenderMetrics
        );

        return (riskScore + consistencyScore) / 2;
    }

    calculateRiskScore(tokenPerformance: TokenPerformance): number {
        let riskScore = 0;
        if (tokenPerformance.rugPull) {
            riskScore += 10;
        }
        if (tokenPerformance.isScam) {
            riskScore += 10;
        }
        if (tokenPerformance.rapidDump) {
            riskScore += 5;
        }
        if (tokenPerformance.suspiciousVolume) {
            riskScore += 5;
        }
        return riskScore;
    }

    calculateConsistencyScore(
        tokenPerformance: TokenPerformance,
        recommenderMetrics: RecommenderMetrics
    ): number {
        const avgTokenPerformance = recommenderMetrics.avgTokenPerformance;
        const priceChange24h = tokenPerformance.priceChange24h;

        return Math.abs(priceChange24h - avgTokenPerformance);
    }

    async suspiciousVolume(
        runtime: IAgentRuntime,
        tokenAddress: string
    ): Promise<boolean> {
        const processedData: ProcessedTokenData =
            await this.tokenProvider.getProcessedTokenData(runtime);
        const unique_wallet_24h = processedData.tradeData.unique_wallet_24h;
        const volume_24h = processedData.tradeData.volume_24h;
        const suspiciousVolume = unique_wallet_24h / volume_24h > 0.5;
        console.log(`Fetched processed token data for token: ${tokenAddress}`);
        return suspiciousVolume;
    }

    async sustainedGrowth(
        runtime: IAgentRuntime,
        tokenAddress: string
    ): Promise<boolean> {
        const processedData: ProcessedTokenData =
            await this.tokenProvider.getProcessedTokenData(runtime);
        console.log(`Fetched processed token data for token: ${tokenAddress}`);

        return processedData.tradeData.volume_24h_change_percent > 50;
    }

    async isRapidDump(
        runtime: IAgentRuntime,
        tokenAddress: string
    ): Promise<boolean> {
        const processedData: ProcessedTokenData =
            await this.tokenProvider.getProcessedTokenData(runtime);
        console.log(`Fetched processed token data for token: ${tokenAddress}`);

        return processedData.tradeData.trade_24h_change_percent < -50;
    }

    async checkTrustScore(
        runtime: IAgentRuntime,
        tokenAddress: string
    ): Promise<TokenSecurityData> {
        const processedData: ProcessedTokenData =
            await this.tokenProvider.getProcessedTokenData(runtime);
        console.log(`Fetched processed token data for token: ${tokenAddress}`);

        return {
            ownerBalance: processedData.security.ownerBalance,
            creatorBalance: processedData.security.creatorBalance,
            ownerPercentage: processedData.security.ownerPercentage,
            creatorPercentage: processedData.security.creatorPercentage,
            top10HolderBalance: processedData.security.top10HolderBalance,
            top10HolderPercent: processedData.security.top10HolderPercent,
            totalSupply: processedData.security.totalSupply,
        };
    }

    /**
     * Creates a TradePerformance object based on token data and recommender.
     * @param tokenAddress The address of the token.
     * @param recommenderId The UUID of the recommender.
     * @param data ProcessedTokenData.
     * @returns TradePerformance object.
     */
    async createTradePerformance(
        runtime: IAgentRuntime,
        tokenAddress: string,
        recommenderId: string,
        data: TradeData
    ): Promise<TradePerformance> {
        try {
            const recommender =
                await this.trustScoreDb.getOrCreateRecommenderWithTelegramId(
                    recommenderId
                );
            const processedData =
                await this.tokenProvider.getProcessedTokenData(runtime);
            const tokenCodex = await this.tokenProvider.fetchTokenCodex();

            // Safely create wallet public key

            // Get wallet public key using getWalletKey instead of settings
            const { publicKey: walletPublicKey } = await getWalletKey(
                runtime,
                false
            );

            if (!walletPublicKey) {
                throw new Error("Could not get wallet public key");
            }

            console.log("DEBUG - Using wallet:", walletPublicKey.toString());

            const connection = new Connection(
                runtime.getSetting("RPC_URL") ||
                    "https://api.mainnet-beta.solana.com"
            );
            const wallet = WalletProvider.getInstance(
                connection,
                walletPublicKey
            );

            // Safe price fetching
            let solPrice = "0";
            try {
                const prices = await wallet.fetchPrices(runtime);
                solPrice = prices.solana.usd;
            } catch (error) {
                console.error("Error fetching prices:", error);
                throw new Error("Unable to fetch price data");
            }

            // Calculate values with safe number conversion
            const buySol = Number(data.buy_amount) / Number(solPrice);
            const buy_value_usd =
                data.buy_amount * (processedData.tradeData.price || 0);
            const tokensBalance = processedData.tradeData.price
                ? buy_value_usd / processedData.tradeData.price
                : 0;

            // Create the trade performance data
            const creationData = {
                token_address: tokenAddress,
                recommender_id: recommender.id,
                buy_price: processedData.tradeData.price || 0,
                sell_price: 0,
                buy_timeStamp: new Date().toISOString(),
                sell_timeStamp: "",
                buy_amount: data.buy_amount,
                sell_amount: 0,
                buy_sol: buySol,
                received_sol: 0,
                buy_value_usd: buy_value_usd,
                sell_value_usd: 0,
                profit_usd: 0,
                profit_percent: 0,
                buy_market_cap:
                    processedData.dexScreenerData?.pairs?.[0]?.marketCap || 0,
                sell_market_cap: 0,
                market_cap_change: 0,
                buy_liquidity:
                    processedData.dexScreenerData?.pairs?.[0]?.liquidity?.usd ||
                    0,
                sell_liquidity: 0,
                liquidity_change: 0,
                last_updated: new Date().toISOString(),
                rapidDump: false,
            };

            // Save the trade performance
            await this.trustScoreDb.addTradePerformance(
                creationData,
                data.is_simulation
            );

            // Create and save token recommendation
            const tokenUUId = uuidv4();
            const tokenRecommendation: TokenRecommendation = {
                id: tokenUUId,
                recommenderId: recommenderId,
                tokenAddress: tokenAddress,
                timestamp: new Date(),
                initialMarketCap: Number(
                    processedData.dexScreenerData?.pairs?.[0]?.marketCap || 0
                ),
                initialLiquidity: Number(
                    processedData.dexScreenerData?.pairs?.[0]?.liquidity?.usd ||
                        0
                ),
                initialPrice: Number(processedData.tradeData.price || 0),
            };
            await this.trustScoreDb.addTokenRecommendation(tokenRecommendation);

            // Update token performance
            await this.trustScoreDb.upsertTokenPerformance({
                tokenAddress: tokenAddress,
                symbol: processedData.tokenCodex?.symbol || "",
                priceChange24h: Number(
                    processedData.tradeData?.price_change_24h_percent || 0
                ),
                volumeChange24h: Number(
                    processedData.tradeData?.volume_24h || 0
                ),
                trade_24h_change: Number(
                    processedData.tradeData?.trade_24h_change_percent || 0
                ),
                liquidity: Number(
                    processedData.dexScreenerData?.pairs?.[0]?.liquidity?.usd ||
                        0
                ),
                liquidityChange24h: 0,
                holderChange24h: Number(
                    processedData.tradeData?.unique_wallet_24h_change_percent ||
                        0
                ),
                rugPull: false,
                isScam: Boolean(tokenCodex?.isScam || false),
                marketCapChange24h: 0,
                sustainedGrowth: false,
                rapidDump: false,
                suspiciousVolume: false,
                validationTrust: 0,
                balance: Number(tokensBalance || 0),
                initialMarketCap: Number(
                    processedData.dexScreenerData?.pairs?.[0]?.marketCap || 0
                ),
                lastUpdated: new Date(),
            });

            // Handle simulation specific logic
            if (data.is_simulation) {
                await this.trustScoreDb.updateTokenBalance(
                    tokenAddress,
                    Number(tokensBalance || 0)
                );
                const hash = Math.random().toString(36).substring(7);
                await this.trustScoreDb.addTransaction({
                    tokenAddress: tokenAddress,
                    type: "buy",
                    transactionHash: hash,
                    amount: Number(data.buy_amount || 0),
                    price: Number(processedData.tradeData.price || 0),
                    isSimulation: true,
                    timestamp: new Date().toISOString(),
                });
            }

            // Process token performance and create trade in backend
            await this.simulationSellingService.processTokenPerformance(
                tokenAddress,
                recommenderId
            );
            await this.createTradeInBe(tokenAddress, recommenderId, data);

            return creationData;
        } catch (error) {
            console.error("Error in createTradePerformance:", error);
            throw error;
        }
    }

    async createTradeInBe(
        tokenAddress: string,
        recommenderId: string,
        data: TradeData,
        retries = 3,
        delayMs = 2000
    ) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                await fetch(
                    `${this.backend}/api/updaters/createTradePerformance`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${this.backendToken}`,
                        },
                        body: JSON.stringify({
                            tokenAddress: tokenAddress,
                            tradeData: data,
                            recommenderId: recommenderId,
                        }),
                    }
                );
                // If the request is successful, exit the loop
                return;
            } catch (error) {
                console.error(
                    `Attempt ${attempt} failed: Error creating trade in backend`,
                    error
                );
                if (attempt < retries) {
                    console.log(`Retrying in ${delayMs} ms...`);
                    await this.delay(delayMs); // Wait for the specified delay before retrying
                } else {
                    console.error("All attempts failed.");
                }
            }
        }
    }

    // Don't forget the delay helper method
    private async delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Updates a trade with sell details.
     * @param tokenAddress The address of the token.
     * @param recommenderId The UUID of the recommender.
     * @param buyTimeStamp The timestamp when the buy occurred.
     * @param sellDetails An object containing sell-related details.
     * @param isSimulation Whether the trade is a simulation. If true, updates in simulation_trade; otherwise, in trade.
     * @returns boolean indicating success.
     */

    async updateSellDetails(
        runtime: IAgentRuntime,
        tokenAddress: string,
        recommenderId: string,
        sellTimeStamp: string,
        sellDetails: sellDetails,
        isSimulation: boolean
    ) {
        const recommender =
            await this.trustScoreDb.getOrCreateRecommenderWithTelegramId(
                recommenderId
            );
        const processedData: ProcessedTokenData =
            await this.tokenProvider.getProcessedTokenData(runtime);
        const { publicKey: walletPublicKey } = await getWalletKey(
            runtime,
            false
        );
        const Wallet = walletPublicKey.toString();
        const wallet = WalletProvider.getInstance(
            this.connection,
            new PublicKey(Wallet!)
        );
        const prices = await wallet.fetchPrices(runtime);
        const solPrice = prices.solana.usd;
        const sellSol = sellDetails.sell_amount / parseFloat(solPrice);
        const sell_value_usd =
            sellDetails.sell_amount * processedData.tradeData.price;
        const trade = await this.trustScoreDb.getLatestTradePerformance(
            tokenAddress,
            recommender.id,
            isSimulation
        );
        const buyTimeStamp = trade.buy_timeStamp;
        const marketCap =
            processedData.dexScreenerData.pairs[0]?.marketCap || 0;
        const liquidity =
            processedData.dexScreenerData.pairs[0]?.liquidity.usd || 0;
        const sell_price = processedData.tradeData.price;
        const profit_usd = sell_value_usd - trade.buy_value_usd;
        const profit_percent = (profit_usd / trade.buy_value_usd) * 100;

        const market_cap_change = marketCap - trade.buy_market_cap;
        const liquidity_change = liquidity - trade.buy_liquidity;

        const isRapidDump = await this.isRapidDump(runtime, tokenAddress);

        const sellDetailsData = {
            sell_price: sell_price,
            sell_timeStamp: sellTimeStamp,
            sell_amount: sellDetails.sell_amount,
            received_sol: sellSol,
            sell_value_usd: sell_value_usd,
            profit_usd: profit_usd,
            profit_percent: profit_percent,
            sell_market_cap: marketCap,
            market_cap_change: market_cap_change,
            sell_liquidity: liquidity,
            liquidity_change: liquidity_change,
            rapidDump: isRapidDump,
            sell_recommender_id: sellDetails.sell_recommender_id || null,
        };
        this.trustScoreDb.updateTradePerformanceOnSell(
            tokenAddress,
            recommender.id,
            buyTimeStamp,
            sellDetailsData,
            isSimulation
        );
        if (isSimulation) {
            // If the trade is a simulation update the balance
            const oldBalance = this.trustScoreDb.getTokenBalance(tokenAddress);
            const tokenBalance = oldBalance - sellDetails.sell_amount;
            this.trustScoreDb.updateTokenBalance(tokenAddress, tokenBalance);
            // generate some random hash for simulations
            const hash = Math.random().toString(36).substring(7);
            const transaction = {
                tokenAddress: tokenAddress,
                type: "sell" as "buy" | "sell",
                transactionHash: hash,
                amount: sellDetails.sell_amount,
                price: processedData.tradeData.price,
                isSimulation: true,
                timestamp: new Date().toISOString(),
            };
            this.trustScoreDb.addTransaction(transaction);
        }

        return sellDetailsData;
    }

    // get all recommendations
    async getRecommendations(
        startDate: Date,
        endDate: Date
    ): Promise<Array<TokenRecommendationSummary>> {
        const recommendations = this.trustScoreDb.getRecommendationsByDateRange(
            startDate,
            endDate
        );

        // Group recommendations by tokenAddress
        const groupedRecommendations = recommendations.reduce(
            (acc, recommendation) => {
                const { tokenAddress } = recommendation;
                if (!acc[tokenAddress]) acc[tokenAddress] = [];
                acc[tokenAddress].push(recommendation);
                return acc;
            },
            {} as Record<string, Array<TokenRecommendation>>
        );

        const result = Object.keys(groupedRecommendations).map(
            (tokenAddress) => {
                const tokenRecommendations =
                    groupedRecommendations[tokenAddress];

                // Initialize variables to compute averages
                let totalTrustScore = 0;
                let totalRiskScore = 0;
                let totalConsistencyScore = 0;
                const recommenderData = [];

                tokenRecommendations.forEach((recommendation) => {
                    const tokenPerformance =
                        this.trustScoreDb.getTokenPerformance(
                            recommendation.tokenAddress
                        );
                    const recommenderMetrics =
                        this.trustScoreDb.getRecommenderMetrics(
                            recommendation.recommenderId
                        );

                    const trustScore = this.calculateTrustScore(
                        tokenPerformance,
                        recommenderMetrics
                    );
                    const consistencyScore = this.calculateConsistencyScore(
                        tokenPerformance,
                        recommenderMetrics
                    );
                    const riskScore = this.calculateRiskScore(tokenPerformance);

                    // Accumulate scores for averaging
                    totalTrustScore += trustScore;
                    totalRiskScore += riskScore;
                    totalConsistencyScore += consistencyScore;

                    recommenderData.push({
                        recommenderId: recommendation.recommenderId,
                        trustScore,
                        riskScore,
                        consistencyScore,
                        recommenderMetrics,
                    });
                });

                // Calculate averages for this token
                const averageTrustScore =
                    totalTrustScore / tokenRecommendations.length;
                const averageRiskScore =
                    totalRiskScore / tokenRecommendations.length;
                const averageConsistencyScore =
                    totalConsistencyScore / tokenRecommendations.length;

                return {
                    tokenAddress,
                    averageTrustScore,
                    averageRiskScore,
                    averageConsistencyScore,
                    recommenders: recommenderData,
                };
            }
        );

        // Sort recommendations by the highest average trust score
        result.sort((a, b) => b.averageTrustScore - a.averageTrustScore);

        return result;
    }
}

export const trustScoreProvider: Provider = {
    async get(
        runtime: IAgentRuntime,
        message: Memory,
        _state?: State
    ): Promise<string> {
        try {
            const text = message.content.text.toLowerCase();
            const metricsMatch = text.match(/metrics for (\w+)/i);
            console.log("DEBUG 1 - Initial match:", { metricsMatch, text });

            if (metricsMatch) {
                const symbol = metricsMatch[1].toUpperCase();
                console.log("DEBUG 2 - Processing symbol:", symbol);
                console.log(
                    `Fetching metrics for ${symbol} via trustScoreProvider`
                );

                const connection = new Connection(
                    runtime.getSetting("RPC_URL") ||
                        "https://api.mainnet-beta.solana.com"
                );
                console.log("DEBUG 3 - Created connection");

                const { publicKey } = await getWalletKey(runtime, false);
                console.log(
                    "DEBUG 4 - Created publicKey:",
                    publicKey.toString()
                );

                const walletProvider = WalletProvider.getInstance(
                    connection,
                    publicKey
                );
                console.log("DEBUG 5 - Got WalletProvider instance");

                const tokenProvider = new TokenProvider(
                    null,
                    walletProvider,
                    runtime.cacheManager
                );
                console.log("DEBUG 6 - Created TokenProvider");

                try {
                    console.log("DEBUG 7 - Starting token lookup");
                    let tokenAddress = await tokenProvider.getTokenFromWallet(
                        runtime,
                        symbol
                    );
                    console.log(
                        "DEBUG 8 - Got token address:",
                        tokenAddress?.toString()
                    );

                    if (!tokenAddress) {
                        console.log(
                            "DEBUG 9 - Token not in wallet, trying DexScreener"
                        );
                        const result =
                            await tokenProvider.searchDexScreenerData(symbol);
                        console.log("DEBUG 10 - DexScreener result:", result);
                        if (result?.baseToken?.address) {
                            tokenAddress = result.baseToken.address;
                        }
                    }

                    if (!tokenAddress) {
                        return `Could not find token ${symbol}. Are you sure that's the right symbol?`;
                    }

                    const metricsProvider = new TokenProvider(
                        tokenAddress,
                        walletProvider,
                        runtime.cacheManager
                    );

                    console.log(
                        "About to fetch processed data for token:",
                        tokenAddress
                    );
                    const processedData =
                        await metricsProvider.getProcessedTokenData(runtime);
                    console.log("Processed data received:", {
                        hasTradeData: !!processedData?.tradeData,
                        hasSecurity: !!processedData?.security,
                        hasTokenCodex: !!processedData?.tokenCodex,
                    });

                    if (!processedData?.tradeData) {
                        console.log("No trade data available for token");
                        return `Found ${symbol} but couldn't fetch current metrics. Try again in a moment?`;
                    }

                    console.log("About to format token data...");
                    const formattedReport = metricsProvider.formatTokenData(
                        runtime,
                        processedData
                    );
                    console.log("=== TOKEN PROVIDER OUTPUT ===");
                    console.log("Provider:", {
                        name: this.name,
                        type: this.type,
                    });
                    console.log("Message ID:", message.id);
                    console.log(
                        "Report about to be returned:",
                        formattedReport
                    );

                    if (!formattedReport) {
                        console.log("No formatted report generated");
                        return `Error formatting metrics for ${symbol}. Please try again.`;
                    }

                    console.log("Returning formatted report:", formattedReport);
                    return formattedReport;
                } catch (error) {
                    console.error("Error fetching token metrics:", error);
                    return `Error fetching metrics for ${symbol}: ${error.message}`;
                }
            }

            // If not a metrics request, continue with existing trust score logic...
            if (runtime.getSetting("POSTGRES_URL")) {
                elizaLogger.warn(
                    "skipping trust evaluator because db is postgres"
                );
                return "";
            }

            // Original trust score code...
            const trustScoreDb = new TrustScoreDatabase(
                runtime.databaseAdapter.db
            );
            const userId = message.userId;

            // Rest of your original trust score logic...
            if (!userId) {
                console.error("User ID is missing from the message");
                return "";
            }

            // Get the recommender metrics for the user
            const recommenderMetrics =
                await trustScoreDb.getRecommenderMetrics(userId);

            if (!recommenderMetrics) {
                console.error("No recommender metrics found for user:", userId);
                return "";
            }

            // Compute the trust score
            const trustScore = recommenderMetrics.trustScore;

            const user = await runtime.databaseAdapter.getAccountById(userId);

            // Format the trust score string
            const trustScoreString = `${user.name}'s trust score: ${trustScore.toFixed(2)}`;

            return trustScoreString;
        } catch (error) {
            console.error("Error in trust score provider:", error.message);
            return `Failed to fetch trust score: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
    },
};
