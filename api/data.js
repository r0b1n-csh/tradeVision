const TD_KEY   = 'ee0ce47963f74929bfa2fcc54bed6e1a';
const AI_MODEL = 'claude-sonnet-4-20250514';

const SYMBOLS = {
  XAUUSD: { td: 'XAU/USD', type: 'td', name: 'Or / Dollar (XAU/USD)',  unit: '$', dec: 2 },
  BTCUSD: { cg: 'bitcoin', type: 'cg', name: 'Bitcoin (BTC/USD)',       unit: '$', dec: 0 },
  SOLUSD: { cg: 'solana',  type: 'cg', name: 'Solana (SOL/USD)',        unit: '$', dec: 2 },
  CAC40:  { td: 'CAC',     type: 'td', name: 'CAC 40 (Paris)',          unit: '',  dec: 0 },
  SP500:  { td: 'SPX',     type: 'td', name: 'S&P 500 (USA)',           unit: '',  dec: 0 },
};

function calcEMA(arr, period) {
  if (!arr || arr.length < 2) return arr?.[arr.length - 1] || 0;
  const p = Math.min(period, arr.length - 1);
  const k = 2 / (p + 1);
  let ema = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
}

function calcRSI(arr, period = 14) {
  if (!arr || arr.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = arr.length - period; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + (gains / period) / (losses / period));
}

function calcMACD(arr) {
  if (!arr || arr.length < 26) return { macd: 0, signal: 0, hist: 0 };
  const ema12 = calcEMA(arr, 12);
  const ema26 = calcEMA(arr, 26);
  const macd = ema12 - ema26;
  return { macd, signal: macd * 0.85, hist: macd * 0.15 };
}

function calcBollinger(arr, period = 20) {
  if (!arr || arr.length < 2) return { upper: 0, mid: 0, lower: 0 };
  const slice = arr.slice(-Math.min(period, arr.length));
  const mid = slice.reduce((a, b) => a + b, 0) / slice.length;
  const std = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / slice.length);
  return { upper: mid + 2 * std, mid, lower: mid - 2 * std };
}

function safe(val, fallback) {
  return (val !== null && val !== undefined && !isNaN(val)) ? val : fallback;
}

async function fetchTD(endpoint, params) {
  const url = new URL(`https://api.twelvedata.com${endpoint}`);
  url.searchParams.set('apikey', TD_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  return r.json();
}

async function getTwelveData(symbol) {
  const [quote, ts] = await Promise.all([
    fetchTD('/quote',       { symbol }),
    fetchTD('/time_series', { symbol, interval: '1h', outputsize: 60 }),
  ]);

  const price     = parseFloat(quote.close || quote.price || 0);
  const changePct = parseFloat(quote.percent_change || 0);
  const candles   = ts.values ? [...ts.values].reverse().map(v => ({ t: v.datetime, c: parseFloat(v.close) })) : [];
  const prices    = candles.map(c => c.c);

  // Try API indicators, fall back to local
  let rsi, macd, macdSig, macdHist, ema20, ema50, bbUpper, bbMid, bbLower;
  try {
    const [rsiD, macdD, ema20D, ema50D, bbD] = await Promise.all([
      fetchTD('/rsi',    { symbol, interval: '1h', time_period: 14, outputsize: 1 }),
      fetchTD('/macd',   { symbol, interval: '1h', outputsize: 1 }),
      fetchTD('/ema',    { symbol, interval: '1h', time_period: 20, outputsize: 1 }),
      fetchTD('/ema',    { symbol, interval: '1h', time_period: 50, outputsize: 1 }),
      fetchTD('/bbands', { symbol, interval: '1h', time_period: 20, outputsize: 1 }),
    ]);
    rsi      = safe(rsiD.values  ? parseFloat(rsiD.values[0].rsi)             : null, calcRSI(prices));
    macd     = safe(macdD.values ? parseFloat(macdD.values[0].macd)           : null, calcMACD(prices).macd);
    macdSig  = safe(macdD.values ? parseFloat(macdD.values[0].signal)         : null, calcMACD(prices).signal);
    macdHist = safe(macdD.values ? parseFloat(macdD.values[0].macd_histogram) : null, calcMACD(prices).hist);
    ema20    = safe(ema20D.values? parseFloat(ema20D.values[0].ema)           : null, calcEMA(prices, 20));
    ema50    = safe(ema50D.values? parseFloat(ema50D.values[0].ema)           : null, calcEMA(prices, 50));
    const bb = calcBollinger(prices);
    bbUpper  = safe(bbD.values   ? parseFloat(bbD.values[0].upper_band)       : null, bb.upper);
    bbMid    = safe(bbD.values   ? parseFloat(bbD.values[0].middle_band)      : null, bb.mid);
    bbLower  = safe(bbD.values   ? parseFloat(bbD.values[0].lower_band)       : null, bb.lower);
  } catch {
    rsi = calcRSI(prices);
    const m = calcMACD(prices); macd = m.macd; macdSig = m.signal; macdHist = m.hist;
    ema20 = calcEMA(prices, 20); ema50 = calcEMA(prices, 50);
    const bb = calcBollinger(prices); bbUpper = bb.upper; bbMid = bb.mid; bbLower = bb.lower;
  }

  return { price, changePct, rsi, macd, macdSig, macdHist, ema20, ema50, bbUpper, bbMid, bbLower, candles, prices };
}

async function getCoinGecko(cgId) {
  const [marketRes, chartRes] = await Promise.all([
    fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${cgId}`),
    fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=1&interval=hourly`),
  ]);
  const [market, chart] = await Promise.all([marketRes.json(), chartRes.json()]);
  const coin      = market[0];
  const price     = coin.current_price;
  const changePct = coin.price_change_percentage_24h || 0;
  const closes    = chart.prices.map(([, c]) => c);
  const candles   = chart.prices.map(([t, c]) => ({ t: new Date(t).toISOString(), c }));
  const rsi       = calcRSI(closes);
  const { macd, signal: macdSig, hist: macdHist } = calcMACD(closes);
  const ema20     = calcEMA(closes, 20);
  const ema50     = calcEMA(closes, 50);
  const { upper: bbUpper, mid: bbMid, lower: bbLower } = calcBollinger(closes);
  return { price, changePct, rsi, macd, macdSig, macdHist, ema20, ema50, bbUpper, bbMid, bbLower, candles, prices: closes };
}

async function getAIAnalysis(assetKey, data) {
  const sym = SYMBOLS[assetKey];
  const { price, changePct, rsi, macd, macdSig, ema20, ema50, bbUpper, bbLower } = data;
  const dec = sym.dec;
  const fmt = n => Number(n).toFixed(dec);
  const trend = price > ema50 ? 'Haussier' : 'Baissier';
  const bbPos = price >= bbUpper * 0.999 ? 'Surachat' : price <= bbLower * 1.001 ? 'Survente' : 'Neutre';
  let score = 50;
  if (rsi < 30) score += 20; else if (rsi > 70) score -= 20;
  else if (rsi < 45) score += 8; else if (rsi > 55) score -= 8;
  if (macd > macdSig) score += 15; else score -= 15;
  if (ema20 > ema50) score += 12; else score -= 12;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const signal = score >= 75 ? 'ACHAT FORT' : score >= 60 ? 'ACHAT' : score <= 25 ? 'VENTE FORTE' : score <= 40 ? 'VENTE' : 'NEUTRE';

  const prompt = `Tu es un analyste financier expert. Données RÉELLES et LIVE de ${sym.name} :
Prix : ${fmt(price)} ${sym.unit} | Variation 24h : ${changePct.toFixed(2)}%
RSI(14) : ${rsi.toFixed(1)} | MACD : ${macd.toFixed(3)} | Signal MACD : ${macdSig.toFixed(3)}
EMA20 : ${fmt(ema20)} / EMA50 : ${fmt(ema50)} → Tendance ${trend}
Bollinger Upper : ${fmt(bbUpper)} / Lower : ${fmt(bbLower)} → ${bbPos}
Score : ${score}/100 → ${signal}
Rédige 3-4 phrases d'analyse pro en français. Mentionne les niveaux clés et ce qu'un trader doit surveiller. Réponds UNIQUEMENT avec le texte.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
  });
  const json = await res.json();
  return json.content?.map(c => c.text || '').join('').trim() || 'Analyse indisponible.';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { asset } = req.query;
  if (!asset || !SYMBOLS[asset]) return res.status(400).json({ error: 'Actif invalide' });

  try {
    const sym  = SYMBOLS[asset];
    const data = sym.type === 'cg' ? await getCoinGecko(sym.cg) : await getTwelveData(sym.td);
    const analysis = await getAIAnalysis(asset, data);
    return res.status(200).json({ ok: true, asset, ...data, analysis });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
