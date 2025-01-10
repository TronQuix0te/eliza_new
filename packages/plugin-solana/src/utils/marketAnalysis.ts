import { TokenProvider } from "../providers/token";
import BigNumber from "bignumber.js";
import { ProcessedTokenData } from "../types/token";

export class MarketAnalyzer {
    constructor(private readonly tokenProvider: TokenProvider) {}

    async analyzeTokenMetrics(tokenAddress: string) {
        if (!tokenAddress) {
            throw new Error('Token address is required for market analysis');
        }

        try {
            const processedData = await this.tokenProvider.getProcessedTokenData();
            if (!processedData) {
                console.warn('No processed data available for market analysis');
                return this.getDefaultMetrics();
            }

            // Wrap each analysis in try-catch for granular error handling
            const metrics = {
                momentum: await this.safeAnalyze(() => this.analyzeMomentum(processedData)),
                volumeProfile: await this.safeAnalyze(() => this.analyzeVolumeProfile(processedData)),
                marketStructure: await this.safeAnalyze(() => this.analyzeMarketStructure(processedData)),
                tradingActivity: await this.safeAnalyze(() => this.analyzeTradingActivity(processedData)),
                liquidityMetrics: await this.safeAnalyze(() => this.analyzeLiquidityMetrics(processedData))
            };

            return metrics;
        } catch (error) {
            console.error("Market analysis failed:", error);
            return this.getDefaultMetrics();
        }
    }

    private async safeAnalyze<T>(analyzeFunction: () => Promise<T> | T): Promise<T> {
        try {
            return await analyzeFunction();
        } catch (error) {
            console.warn('Analysis component failed:', error);
            return null;
        }
    }

    private analyzeMomentum(data: ProcessedTokenData) {
        try {
            const timeframes = [
                { period: "1h", change: data.tradeData.price_change_1h_percent || 0 },
                { period: "24h", change: data.tradeData.price_change_24h_percent || 0 }
            ];

            const momentum = {
                trend: this.calculateTrend(timeframes),
                strength: this.calculateMomentumStrength(timeframes),
                volatility: this.calculateVolatility(data),
                rsi: this.calculateSimpleRSI(data)
            };

            return momentum;
        } catch (error) {
            console.warn('Error analyzing momentum:', error);
            return this.getDefaultMomentum();
        }
    }

    private analyzeVolumeProfile(data: ProcessedTokenData) {
        try {
            const volumeProfile = {
                volume24h: new BigNumber(data.tradeData.volume_24h || 0).toNumber(),
                volumeChange: new BigNumber(data.tradeData.volume_24h_change_percent || 0).toNumber(),
                buyVolumeRatio: this.calculateBuyVolumeRatio(data),
                volumeTrend: this.calculateVolumeTrend(data)
            };

            return volumeProfile;
        } catch (error) {
            console.warn('Error analyzing volume profile:', error);
            return this.getDefaultVolumeProfile();
        }
    }

    private analyzeMarketStructure(data: ProcessedTokenData) {
        try {
            const pair = data.dexScreenerData?.pairs?.[0];
            return {
                marketCap: pair?.marketCap || 0,
                fullyDilutedValue: pair?.fdv || 0,
                liquidityUSD: pair?.liquidity?.usd || 0,
                priceDiscovery: this.assessPriceDiscovery(data)
            };
        } catch (error) {
            console.warn('Error analyzing market structure:', error);
            return this.getDefaultMarketStructure();
        }
    }

    private analyzeTradingActivity(data: ProcessedTokenData) {
        try {
            return {
                uniqueTraders24h: data.tradeData.unique_wallet_24h || 0,
                tradeCount24h: data.tradeData.trade_24h || 0,
                averageTradeSize: this.calculateAverageTradeSize(data),
                tradingPattern: this.analyzeTradingPattern(data)
            };
        } catch (error) {
            console.warn('Error analyzing trading activity:', error);
            return this.getDefaultTradingActivity();
        }
    }

    private analyzeLiquidityMetrics(data: ProcessedTokenData) {
        try {
            const pair = data.dexScreenerData?.pairs?.[0];
            return {
                liquidityDepth: pair?.liquidity?.usd || 0,
                liquidityScore: this.calculateLiquidityScore(data),
                liquidityChange24h: this.calculateLiquidityChange(data),
                liquidityConcentration: this.calculateLiquidityConcentration(data)
            };
        } catch (error) {
            console.warn('Error analyzing liquidity metrics:', error);
            return this.getDefaultLiquidityMetrics();
        }
    }

    // Helper methods for calculations
    private calculateTrend(timeframes: Array<{ period: string; change: number }>) {
        const weightedChange = timeframes.reduce((acc, tf) => {
            const weight = tf.period === "1h" ? 0.3 : 0.7;
            return acc + (tf.change * weight);
        }, 0);

        if (weightedChange > 5) return "bullish";
        if (weightedChange < -5) return "bearish";
        return "neutral";
    }

    private calculateMomentumStrength(timeframes: Array<{ period: string; change: number }>) {
        const totalChange = Math.abs(timeframes.reduce((acc, tf) => acc + tf.change, 0));
        return Math.min(100, totalChange / 2);
    }

    private calculateVolatility(data: ProcessedTokenData) {
        const changes = [
            data.tradeData.price_change_1h_percent,
            data.tradeData.price_change_24h_percent
        ].filter(change => typeof change === 'number');

        if (changes.length === 0) return 0;

        const volatility = changes.reduce((acc, change) => acc + Math.abs(change), 0) / changes.length;
        return Math.min(100, volatility);
    }

    private calculateSimpleRSI(data: ProcessedTokenData) {
        // Simplified RSI calculation based on available data
        const gains = [
            data.tradeData.price_change_1h_percent,
            data.tradeData.price_change_24h_percent
        ].filter(change => (change || 0) > 0);

        const losses = [
            data.tradeData.price_change_1h_percent,
            data.tradeData.price_change_24h_percent
        ].filter(change => (change || 0) < 0);

        const avgGain = gains.length ? gains.reduce((acc, val) => acc + val, 0) / gains.length : 0;
        const avgLoss = losses.length ? Math.abs(losses.reduce((acc, val) => acc + val, 0) / losses.length) : 0;

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    private calculateBuyVolumeRatio(data: ProcessedTokenData) {
        const buyVolume = new BigNumber(data.tradeData.volume_buy_24h || 0);
        const totalVolume = new BigNumber(data.tradeData.volume_24h || 0);

        if (totalVolume.isZero()) return 0;
        return buyVolume.dividedBy(totalVolume).multipliedBy(100).toNumber();
    }

    private calculateVolumeTrend(data: ProcessedTokenData) {
        const volumeChange = new BigNumber(data.tradeData.volume_24h_change_percent || 0);
        if (volumeChange.isGreaterThan(20)) return "increasing";
        if (volumeChange.isLessThan(-20)) return "decreasing";
        return "stable";
    }

    private assessPriceDiscovery(data: ProcessedTokenData) {
        const liquidityUSD = new BigNumber(data.dexScreenerData?.pairs?.[0]?.liquidity?.usd || 0);
        const volume24h = new BigNumber(data.tradeData.volume_24h || 0);

        if (liquidityUSD.isZero()) return "insufficient_data";
        const ratio = volume24h.dividedBy(liquidityUSD);

        if (ratio.isGreaterThan(1)) return "high";
        if (ratio.isGreaterThan(0.1)) return "medium";
        return "low";
    }

    private calculateAverageTradeSize(data: ProcessedTokenData) {
        const volume = new BigNumber(data.tradeData.volume_24h || 0);
        const trades = new BigNumber(data.tradeData.trade_24h || 1);

        if (trades.isZero()) return 0;
        return volume.dividedBy(trades).toNumber();
    }

    private analyzeTradingPattern(data: ProcessedTokenData) {
        const buyRatio = this.calculateBuyVolumeRatio(data);
        const uniqueWallets = data.tradeData.unique_wallet_24h || 0;
        const tradeCount = data.tradeData.trade_24h || 0;

        return {
            buyPressure: buyRatio > 60 ? "high" : buyRatio < 40 ? "low" : "neutral",
            traderDiversity: uniqueWallets > 100 ? "high" : uniqueWallets > 50 ? "medium" : "low",
            intensity: tradeCount > 1000 ? "high" : tradeCount > 500 ? "medium" : "low"
        };
    }

    private calculateLiquidityScore(data: ProcessedTokenData) {
        const liquidity = new BigNumber(data.dexScreenerData?.pairs?.[0]?.liquidity?.usd || 0);
        const marketCap = new BigNumber(data.dexScreenerData?.pairs?.[0]?.marketCap || 1);

        if (marketCap.isZero()) return 0;

        // Calculate liquidity score as a percentage of market cap
        const score = liquidity.dividedBy(marketCap).multipliedBy(100);
        return Math.min(100, score.toNumber());
    }

    private calculateLiquidityChange(data: ProcessedTokenData) {
        const pair = data.dexScreenerData?.pairs?.[0];
        if (!pair) return 0;

        const currentLiquidity = new BigNumber(pair.liquidity?.usd || 0);
        const previousLiquidity = currentLiquidity.multipliedBy(0.95); // Approximate previous liquidity

        if (previousLiquidity.isZero()) return 0;

        return currentLiquidity
            .minus(previousLiquidity)
            .dividedBy(previousLiquidity)
            .multipliedBy(100)
            .toNumber();
    }

    private calculateLiquidityConcentration(data: ProcessedTokenData) {
        // Calculate concentration of liquidity across pairs
        const pairs = data.dexScreenerData?.pairs || [];
        if (pairs.length <= 1) return 100;

        const totalLiquidity = pairs.reduce((acc, pair) =>
            acc.plus(new BigNumber(pair.liquidity?.usd || 0)), new BigNumber(0));

        if (totalLiquidity.isZero()) return 0;

        const mainPairLiquidity = new BigNumber(pairs[0].liquidity?.usd || 0);
        return mainPairLiquidity.dividedBy(totalLiquidity).multipliedBy(100).toNumber();
    }

    // Default value methods
    private getDefaultMetrics() {
        return {
            momentum: this.getDefaultMomentum(),
            volumeProfile: this.getDefaultVolumeProfile(),
            marketStructure: this.getDefaultMarketStructure(),
            tradingActivity: this.getDefaultTradingActivity(),
            liquidityMetrics: this.getDefaultLiquidityMetrics()
        };
    }

    private getDefaultMomentum() {
        return {
            trend: "neutral",
            strength: 0,
            volatility: 0,
            rsi: 50
        };
    }

    private getDefaultVolumeProfile() {
        return {
            volume24h: 0,
            volumeChange: 0,
            buyVolumeRatio: 50,
            volumeTrend: "stable"
        };
    }

    private getDefaultMarketStructure() {
        return {
            marketCap: 0,
            fullyDilutedValue: 0,
            liquidityUSD: 0,
            priceDiscovery: "insufficient_data"
        };
    }

    private getDefaultTradingActivity() {
        return {
            uniqueTraders24h: 0,
            tradeCount24h: 0,
            averageTradeSize: 0,
            tradingPattern: {
                buyPressure: "neutral",
                traderDiversity: "low",
                intensity: "low"
            }
        };
    }

    private getDefaultLiquidityMetrics() {
        return {
            liquidityDepth: 0,
            liquidityScore: 0,
            liquidityChange24h: 0,
            liquidityConcentration: 100
        };
    }
}