import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AppSettings } from "./settingsService";

export interface AIAnalysisResult {
    analysis: string;
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence: number;
    timestamp: number;
}

export const analyzeMarketWithAI = async (
    settings: AppSettings,
    marketData: any
): Promise<AIAnalysisResult> => {
    if (!settings.geminiApiKey) {
        throw new Error("API Key de Gemini no configurada");
    }

    try {
        const genAI = new GoogleGenerativeAI(settings.geminiApiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Actualizado a Gemini 2.5 Flash

        const prompt = `
            Actúa como un analista de trading experto en criptomonedas.
            Analiza los siguientes datos técnicos de ${marketData.symbol} en temporalidad ${marketData.interval}:

            PRECÍO ACTUAL: ${marketData.currentPrice}
            TENDENCIA EMA(99): ${marketData.trend}
            EMAs (7, 25, 99): ${marketData.emas.ema7.toFixed(2)}, ${marketData.emas.ema25.toFixed(2)}, ${marketData.emas.ema99.toFixed(2)}
            RSI: ${marketData.rsi.toFixed(2)}
            MACD: ${JSON.stringify(marketData.macd)}
            NIVELES FIBONACCI CERCANOS:
            - 0%: ${marketData.fib[0]}
            - 23.6%: ${marketData.fib[0.236]}
            - 38.2%: ${marketData.fib[0.382]}
            - 50%: ${marketData.fib[0.5]}
            - 61.8%: ${marketData.fib[0.618]}
            - 100%: ${marketData.fib[1]}

            Instrucciones:
            1. Evalúa la fuerza de la tendencia.
            2. Identifica si el precio está rebotando en un soporte o resistencia Fibonacci clave.
            3. Analiza la convergencia de indicadores (RSI + MACD + EMAs).
            4. Proporciona una recomendación clara (COMPRAR, VENDER, ESPERAR).
            5. Estima un porcentaje de confianza (0-100%).

            Formato de respuesta (JSON):
            {
                "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
                "confidence": number,
                "analysis": "Breve explicación de 2-3 frases enfocada en acción de precio y niveles clave."
            }
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Limpiar el texto para obtener solo el JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Formato de respuesta inválido");

        const parsed = JSON.parse(jsonMatch[0]);

        return {
            analysis: parsed.analysis,
            sentiment: parsed.sentiment,
            confidence: parsed.confidence,
            timestamp: Date.now()
        };

    } catch (error) {
        console.error("Error en análisis IA:", error);
        throw error;
    }
};
