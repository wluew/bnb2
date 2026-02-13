import type { Candle } from './binanceService';
import type { IndicatorData } from './indicatorService';
import { calculateFibonacciLevels } from './indicatorService';

export const SignalType = {
    BUY: 'BUY',
    SELL: 'SELL',
    NONE: 'NONE'
} as const;

export type SignalType = typeof SignalType[keyof typeof SignalType];

export interface Signal {
    type: SignalType;
    price: number;
    time: number;
    reason: string;
}

export const checkSignals = (candles: Candle[], indicators: IndicatorData[]): Signal => {
    if (candles.length < 100) return { type: SignalType.NONE, price: 0, time: 0, reason: '' };

    const currentPrice = candles[candles.length - 1].close;
    const currentIndicator = indicators[indicators.length - 1];
    const prevIndicator = indicators[indicators.length - 2];

    if (!currentIndicator || !prevIndicator) return { type: SignalType.NONE, price: 0, time: 0, reason: '' };

    // --- INDICADORES ---

    // 1. Tendencia: Precio sobre EMA 99
    const isUpTrend = currentIndicator.ema99 ? currentPrice > currentIndicator.ema99 : true;

    // 2. Alineación de EMAs (Tendencia fuerte cuando 7 > 25 > 99)
    const emasAligned = currentIndicator.ema7 && currentIndicator.ema25 && currentIndicator.ema99 &&
        currentIndicator.ema7 > currentIndicator.ema25 &&
        currentIndicator.ema25 > currentIndicator.ema99;

    const emasAlignedBearish = currentIndicator.ema7 && currentIndicator.ema25 && currentIndicator.ema99 &&
        currentIndicator.ema7 < currentIndicator.ema25 &&
        currentIndicator.ema25 < currentIndicator.ema99;

    // 3. Momentum: Cruce de MACD
    let macdBullishCrossover = false;
    let macdBearishCrossover = false;
    if (currentIndicator.macd && prevIndicator.macd) {
        if (prevIndicator.macd.macd < prevIndicator.macd.signal && currentIndicator.macd.macd > currentIndicator.macd.signal) {
            macdBullishCrossover = true;
        }
        if (prevIndicator.macd.macd > prevIndicator.macd.signal && currentIndicator.macd.macd < currentIndicator.macd.signal) {
            macdBearishCrossover = true;
        }
    }

    // 4. Fibonacci: Niveles de Soporte/Resistencia
    const fibLevels = calculateFibonacciLevels(candles.slice(-100));
    let nearFibSupport = false;
    let nearFibResistance = false;

    if (fibLevels) {
        // Verificar si estamos cerca de un nivel de soporte clave (618, 50, 382)
        const supportLevels = [fibLevels[0.618], fibLevels[0.5], fibLevels[0.382]];
        const resistanceLevels = [fibLevels[0.236], fibLevels[0]];

        // Tolerancia del 0.5% para considerar "cerca" de un nivel
        const tolerance = 0.005;

        nearFibSupport = supportLevels.some(level =>
            Math.abs(currentPrice - level) / level < tolerance
        );

        nearFibResistance = resistanceLevels.some(level =>
            Math.abs(currentPrice - level) / level < tolerance
        );
    }

    // 5. RSI: Evitar sobrecompra/sobreventa extrema
    const rsiVal = currentIndicator.rsi || 50;
    const isRsiSafeBuy = rsiVal < 70;
    const isRsiSafeSell = rsiVal > 30;

    // 6. Volumen: Confirmación
    const currentVolume = candles[candles.length - 1].volume;
    const avgVolume = candles.slice(-20).reduce((acc, c) => acc + c.volume, 0) / 20;
    const isHighVolume = currentVolume > avgVolume * 1.1;

    // --- LÓGICA FINAL ---

    // COMPRA: Tendencia Alcista + EMAs Alineadas + Cruce MACD + Cerca de Soporte Fib + RSI Seguro + Volumen
    if (isUpTrend && emasAligned && macdBullishCrossover && nearFibSupport && isRsiSafeBuy && isHighVolume) {
        return {
            type: SignalType.BUY,
            price: currentPrice,
            time: candles[candles.length - 1].time,
            reason: 'Convergencia: EMA(7>25>99) + MACD + Fib Soporte + RSI'
        };
    }

    // COMPRA ALTERNATIVA: Sin Fibonacci pero con señales muy fuertes
    if (isUpTrend && emasAligned && macdBullishCrossover && isRsiSafeBuy && isHighVolume && !nearFibResistance) {
        return {
            type: SignalType.BUY,
            price: currentPrice,
            time: candles[candles.length - 1].time,
            reason: 'Convergencia: EMA(7>25>99) + MACD Bullish + RSI OK'
        };
    }

    // VENTA: Tendencia Bajista + EMAs Alineadas Bajistas + Cruce MACD + Cerca de Resistencia Fib + RSI Seguro + Volumen
    if (!isUpTrend && emasAlignedBearish && macdBearishCrossover && nearFibResistance && isRsiSafeSell && isHighVolume) {
        return {
            type: SignalType.SELL,
            price: currentPrice,
            time: candles[candles.length - 1].time,
            reason: 'Convergencia: EMA(7<25<99) + MACD + Fib Resistencia + Vol'
        };
    }

    // VENTA ALTERNATIVA: Sin Fibonacci pero con señales muy fuertes
    if (!isUpTrend && emasAlignedBearish && macdBearishCrossover && isRsiSafeSell && isHighVolume && !nearFibSupport) {
        return {
            type: SignalType.SELL,
            price: currentPrice,
            time: candles[candles.length - 1].time,
            reason: 'Convergencia: EMA(7<25<99) + MACD Bearish + Volumen'
        };
    }

    return { type: SignalType.NONE, price: 0, time: 0, reason: '' };
};
