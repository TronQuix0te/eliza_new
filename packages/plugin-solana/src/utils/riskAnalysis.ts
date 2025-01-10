import { TokenProvider } from "../providers/token";
import { ProcessedTokenData } from "../types/token";
import BigNumber from "bignumber.js";

interface RiskMetrics {
    volatilityScore: number;
    liquidityRisk: number;
    holderConcentration: number;
    securityScore: number;
    marketStability: number;
    overallRisk: number;
}

export class RiskAnalyzer {
    constructor(private readonly tokenProvider: TokenProvider) {}

    async calculateRiskMetrics(tokenAddress: string) {
        if (!tokenAddress) {
            throw new Error('Token address is required for risk analysis');
        }

        try {
            const processedData = await this.tokenProvider.getProcessedTokenData();
            if (!processedData) {
                console.warn('No processed data available for risk analysis');
                return this.getDefaultRiskMetrics();
            }

            // Create initial metrics
            const metrics = {
                volatilityScore: this.calculateVolatility(processedData),
                liquidityRisk: this.calculateLiquidityRisk(processedData),
                holderConcentration: this.calculateHolderConcentration(processedData),
                securityScore: this.calculateSecurityScore(processedData),
                marketStability: this.calculateMarketStability(processedData)
            };

            // Calculate and add overallRisk to the metrics object
            return {
                ...metrics,
                overallRisk: this.calculateOverallRisk(metrics)
            };

        } catch (error) {
            console.error("Risk analysis failed:", error);
            return this.getDefaultRiskMetrics();
        }
    }

    private async safeCalculate<T>(calculateFunction: () => Promise<T> | T): Promise<T> {
        try {
            return await calculateFunction();
        } catch (error) {
            console.warn('Risk calculation component failed:', error);
            return null;
        }
    }

    private calculateVolatility(data: ProcessedTokenData): number {
        try {
            const timeframes = [
                { value: data.tradeData.price_change_1h_percent || 0, weight: 0.3 },
                { value: data.tradeData.price_change_24h_percent || 0, weight: 0.7 }
            ];

            const weightedVolatility = timeframes.reduce((acc, { value, weight }) => {
                return acc + (Math.abs(value) * weight);
            }, 0);

            // Normalize to 0-100 scale
            return Math.min(100, weightedVolatility);
        } catch (error) {
            console.warn('Error calculating volatility:', error);
            return 50; // Default medium volatility
        }
    }

    private calculateLiquidityRisk(data: ProcessedTokenData): number {
        try {
            const liquidity = new BigNumber(data.dexScreenerData?.pairs?.[0]?.liquidity?.usd || 0);
            const marketCap = new BigNumber(data.dexScreenerData?.pairs?.[0]?.marketCap || 0);

            if (marketCap.isZero()) {
                return 100; // Maximum risk if no market cap
            }

            // Calculate liquidity ratio
            const liquidityRatio = liquidity.dividedBy(marketCap).multipliedBy(100);

            // Higher ratio = lower risk
            const riskScore = Math.max(0, 100 - liquidityRatio.toNumber());

            return Math.min(100, riskScore);
        } catch (error) {
            console.warn('Error calculating liquidity risk:', error);
            return 75; // Default high risk
        }
    }

    private calculateHolderConcentration(data: ProcessedTokenData): number {
        try {
            const concentration = data.security.top10HolderPercent || 0;

            // Higher concentration = higher risk
            // Scale: 0-100 where >80% concentration is maximum risk
            return Math.min(100, (concentration / 80) * 100);
        } catch (error) {
            console.warn('Error calculating holder concentration:', error);
            return 50; // Default medium concentration
        }
    }

    private calculateSecurityScore(data: ProcessedTokenData): number {
        try {
            const factors = [
                { value: data.tokenCodex.blueCheckmark ? 0 : 100, weight: 0.3 }, // Verified status
                { value: data.security.creatorPercentage || 0, weight: 0.4 }, // Creator ownership
                { value: data.tokenCodex.isScam ? 100 : 0, weight: 0.3 } // Scam flag
            ];

            const weightedScore = factors.reduce((acc, { value, weight }) => {
                return acc + (value * weight);
            }, 0);

            return Math.min(100, weightedScore);
        } catch (error) {
            console.warn('Error calculating security score:', error);
            return 70; // Default higher risk
        }
    }

    private calculateMarketStability(data: ProcessedTokenData): number {
        try {
            const factors = [
                { value: Math.abs(data.tradeData.trade_24h_change_percent || 0), weight: 0.4 },
                { value: Math.abs(data.tradeData.volume_24h_change_percent || 0), weight: 0.3 },
                { value: data.tradeData.unique_wallet_24h_change_percent || 0, weight: 0.3 }
            ];

            const stabilityScore = factors.reduce((acc, { value, weight }) => {
                return acc + (Math.min(100, Math.abs(value)) * weight);
            }, 0);

            return Math.min(100, stabilityScore);
        } catch (error) {
            console.warn('Error calculating market stability:', error);
            return 50; // Default medium stability
        }
    }

    private calculateOverallRisk(metrics: {
        volatilityScore: number;
        liquidityRisk: number;
        holderConcentration: number;
        securityScore: number;
        marketStability: number;
    }): number {
        const weights = {
            volatilityScore: 0.25,
            liquidityRisk: 0.25,
            holderConcentration: 0.2,
            securityScore: 0.2,
            marketStability: 0.1
        };

        const overallRisk = Object.entries(weights).reduce((acc, [key, weight]) => {
            return acc + (metrics[key as keyof typeof metrics] * weight);
        }, 0);

        return Math.min(100, Math.round(overallRisk));
    }

    private getDefaultRiskMetrics() {
        return {
            volatilityScore: 50,
            liquidityRisk: 75,
            holderConcentration: 50,
            securityScore: 70,
            marketStability: 50,
            overallRisk: 65
        };
    }
}