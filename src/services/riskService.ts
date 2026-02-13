export interface RiskParams {
    accountBalance: number;
    riskPerTradePercentage: number; // e.g., 0.01 for 1%
    stopLossPercentage: number;
    takeProfitPercentage: number;
}

export interface TradeSetup {
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    positionSize: number;
    riskAmount: number;
}

export const calculateTradeSetup = (
    entryPrice: number,
    params: RiskParams,
    side: 'BUY' | 'SELL'
): TradeSetup => {
    const { accountBalance, riskPerTradePercentage, stopLossPercentage, takeProfitPercentage } = params;

    const riskAmount = accountBalance * riskPerTradePercentage;

    let stopLoss: number;
    let takeProfit: number;

    if (side === 'BUY') {
        stopLoss = entryPrice * (1 - stopLossPercentage);
        takeProfit = entryPrice * (1 + takeProfitPercentage);
    } else {
        stopLoss = entryPrice * (1 + stopLossPercentage);
        takeProfit = entryPrice * (1 - takeProfitPercentage);
    }

    const priceDiff = Math.abs(entryPrice - stopLoss);
    const positionSize = riskAmount / priceDiff;

    return {
        entryPrice,
        stopLoss,
        takeProfit,
        positionSize,
        riskAmount
    };
};
