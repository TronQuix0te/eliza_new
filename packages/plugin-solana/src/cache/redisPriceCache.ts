import { Redis } from "ioredis";
import { TokenProvider } from "../providers/token";

export class RedisPriceCache {
    private redis: Redis;
    private readonly DEFAULT_TTL = 300; // 5 minutes in seconds
    private readonly PRICE_PREFIX = "prices:";

    constructor(redis: Redis) {
        this.redis = redis;
    }

    private formatKey(symbol: string): string {
        return `${this.PRICE_PREFIX}${symbol.toLowerCase()}`;
    }

    async getPrice(symbol: string): Promise<number | null> {
        try {
            const price = await this.redis.get(this.formatKey(symbol));
            return price ? parseFloat(price) : null;
        } catch (error) {
            console.error(`Error fetching price for ${symbol}:`, error);
            return null;
        }
    }

    async setPrice(
        symbol: string,
        price: number,
        ttl: number = this.DEFAULT_TTL
    ): Promise<void> {
        try {
            await this.redis.setex(
                this.formatKey(symbol),
                ttl,
                price.toString()
            );
        } catch (error) {
            console.error(`Error setting price for ${symbol}:`, error);
        }
    }

    async setBulkPrices(prices: Record<string, number>): Promise<void> {
        const pipeline = this.redis.pipeline();

        Object.entries(prices).forEach(([symbol, price]) => {
            pipeline.setex(
                this.formatKey(symbol),
                this.DEFAULT_TTL,
                price.toString()
            );
        });

        try {
            await pipeline.exec();
        } catch (error) {
            console.error("Error setting bulk prices:", error);
        }
    }

    async updateTokenProvider(tokenProvider: TokenProvider): Promise<void> {
        const fetchPrices = tokenProvider.fetchPrices.bind(tokenProvider);
        const originalFetch = tokenProvider.fetchPrice.bind(tokenProvider);

        // Override the fetchPrice method to check cache first
        tokenProvider.fetchPrice = async (symbol: string): Promise<number> => {
            const cachedPrice = await this.getPrice(symbol);
            if (cachedPrice !== null) {
                return cachedPrice;
            }

            const price = await originalFetch(symbol);
            await this.setPrice(symbol, price);
            return price;
        };

        // Override the fetchPrices method to use bulk operations
        tokenProvider.fetchPrices = async (
            symbols: string[]
        ): Promise<Record<string, number>> => {
            const prices: Record<string, number> = {};
            const missedSymbols: string[] = [];

            // Check cache first
            await Promise.all(
                symbols.map(async (symbol) => {
                    const price = await this.getPrice(symbol);
                    if (price !== null) {
                        prices[symbol] = price;
                    } else {
                        missedSymbols.push(symbol);
                    }
                })
            );

            // Fetch missing prices
            if (missedSymbols.length > 0) {
                const fetchedPrices = await fetchPrices(missedSymbols);
                await this.setBulkPrices(fetchedPrices);
                Object.assign(prices, fetchedPrices);
            }

            return prices;
        };
    }

    async getPriceStats(): Promise<{
        totalKeys: number;
        keyPattern: string[];
    }> {
        const keys = await this.redis.keys(`${this.PRICE_PREFIX}*`);
        return {
            totalKeys: keys.length,
            keyPattern: keys,
        };
    }
}

export async function initializePriceCache(
    redis: Redis,
    tokenProvider: TokenProvider
) {
    const priceCache = new RedisPriceCache(redis);
    await priceCache.updateTokenProvider(tokenProvider);

    // Monitor stats every minute
    setInterval(async () => {
        const stats = await priceCache.getPriceStats();
        console.log("Price Cache Stats:", stats);
    }, 60000);

    return priceCache;
}
