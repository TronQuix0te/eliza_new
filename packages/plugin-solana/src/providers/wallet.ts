import { IAgentRuntime, Memory, Provider, State } from "@elizaos/core";
import { Connection, PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import NodeCache from "node-cache";
import { getWalletKey } from "../keypairUtils";

// Provider configuration
const PROVIDER_CONFIG = {
    BIRDEYE_API: "https://public-api.birdeye.so",
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    DEFAULT_RPC: "https://api.mainnet-beta.solana.com",
    GRAPHQL_ENDPOINT: "https://graph.codex.io/graphql",
    TOKEN_ADDRESSES: {
        SOL: "So11111111111111111111111111111111111111112",
        BTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
        ETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    },
};

export interface Item {
    name: string;
    address: string;
    symbol: string;
    decimals: number;
    balance: string;
    uiAmount: string;
    priceUsd: string;
    valueUsd: string;
    valueSol?: string;
}

interface WalletPortfolio {
    totalUsd: string;
    totalSol?: string;
    items: Array<Item>;
}

interface _BirdEyePriceData {
    data: {
        [key: string]: {
            price: number;
            priceChange24h: number;
        };
    };
}

interface Prices {
    solana: { usd: string };
    bitcoin: { usd: string };
    ethereum: { usd: string };
}

export class WalletProvider {
    private static instance: WalletProvider;
private static instanceWalletKey: string;
    private cache: NodeCache;
    private isCacheInitialized: boolean = false;
    private cacheInstanceId: string;

    public static getInstance(connection: Connection, walletPublicKey: PublicKey): WalletProvider {
        const walletKey = walletPublicKey.toBase58();
        if (!WalletProvider.instance || WalletProvider.instanceWalletKey !== walletKey) {
            console.log('Creating new WalletProvider instance:', {
                reason: WalletProvider.instance ? 'wallet changed' : 'first instance',
                previousWallet: WalletProvider.instanceWalletKey,
                newWallet: walletKey
            });
            WalletProvider.instance = new WalletProvider(connection, walletPublicKey);
            WalletProvider.instanceWalletKey = walletKey;
        } else {
            console.log('Reusing existing WalletProvider instance:', {
                instanceId: WalletProvider.instance.cacheInstanceId,
                wallet: walletKey,
                cacheStats: WalletProvider.instance.cache.getStats()
            });
        }
        return WalletProvider.instance;
    }

    private constructor(
        private connection: Connection,
        private walletPublicKey: PublicKey
    ) {
        this.cacheInstanceId = Math.random().toString(36).substring(7);
        console.log('Creating new WalletProvider cache instance:', {
            instanceId: this.cacheInstanceId,
            walletPublicKey: this.walletPublicKey.toBase58()
        });
        try {
            this.cache = new NodeCache({
                stdTTL: 300,
                errorOnMissing: false,
                useClones: false
            });
            console.log('NodeCache instance created with config:', {
                stdTTL: 300,
                errorOnMissing: false,
                useClones: false
            });

            // Set up error handler for cache
            this.cache.on('error', (err) => {
                console.error('Cache error event triggered:', {
                    error: err,
                    errorMessage: err.message,
                    stack: err.stack
                });
                this.isCacheInitialized = false;
            });

            // Test cache functionality
            const testKey = '_test_init_';
            console.log('Testing cache initialization with key:', testKey);
            const setResult = this.cache.set(testKey, 'test');
            console.log('Cache set result:', setResult);
            const getResult = this.cache.get(testKey);
            console.log('Cache get result:', getResult);
            const delResult = this.cache.del(testKey);
            console.log('Cache delete result:', delResult);

            this.isCacheInitialized = true;
            console.log('Cache initialized successfully');
        } catch (error) {
            console.error('Failed to initialize cache:', {
                error,
                errorMessage: error.message,
                stack: error.stack,
                type: error.constructor.name
            });
            this.isCacheInitialized = false;
            // Create a new cache instance but mark it as not initialized
            this.cache = new NodeCache({
                stdTTL: 300,
                errorOnMissing: false,
                useClones: false
            });
            console.warn('Created fallback cache instance with disabled operations');
            // Disable actual caching operations in error state
            this.cache.get = () => {
                console.warn('Attempted to get from disabled cache');
                return undefined;
            };
            this.cache.set = () => {
                console.warn('Attempted to set in disabled cache');
                return false;
            };
            this.cache.del = () => {
                console.warn('Attempted to delete from disabled cache');
                return 0;
            };
        }
    }

    private validateCache(): boolean {
        console.log('Validating cache state...', {
            isCacheInitialized: this.isCacheInitialized,
            cacheExists: !!this.cache
        });

        if (!this.isCacheInitialized) {
            console.warn('Cache validation failed - not initialized');
            return false;
        }

        try {
            // Test if cache is actually working
            const testKey = '_test_validate_';
            const testValue = 'test';
            console.log('Testing cache operations with key:', testKey);

            const setResult = this.cache.set(testKey, testValue);
            console.log('Cache set result:', setResult);

            const retrieved = this.cache.get(testKey);
            console.log('Cache get result:', {
                retrieved,
                matches: retrieved === testValue
            });

            const delResult = this.cache.del(testKey);
            console.log('Cache delete result:', delResult);

            if (retrieved !== testValue) {
                console.warn('Cache validation failed - retrieved value does not match set value', {
                    expected: testValue,
                    actual: retrieved
                });
                this.isCacheInitialized = false;
                return false;
            }

            console.log('Cache validation successful');
            return true;
        } catch (error) {
            console.error('Cache validation failed with error:', {
                error,
                errorMessage: error.message,
                stack: error.stack,
                type: error.constructor.name
            });
            this.isCacheInitialized = false;
            return false;
        }
    }

    private getCacheValue<T>(key: string): T | undefined {
        console.log('Getting cache value:', {
            instanceId: this.cacheInstanceId,
            key,
            stats: this.cache.getStats(),
            keys: this.cache.keys(),
            ttl: this.cache.getTtl(key)
        });
        if (!this.validateCache()) {
            console.warn('Cache validation failed during get operation');
            return undefined;
        }
        try {
            const value = this.cache.get<T>(key);
            console.log('Cache get operation result:', {
                key,
                found: value !== undefined,
                type: value ? typeof value : 'undefined'
            });
            return value;
        } catch (error) {
            console.error('Error getting cache value:', {
                key,
                error,
                errorMessage: error.message,
                stack: error.stack,
                type: error.constructor.name
            });
            return undefined;
        }
    }

    private setCacheValue<T>(key: string, value: T, ttl?: number): boolean {
        console.log('Setting cache value:', {
            instanceId: this.cacheInstanceId,
            key,
            ttl,
            currentKeys: this.cache.keys(),
            stats: this.cache.getStats()
        });
        if (!this.validateCache()) {
            console.warn('Cache validation failed during set operation');
            return false;
        }
        try {
            const result = this.cache.set(key, value, ttl);
            console.log('Cache set operation result:', {
                key,
                success: result,
                ttl
            });
            return result;
        } catch (error) {
            console.error('Error setting cache value:', {
                key,
                error,
                errorMessage: error.message,
                stack: error.stack,
                type: error.constructor.name,
                ttl
            });
            return false;
        }
    }

    private async fetchWithRetry(
        runtime,
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
                        "X-API-KEY":
                            runtime.getSetting("BIRDEYE_API_KEY", "") || "",
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
                lastError = error;
                if (i < PROVIDER_CONFIG.MAX_RETRIES - 1) {
                    const delay = PROVIDER_CONFIG.RETRY_DELAY * Math.pow(2, i);
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

    async fetchPortfolioValue(runtime): Promise<WalletPortfolio> {
        try {
            const cacheKey = `portfolio-${this.walletPublicKey.toBase58()}`;
            const cachedValue = this.getCacheValue<WalletPortfolio>(cacheKey);

            // Log detailed caching information
            console.log("Caching Debug:", {
                cacheKey,
                cacheInitialized: this.isCacheInitialized,
                cacheInstance: this.cache ? "Cache exists" : "Cache is null",
                cachedValue: cachedValue ? "Found" : "Not found"
            });

            if (cachedValue) {
                console.log("Cache hit for fetchPortfolioValue", {
                    totalUsd: cachedValue.totalUsd,
                    itemCount: cachedValue.items.length
                });
                return cachedValue;
            }

            console.log("Cache miss for fetchPortfolioValue - fetching new data");

            const walletData = await this.fetchWithRetry(
                runtime,
                `${PROVIDER_CONFIG.BIRDEYE_API}/v1/wallet/token_list?wallet=${this.walletPublicKey.toBase58()}`
            );

            if (!walletData?.success || !walletData?.data) {
                console.error("No portfolio data available", walletData);
                throw new Error("No portfolio data available");
            }

            const data = walletData.data;
            const totalUsd = new BigNumber(data.totalUsd.toString());
            const prices = await this.fetchPrices(runtime);
            const solPriceInUSD = new BigNumber(prices.solana.usd.toString());

            const items = data.items.map((item: any) => ({
                ...item,
                valueSol: new BigNumber(item.valueUsd || 0)
                    .div(solPriceInUSD)
                    .toFixed(6),
                name: item.name || "Unknown",
                symbol: item.symbol || "Unknown",
                priceUsd: item.priceUsd || "0",
                valueUsd: item.valueUsd || "0",
            }));

            const totalSol = totalUsd.div(solPriceInUSD);
            const portfolio = {
                totalUsd: totalUsd.toString(),
                totalSol: totalSol.toFixed(6),
                items: items.sort((a, b) =>
                    new BigNumber(b.valueUsd)
                        .minus(new BigNumber(a.valueUsd))
                        .toNumber()
                ),
            };

            // Explicit null check before caching
            this.setCacheValue(cacheKey, portfolio, 300); // 5 minutes cache

            return portfolio;
        } catch (error) {
            console.error("Error fetching portfolio:", error);

            // If there's an error, we want to ensure it's logged completely
            if (error instanceof Error) {
                console.error("Error details:", {
                    message: error.message,
                    stack: error.stack
                });
            }

            throw error;
        }
    }

    async fetchPortfolioValueCodex(runtime): Promise<WalletPortfolio> {
        try {
            const cacheKey = `portfolio-${this.walletPublicKey.toBase58()}`;
            const cachedValue = this.getCacheValue<WalletPortfolio>(cacheKey);

            // Log detailed caching information
            console.log("Caching Debug:", {
                cacheKey,
                cacheInitialized: this.isCacheInitialized,
                cacheInstance: this.cache ? "Cache exists" : "Cache is null",
                cachedValue: cachedValue ? "Found" : "Not found"
            });

            if (cachedValue) {
                console.log("Cache hit for fetchPortfolioValue");
                return cachedValue;
            }
            console.log("Cache miss for fetchPortfolioValue");

            const query = `
              query Balances($walletId: String!, $cursor: String) {
                balances(input: { walletId: $walletId, cursor: $cursor }) {
                  cursor
                  items {
                    walletId
                    tokenId
                    balance
                    shiftedBalance
                  }
                }
              }
            `;

            const variables = {
                walletId: `${this.walletPublicKey.toBase58()}:${1399811149}`,
                cursor: null,
            };

            const response = await fetch(PROVIDER_CONFIG.GRAPHQL_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization:
                        runtime.getSetting("CODEX_API_KEY", "") || "",
                },
                body: JSON.stringify({
                    query,
                    variables,
                }),
            }).then((res) => res.json());

            const data = response.data?.data?.balances?.items;

            if (!data || data.length === 0) {
                console.error("No portfolio data available", data);
                throw new Error("No portfolio data available");
            }

            // Fetch token prices
            const prices = await this.fetchPrices(runtime);
            const solPriceInUSD = new BigNumber(prices.solana.usd.toString());

            // Reformat items
            const items: Item[] = data.map((item: any) => {
                return {
                    name: "Unknown",
                    address: item.tokenId.split(":")[0],
                    symbol: item.tokenId.split(":")[0],
                    decimals: 6,
                    balance: item.balance,
                    uiAmount: item.shiftedBalance.toString(),
                    priceUsd: "",
                    valueUsd: "",
                    valueSol: "",
                };
            });

            // Calculate total portfolio value
            const totalUsd = items.reduce(
                (sum, item) => sum.plus(new BigNumber(item.valueUsd)),
                new BigNumber(0)
            );

            const totalSol = totalUsd.div(solPriceInUSD);

            const portfolio: WalletPortfolio = {
                totalUsd: totalUsd.toFixed(6),
                totalSol: totalSol.toFixed(6),
                items: items.sort((a, b) =>
                    new BigNumber(b.valueUsd)
                        .minus(new BigNumber(a.valueUsd))
                        .toNumber()
                ),
            };

            // Cache the portfolio for future requests
            this.setCacheValue(cacheKey, portfolio, 60 * 1000); // Cache for 1 minute

            return portfolio;
        } catch (error) {
            console.error("Error fetching portfolio:", error);
            throw error;
        }
    }

    async fetchPrices(runtime): Promise<Prices> {
        try {
            const cacheKey = "prices";
            const cachedValue = this.getCacheValue<Prices>(cacheKey);

            // Log detailed caching information
            console.log("Caching Debug:", {
                cacheKey,
                cacheInitialized: this.isCacheInitialized,
                cacheInstance: this.cache ? "Cache exists" : "Cache is null",
                cachedValue: cachedValue ? "Found" : "Not found"
            });

            if (cachedValue) {
                console.log("Cache hit for fetchPrices");
                return cachedValue;
            }
            console.log("Cache miss for fetchPrices");

            const { SOL, BTC, ETH } = PROVIDER_CONFIG.TOKEN_ADDRESSES;
            const tokens = [SOL, BTC, ETH];
            const prices: Prices = {
                solana: { usd: "0" },
                bitcoin: { usd: "0" },
                ethereum: { usd: "0" },
            };

            for (const token of tokens) {
                const response = await this.fetchWithRetry(
                    runtime,
                    `${PROVIDER_CONFIG.BIRDEYE_API}/defi/price?address=${token}`,
                    {
                        headers: {
                            "x-chain": "solana",
                        },
                    }
                );

                if (response?.data?.value) {
                    const price = response.data.value.toString();
                    prices[
                        token === SOL
                            ? "solana"
                            : token === BTC
                                ? "bitcoin"
                                : "ethereum"
                    ].usd = price;
                } else {
                    console.warn(`No price data available for token: ${token}`);
                }
            }

            this.setCacheValue(cacheKey, prices, 300); // Set TTL to 5 minutes explicitly
            return prices;
        } catch (error) {
            console.error("Error fetching prices:", error);
            throw error;
        }
    }

    formatPortfolio(
        runtime,
        portfolio: WalletPortfolio,
        prices: Prices
    ): string {
        let output = `${runtime.character.description}\n`;
        output += `Wallet Address: ${this.walletPublicKey.toBase58()}\n\n`;

        const totalUsdFormatted = new BigNumber(portfolio.totalUsd).toFixed(2);
        const totalSolFormatted = portfolio.totalSol;

        output += `Total Value: $${totalUsdFormatted} (${totalSolFormatted} SOL)\n\n`;
        output += "Token Balances:\n";

        const nonZeroItems = portfolio.items.filter((item) =>
            new BigNumber(item.uiAmount).isGreaterThan(0)
        );

        if (nonZeroItems.length === 0) {
            output += "No tokens found with non-zero balance\n";
        } else {
            for (const item of nonZeroItems) {
                const valueUsd = new BigNumber(item.valueUsd).toFixed(2);
                output += `${item.name} (${item.symbol}): ${new BigNumber(
                    item.uiAmount
                ).toFixed(6)} ($${valueUsd} | ${item.valueSol} SOL)\n`;
            }
        }

        output += "\nMarket Prices:\n";
        output += `SOL: $${new BigNumber(prices.solana.usd).toFixed(2)}\n`;
        output += `BTC: $${new BigNumber(prices.bitcoin.usd).toFixed(2)}\n`;
        output += `ETH: $${new BigNumber(prices.ethereum.usd).toFixed(2)}\n`;

        return output;
    }

    async getFormattedPortfolio(runtime): Promise<string> {
        try {
            const [portfolio, prices] = await Promise.all([
                this.fetchPortfolioValue(runtime),
                this.fetchPrices(runtime),
            ]);

            return this.formatPortfolio(runtime, portfolio, prices);
        } catch (error) {
            console.error("Error generating portfolio report:", error);
            return "Unable to fetch wallet information. Please try again later.";
        }
    }
}

const walletProvider: Provider = {
    async get(
        runtime: IAgentRuntime,
        _message: Memory,
        _state?: State
    ): Promise<string | null> {
        try {
            const { publicKey } = await getWalletKey(runtime, false);
            if (!publicKey) {
                return null;
            }

            const rpcEndpoint = runtime.getSetting("RPC_ENDPOINT") || PROVIDER_CONFIG.DEFAULT_RPC;
            const connection = new Connection(rpcEndpoint);

            const provider = WalletProvider.getInstance(connection, publicKey);
            return provider.getFormattedPortfolio(runtime);
        } catch (error) {
            console.error("Error in wallet provider:", error);
            return null;
        }
    },
};

// Module exports
export { walletProvider };
