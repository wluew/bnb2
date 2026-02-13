import { EMA, RSI, MACD, BollingerBands } from 'technicalindicators';
import type { Candle } from './binanceService';

export interface IndicatorData {
    time: number;
    ema7?: number;
    ema25?: number;
    ema99?: number;
    rsi?: number;
    macd?: {
        macd: number;
        signal: number;
        histogram: number;
    };
    bb?: {
        upper: number;
        middle: number;
        lower: number;
    };
}

export const calculateIndicators = (candles: Candle[]): IndicatorData[] => {
    const closes = candles.map((c) => c.close);
    const times = candles.map((c) => c.time);

    const ema7 = EMA.calculate({ period: 7, values: closes });
    const ema25 = EMA.calculate({ period: 25, values: closes });
    const ema99 = EMA.calculate({ period: 99, values: closes });
    const rsi = RSI.calculate({ period: 14, values: closes });
    const macd = MACD.calculate({
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        values: closes,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
    });
    const bb = BollingerBands.calculate({
        period: 20,
        stdDev: 2,
        values: closes,
    });

    return times.map((time, i) => {
        const data: IndicatorData = { time };

        // EMA 7 (offset by 6)
        if (i >= 6) data.ema7 = ema7[i - 6];

        // EMA 25 (offset by 24)
        if (i >= 24) data.ema25 = ema25[i - 24];

        // EMA 99 (offset by 98)
        if (i >= 98) data.ema99 = ema99[i - 98];

        // RSI 14 (offset by 14)
        if (i >= 14) data.rsi = rsi[i - 14];

        const macdIndex = i - (26 + 9 - 2);
        if (macdIndex >= 0 && macd[macdIndex]) {
            data.macd = {
                macd: macd[macdIndex].MACD!,
                signal: macd[macdIndex].signal!,
                histogram: macd[macdIndex].histogram!,
            };
        }

        const bbIndex = i - 19;
        if (bbIndex >= 0 && bb[bbIndex]) {
            data.bb = {
                upper: bb[bbIndex].upper,
                middle: bb[bbIndex].middle,
                lower: bb[bbIndex].lower,
            };
        }

        return data;
    });
};

export const calculateFibonacciLevels = (candles: Candle[]) => {
    if (candles.length === 0) return null;

    let high = -Infinity;
    let low = Infinity;

    candles.forEach(c => {
        if (c.high > high) high = c.high;
        if (c.low < low) low = c.low;
    });

    const diff = high - low;

    return {
        0: high,
        0.236: high - 0.236 * diff,
        0.382: high - 0.382 * diff,
        0.5: high - 0.5 * diff,
        0.618: high - 0.618 * diff,
        0.786: high - 0.786 * diff,
        1: low
    };
};
