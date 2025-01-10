import { Provider, IAgentRuntime, Memory, State } from "@elizaos/core";
import { TradeHistoryService } from "../../../services/tradeHistoryService";

export class TradeHistoryProvider implements Provider {
    private tradeHistoryService: TradeHistoryService;

    constructor() {
        this.tradeHistoryService = new TradeHistoryService();
        this.tradeHistoryService.initialize().catch(console.error);
    }

    async provide(runtime: IAgentRuntime, message: Memory, state: State): Promise<string> {
        const walletAddress = state.walletInfo?.publicKey;
        if (!walletAddress) {
            return "No wallet history available.";
        }

        const trades = await this.tradeHistoryService.getTradesByWallet(walletAddress);
        if (!trades || trades.length === 0) {
            return "No previous trades found for this wallet.";
        }

        // Format trade history for AI context
        const tradeHistory = trades.map(trade => ({
            date: trade.timestamp,
            pair: trade.tokenPair,
            type: trade.type,
            amount: trade.amount,
            price: trade.price
        }));

        return `
Recent Trade History:
${tradeHistory.map(trade => 
    `- ${trade.date.toISOString()}: ${trade.type} ${trade.amount} ${trade.pair} @ ${trade.price}`
).join('\n')}
`;
    }
}

// Singleton instance
export const tradeHistoryProvider = new TradeHistoryProvider();
