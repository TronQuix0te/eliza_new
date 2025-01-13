import { ICacheManager, settings } from "@elizaos/core";
import { IAgentRuntime, Memory, Provider, State } from "@elizaos/core";
import { normalizeAddress } from "../keypairUtils";
import {
    DexScreenerData,
    DexScreenerPair,
    HolderData,
    ProcessedTokenData,
    TokenSecurityData,
    TokenTradeData,
    CalculatedBuyAmounts,
    Prices,
    TokenCodex,
} from "../types/token.ts";
import NodeCache from "node-cache";
import * as path from "path";
import { toBN } from "../bignumber.ts";
import { WalletProvider, Item } from "./wallet.ts";
import { Connection } from "@solana/web3.js";
import { getWalletKey } from "../keypairUtils.ts";
import { MarketAnalyzer } from "../utils/marketAnalysis";
import { RiskAnalyzer } from "../utils/riskAnalysis";

const PROVIDER_CONFIG = {
    BIRDEYE_API: "https://public-api.birdeye.so",
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    DEFAULT_RPC: "https://api.mainnet-beta.solana.com",
    TOKEN_ADDRESSES: {
        SOL: "So11111111111111111111111111111111111111112",
        BTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
        ETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
        Example: "2weMjPLLybRMMva1fM3U31goWWrCpF59CHWNhnCJ9Vyh",
    },
    TOKEN_SECURITY_ENDPOINT: "/defi/token_security?address=",
    TOKEN_TRADE_DATA_ENDPOINT: "/defi/v3/token/trade-data/single?address=",
    DEX_SCREENER_API: "https://api.dexscreener.com/latest/dex/tokens/",
    MAIN_WALLET: "",
};

export class TokenProvider {
    private cache: NodeCache;
    private cacheKey: string = "solana/tokens";
    private NETWORK_ID = 1399811149;
    private GRAPHQL_ENDPOINT = "https://graph.codex.io/graphql";

    constructor(
        private tokenAddress: string | null,
        private walletProvider: WalletProvider,
        private cacheManager: ICacheManager
    ) {
        console.log(
            "TokenProvider constructor received address:",
            tokenAddress
        );
        // Add validation but handle cross-chain addresses gracefully
        if (tokenAddress) {
            try {
                this.tokenAddress = normalizeAddress(tokenAddress);
                console.log("Address normalized to:", this.tokenAddress);
            } catch (error) {
                console.warn("Address normalization failed:", error);
                this.tokenAddress = null; // Set to null and continue rather than throwing
            }
        } else {
            console.warn("No address provided to TokenProvider constructor");
        }
        this.cache = new NodeCache({ stdTTL: 600 });
    }

    public getTokenAddress(): string | null {
        return this.tokenAddress;
    }

    private getDefaultTradeData(): TokenTradeData {
        return {
            address: this.tokenAddress,
            holder: 0,
            market: 0,
            last_trade_unix_time: 0,
            last_trade_human_time: new Date().toISOString(),
            price: 0,
            history_30m_price: 0,
            price_change_30m_percent: 0,
            history_1h_price: 0,
            price_change_1h_percent: 0,
            history_2h_price: 0,
            price_change_2h_percent: 0,
            history_4h_price: 0,
            price_change_4h_percent: 0,
            history_6h_price: 0,
            price_change_6h_percent: 0,
            history_8h_price: 0,
            price_change_8h_percent: 0,
            history_12h_price: 0,
            price_change_12h_percent: 0,
            history_24h_price: 0,
            price_change_24h_percent: 0,
            unique_wallet_30m: 0,
            unique_wallet_history_30m: 0,
            unique_wallet_30m_change_percent: 0,
            unique_wallet_1h: 0,
            unique_wallet_history_1h: 0,
            unique_wallet_1h_change_percent: 0,
            unique_wallet_2h: 0,
            unique_wallet_history_2h: 0,
            unique_wallet_2h_change_percent: 0,
            unique_wallet_4h: 0,
            unique_wallet_history_4h: 0,
            unique_wallet_4h_change_percent: 0,
            unique_wallet_8h: 0,
            unique_wallet_history_8h: null,
            unique_wallet_8h_change_percent: null,
            unique_wallet_24h: 0,
            unique_wallet_history_24h: null,
            unique_wallet_24h_change_percent: null,
            trade_30m: 0,
            trade_history_30m: 0,
            trade_30m_change_percent: 0,
            trade_1h: 0,
            trade_history_1h: 0,
            trade_1h_change_percent: 0,
            trade_2h: 0,
            trade_history_2h: 0,
            trade_2h_change_percent: 0,
            trade_4h: 0,
            trade_history_4h: 0,
            trade_4h_change_percent: 0,
            trade_8h: 0,
            trade_history_8h: null,
            trade_8h_change_percent: null,
            trade_24h: 0,
            trade_history_24h: 0,
            trade_24h_change_percent: null,
            sell_30m: 0,
            sell_history_30m: 0,
            sell_30m_change_percent: 0,
            buy_30m: 0,
            buy_history_30m: 0,
            buy_30m_change_percent: 0,
            volume_30m: 0,
            volume_30m_usd: 0,
            volume_history_30m: 0,
            volume_history_30m_usd: 0,
            volume_30m_change_percent: 0,
            volume_buy_30m: 0,
            volume_buy_30m_usd: 0,
            volume_buy_history_30m: 0,
            volume_buy_history_30m_usd: 0,
            volume_buy_30m_change_percent: 0,
            volume_sell_30m: 0,
            volume_sell_30m_usd: 0,
            volume_sell_history_30m: 0,
            volume_sell_history_30m_usd: 0,
            volume_sell_30m_change_percent: 0,
            volume_1h: 0,
            volume_1h_usd: 0,
            volume_history_1h: 0,
            volume_history_1h_usd: 0,
            volume_1h_change_percent: 0,
            volume_buy_1h: 0,
            volume_buy_1h_usd: 0,
            volume_buy_history_1h: 0,
            volume_buy_history_1h_usd: 0,
            volume_buy_1h_change_percent: 0,
            volume_sell_1h: 0,
            volume_sell_1h_usd: 0,
            volume_sell_history_1h: 0,
            volume_sell_history_1h_usd: 0,
            volume_sell_1h_change_percent: 0,
            volume_2h: 0,
            volume_2h_usd: 0,
            volume_history_2h: 0,
            volume_history_2h_usd: 0,
            volume_2h_change_percent: 0,
            volume_buy_2h: 0,
            volume_buy_2h_usd: 0,
            volume_buy_history_2h: 0,
            volume_buy_history_2h_usd: 0,
            volume_buy_2h_change_percent: 0,
            volume_sell_2h: 0,
            volume_sell_2h_usd: 0,
            volume_sell_history_2h: 0,
            volume_sell_history_2h_usd: 0,
            volume_sell_2h_change_percent: 0,
            volume_4h: 0,
            volume_4h_usd: 0,
            volume_history_4h: 0,
            volume_history_4h_usd: 0,
            volume_4h_change_percent: 0,
            volume_buy_4h: 0,
            volume_buy_4h_usd: 0,
            volume_buy_history_4h: 0,
            volume_buy_history_4h_usd: 0,
            volume_buy_4h_change_percent: 0,
            volume_sell_4h: 0,
            volume_sell_4h_usd: 0,
            volume_sell_history_4h: 0,
            volume_sell_history_4h_usd: 0,
            volume_sell_4h_change_percent: 0,
            volume_8h: 0,
            volume_8h_usd: 0,
            volume_history_8h: 0,
            volume_history_8h_usd: 0,
            volume_8h_change_percent: null,
            volume_buy_8h: 0,
            volume_buy_8h_usd: 0,
            volume_buy_history_8h: 0,
            volume_buy_history_8h_usd: 0,
            volume_buy_8h_change_percent: null,
            volume_sell_8h: 0,
            volume_sell_8h_usd: 0,
            volume_sell_history_8h: 0,
            volume_sell_history_8h_usd: 0,
            volume_sell_8h_change_percent: null,
            volume_24h: 0,
            volume_24h_usd: 0,
            volume_history_24h: 0,
            volume_history_24h_usd: 0,
            volume_24h_change_percent: null,
            volume_buy_24h: 0,
            volume_buy_24h_usd: 0,
            volume_buy_history_24h: 0,
            volume_buy_history_24h_usd: 0,
            volume_buy_24h_change_percent: null,
            volume_sell_24h: 0,
            volume_sell_24h_usd: 0,
            volume_sell_history_24h: 0,
            volume_sell_history_24h_usd: 0,
            volume_sell_24h_change_percent: null,
            sell_1h: 0,
            sell_history_1h: 0,
            sell_1h_change_percent: 0,
            buy_1h: 0,
            buy_history_1h: 0,
            buy_1h_change_percent: 0,
            sell_2h: 0,
            sell_history_2h: 0,
            sell_2h_change_percent: 0,
            buy_2h: 0,
            buy_history_2h: 0,
            buy_2h_change_percent: 0,
            sell_4h: 0,
            sell_history_4h: 0,
            sell_4h_change_percent: 0,
            buy_4h: 0,
            buy_history_4h: 0,
            buy_4h_change_percent: 0,
            sell_8h: 0,
            sell_history_8h: null,
            sell_8h_change_percent: null,
            buy_8h: 0,
            buy_history_8h: null,
            buy_8h_change_percent: null,
            sell_24h: 0,
            sell_history_24h: 0,
            sell_24h_change_percent: null,
            buy_24h: 0,
            buy_history_24h: 0,
            buy_24h_change_percent: null,
        };
    }

    private async readFromCache<T>(key: string): Promise<T | null> {
        try {
            const cached = await this.cacheManager.get<T>(
                path.join(this.cacheKey, key)
            );
            return cached;
        } catch (error) {
            console.error("Error reading from cache:", error);
            return null;
        }
    }

    private async writeToCache<T>(key: string, data: T): Promise<void> {
        try {
            await this.cacheManager.set(path.join(this.cacheKey, key), data, {
                expires: Date.now() + 10 * 60 * 1000,
            });
        } catch (error) {
            console.error("Error writing to cache:", error);
        }
    }

    private async getCachedData<T>(key: string): Promise<T | null> {
        try {
            // Check in-memory cache first
            const cachedData = this.cache.get<T>(key);
            if (cachedData) {
                return cachedData;
            }

            // Check file-based cache
            const fileCachedData = await this.readFromCache<T>(key);
            if (fileCachedData) {
                // Populate in-memory cache
                this.cache.set(key, fileCachedData);
                return fileCachedData;
            }

            return null;
        } catch (error) {
            console.error("Error getting cached data for key:", key, error);
            return null;
        }
    }

    private async setCachedData<T>(cacheKey: string, data: T): Promise<void> {
        try {
            // Set in-memory cache
            this.cache.set(cacheKey, data);

            // Write to file-based cache
            await this.writeToCache(cacheKey, data);
        } catch (error) {
            console.error(
                "Error setting cached data for key:",
                cacheKey,
                error
            );
        }
    }

    private async fetchWithRetry(
        url: string,
        options: RequestInit = {}
    ): Promise<any> {
        let lastError: Error;

        for (let i = 0; i < PROVIDER_CONFIG.MAX_RETRIES; i++) {
            try {
                const response = await fetch(url, {
                    ...options,
                    headers: {
                        Accept: "application/json",
                        "x-chain": "solana",
                        "X-API-KEY": settings.BIRDEYE_API_KEY || "",
                        ...options.headers,
                    },
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(
                        `HTTP error! status: ${response.status}, message: ${errorText}`
                    );
                }

                const data = await response.json();
                return data;
            } catch (error) {
                console.error(`Attempt ${i + 1} failed:`, error);
                lastError = error as Error;
                if (i < PROVIDER_CONFIG.MAX_RETRIES - 1) {
                    const delay = PROVIDER_CONFIG.RETRY_DELAY * Math.pow(2, i);
                    console.log(`Waiting ${delay}ms before retrying...`);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }
            }
        }

        console.error(
            "All attempts failed. Throwing the last error:",
            lastError
        );
        throw lastError;
    }

    async getTokensInWallet(runtime: IAgentRuntime): Promise<Item[]> {
        const walletInfo =
            await this.walletProvider.fetchPortfolioValue(runtime);
        const items = walletInfo.items;
        return items;
    }

    // check if the token symbol is in the wallet
    async getTokenFromWallet(runtime: IAgentRuntime, tokenSymbol: string) {
        try {
            // First try to find in wallet
            const items = await this.getTokensInWallet(runtime);
            const token = items.find(
                (item) =>
                    item.symbol.toUpperCase() === tokenSymbol.toUpperCase()
            );

            if (token) {
                return normalizeAddress(token.address);
            }

            // If not in wallet, search Birdeye
            return await this.searchBirdeyeForToken(tokenSymbol, runtime);
        } catch (error) {
            console.error("Error checking token in wallet:", error);
            return null;
        }
    }

    private async searchBirdeyeForToken(
        tokenSymbol: string,
        runtime: IAgentRuntime
    ): Promise<string | null> {
        try {
            const apiKey = runtime.getSetting("BIRDEYE_API_KEY");
            if (!apiKey) {
                console.error("BIRDEYE_API_KEY not found in settings");
                return null;
            }

            const options = {
                method: "GET",
                headers: {
                    accept: "application/json",
                    "X-API-KEY": apiKey,
                },
            };

            const url = `${PROVIDER_CONFIG.BIRDEYE_API}/defi/v3/search?chain=solana&keyword=${encodeURIComponent(tokenSymbol)}&target=token&sort_by=volume_24h_usd&sort_type=desc&verify_token=true&offset=0&limit=20`;
            console.log("Searching Birdeye for token:", {
                symbol: tokenSymbol,
                url,
            });

            const response = await this.fetchWithRetry(url, options);
            console.log("Birdeye search response:", response);

            // Fix the nested structure parsing
            if (response?.data?.items && response.data.items.length > 0) {
                const tokenResults = response.data.items[0].result;
                console.log("Token results:", tokenResults);

                if (tokenResults && tokenResults.length > 0) {
                    // Sort by volume and market cap for best match
                    const sortedTokens = tokenResults.sort(
                        (a: any, b: any) =>
                            (b.volume_24h_usd || 0) - (a.volume_24h_usd || 0)
                    );

                    const normalizeSymbol = (s: string) =>
                        s.trim().replace("$", "").toUpperCase();
                    const exactMatch = sortedTokens.find(
                        (token: any) =>
                            normalizeSymbol(token.symbol) ===
                            normalizeSymbol(tokenSymbol)
                    );

                    if (exactMatch) {
                        const address = normalizeAddress(exactMatch.address);
                        console.log("Found token address:", address);
                        return address;
                    }
                }
            }

            console.warn(`No matching token found for symbol: ${tokenSymbol}`);
            return null;
        } catch (error) {
            console.error(
                `Error searching Birdeye for token ${tokenSymbol}:`,
                error
            );
            return null;
        }
    }

    static async createFromSymbol(
        symbol: string,
        walletProvider: WalletProvider,
        cacheManager: ICacheManager,
        runtime: IAgentRuntime
    ): Promise<TokenProvider | null> {
        // First try to find in wallet
        const portfolio = await walletProvider.fetchPortfolioValue(runtime);
        const token = portfolio.items.find(
            (item) => item.symbol.toUpperCase() === symbol.toUpperCase()
        );

        if (token) {
            return new TokenProvider(
                normalizeAddress(token.address),
                walletProvider,
                cacheManager
            );
        }

        // If not in wallet, search Birdeye
        const tempProvider = new TokenProvider(
            "",
            walletProvider,
            cacheManager
        );
        const address = await tempProvider.searchBirdeyeForToken(
            symbol,
            runtime
        );

        if (address) {
            return new TokenProvider(address, walletProvider, cacheManager);
        }

        console.warn(`Could not find token address for symbol: ${symbol}`);
        return null;
    }

    private async initializeAddress(
        symbol: string,
        runtime: IAgentRuntime
    ): Promise<boolean> {
        if (!this.tokenAddress && symbol) {
            console.log(
                `Attempting to initialize address for symbol: ${symbol}`
            );
            const foundAddress = await this.searchBirdeyeForToken(
                symbol,
                runtime
            );
            if (foundAddress) {
                console.log(
                    `Found address ${foundAddress} for symbol ${symbol}`
                );
                this.tokenAddress = foundAddress;
                return true;
            }
            console.warn(`Could not find address for symbol ${symbol}`);
        }
        return false;
    }

    async fetchTokenCodex(
        runtime?: IAgentRuntime,
        symbol?: string
    ): Promise<TokenCodex> {
        try {
            // Try to initialize address if we don't have one
            if (!this.tokenAddress && symbol && runtime) {
                await this.initializeAddress(symbol, runtime);
            }

            if (!this.tokenAddress) {
                throw new Error(
                    "No token address available for fetching token codex"
                );
            }

            console.log(
                "fetchTokenCodex called with tokenAddress:",
                this.tokenAddress
            );
            const cacheKey = `token_${this.tokenAddress}`;
            const cachedData = await this.getCachedData<TokenCodex>(cacheKey);
            if (cachedData) {
                console.log(
                    `Returning cached token data for ${this.tokenAddress}.`
                );
                return cachedData;
            }

            const query = `
                query Token($address: String!, $networkId: Int!) {
                    token(input: { address: $address, networkId: $networkId }) {
                        id
                        address
                        cmcId
                        decimals
                        name
                        symbol
                        totalSupply
                        isScam
                        info {
                            circulatingSupply
                            imageThumbUrl
                        }
                        explorerData {
                            blueCheckmark
                            description
                            tokenType
                        }
                    }
                }
            `;

            const variables = {
                address: this.tokenAddress,
                networkId: this.NETWORK_ID, // Solana
            };

            const requestBody = {
                query,
                variables,
            };

            console.log(
                "Making Codex API call with full request:",
                JSON.stringify(requestBody, null, 2)
            );
            console.log(
                "Using API key:",
                settings.CODEX_API_KEY?.substring(0, 10) + "..."
            );

            const response = await fetch(this.GRAPHQL_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `${settings.CODEX_API_KEY}`,
                },
                body: JSON.stringify(requestBody),
            });

            const responseData = await response.json();
            console.log(
                "Codex API Response:",
                JSON.stringify(responseData, null, 2)
            );

            if (!response.ok) {
                throw new Error(
                    `Codex API error: ${response.status} ${response.statusText}`
                );
            }

            if (responseData.errors) {
                throw new Error(
                    `GraphQL errors: ${JSON.stringify(responseData.errors)}`
                );
            }

            const token = responseData.data?.token;
            if (!token) {
                throw new Error(
                    `No data returned for token ${this.tokenAddress}`
                );
            }

            const tokenCodex: TokenCodex = {
                id: token.id,
                address: token.address,
                cmcId: token.cmcId,
                decimals: token.decimals,
                name: token.name,
                symbol: token.symbol,
                totalSupply: token.totalSupply,
                circulatingSupply: token.info?.circulatingSupply,
                imageThumbUrl: token.info?.imageThumbUrl,
                blueCheckmark: token.explorerData?.blueCheckmark,
                isScam: token.isScam ? true : false,
            };

            await this.setCachedData(cacheKey, tokenCodex);
            return tokenCodex;
        } catch (error) {
            console.error("Error fetching token data from Codex:", error);
            console.error("Full error:", JSON.stringify(error, null, 2));
            throw error;
        }
    }

    async fetchPrices(): Promise<Prices> {
        try {
            const cacheKey = "prices";
            const cachedData = await this.getCachedData<Prices>(cacheKey);
            if (cachedData) {
                console.log("Returning cached prices:", cachedData);
                return cachedData;
            }
            console.log("Cache miss, fetching fresh prices");
            const { SOL, BTC, ETH } = PROVIDER_CONFIG.TOKEN_ADDRESSES;
            const tokens = [SOL, BTC, ETH];
            const prices: Prices = {
                solana: { usd: "0" },
                bitcoin: { usd: "0" },
                ethereum: { usd: "0" },
            };

            for (const token of tokens) {
                try {
                    console.log(`Fetching price for token: ${token}`);
                    const response = await this.fetchWithRetry(
                        `${PROVIDER_CONFIG.BIRDEYE_API}/defi/price?address=${token}`,
                        {
                            headers: {
                                "x-chain": "solana",
                            },
                        }
                    );

                    if (response?.data?.value) {
                        const price = response.data.value.toString();
                        console.log(`Got price for ${token}:`, price);
                        prices[
                            token === SOL
                                ? "solana"
                                : token === BTC
                                  ? "bitcoin"
                                  : "ethereum"
                        ].usd = price;
                    } else {
                        console.warn(
                            `No price data available for token: ${token}`,
                            response
                        );
                    }
                } catch (fetchError) {
                    console.error(
                        `Error fetching price for token ${token}:`,
                        fetchError
                    );
                    // Continue with next token instead of failing completely
                    continue;
                }
            }

            // Only cache if we got at least one valid price
            if (Object.values(prices).some((p) => p.usd !== "0")) {
                console.log("Setting cache with prices:", prices);
                await this.setCachedData(cacheKey, prices);
            } else {
                console.warn(
                    "No valid prices fetched, not caching empty results"
                );
            }
            return prices;
        } catch (error) {
            console.error("Error in fetchPrices:", error);
            // Return default prices instead of throwing
            return {
                solana: { usd: "0" },
                bitcoin: { usd: "0" },
                ethereum: { usd: "0" },
            };
        }
    }
    async calculateBuyAmounts(): Promise<CalculatedBuyAmounts> {
        const dexScreenerData = await this.fetchDexScreenerData();
        console.log("DexScreener data:", {
            tokenAddress: this.tokenAddress,
            pairs: dexScreenerData?.pairs || [],
            firstPair: dexScreenerData?.pairs?.[0] || null,
        });
        const prices = await this.fetchPrices();
        const solPrice = toBN(prices.solana.usd);

        if (
            !dexScreenerData ||
            !dexScreenerData.pairs ||
            dexScreenerData.pairs.length === 0
        ) {
            console.warn("No DEX data available for token:", this.tokenAddress);
            return { none: 0, low: 0, medium: 0, high: 0 };
        }

        // Get the first pair
        const pair = dexScreenerData.pairs[0];
        const { liquidity } = pair;

        // Use fallback values if data is missing
        const liquidityUsd = liquidity?.usd || 0;

        // Only return zeros if there's absolutely no liquidity
        if (liquidityUsd <= 0) {
            console.warn("Zero liquidity for token:", this.tokenAddress);
            return { none: 0, low: 0, medium: 0, high: 0 };
        }

        // Calculate impact percentages
        const impactPercentages = {
            LOW: 0.01, // 1% of liquidity
            MEDIUM: 0.05, // 5% of liquidity
            HIGH: 0.1, // 10% of liquidity
        };

        // Calculate buy amounts in USD
        const lowBuyAmountUSD = liquidityUsd * impactPercentages.LOW;
        const mediumBuyAmountUSD = liquidityUsd * impactPercentages.MEDIUM;
        const highBuyAmountUSD = liquidityUsd * impactPercentages.HIGH;

        // Convert to SOL
        return {
            none: 0,
            low: toBN(lowBuyAmountUSD).div(solPrice).toNumber(),
            medium: toBN(mediumBuyAmountUSD).div(solPrice).toNumber(),
            high: toBN(highBuyAmountUSD).div(solPrice).toNumber(),
        };
    }

    async fetchTokenSecurity(): Promise<TokenSecurityData> {
        const cacheKey = `tokenSecurity_${this.tokenAddress.toLowerCase()}`;
        const cachedData = await this.getCachedData<TokenSecurityData>(cacheKey);
        if (cachedData) {
            console.log(
                `Returning cached token security data for ${this.tokenAddress}.`
            );
            return cachedData;
        }

        console.log(`Fetching security data for token: ${this.tokenAddress}`);
        const url = `${PROVIDER_CONFIG.BIRDEYE_API}${PROVIDER_CONFIG.TOKEN_SECURITY_ENDPOINT}${this.tokenAddress}`;

        try {
            const data = await this.fetchWithRetry(url);
            console.log("Raw security data response:", data);

            if (!data?.success || !data?.data) {
                console.log("Invalid security data response, using default values");
                return {
                    ownerBalance: "0",
                    creatorBalance: "0",
                    ownerPercentage: 0,
                    creatorPercentage: 0,
                    top10HolderBalance: "0",
                    top10HolderPercent: 0,
                    totalSupply: "0"
                };
            }

            const security: TokenSecurityData = {
                ownerBalance: data.data.ownerBalance?.toString() || data.data.creatorBalance?.toString() || "0",
                creatorBalance: data.data.creatorBalance?.toString() || "0",
                ownerPercentage: data.data.ownerPercentage || data.data.creatorPercentage || 0,
                creatorPercentage: data.data.creatorPercentage || 0,
                top10HolderBalance: data.data.top10HolderBalance?.toString() || "0",
                top10HolderPercent: data.data.top10HolderPercent || 0,
                totalSupply: data.data.totalSupply?.toString() || "0"
            };

            console.log("Processed security data:", security);
            await this.setCachedData(cacheKey, security);
            return security;
        } catch (error) {
            console.log("Error fetching security data, using default values:", error);
            return {
                ownerBalance: "0",
                creatorBalance: "0",
                ownerPercentage: 0,
                creatorPercentage: 0,
                top10HolderBalance: "0",
                top10HolderPercent: 0,
                totalSupply: "0"
            };
        }
    }

    async fetchTokenTradeData(runtime: IAgentRuntime): Promise<TokenTradeData> {
        const cacheKey = `tokenTradeData_${this.tokenAddress}`;
        const cachedData = await this.getCachedData<TokenTradeData>(cacheKey);
        if (cachedData?.price) {
            console.log(
                `Returning cached token trade data for ${this.tokenAddress}`
            );
            return cachedData;
        }
        console.log(`Fetching fresh trade data for ${this.tokenAddress}`);

        try {
            const apiKey = runtime.getSetting("BIRDEYE_API_KEY");
            if (!apiKey) {
                console.error("BIRDEYE_API_KEY not found in settings");
                return null;
            }

            const options = {
                method: "GET",
                headers: {
                    accept: "application/json",
                    "X-API-KEY": apiKey,
                },
            };

            const url = `${PROVIDER_CONFIG.BIRDEYE_API}/defi/token_overview?address=${this.tokenAddress}`;
            const data = await this.fetchWithRetry(url, options);

            if (!data?.success || !data?.data) {
                throw new Error("No token overview data available");
            }

            const overview = data.data;

            const tradeData: TokenTradeData = {
                address: this.tokenAddress,
                holder: overview.holder || 0,
                market: overview.numberMarkets || 0,
                last_trade_unix_time: overview.lastTradeUnixTime || 0,
                last_trade_human_time:
                    overview.lastTradeHumanTime || new Date().toISOString(),
                price: overview.price || 0,

                // 30m data
                history_30m_price: overview.history30mPrice || 0,
                price_change_30m_percent: overview.priceChange30mPercent || 0,
                unique_wallet_30m: overview.uniqueWallet30m || 0,
                unique_wallet_history_30m: overview.uniqueWalletHistory30m || 0,
                unique_wallet_30m_change_percent:
                    overview.uniqueWallet30mChangePercent || 0,
                trade_30m: overview.trade30m || 0,
                trade_history_30m: overview.tradeHistory30m || 0,
                trade_30m_change_percent: overview.trade30mChangePercent || 0,
                sell_30m: overview.sell30m || 0,
                sell_history_30m: overview.sellHistory30m || 0,
                sell_30m_change_percent: overview.sell30mChangePercent || 0,
                buy_30m: overview.buy30m || 0,
                buy_history_30m: overview.buyHistory30m || 0,
                buy_30m_change_percent: overview.buy30mChangePercent || 0,
                volume_30m: overview.v30m || 0,
                volume_30m_usd: overview.v30mUSD || 0,
                volume_history_30m: overview.vHistory30m || 0,
                volume_history_30m_usd: overview.vHistory30mUSD || 0,
                volume_30m_change_percent: overview.v30mChangePercent || 0,
                volume_buy_30m: overview.vBuy30m || 0,
                volume_buy_30m_usd: overview.vBuy30mUSD || 0,
                volume_buy_history_30m: overview.vBuyHistory30m || 0,
                volume_buy_history_30m_usd: overview.vBuyHistory30mUSD || 0,
                volume_buy_30m_change_percent:
                    overview.vBuy30mChangePercent || 0,
                volume_sell_30m: overview.vSell30m || 0,
                volume_sell_30m_usd: overview.vSell30mUSD || 0,
                volume_sell_history_30m: overview.vSellHistory30m || 0,
                volume_sell_history_30m_usd: overview.vSellHistory30mUSD || 0,
                volume_sell_30m_change_percent:
                    overview.vSell30mChangePercent || 0,

                // 1h data
                history_1h_price: overview.history1hPrice || 0,
                price_change_1h_percent: overview.priceChange1hPercent || 0,
                unique_wallet_1h: overview.uniqueWallet1h || 0,
                unique_wallet_history_1h: overview.uniqueWalletHistory1h || 0,
                unique_wallet_1h_change_percent:
                    overview.uniqueWallet1hChangePercent || 0,
                trade_1h: overview.trade1h || 0,
                trade_history_1h: overview.tradeHistory1h || 0,
                trade_1h_change_percent: overview.trade1hChangePercent || 0,
                sell_1h: overview.sell1h || 0,
                sell_history_1h: overview.sellHistory1h || 0,
                sell_1h_change_percent: overview.sell1hChangePercent || 0,
                buy_1h: overview.buy1h || 0,
                buy_history_1h: overview.buyHistory1h || 0,
                buy_1h_change_percent: overview.buy1hChangePercent || 0,
                volume_1h: overview.v1h || 0,
                volume_1h_usd: overview.v1hUSD || 0,
                volume_history_1h: overview.vHistory1h || 0,
                volume_history_1h_usd: overview.vHistory1hUSD || 0,
                volume_1h_change_percent: overview.v1hChangePercent || 0,
                volume_buy_1h: overview.vBuy1h || 0,
                volume_buy_1h_usd: overview.vBuy1hUSD || 0,
                volume_buy_history_1h: overview.vBuyHistory1h || 0,
                volume_buy_history_1h_usd: overview.vBuyHistory1hUSD || 0,
                volume_buy_1h_change_percent: overview.vBuy1hChangePercent || 0,
                volume_sell_1h: overview.vSell1h || 0,
                volume_sell_1h_usd: overview.vSell1hUSD || 0,
                volume_sell_history_1h: overview.vSellHistory1h || 0,
                volume_sell_history_1h_usd: overview.vSellHistory1hUSD || 0,
                volume_sell_1h_change_percent:
                    overview.vSell1hChangePercent || 0,

                // 2h data
                history_2h_price: overview.history2hPrice || 0,
                price_change_2h_percent: overview.priceChange2hPercent || 0,
                unique_wallet_2h: overview.uniqueWallet2h || 0,
                unique_wallet_history_2h: overview.uniqueWalletHistory2h || 0,
                unique_wallet_2h_change_percent:
                    overview.uniqueWallet2hChangePercent || 0,
                trade_2h: overview.trade2h || 0,
                trade_history_2h: overview.tradeHistory2h || 0,
                trade_2h_change_percent: overview.trade2hChangePercent || 0,
                sell_2h: overview.sell2h || 0,
                sell_history_2h: overview.sellHistory2h || 0,
                sell_2h_change_percent: overview.sell2hChangePercent || 0,
                buy_2h: overview.buy2h || 0,
                buy_history_2h: overview.buyHistory2h || 0,
                buy_2h_change_percent: overview.buy2hChangePercent || 0,
                volume_2h: overview.v2h || 0,
                volume_2h_usd: overview.v2hUSD || 0,
                volume_history_2h: overview.vHistory2h || 0,
                volume_history_2h_usd: overview.vHistory2hUSD || 0,
                volume_2h_change_percent: overview.v2hChangePercent || 0,
                volume_buy_2h: overview.vBuy2h || 0,
                volume_buy_2h_usd: overview.vBuy2hUSD || 0,
                volume_buy_history_2h: overview.vBuyHistory2h || 0,
                volume_buy_history_2h_usd: overview.vBuyHistory2hUSD || 0,
                volume_buy_2h_change_percent: overview.vBuy2hChangePercent || 0,
                volume_sell_2h: overview.vSell2h || 0,
                volume_sell_2h_usd: overview.vSell2hUSD || 0,
                volume_sell_history_2h: overview.vSellHistory2h || 0,
                volume_sell_history_2h_usd: overview.vSellHistory2hUSD || 0,
                volume_sell_2h_change_percent:
                    overview.vSell2hChangePercent || 0,

                // 4h data
                history_4h_price: overview.history4hPrice || 0,
                price_change_4h_percent: overview.priceChange4hPercent || 0,
                unique_wallet_4h: overview.uniqueWallet4h || 0,
                unique_wallet_history_4h: overview.uniqueWalletHistory4h || 0,
                unique_wallet_4h_change_percent:
                    overview.uniqueWallet4hChangePercent || 0,
                trade_4h: overview.trade4h || 0,
                trade_history_4h: overview.tradeHistory4h || 0,
                trade_4h_change_percent: overview.trade4hChangePercent || 0,
                sell_4h: overview.sell4h || 0,
                sell_history_4h: overview.sellHistory4h || 0,
                sell_4h_change_percent: overview.sell4hChangePercent || 0,
                buy_4h: overview.buy4h || 0,
                buy_history_4h: overview.buyHistory4h || 0,
                buy_4h_change_percent: overview.buy4hChangePercent || 0,
                volume_4h: overview.v4h || 0,
                volume_4h_usd: overview.v4hUSD || 0,
                volume_history_4h: overview.vHistory4h || 0,
                volume_history_4h_usd: overview.vHistory4hUSD || 0,
                volume_4h_change_percent: overview.v4hChangePercent || 0,
                volume_buy_4h: overview.vBuy4h || 0,
                volume_buy_4h_usd: overview.vBuy4hUSD || 0,
                volume_buy_history_4h: overview.vBuyHistory4h || 0,
                volume_buy_history_4h_usd: overview.vBuyHistory4hUSD || 0,
                volume_buy_4h_change_percent: overview.vBuy4hChangePercent || 0,
                volume_sell_4h: overview.vSell4h || 0,
                volume_sell_4h_usd: overview.vSell4hUSD || 0,
                volume_sell_history_4h: overview.vSellHistory4h || 0,
                volume_sell_history_4h_usd: overview.vSellHistory4hUSD || 0,
                volume_sell_4h_change_percent:
                    overview.vSell4hChangePercent || 0,

                // 6h data
                history_6h_price: overview.history6hPrice || 0,
                price_change_6h_percent: overview.priceChange6hPercent || 0,

                // 12h data
                history_12h_price: overview.history12hPrice || 0,
                price_change_12h_percent: overview.priceChange12hPercent || 0,

                // 8h data
                history_8h_price: overview.history8hPrice || 0,
                price_change_8h_percent: overview.priceChange8hPercent || 0,
                unique_wallet_8h: overview.uniqueWallet8h || 0,
                unique_wallet_history_8h: overview.uniqueWalletHistory8h,
                unique_wallet_8h_change_percent:
                    overview.uniqueWallet8hChangePercent,
                trade_8h: overview.trade8h || 0,
                trade_history_8h: overview.tradeHistory8h || null,
                trade_8h_change_percent: overview.trade8hChangePercent || null,
                sell_8h: overview.sell8h || 0,
                sell_history_8h: overview.sellHistory8h || null,
                sell_8h_change_percent: overview.sell8hChangePercent || null,
                buy_8h: overview.buy8h || 0,
                buy_history_8h: overview.buyHistory8h || null,
                buy_8h_change_percent: overview.buy8hChangePercent || null,
                volume_8h: overview.v8h || 0,
                volume_8h_usd: overview.v8hUSD || 0,
                volume_history_8h: overview.vHistory8h || 0,
                volume_history_8h_usd: overview.vHistory8hUSD || 0,
                volume_8h_change_percent: overview.v8hChangePercent || null,
                volume_buy_8h: overview.vBuy8h || 0,
                volume_buy_8h_usd: overview.vBuy8hUSD || 0,
                volume_buy_history_8h: overview.vBuyHistory8h || 0,
                volume_buy_history_8h_usd: overview.vBuyHistory8hUSD || 0,
                volume_buy_8h_change_percent:
                    overview.vBuy8hChangePercent || null,
                volume_sell_8h: overview.vSell8h || 0,
                volume_sell_8h_usd: overview.vSell8hUSD || 0,
                volume_sell_history_8h: overview.vSellHistory8h || 0,
                volume_sell_history_8h_usd: overview.vSellHistory8hUSD || 0,
                volume_sell_8h_change_percent:
                    overview.vSell8hChangePercent || null,

                // 24h data
                history_24h_price: overview.history24hPrice || 0,
                price_change_24h_percent: overview.priceChange24hPercent || 0,
                unique_wallet_24h: overview.uniqueWallet24h || 0,
                unique_wallet_history_24h: overview.uniqueWalletHistory24h,
                unique_wallet_24h_change_percent:
                    overview.uniqueWallet24hChangePercent,
                trade_24h: overview.trade24h || 0,
                trade_history_24h: overview.tradeHistory24h || 0,
                trade_24h_change_percent:
                    overview.trade24hChangePercent || null,
                sell_24h: overview.sell24h || 0,
                sell_history_24h: overview.sellHistory24h || 0,
                sell_24h_change_percent: overview.sell24hChangePercent || null,
                buy_24h: overview.buy24h || 0,
                buy_history_24h: overview.buyHistory24h || 0,
                buy_24h_change_percent: overview.buy24hChangePercent || null,
                volume_24h: overview.v24h || 0,
                volume_24h_usd: overview.v24hUSD || 0,
                volume_history_24h: overview.vHistory24h || 0,
                volume_history_24h_usd: overview.vHistory24hUSD || 0,
                volume_24h_change_percent: overview.v24hChangePercent || null,
                volume_buy_24h: overview.vBuy24h || 0,
                volume_buy_24h_usd: overview.vBuy24hUSD || 0,
                volume_buy_history_24h: overview.vBuyHistory24h || 0,
                volume_buy_history_24h_usd: overview.vBuyHistory24hUSD || 0,
                volume_buy_24h_change_percent:
                    overview.vBuy24hChangePercent || null,
                volume_sell_24h: overview.vSell24h || 0,
                volume_sell_24h_usd: overview.vSell24hUSD || 0,
                volume_sell_history_24h: overview.vSellHistory24h || 0,
                volume_sell_history_24h_usd: overview.vSellHistory24hUSD || 0,
                volume_sell_24h_change_percent:
                    overview.vSell24hChangePercent || null,
            };

            console.log(`This is the tradeData ${tradeData}`);
            // Cache the processed data
            await this.setCachedData(cacheKey, tradeData);
            return tradeData;
        } catch (error) {
            console.error(
                `Error fetching token overview data for ${this.tokenAddress}:`,
                error
            );
            throw new Error("Failed to fetch token trade data");
        }
    }

    async fetchDexScreenerDataByToken(tokenAddress: string): Promise<any> {
        try {
            const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${tokenAddress}`);
            const data = await response.json();

            if (!data.pairs || data.pairs.length === 0) {
                console.warn(`No data found for token ${tokenAddress}`);
                return null;
            }

            // Find the pair where the base token matches the token address we're looking for
            const pair = data.pairs.find((pair: any) => pair.baseToken.address.toLowerCase() === tokenAddress.toLowerCase());

            if (!pair) {
                console.warn(`No matching pair found for token ${tokenAddress}`);
                return null;
            }

            return {
                volume24hUSD: pair.volume.h24,
                liquidityUSD: pair.liquidity.usd,
                priceChange24h_percent: pair.priceChange.h24 || 0, // Use 0 if data not available
                marketCap: pair.marketCap
            };
        } catch (error) {
            console.error("Error fetching DexScreener data:", error);
            return null;
        }
    }

    async fetchDexScreenerData(): Promise<DexScreenerData> {
        const cacheKey = `dexScreenerData_${this.tokenAddress}`;
        const cachedData = await this.getCachedData<DexScreenerData>(cacheKey);

        if (cachedData?.pairs?.length > 0) {
            console.log(
                "Returning cached DexScreener data with pairs:",
                cachedData.pairs.length
            );
            return cachedData;
        }

        try {
            const response = await fetch(
                `https://api.dexscreener.com/latest/dex/tokens/${this.tokenAddress}`
            );
            const data = await response.json();

            console.log("DexScreener raw response:", {
                tokenAddress: this.tokenAddress,
                pairsCount: data?.pairs?.length || 0,
            });

            if (!data?.pairs?.length) {
                console.warn(`No pairs found for token ${this.tokenAddress}`);
                return {
                    schemaVersion: "1.0.0",
                    pairs: [],
                };
            }

            // Filter for Solana pairs
            const solanaPairs = data.pairs.filter(
                (pair) =>
                    pair.chainId === "solana" &&
                    pair.baseToken.address.toLowerCase() ===
                        this.tokenAddress.toLowerCase()
            );

            console.log("Found Solana pairs:", {
                total: data.pairs.length,
                solana: solanaPairs.length,
            });

            const dexData: DexScreenerData = {
                schemaVersion: data.schemaVersion || "1.0.0",
                pairs: solanaPairs,
            };

            if (solanaPairs.length > 0) {
                await this.setCachedData(cacheKey, dexData);
            }

            return dexData;
        } catch (error) {
            console.error("Error fetching DexScreener data:", error);
            return {
                schemaVersion: "1.0.0",
                pairs: [],
            };
        }
    }

    async searchDexScreenerData(
        symbol: string
    ): Promise<DexScreenerPair | null> {
        const cacheKey = `dexScreenerData_search_${symbol}`;
        const cachedData = await this.getCachedData<DexScreenerData>(cacheKey);
        if (cachedData) {
            console.log("Returning cached search DexScreener data.");
            return this.getHighestLiquidityPair(cachedData);
        }

        const url = `https://api.dexscreener.com/latest/dex/search?q=${symbol}`;
        try {
            console.log(`Fetching DexScreener data for symbol: ${symbol}`);
            const data = await fetch(url)
                .then((res) => res.json())
                .catch((err) => {
                    console.error(err);
                    return null;
                });

            if (!data || !data.pairs || data.pairs.length === 0) {
                throw new Error("No DexScreener data available");
            }

            const dexData: DexScreenerData = {
                schemaVersion: data.schemaVersion,
                pairs: data.pairs,
            };

            // Cache the result
            this.setCachedData(cacheKey, dexData);

            // Return the pair with the highest liquidity and market cap
            return this.getHighestLiquidityPair(dexData);
        } catch (error) {
            console.error(`Error fetching DexScreener data:`, error);
            return null;
        }
    }
    getHighestLiquidityPair(dexData: DexScreenerData): DexScreenerPair | null {
        if (dexData.pairs.length === 0) {
            return null;
        }

        // Sort pairs by both liquidity and market cap to get the highest one
        return dexData.pairs.sort((a, b) => {
            const liquidityDiff = b.liquidity.usd - a.liquidity.usd;
            if (liquidityDiff !== 0) {
                return liquidityDiff; // Higher liquidity comes first
            }
            return b.marketCap - a.marketCap; // If liquidity is equal, higher market cap comes first
        })[0];
    }

    async analyzeHolderDistribution(
        tradeData: TokenTradeData
    ): Promise<string> {
        // Define the time intervals to consider (e.g., 30m, 1h, 2h)
        const intervals = [
            {
                period: "30m",
                change: tradeData?.unique_wallet_30m_change_percent ?? 0,
            },
            {
                period: "1h",
                change: tradeData?.unique_wallet_1h_change_percent ?? 0,
            },
            {
                period: "2h",
                change: tradeData?.unique_wallet_2h_change_percent ?? 0,
            },
            {
                period: "4h",
                change: tradeData?.unique_wallet_4h_change_percent ?? 0,
            },
            {
                period: "8h",
                change: tradeData?.unique_wallet_8h_change_percent ?? 0,
            },
            {
                period: "24h",
                change: tradeData?.unique_wallet_24h_change_percent ?? 0,
            },
        ];

        // Calculate the average change percentage
        const validChanges = intervals
            .map((interval) => interval.change)
            .filter(
                (change) =>
                    change !== null && change !== undefined && !isNaN(change)
            );

        if (validChanges.length === 0) {
            return "stable";
        }

        const averageChange =
            validChanges.reduce((acc, curr) => acc + curr, 0) /
            validChanges.length;

        const increaseThreshold = 10; // e.g., average change > 10%
        const decreaseThreshold = -10; // e.g., average change < -10%

        if (averageChange > increaseThreshold) {
            return "increasing";
        } else if (averageChange < decreaseThreshold) {
            return "decreasing";
        } else {
            return "stable";
        }
    }

    async fetchHolderList(): Promise<HolderData[]> {
        const cacheKey = `holderList_${this.tokenAddress}`;
        console.log("Checking cache for key:", cacheKey);

        const cachedData = await this.getCachedData<HolderData[]>(cacheKey);
        if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
            console.log(
                "Returning cached holder list with length:",
                cachedData.length
            );
            return cachedData;
        } else {
            console.log("No valid cached data found or cache is empty");
        }

        const url = `https://mainnet.helius-rpc.com/?api-key=${settings.HELIUS_API_KEY || ""}`;
        console.log("Making Helius request for holders:", {
            tokenAddress: this.tokenAddress,
            url: url.replace(settings.HELIUS_API_KEY || "", "API_KEY"),
        });

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: "1",
                    method: "getTokenLargestAccounts",
                    params: [this.tokenAddress],
                }),
            });

            const data = await response.json();
            console.log("Raw Helius response:", JSON.stringify(data, null, 2));

            if (!data?.result?.value || !Array.isArray(data.result.value)) {
                console.warn("Invalid response format from Helius:", {
                    hasResult: !!data?.result,
                    hasValue: !!data?.result?.value,
                    isArray: Array.isArray(data?.result?.value),
                });
                return [];
            }

            const holders: HolderData[] = data.result.value
                .map((account) => {
                    if (!account.address || !account.amount) {
                        console.warn("Invalid account data:", account);
                    }
                    return {
                        address: account.address,
                        balance: account.amount, // Already a string
                    };
                })
                .filter((holder) => holder.address && holder.balance); // Filter out any invalid entries

            console.log("Transformed holders data:", {
                count: holders.length,
                sample: holders.slice(0, 2),
            });

            if (holders.length > 0) {
                console.log(
                    `Caching ${holders.length} holders with key:`,
                    cacheKey
                );
                await this.setCachedData(cacheKey, holders);
            } else {
                console.warn("No holders to cache");
            }

            return holders;
        } catch (error) {
            console.error("Error fetching holder list from Helius:", error);
            return [];
        }
    }

    async filterHighValueHolders(
        tradeData: TokenTradeData | null
    ): Promise<Array<{ holderAddress: string; balanceUsd: string }>> {
        try {
            if (!tradeData || !tradeData.price) {
                console.warn(
                    "No valid trade data available for filtering high value holders"
                );
                return [];
            }

            const holdersData = await this.fetchHolderList();

            if (!holdersData || holdersData.length === 0) {
                console.warn("No holders data available");
                return [];
            }

            console.log("Filtering holders with data:", {
                holdersCount: holdersData.length,
                tokenPrice: tradeData.price,
            });

            const tokenPriceUsd = toBN(tradeData.price);

            const highValueHolders = holdersData
                .filter((holder) => {
                    try {
                        const balance = toBN(holder.balance || "0");
                        const balanceUsd = balance.multipliedBy(tokenPriceUsd);
                        return balanceUsd.isGreaterThan(5);
                    } catch (error) {
                        console.warn(
                            `Error calculating balance for holder ${holder.address}:`,
                            error
                        );
                        return false;
                    }
                })
                .map((holder) => ({
                    holderAddress: holder.address,
                    balanceUsd: toBN(holder.balance || "0")
                        .multipliedBy(tokenPriceUsd)
                        .toFixed(2),
                }));

            console.log(`Found ${highValueHolders.length} high value holders`);
            return highValueHolders;
        } catch (error) {
            console.error("Error filtering high value holders:", error);
            return [];
        }
    }

    async checkRecentTrades(
        tradeData: TokenTradeData | null
    ): Promise<boolean> {
        if (!tradeData || !tradeData.volume_24h_usd) {
            console.warn(
                "No valid trade data available for recent trades check"
            );
            return false;
        }
        try {
            return toBN(tradeData.volume_24h_usd).isGreaterThan(0);
        } catch (error) {
            console.warn("Error checking recent trades:", error);
            return false;
        }
    }

    async countHighSupplyHolders(
        securityData: TokenSecurityData | null
    ): Promise<number> {
        try {
            if (!securityData) {
                console.warn("No security data provided");
                return 0;
            }

            // Use creator balance if owner balance is null
            const balanceToUse =
                securityData.ownerBalance ||
                securityData.creatorBalance?.toString();
            if (!balanceToUse) {
                console.warn("Neither owner nor creator balance available");
                return 0;
            }

            const mainBalance = toBN(balanceToUse);
            const totalSupply = toBN(securityData.totalSupply || "0");

            if (totalSupply.isZero()) {
                console.warn("Total supply is zero");
                return 0;
            }

            console.log("Processing supply data:", {
                mainBalance: mainBalance.toString(),
                totalSupply: totalSupply.toString(),
            });

            const holdersData = await this.fetchHolderList();
            console.log("Got holders data for counting supply:", {
                holdersCount: holdersData.length,
                totalSupply: totalSupply.toString(),
            });

            const highSupplyHoldersCount = holdersData.filter((holder) => {
                try {
                    const balance = toBN(holder.balance);
                    const percentage = balance.dividedBy(totalSupply);
                    return percentage.isGreaterThan(0.02); // 2% threshold
                } catch (error) {
                    console.warn(`Error processing holder balance: ${error}`);
                    return false;
                }
            }).length;

            console.log("Found high supply holders:", {
                count: highSupplyHoldersCount,
                threshold: "2%",
            });

            return highSupplyHoldersCount;
        } catch (error) {
            console.error("Error counting high supply holders:", error);
            return 0;
        }
    }

    async getProcessedTokenData(
        runtime: IAgentRuntime
    ): Promise<ProcessedTokenData> {
        try {
            console.log(
                `Fetching processed token data for token: ${this.tokenAddress}`
            );

            // Fetch all data with better error handling
            let security = await this.fetchTokenSecurity();
            if (!security) {
                console.log("No security data returned, using default values");
                security = {
                    ownerBalance: "0",
                    creatorBalance: "0",
                    ownerPercentage: 0,
                    creatorPercentage: 0,
                    top10HolderBalance: "0",
                    top10HolderPercent: 0,
                    totalSupply: "0",
                };
            }
            console.log("Using security data:", security);

            let tokenCodex, tradeData, dexData;

            try {
                tokenCodex = await this.fetchTokenCodex();
            } catch (error) {
                console.warn("Error fetching token codex:", error);
                tokenCodex = {
                    id: "",
                    address: this.tokenAddress,
                    cmcId: 0,
                    decimals: 9,
                    name: "",
                    symbol: "",
                    totalSupply: "0",
                    circulatingSupply: "0",
                    imageThumbUrl: "",
                    blueCheckmark: false,
                    isScam: false,
                };
            }

            try {
                tradeData = await this.fetchTokenTradeData(runtime);
                console.log(
                    "This is the tradeData",
                    JSON.stringify(tradeData, null, 2)
                );
                if (!tradeData || !tradeData.price) {
                    console.warn(
                        "Invalid trade data received, fetching fresh data..."
                    );
                    // Clear cache and try again
                    const cacheKey = `tokenTradeData_${this.tokenAddress}`;
                    await this.cacheManager.delete(cacheKey);
                    tradeData = await this.fetchTokenTradeData(runtime);
                    console.log(
                        "Fresh trade data fetched:",
                        JSON.stringify(tradeData, null, 2)
                    );
                }
            } catch (error) {
                console.warn("Error fetching trade data:", error);
                tradeData = this.getDefaultTradeData();
                console.log(
                    "Using default trade data:",
                    JSON.stringify(tradeData, null, 2)
                );
            }

            try {
                dexData = await this.fetchDexScreenerData();
                if (!dexData?.pairs?.length) {
                    // Only consider it invalid if we have no pairs
                    console.log("No DEX pairs found, using default");
                    dexData = {
                        schemaVersion: "1.0.0",
                        pairs: [],
                    };
                } else {
                    console.log(`Found ${dexData.pairs.length} DEX pairs`);
                }
            } catch (error) {
                console.warn("Error fetching DEX data:", error);
                dexData = {
                    schemaVersion: "1.0.0",
                    pairs: [],
                };
            }

            // Process the data with whatever we have
            const holderDistributionTrend =
                await this.analyzeHolderDistribution(tradeData);
            const highValueHolders =
                await this.filterHighValueHolders(tradeData);
            const recentTrades = await this.checkRecentTrades(tradeData);
            const highSupplyHoldersCount =
                await this.countHighSupplyHolders(security);

            const isDexScreenerListed = dexData?.pairs?.length > 0 || false;
            const isDexScreenerPaid =
                dexData?.pairs?.some(
                    (pair) => pair.boosts && pair.boosts.active > 0
                ) || false;

            const processedData: ProcessedTokenData = {
                security,
                tradeData,
                holderDistributionTrend,
                highValueHolders,
                recentTrades,
                highSupplyHoldersCount,
                dexScreenerData: dexData,
                isDexScreenerListed,
                isDexScreenerPaid,
                tokenCodex,
            };

            return processedData;
        } catch (error) {
            console.error("Error in getProcessedTokenData:", error);
            throw error;
        }
    }

    private async fetchTrendingTokens(runtime: IAgentRuntime): Promise<any[]> {
        try {
            const apiKey = runtime.getSetting("BIRDEYE_API_KEY");
            if (!apiKey) {
                console.error("BIRDEYE_API_KEY not found in settings");
                return [];
            }

            const options = {
                method: 'GET',
                headers: {
                    'accept': 'application/json',
                    'X-API-KEY': apiKey,
                },
            };

            const response = await fetch('https://public-api.birdeye.so/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=20', options);
            const data = await response.json();

            if (!data.success || !data.data.tokens) {
                console.error("Failed to fetch trending tokens", data);
                return [];
            }

            return data.data.tokens;
        } catch (error) {
            console.error("Error fetching trending tokens:", error);
            return [];
        }
    }

    async findGemTokens(runtime: IAgentRuntime, criteria: any): Promise<any[]> {
        try {
            const trendingTokens = await this.fetchTrendingTokens(runtime);

            const gems = await Promise.all(trendingTokens.map(async (token: any) => {
                const dexData = await this.fetchDexScreenerDataByToken(token.address);

                if (!dexData) return null; // Skip if no DexScreener data

                const processedData = {
                    ...token,
                    ...dexData,
                };

                const criteriaMatches = this.evaluateGemCriteria(processedData, criteria);
                if (criteriaMatches.length > 0) {
                    return {
                        ...processedData,
                        criteriaMatch: criteriaMatches
                    };
                }
                return null;
            }));

            return gems.filter(Boolean); // Remove null entries
        } catch (error) {
            console.error("Error finding gem tokens:", error);
            return [];
        }
    }

    evaluateGemCriteria(token: any, criteria: any): string[] {
        const matches = [];
        if (token.liquidityUSD > criteria.liquidityThreshold) matches.push('High Liquidity');
        if (token.volume24hUSD > criteria.volumeThreshold) matches.push('High Volume');
        if (Math.abs(token.priceChange24h_percent) > criteria.priceSurgeThreshold) matches.push('Recent Price Surge');
        if (token.marketCap < criteria.maxMarketCap) matches.push('Low Market Cap');
        return matches;
    }

    private normalize(value: number, min: number, max: number): number {
        return Math.max(0, Math.min(1, (value - min) / (max - min)));
    }

    calculateGemScore(token: any, criteria: any): number {
        let score = 0;
        const weights = {
            volume24hUSD: 0.3,
            liquidityUSD: 0.25,
            priceChange24h_percent: 0.25,
            marketCap: 0.2
        };

        score += this.normalize(token.volume24hUSD, 0, criteria.volumeThreshold) * weights.volume24hUSD;
        score += this.normalize(token.liquidityUSD, 0, criteria.liquidityThreshold) * weights.liquidityUSD;
        score += this.normalize(Math.abs(token.priceChange24h_percent), 0, criteria.priceSurgeThreshold) * weights.priceChange24h_percent;
        score += (1 - this.normalize(token.marketCap, 0, criteria.maxMarketCap)) * weights.marketCap;

        return Math.round(score * 100);
    }



    async provideDeeperAnalysis(token: any, criteria: any): Promise<string> {
        function formatLargeNumber(num: number): string {
            const absNum = Math.abs(num);
            if (absNum >= 1000000000) {
              return (num / 1000000000).toFixed(1) + ' B';
            }
            if (absNum >= 1000000) {
              return (num / 1000000).toFixed(1) + ' M';
            }
            if (absNum >= 1000) {
              return (num / 1000).toFixed(1) + ' K';
            }
            return num.toString();
          }

        const analysis = [];

        if (token.volume24hUSD > criteria.volumeThreshold) {
            analysis.push(`**${token.symbol}** has seen a **${formatLargeNumber(token.volume24hUSD)} USD** volume increase in the last 24 hours, indicating strong market interest.`);
        }

        if (token.liquidityUSD > criteria.liquidityThreshold) {
            analysis.push(`With **${formatLargeNumber(token.liquidityUSD)} USD** in liquidity, **${token.symbol}** has robust market support, reducing slippage risks.`);
        }

        if (Math.abs(token.priceChange24h_percent) > criteria.priceSurgeThreshold) {
            const change = token.priceChange24h_percent > 0 ? 'increase' : 'decrease';
            analysis.push(`**${token.symbol}** has experienced a **${Math.abs(token.priceChange24h_percent).toFixed(1)}% ${change}** in price over the last 24 hours.`);
        }

        if (token.marketCap < criteria.maxMarketCap) {
            analysis.push(`**${token.symbol}** has a **low market cap** of approximately ${formatLargeNumber(token.marketCap)} USD, suggesting room for significant growth if fundamentals are strong.`);
        }

        return analysis.join('\n- ');
    }

    provideRecommendation(token: any, gemScore: number): string {
        if (gemScore > 80) {
            return `**${token.name} (${token.symbol})** is showing **strong gem indicators**. **Consider for short-term trade** due to current momentum. Monitor for price stabilization before long-term investment.`;
        } else if (gemScore > 50) {
            return `**${token.name} (${token.symbol})** looks promising with moderate gem signals. **Good for portfolio diversification** if the project's fundamentals are solid.`;
        } else {
            return `**${token.name} (${token.symbol})** has some gem-like traits but **approach with caution** - further research into the project's fundamentals is necessary.`;
        }
    }

    assessRisk(token: any, criteria: any): string {
        let riskLevel = 'Low';

        if (Math.abs(token.priceChange24h_percent) > 50) {
            riskLevel = 'High'; // Extreme price movements
        } else if (token.liquidityUSD < criteria.liquidityThreshold / 2) { // Half the threshold as a risk indicator
            riskLevel = 'Moderate'; // Low liquidity might mean high slippage and volatility
        }

        return `**Risk:** ${riskLevel}, due to ${this.getRiskReason(token, criteria)}`;
    }

    getRiskReason(token: any, criteria: any): string {
        if (Math.abs(token.priceChange24h_percent) > 50) {
            return 'recent extreme volatility';
        } else if (token.liquidityUSD < criteria.liquidityThreshold / 2) {
            return 'low liquidity';
        }
        return 'stable market conditions';
    }

    async shouldTradeToken(runtime: IAgentRuntime): Promise<boolean> {
        try {
            const tokenData = await this.getProcessedTokenData(runtime);
            const { tradeData, security, dexScreenerData } = tokenData;

            if (
                !security ||
                !dexScreenerData ||
                !dexScreenerData.pairs ||
                !dexScreenerData.pairs[0]
            ) {
                console.warn("Missing required security or DEX data");
                return false;
            }

            // Now safely destructure security data after null check
            const { ownerBalance, creatorBalance } = security;
            const { liquidity, marketCap } = dexScreenerData.pairs[0];

            const liquidityUsd = toBN(liquidity?.usd || 0);
            const marketCapUsd = toBN(marketCap || 0);
            const totalSupply = toBN(ownerBalance || "0").plus(
                creatorBalance || "0"
            );
            const ownerPercentage = toBN(ownerBalance || "0").dividedBy(
                totalSupply
            );
            const creatorPercentage = toBN(creatorBalance || "0").dividedBy(
                totalSupply
            );

            // If we don't have trade data, we shouldn't trade
            if (!tradeData) {
                console.warn("No trade data available");
                return false;
            }

            const top10HolderPercent = toBN(
                tradeData.volume_24h_usd || "0"
            ).dividedBy(totalSupply);
            const priceChange24hPercent = toBN(
                tradeData.price_change_24h_percent || 0
            );
            const priceChange12hPercent = toBN(
                tradeData.price_change_12h_percent || 0
            );
            const uniqueWallet24h = tradeData.unique_wallet_24h || 0;
            const volume24hUsd = toBN(tradeData.volume_24h_usd || 0);

            const volume24hUsdThreshold = 1000;
            const priceChange24hPercentThreshold = 10;
            const priceChange12hPercentThreshold = 5;
            const top10HolderPercentThreshold = 0.05;
            const uniqueWallet24hThreshold = 100;
            const isTop10Holder = top10HolderPercent.gte(
                top10HolderPercentThreshold
            );
            const isVolume24h = volume24hUsd.gte(volume24hUsdThreshold);
            const isPriceChange24h = priceChange24hPercent.gte(
                priceChange24hPercentThreshold
            );
            const isPriceChange12h = priceChange12hPercent.gte(
                priceChange12hPercentThreshold
            );
            const isUniqueWallet24h =
                uniqueWallet24h >= uniqueWallet24hThreshold;
            const isLiquidityTooLow = liquidityUsd.lt(1000);
            const isMarketCapTooLow = marketCapUsd.lt(100000);
            return (
                isTop10Holder ||
                isVolume24h ||
                isPriceChange24h ||
                isPriceChange12h ||
                isUniqueWallet24h ||
                isLiquidityTooLow ||
                isMarketCapTooLow
            );
        } catch (error) {
            console.error("Error processing token data:", error);
            throw error;
        }
    }

    formatTokenData(runtime: IAgentRuntime, data: ProcessedTokenData): string {
        try {
            if (!data || !data.tradeData || !data.security) {
                throw new Error("Invalid or missing token data");
            }

            let output = `**Token Analysis Report for ${data.tokenCodex?.symbol || 'Unknown Token'}**\n`;
            output += `Address: ${this.tokenAddress}\n`;
            output += `Name: ${data.tokenCodex?.name || 'Unknown'}\n\n`;

            // Market Overview
            output += `**📊 Market Overview**\n`;
            output += `Current Price: $${toBN(data.tradeData.price || 0).toFixed(4)}\n`;
            output += `Market Cap: $${toBN(data.dexScreenerData?.pairs?.[0]?.marketCap || 0).toLocaleString()}\n`;
            output += `Total Supply: ${toBN(data.security.totalSupply || 0).toLocaleString()}\n`;
            output += `Verified: ${data.tokenCodex?.blueCheckmark ? '✅' : '❌'}\n\n`;

            // Price Performance
            output += `**💰 Price Performance**\n`;
            output += `1h: ${(data.tradeData.price_change_1h_percent || 0).toFixed(2)}%\n`;
            output += `24h: ${(data.tradeData.price_change_24h_percent || 0).toFixed(2)}%\n`;


            // Volume Analysis
            const volume24hUSD = toBN(data.tradeData.volume_24h_usd || 0);
            const volumeChange = toBN(data.tradeData.volume_24h_change_percent || 0);
            output += `**📈 Trading Activity (24h)**\n`;
            output += `Volume: $${volume24hUSD.toLocaleString()}\n`;
            output += `Volume Change: ${volumeChange.toFixed(2)}%\n`;
            output += `Trades: ${data.tradeData.trade_24h?.toLocaleString() || 0}\n`;
            output += `Buy/Sell Ratio: ${((data.tradeData.buy_24h || 0) / (data.tradeData.sell_24h || 1)).toFixed(2)}\n\n`;

            // Liquidity Analysis
            const mainPair = data.dexScreenerData?.pairs?.[0];
            if (mainPair) {
                output += `**💧 Liquidity**\n`;
                output += `Total Liquidity: $${toBN(mainPair.liquidity?.usd || 0).toLocaleString()}\n`;
                output += `Liquidity/MCap Ratio: ${(toBN(mainPair.liquidity?.usd || 0).dividedBy(toBN(mainPair.marketCap || 1)).multipliedBy(100)).toFixed(2)}%\n`;
                output += `DEX: ${mainPair.dexId || 'Unknown'}\n\n`;
            }

            // Holder Analysis
            output += `**👥 Holder Analysis**\n`;
            output += `Total Holders: ${(data.tradeData.holder || 0).toLocaleString()}\n`;
            output += `Active Wallets (24h): ${(data.tradeData.unique_wallet_24h || 0).toLocaleString()}\n`;
            output += `Top 10 Holders %: ${(data.security.top10HolderPercent * 100 || 0).toFixed(2)}%\n\n`;

            // Risk Metrics
            output += `**⚠️ Risk Metrics**\n`;
            output += `Owner %: ${(data.security.ownerPercentage || 0).toFixed(2)}%\n`;
            output += `Creator %: ${(data.security.creatorPercentage || 0).toFixed(2)}%\n`;
            output += `High Concentration Holders: ${data.highSupplyHoldersCount || 0}\n`;
            output += `Token Type: ${data.security.isToken2022 ? 'Token-2022' : 'SPL'}\n`;
            output += `Mutable Metadata: ${data.security.mutableMetadata ? '⚠️ Yes' : '✅ No'}\n\n`;

            // Market Depth
            if (data.dexScreenerData?.pairs?.length > 1) {
                output += `**🌊 Market Depth**\n`;
                output += `Total DEX Pairs: ${data.dexScreenerData.pairs.length}\n`;
                const totalLiquidity = data.dexScreenerData.pairs.reduce((sum, pair) =>
                    sum.plus(toBN(pair.liquidity?.usd || 0)), toBN(0));
                output += `Combined Liquidity: $${totalLiquidity.toLocaleString()}\n\n`;
            }

            return output;
        } catch (error) {
            console.error("Error formatting token data:", error);
            return "Unable to format token data. Some metrics may be unavailable.";
        }
    }

    async getEnhancedAnalysis(runtime: IAgentRuntime): Promise<any> {
        try {
            // Get base analysis first with proper error handling
            const baseAnalysis = await this.getProcessedTokenData(
                runtime
            ).catch((error) => {
                console.error("Error getting base token data:", error);
                return null;
            });

            if (!baseAnalysis) {
                throw new Error("Could not retrieve base token data");
            }

            // Initialize analyzers with proper error boundaries
            const marketAnalyzer = new MarketAnalyzer(this);
            const riskAnalyzer = new RiskAnalyzer(this);

            // Use Promise.allSettled instead of Promise.all to handle partial failures
            const [marketMetricsResult, riskMetricsResult] =
                await Promise.allSettled([
                    marketAnalyzer.analyzeTokenMetrics(this.tokenAddress),
                    riskAnalyzer.calculateRiskMetrics(this.tokenAddress),
                ]);

            // Process results safely
            const marketMetrics =
                marketMetricsResult.status === "fulfilled"
                    ? marketMetricsResult.value
                    : null;
            const riskMetrics =
                riskMetricsResult.status === "fulfilled"
                    ? riskMetricsResult.value
                    : null;

            // Format response with enhanced error handling
            const analysis = {
                ...baseAnalysis,
                enhancedMetrics: {
                    market: marketMetrics,
                    risk: riskMetrics,
                },
                summary: this.generateAnalysisSummary(
                    marketMetrics,
                    riskMetrics
                ),
            };

            // Cache the analysis result if valid
            if (marketMetrics || riskMetrics) {
                await this.setCachedData(
                    `analysis_${this.tokenAddress}`,
                    analysis
                );
            }

            return analysis;
        } catch (error) {
            console.error("Enhanced analysis failed:", error);
            // Return base analysis with error information
            const baseAnalysis = await this.getProcessedTokenData(
                runtime
            ).catch(() => ({}));
            return {
                ...baseAnalysis,
                error: {
                    message: "Enhanced analysis failed",
                    details: error.message,
                    enhancedMetricsAvailable: false,
                },
            };
        }
    }

    private generateAnalysisSummary(
        marketMetrics: any,
        riskMetrics: any
    ): string {
        const summaryParts = [];

        if (marketMetrics) {
            const { momentum, volumeProfile, marketStructure } = marketMetrics;
            summaryParts.push(
                `Market Overview: ${momentum?.trend || "unknown"} trend with ${momentum?.strength || "unknown"} strength.`,
                `Volume: ${volumeProfile?.volumeTrend || "unknown"} with ${volumeProfile?.buyVolumeRatio || 0}% buy ratio.`,
                `Market Structure: ${marketStructure?.priceDiscovery || "unknown"} price discovery.`
            );
        }

        if (riskMetrics) {
            summaryParts.push(
                `Overall Risk Score: ${riskMetrics.overallRisk || 0}/100`,
                `Key Concerns: ${this.formatRiskConcerns(riskMetrics)}`
            );
        }

        return summaryParts.join(" ");
    }

    private formatRiskConcerns(riskMetrics: any): string {
        const concerns = [];

        if (riskMetrics.volatilityScore > 70) concerns.push("high volatility");
        if (riskMetrics.liquidityRisk > 70) concerns.push("low liquidity");
        if (riskMetrics.holderConcentration > 70)
            concerns.push("concentrated holdings");
        if (riskMetrics.securityScore > 70) concerns.push("security risks");
        if (riskMetrics.marketStability > 70)
            concerns.push("market instability");

        // Check additional risk factors
        if (riskMetrics.overallRisk > 80) {
            concerns.push("extreme risk level");
        } else if (riskMetrics.overallRisk > 60) {
            concerns.push("elevated risk level");
        }

        return concerns.length > 0
            ? `Key Risks: ${concerns.join(", ")}`
            : "No major concerns identified";
    }

    private async getHistoricalMetrics(
        runtime: IAgentRuntime,
        timeframe: string = "24h"
    ): Promise<any> {
        try {
            const tradeData = await this.fetchTokenTradeData(runtime);
            const metrics = {
                priceChange: 0,
                volumeChange: 0,
                holderChange: 0,
                liquidityChange: 0,
            };

            switch (timeframe) {
                case "1h":
                    metrics.priceChange =
                        tradeData.price_change_1h_percent || 0;
                    metrics.volumeChange =
                        tradeData.volume_1h_change_percent || 0;
                    metrics.holderChange =
                        tradeData.unique_wallet_1h_change_percent || 0;
                    break;
                case "24h":
                    metrics.priceChange =
                        tradeData.price_change_24h_percent || 0;
                    metrics.volumeChange =
                        tradeData.volume_24h_change_percent || 0;
                    metrics.holderChange =
                        tradeData.unique_wallet_24h_change_percent || 0;
                    break;
                default:
                    throw new Error(`Unsupported timeframe: ${timeframe}`);
            }

            return metrics;
        } catch (error) {
            console.error(
                `Error fetching historical metrics for ${timeframe}:`,
                error
            );
            return null;
        }
    }

    async getTrendAnalysis(runtime: IAgentRuntime): Promise<any> {
        try {
            const [hourlyMetrics, dailyMetrics] = await Promise.all([
                this.getHistoricalMetrics(runtime, "1h"),
                this.getHistoricalMetrics(runtime, "24h"),
            ]);

            if (!hourlyMetrics || !dailyMetrics) {
                throw new Error("Unable to fetch complete metrics");
            }

            return {
                shortTerm: this.analyzeTrend(hourlyMetrics),
                longTerm: this.analyzeTrend(dailyMetrics),
                momentum: this.calculateMomentum(hourlyMetrics, dailyMetrics),
                summary: this.generateTrendSummary(hourlyMetrics, dailyMetrics),
            };
        } catch (error) {
            console.error("Error in trend analysis:", error);
            return {
                error: "Failed to analyze trends",
                details: error.message,
            };
        }
    }

    private analyzeTrend(metrics: any): string {
        const { priceChange, volumeChange } = metrics;

        if (priceChange > 5 && volumeChange > 0) return "bullish";
        if (priceChange < -5 && volumeChange > 0) return "bearish";
        if (Math.abs(priceChange) <= 5) return "sideways";
        return "uncertain";
    }

    private calculateMomentum(hourly: any, daily: any): number {
        // Weight recent activity more heavily
        const hourlyWeight = 0.6;
        const dailyWeight = 0.4;

        const hourlyMomentum = hourly.priceChange * hourly.volumeChange;
        const dailyMomentum = daily.priceChange * daily.volumeChange;

        return hourlyMomentum * hourlyWeight + dailyMomentum * dailyWeight;
    }

    private generateTrendSummary(hourly: any, daily: any): string {
        const momentum = this.calculateMomentum(hourly, daily);
        const shortTrend = this.analyzeTrend(hourly);
        const longTrend = this.analyzeTrend(daily);

        let summary = `${shortTrend.toUpperCase()} short-term trend, `;
        summary += `${longTrend.toUpperCase()} long-term trend. `;

        if (Math.abs(momentum) > 1000) {
            summary +=
                momentum > 0
                    ? "Strong upward momentum."
                    : "Strong downward momentum.";
        } else if (Math.abs(momentum) > 500) {
            summary +=
                momentum > 0
                    ? "Moderate upward momentum."
                    : "Moderate downward momentum.";
        } else {
            summary += "Weak or neutral momentum.";
        }

        return summary;
    }

    async getFormattedTokenReport(runtime: IAgentRuntime): Promise<string> {
        try {
            console.log("Generating formatted token report...");
            const processedData = await this.getProcessedTokenData(runtime);
            return this.formatTokenData(runtime, processedData);
        } catch (error) {
            console.error("Error generating token report:", error);
            return "Unable to fetch token information. Please try again later.";
        }
    }
}

const tokenAddress = PROVIDER_CONFIG.TOKEN_ADDRESSES.Example;

const connection = new Connection(PROVIDER_CONFIG.DEFAULT_RPC);
const tokenProvider: Provider = {
    async get(
        runtime: IAgentRuntime,
        _message: Memory,
        _state?: State
    ): Promise<string> {
        try {
            const { publicKey } = await getWalletKey(runtime, false);

            const rpcEndpoint =
                runtime.getSetting("RPC_ENDPOINT") ||
                PROVIDER_CONFIG.DEFAULT_RPC;
            const connection = new Connection(rpcEndpoint);

            const walletProvider = WalletProvider.getInstance(
                connection,
                publicKey
            );

            const provider = new TokenProvider(
                tokenAddress,
                walletProvider,
                runtime.cacheManager
            );

            return provider.getFormattedTokenReport(runtime);
        } catch (error) {
            console.error("Error in token provider:", error);
            return "Error fetching token data";
        }
    },
};

export { tokenProvider };
