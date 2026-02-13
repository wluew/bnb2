import Binance, { OrderSide, OrderType } from 'binance-api-node';

let client = Binance();

export const updateBinanceClient = (apiKey?: string, apiSecret?: string) => {
  client = Binance({
    apiKey: apiKey || undefined,
    apiSecret: apiSecret || undefined,
  });
};

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isFinal: boolean;
}

export type CandleInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M';

export const fetchHistoricalCandles = async (
  symbol: string = 'BNBUSDT',
  interval: CandleInterval = '4h',
  limit: number = 200
): Promise<Candle[]> => {
  // @ts-ignore
  const candles = await client.candles({ symbol, interval, limit });
  return candles.map((c) => ({
    time: c.openTime,
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
    volume: parseFloat(c.volume),
    isFinal: true,
  }));
};

export const subscribeToCandles = (
  symbol: string,
  interval: CandleInterval,
  onCandle: (candle: Candle) => void
) => {
  // @ts-ignore
  return client.ws.candles(symbol, interval, (candle: any) => {
    onCandle({
      time: candle.startTime,
      open: parseFloat(candle.open),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      close: parseFloat(candle.close),
      volume: parseFloat(candle.volume),
      isFinal: candle.isFinal,
    });
  });
};

export const placeOrder = async (
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: string,
  price?: string
) => {
  try {
    if (price) {
      return await client.order({
        symbol,
        side: side as OrderSide,
        quantity,
        price,
        type: 'LIMIT' as OrderType,
      });
    } else {
      return await client.order({
        symbol,
        side: side as OrderSide,
        quantity,
        type: 'MARKET' as OrderType,
      });
    }
  } catch (error) {
    console.error('Order placement failed:', error);
    throw error;
  }
};

export const getAccountBalances = async () => {
  try {
    const info = await client.accountInfo();
    return info.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
  } catch (error) {
    console.error('Failed to get account info:', error);
    return [];
  }
};
