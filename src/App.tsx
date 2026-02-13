import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart, Bar, Line, ReferenceLine
} from 'recharts';
import {
  TrendingUp, Bell, Shield, Zap, BarChart3, RefreshCcw, Settings as SettingsIcon, Wallet, X, Clock, AlertCircle
} from 'lucide-react';
import { fetchHistoricalCandles, subscribeToCandles, updateBinanceClient, placeOrder, getAccountBalances } from './services/binanceService';
import type { Candle, CandleInterval } from './services/binanceService';
import { calculateIndicators, calculateFibonacciLevels } from './services/indicatorService';
import type { IndicatorData } from './services/indicatorService';
import { checkSignals, SignalType } from './services/strategyService';
import type { Signal } from './services/strategyService';
import { calculateTradeSetup } from './services/riskService';
import type { RiskParams, TradeSetup } from './services/riskService';
import { sendNotification, NotificationType, requestNotificationPermission } from './services/notificationService';
import { loadSettings, saveSettings } from './services/settingsService';
import type { AppSettings } from './services/settingsService';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { analyzeMarketWithAI } from './services/aiService';
import type { AIAnalysisResult } from './services/aiService';

const INTERVALS: CandleInterval[] = ['5m', '15m', '1h', '4h', '1d'];

interface TimeframeState {
  candles: Candle[];
  indicators: IndicatorData[];
  lastSignal: Signal | null;
}

interface AlertHistoryItem {
  id: string;
  timestamp: number;
  interval: string;
  type: SignalType;
  price: number;
  reason: string;
}

const App: React.FC = () => {
  const [timeframes, setTimeframes] = useState<Record<string, TimeframeState>>({
    '5m': { candles: [], indicators: [], lastSignal: null },
    '15m': { candles: [], indicators: [], lastSignal: null },
    '1h': { candles: [], indicators: [], lastSignal: null },
    '4h': { candles: [], indicators: [], lastSignal: null },
    '1d': { candles: [], indicators: [], lastSignal: null },
  });

  const [activeInterval, setActiveInterval] = useState<CandleInterval>('1h');
  const [signals, setSignals] = useState<Signal[]>([]);
  const [alertHistory, setAlertHistory] = useState<AlertHistoryItem[]>([]);
  const [activeTrade, setActiveTrade] = useState<TradeSetup | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showAlertHistory, setShowAlertHistory] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(loadSettings());
  const [balances, setBalances] = useState<any[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    updateBinanceClient(settings.apiKey, settings.apiSecret);
    if (settings.apiKey) fetchBalances();
  }, [settings.apiKey, settings.apiSecret]);

  const fetchBalances = async () => {
    const b = await getAccountBalances();
    setBalances(b);
  };

  const processCandles = useCallback((interval: CandleInterval, newCandles: Candle[]) => {
    const indicators = calculateIndicators(newCandles);
    const signal = checkSignals(newCandles, indicators);

    setTimeframes(prev => ({
      ...prev,
      [interval]: {
        candles: newCandles,
        indicators,
        lastSignal: signal.type !== SignalType.NONE ? signal : prev[interval].lastSignal
      }
    }));

    if (signal.type !== SignalType.NONE) {
      setSignals(prev => {
        const isDuplicate = prev.length > 0 && prev[prev.length - 1].time === signal.time && prev[prev.length - 1].reason.includes(interval);
        if (isDuplicate) return prev;

        const signalWithInterval = { ...signal, reason: `[${interval}] ${signal.reason}` };

        // Agregar a historial de alertas
        const alertItem: AlertHistoryItem = {
          id: `${interval}-${signal.time}`,
          timestamp: signal.time,
          interval,
          type: signal.type,
          price: signal.price,
          reason: signal.reason
        };

        setAlertHistory(prev => [alertItem, ...prev].slice(0, 50));

        if (interval === activeInterval) {
          const tradeRisk: RiskParams = {
            accountBalance: parseFloat(balances.find(b => b.asset === 'USDT')?.free || '1000'),
            riskPerTradePercentage: settings.riskPerTrade,
            stopLossPercentage: 0.015,
            takeProfitPercentage: 0.045,
          };
          const trade = calculateTradeSetup(signal.price, tradeRisk, signal.type === SignalType.BUY ? 'BUY' : 'SELL');
          setActiveTrade(trade);
        }

        sendNotification(NotificationType.ALERT, `Señal en ${interval}: ${signal.reason}`);
        return [...prev, signalWithInterval].slice(-20);
      });
    }
  }, [activeInterval, balances, settings.riskPerTrade]);

  useEffect(() => {
    const init = async () => {
      await requestNotificationPermission();

      try {
        const fetchPromises = INTERVALS.map(async (interval) => {
          const hist = await fetchHistoricalCandles(settings.defaultSymbol, interval, 250);
          return { interval, hist };
        });

        const results = await Promise.all(fetchPromises);

        const newState = { ...timeframes };
        results.forEach(({ interval, hist }) => {
          const indicators = calculateIndicators(hist);
          newState[interval] = {
            candles: hist,
            indicators,
            lastSignal: null
          };
        });

        setTimeframes(newState);
        setIsLoading(false);

        const unsubscribes = INTERVALS.map(interval => {
          return subscribeToCandles(settings.defaultSymbol, interval, (newCandle) => {
            setTimeframes(prev => {
              const current = prev[interval].candles;
              let updated = [...current];

              if (updated.length > 0 && updated[updated.length - 1].time === newCandle.time) {
                updated[updated.length - 1] = newCandle;
              } else {
                updated.push(newCandle);
                if (updated.length > 400) updated.shift();
              }

              const indicators = calculateIndicators(updated);
              const signal = checkSignals(updated, indicators);

              if (newCandle.isFinal || signal.type !== SignalType.NONE) {
                processCandles(interval, updated);
              }

              return {
                ...prev,
                [interval]: { ...prev[interval], candles: updated, indicators }
              };
            });
          });
        });

        return () => unsubscribes.forEach(unsub => unsub());
      } catch (error) {
        console.error('Error al inicializar multi-temporalidad:', error);
      }
    };

    init();
  }, [settings.defaultSymbol]);

  const activeData = timeframes[activeInterval];

  const fibLevels = useMemo(() => {
    if (!activeData || activeData.candles.length < 100) return null;
    return calculateFibonacciLevels(activeData.candles.slice(-100));
  }, [activeData]);

  const chartData = useMemo(() => {
    if (!activeData) return [];
    return activeData.candles.map((c, i) => ({
      time: format(c.time, activeInterval === '1d' ? 'dd MMM' : 'HH:mm', { locale: es }),
      price: c.close,
      volume: c.volume,
      ema7: activeData.indicators[i]?.ema7,
      ema25: activeData.indicators[i]?.ema25,
      ema99: activeData.indicators[i]?.ema99,
    })).slice(-100);
  }, [activeData, activeInterval]);

  const handleConsultAI = async () => {
    if (!settings.geminiApiKey) {
      alert("Por favor configura tu API Key de Gemini en Configuración");
      setShowSettings(true);
      return;
    }

    if (!activeData || activeData.candles.length < 100) return;

    setIsAnalyzing(true);
    try {
      const lastCandle = activeData.candles[activeData.candles.length - 1];
      const lastIndicator = activeData.indicators[activeData.indicators.length - 1];
      const fibs = calculateFibonacciLevels(activeData.candles.slice(-100));

      if (!lastIndicator || !fibs) return;

      const marketData = {
        symbol: settings.defaultSymbol,
        interval: activeInterval,
        currentPrice: lastCandle.close,
        trend: lastIndicator.ema99 < lastCandle.close ? "ALCISTA" : "BAJISTA",
        emas: {
          ema7: lastIndicator.ema7,
          ema25: lastIndicator.ema25,
          ema99: lastIndicator.ema99
        },
        rsi: lastIndicator.rsi,
        macd: lastIndicator.macd,
        fib: fibs
      };

      const result = await analyzeMarketWithAI(settings, marketData);
      setAiAnalysis(result);
    } catch (error: any) {
      alert(`Error al consultar IA: ${error.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExecuteTrade = async () => {
    if (!activeTrade) return;
    if (!settings.apiKey) {
      alert("Configura las llaves API.");
      setShowSettings(true);
      return;
    }
    setIsExecuting(true);
    try {
      const side = activeTrade.entryPrice > activeTrade.stopLoss ? 'BUY' : 'SELL';
      await placeOrder(settings.defaultSymbol, side, activeTrade.positionSize.toFixed(4));
      sendNotification(NotificationType.EXECUTION, `Orden confirmada en ${activeInterval}`);
      setActiveTrade(null);
      fetchBalances();
    } catch (e: any) {
      sendNotification(NotificationType.ERROR, e.message);
    } finally {
      setIsExecuting(false);
    }
  };

  if (isLoading) return <div className="loading">Sincronizando Multi-Temporalidad...</div>;

  const currentPrice = activeData?.candles[activeData.candles.length - 1]?.close || 0;

  return (
    <>
      <div className={`dashboard animate ${showSettings || showAlertHistory || aiAnalysis ? 'blur' : ''}`}>
        <header className="header">
          <div>
            <h1>BNB Multi-Timeframe Pro</h1>
            <p className="label">EMAs: 7, 25, 99 | Monitor de 5 Temporalidades</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div className="price-display">
              ${currentPrice.toLocaleString()}
            </div>

            <button
              className="icon-btn"
              onClick={handleConsultAI}
              disabled={isAnalyzing}
              title="Consultar IA (Gemini)"
              style={{ color: isAnalyzing ? 'var(--text-secondary)' : 'var(--accent-color)' }}
            >
              {isAnalyzing ? <RefreshCcw className="spin" size={20} /> : <Zap size={20} />}
            </button>

            <button className="icon-btn" onClick={() => setShowAlertHistory(true)} title="Historial de Alertas">
              <AlertCircle size={20} />
              {alertHistory.length > 0 && (
                <span className="badge-count">{alertHistory.length}</span>
              )}
            </button>
            <button className="icon-btn" onClick={() => setShowSettings(true)}>
              <SettingsIcon size={20} />
            </button>
          </div>
        </header>

        {/* Selector de Temporalidad */}
        <div className="timeframe-selector glass-card" style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', padding: '0.75rem' }}>
          {INTERVALS.map(interval => (
            <button
              key={interval}
              className={activeInterval === interval ? 'active' : ''}
              onClick={() => setActiveInterval(interval)}
              style={{
                flex: 1,
                background: activeInterval === interval ? 'var(--accent-color)' : 'transparent',
                color: activeInterval === interval ? '#000' : 'var(--text-primary)',
                border: '1px solid var(--glass-border)',
                padding: '0.5rem',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              <Clock size={14} style={{ marginRight: '5px' }} /> {interval}
            </button>
          ))}
        </div>

        <div className="grid">
          <div className="glass-card">
            <div className="label"><TrendingUp size={16} /> Tendencia {activeInterval}</div>
            <div className="indicator-val">
              {(activeData?.indicators[activeData.indicators.length - 1]?.ema99 || 0) < currentPrice ? (
                <span className="badge badge-success">Alcista</span>
              ) : <span className="badge badge-danger">Bajista</span>}
            </div>
          </div>
          <div className="glass-card">
            <div className="label"><Bell size={16} /> Estado Global</div>
            <div style={{ display: 'flex', gap: '3px', marginTop: '10px' }}>
              {INTERVALS.map(int => (
                <div key={int} style={{
                  width: '20%',
                  height: '4px',
                  borderRadius: '2px',
                  background: timeframes[int].lastSignal?.type === SignalType.BUY ? 'var(--success)' :
                    timeframes[int].lastSignal?.type === SignalType.SELL ? 'var(--danger)' : 'var(--glass-border)'
                }}></div>
              ))}
            </div>
            <p className="label" style={{ fontSize: '0.6rem', marginTop: '5px' }}>5m | 15m | 1h | 4h | 1d</p>
          </div>
          <div className="glass-card">
            <div className="label"><Wallet size={16} /> Balance Real</div>
            <div className="indicator-val">${balances.find(b => b.asset === 'USDT')?.free || '0.00'}</div>
          </div>
          <div className="glass-card">
            <div className="label"><Shield size={16} /> Conf. Riesgo</div>
            <div className="indicator-val">{(settings.riskPerTrade * 100).toFixed(1)}%</div>
          </div>
        </div>

        {/* Fibonacci Levels Panel */}
        {fibLevels && (
          <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
            <div className="label" style={{ marginBottom: '1rem' }}>📊 Niveles de Fibonacci (últimas 100 velas - {activeInterval})</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
              <div style={{ padding: '0.5rem', background: 'rgba(255, 0, 0, 0.1)', borderRadius: '8px', border: '1px solid rgba(255, 0, 0, 0.3)' }}>
                <div className="label" style={{ fontSize: '0.7rem', color: '#ff0000' }}>0% (High)</div>
                <div style={{ fontWeight: 600, color: '#ff0000' }}>${fibLevels[0].toFixed(2)}</div>
              </div>
              <div style={{ padding: '0.5rem', background: 'rgba(255, 165, 0, 0.1)', borderRadius: '8px', border: '1px solid rgba(255, 165, 0, 0.3)' }}>
                <div className="label" style={{ fontSize: '0.7rem', color: '#ffa500' }}>23.6%</div>
                <div style={{ fontWeight: 600, color: '#ffa500' }}>${fibLevels[0.236].toFixed(2)}</div>
              </div>
              <div style={{ padding: '0.5rem', background: 'rgba(255, 255, 0, 0.1)', borderRadius: '8px', border: '1px solid rgba(255, 255, 0, 0.3)' }}>
                <div className="label" style={{ fontSize: '0.7rem', color: '#ffff00' }}>38.2%</div>
                <div style={{ fontWeight: 600, color: '#ffff00' }}>${fibLevels[0.382].toFixed(2)}</div>
              </div>
              <div style={{ padding: '0.5rem', background: 'rgba(0, 255, 255, 0.1)', borderRadius: '8px', border: '1px solid rgba(0, 255, 255, 0.3)' }}>
                <div className="label" style={{ fontSize: '0.7rem', color: '#00ffff' }}>50%</div>
                <div style={{ fontWeight: 600, color: '#00ffff' }}>${fibLevels[0.5].toFixed(2)}</div>
              </div>
              <div style={{ padding: '0.5rem', background: 'rgba(0, 255, 0, 0.15)', borderRadius: '8px', border: '2px solid rgba(0, 255, 0, 0.5)' }}>
                <div className="label" style={{ fontSize: '0.7rem', color: '#00ff00' }}>61.8% ⭐ Golden</div>
                <div style={{ fontWeight: 700, color: '#00ff00', fontSize: '1.1rem' }}>${fibLevels[0.618].toFixed(2)}</div>
              </div>
              <div style={{ padding: '0.5rem', background: 'rgba(0, 100, 255, 0.1)', borderRadius: '8px', border: '1px solid rgba(0, 100, 255, 0.3)' }}>
                <div className="label" style={{ fontSize: '0.7rem', color: '#0064ff' }}>100% (Low)</div>
                <div style={{ fontWeight: 600, color: '#0064ff' }}>${fibLevels[1].toFixed(2)}</div>
              </div>
            </div>
            <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: 'rgba(243, 186, 47, 0.1)', borderRadius: '6px' }}>
              <span className="label" style={{ fontSize: '0.75rem' }}>💰 Precio Actual: </span>
              <span style={{ fontWeight: 700, color: 'var(--accent-color)', fontSize: '0.9rem' }}>${currentPrice.toFixed(2)}</span>
            </div>
          </div>
        )}

        <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <div className="glass-card">
            <div className="label" style={{ justifyContent: 'space-between' }}>
              <span><BarChart3 size={16} /> Gráfico Principal ({activeInterval})</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <span className="badge" style={{ background: 'rgba(0, 255, 0, 0.1)', color: '#0f0', fontSize: '0.6rem' }}>EMA 7</span>
                <span className="badge" style={{ background: 'rgba(255, 165, 0, 0.1)', color: '#ffa500', fontSize: '0.6rem' }}>EMA 25</span>
                <span className="badge" style={{ background: 'rgba(255, 77, 77, 0.1)', color: '#ff4d4d', fontSize: '0.6rem' }}>EMA 99</span>
              </div>
            </div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="time" stroke="var(--text-secondary)" fontSize={10} tickLine={false} />
                  <YAxis domain={['auto', 'auto']} stroke="var(--text-secondary)" fontSize={10} tickLine={false} />
                  <YAxis yAxisId={1} hide />
                  <Tooltip contentStyle={{ backgroundColor: '#161a1e', border: 'none', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="price" stroke="var(--accent-color)" fill="url(#colorPrice)" fillOpacity={0.1} />
                  <Line type="monotone" dataKey="ema99" stroke="#ff4d4d" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="ema25" stroke="#ffa500" dot={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="ema7" stroke="#0f0" dot={false} strokeWidth={1} />
                  <Bar dataKey="volume" fill="rgba(132, 142, 156, 0.1)" yAxisId={1} />

                  {/* Fibonacci Levels */}
                  {fibLevels && (
                    <>
                      <ReferenceLine
                        y={fibLevels[0]}
                        stroke="rgba(255, 0, 0, 0.5)"
                        strokeDasharray="5 5"
                        strokeWidth={2}
                        label={{ value: 'Fib 0% (High)', fill: '#ff0000', fontSize: 11, position: 'right' }}
                      />
                      <ReferenceLine
                        y={fibLevels[0.236]}
                        stroke="rgba(255, 165, 0, 0.5)"
                        strokeDasharray="3 3"
                        label={{ value: 'Fib 23.6%', fill: '#ffa500', fontSize: 10, position: 'right' }}
                      />
                      <ReferenceLine
                        y={fibLevels[0.382]}
                        stroke="rgba(255, 255, 0, 0.5)"
                        strokeDasharray="3 3"
                        label={{ value: 'Fib 38.2%', fill: '#ffff00', fontSize: 10, position: 'right' }}
                      />
                      <ReferenceLine
                        y={fibLevels[0.5]}
                        stroke="rgba(0, 255, 255, 0.6)"
                        strokeDasharray="3 3"
                        strokeWidth={2}
                        label={{ value: 'Fib 50%', fill: '#00ffff', fontSize: 11, position: 'right' }}
                      />
                      <ReferenceLine
                        y={fibLevels[0.618]}
                        stroke="rgba(0, 255, 0, 0.7)"
                        strokeDasharray="5 5"
                        strokeWidth={2}
                        label={{ value: 'Fib 61.8% (Golden)', fill: '#00ff00', fontSize: 11, position: 'right' }}
                      />
                      <ReferenceLine
                        y={fibLevels[1]}
                        stroke="rgba(0, 100, 255, 0.5)"
                        strokeDasharray="5 5"
                        strokeWidth={2}
                        label={{ value: 'Fib 100% (Low)', fill: '#0064ff', fontSize: 11, position: 'right' }}
                      />
                    </>
                  )}

                  <defs>
                    <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-color)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent-color)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="glass-card">
            <div className="label"><Zap size={16} /> Ejecución Automática</div>
            {activeTrade ? (
              <div className="animate" style={{ marginTop: '1rem' }}>
                <div className="risk-metrics">
                  <div className="metric"><span className="label">Entrada</span><span className="val">${activeTrade.entryPrice.toFixed(2)}</span></div>
                  <div className="metric"><span className="label" style={{ color: 'var(--danger)' }}>ST</span><span className="val">${activeTrade.stopLoss.toFixed(2)}</span></div>
                  <div className="metric"><span className="label" style={{ color: 'var(--success)' }}>TP</span><span className="val">${activeTrade.takeProfit.toFixed(2)}</span></div>
                </div>
                <button className="execute-btn" onClick={handleExecuteTrade} disabled={isExecuting} style={{ width: '100%', marginTop: '1rem' }}>
                  {isExecuting ? 'Confirmando...' : 'Confirmar Orden'}
                </button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                <RefreshCcw className="spin" size={24} style={{ opacity: 0.3 }} />
                <p className="label" style={{ marginTop: '1rem' }}>Vigilando {activeInterval}...</p>
              </div>
            )}
          </div>
        </div>

        <div className="glass-card signal-history">
          <div className="label"><Bell size={16} /> Registro Multi-Temporal (Últimas 20)</div>
          <div style={{ marginTop: '1rem' }}>
            {signals.length > 0 ? signals.map((s, idx) => (
              <div key={idx} className="signal-item">
                <span className={`badge ${s.type === SignalType.BUY ? 'badge-success' : 'badge-danger'}`}>{s.type === SignalType.BUY ? 'COMPRA' : 'VENTA'}</span>
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{s.reason}</span>
                <span className="label">{format(s.time, 'HH:mm:ss')}</span>
              </div>
            )) : <p className="label">Esperando señales...</p>}
          </div>
        </div>
      </div>

      {/* Historial de Alertas Modal - OUTSIDE dashboard */}
      {showAlertHistory && (
        <div className="settings-overlay animate">
          <div className="settings-card glass-card" style={{ maxWidth: '700px' }}>
            <div className="settings-header">
              <h3>Historial Completo de Alertas ({alertHistory.length})</h3>
              <button className="icon-btn" onClick={() => setShowAlertHistory(false)}><X size={20} /></button>
            </div>
            <div style={{ maxHeight: '500px', overflowY: 'auto', marginTop: '1rem' }}>
              {alertHistory.length > 0 ? alertHistory.map((alert) => (
                <div key={alert.id} className="signal-item" style={{ marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className={`badge ${alert.type === SignalType.BUY ? 'badge-success' : 'badge-danger'}`}>
                      {alert.type}
                    </span>
                    <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>{alert.interval}</span>
                  </div>
                  <div style={{ flex: 1, marginLeft: '1rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{alert.reason}</div>
                    <div className="label" style={{ fontSize: '0.7rem' }}>Precio: ${alert.price.toFixed(2)}</div>
                  </div>
                  <span className="label">{format(alert.timestamp, 'dd/MM HH:mm:ss', { locale: es })}</span>
                </div>
              )) : (
                <p className="label" style={{ textAlign: 'center', padding: '2rem' }}>No hay alertas registradas aún</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal - OUTSIDE dashboard */}
      {showSettings && (
        <div className="settings-overlay animate">
          <div className="settings-card glass-card">
            <div className="settings-header">
              <h3>Configuración</h3>
              <button className="icon-btn" onClick={() => setShowSettings(false)}><X size={20} /></button>
            </div>
            <div className="settings-body">
              <div className="input-group">
                <label>API Key (Binance)</label>
                <input type="password" value={settings.apiKey} onChange={e => setSettings({ ...settings, apiKey: e.target.value })} />
              </div>
              <div className="input-group">
                <label>Secret Key (Binance)</label>
                <input type="password" value={settings.apiSecret} onChange={e => setSettings({ ...settings, apiSecret: e.target.value })} />
              </div>
              <div className="input-group">
                <label>Gemini API Key (Para IA)</label>
                <input type="password" placeholder="Requerido para análisis inteligente" value={settings.geminiApiKey || ''} onChange={e => setSettings({ ...settings, geminiApiKey: e.target.value })} />
              </div>
              <div className="input-group">
                <label>Símbolo (ej: BNBUSDT)</label>
                <input type="text" value={settings.defaultSymbol} onChange={e => setSettings({ ...settings, defaultSymbol: e.target.value.toUpperCase() })} />
              </div>
              <div className="input-group">
                <label>Riesgo por Operación (%)</label>
                <input type="number" step="0.1" min="0.1" max="10" value={settings.riskPerTrade * 100} onChange={e => setSettings({ ...settings, riskPerTrade: parseFloat(e.target.value) / 100 })} />
              </div>
              <button className="save-btn" onClick={() => { saveSettings(settings); window.location.reload(); }}>Guardar y Reiniciar</button>
            </div>
          </div>
        </div>
      )}

      {/* AI Analysis Modal - OUTSIDE dashboard */}
      {aiAnalysis && (
        <div className="settings-overlay animate" style={{ zIndex: 1100 }}>
          <div className="settings-card glass-card" style={{ maxWidth: '600px', border: aiAnalysis.sentiment === 'BULLISH' ? '2px solid var(--success)' : aiAnalysis.sentiment === 'BEARISH' ? '2px solid var(--danger)' : '1px solid var(--glass-border)' }}>
            <div className="settings-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Zap size={20} className={aiAnalysis.sentiment === 'BULLISH' ? 'text-green-500' : aiAnalysis.sentiment === 'BEARISH' ? 'text-red-500' : ''} />
                Análisis Inteligente (Gemini)
              </h3>
              <button className="icon-btn" onClick={() => setAiAnalysis(null)}><X size={20} /></button>
            </div>
            <div className="settings-body" style={{ marginTop: '0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                <div style={{ textAlign: 'center' }}>
                  <div className="label">Sentimiento</div>
                  <div style={{ fontWeight: 'bold', color: aiAnalysis.sentiment === 'BULLISH' ? 'var(--success)' : aiAnalysis.sentiment === 'BEARISH' ? 'var(--danger)' : 'var(--text-primary)' }}>
                    {aiAnalysis.sentiment}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div className="label">Confianza</div>
                  <div style={{ fontWeight: 'bold' }}>{aiAnalysis.confidence}%</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div className="label">Hora</div>
                  <div style={{ fontWeight: 'bold' }}>{format(aiAnalysis.timestamp, 'HH:mm')}</div>
                </div>
              </div>

              <p style={{ lineHeight: '1.6', fontSize: '1.05rem', marginBottom: '1.5rem', whiteSpace: 'pre-line' }}>
                {aiAnalysis.analysis}
              </p>

              <button className="save-btn" onClick={() => setAiAnalysis(null)}>Entendido</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default App;
