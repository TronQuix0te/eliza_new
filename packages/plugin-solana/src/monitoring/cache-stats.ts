import { RedisPriceCache } from '../cache/redisPriceCache';

export async function monitorCacheStats(priceCache: RedisPriceCache) {
    setInterval(async () => {
        try {
            const stats = await priceCache.getPriceStats();
            console.log('Price Cache Stats:', {
                timestamp: new Date().toISOString(),
                ...stats
            });
        } catch (error) {
            console.error('Error monitoring cache stats:', error);
        }
    }, 60000); // Every minute
}
