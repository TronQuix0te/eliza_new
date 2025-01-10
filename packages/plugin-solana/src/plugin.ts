import { Plugin } from "@elizaos/core";
import { executeSwap } from "./actions/swap";
import { trustEvaluator } from "./evaluators/trust";
import { walletProvider } from "./providers/wallet";
import { tokenProvider } from "./providers/token";
import { tradeHistoryProvider } from "./providers/tradeHistory";

export const solanaPlugin: Plugin = {
    name: "solana",
    actions: [executeSwap],
    evaluators: [trustEvaluator],
    providers: [walletProvider, tokenProvider, tradeHistoryProvider],
};

export default solanaPlugin;
