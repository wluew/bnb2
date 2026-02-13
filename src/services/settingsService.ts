export interface AppSettings {
    apiKey: string;
    apiSecret: string;
    geminiApiKey: string; // Nueva clave para Gemini
    riskPerTrade: number;
    defaultSymbol: string;
    defaultInterval: string;
    isTestnet: boolean;
}

const STORAGE_KEY = 'bnb_trader_settings';

const defaultSettings: AppSettings = {
    apiKey: '',
    apiSecret: '',
    geminiApiKey: '',
    riskPerTrade: 0.02,
    defaultSymbol: 'BNBUSDT',
    defaultInterval: '1h',
    isTestnet: true,
};

export const loadSettings = (): AppSettings => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            return { ...defaultSettings, ...JSON.parse(saved) };
        } catch (e) {
            return defaultSettings;
        }
    }
    return defaultSettings;
};

export const saveSettings = (settings: AppSettings) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};
