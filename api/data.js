const TD_KEY = 'ee0ce47963f74929bfa2fcc54bed6e1a';

const SYMBOLS = {
  XAUUSD: { td: 'XAU/USD',  type: 'td' },
  BTCUSD: { cg: 'bitcoin',  type: 'cg' },
  SOLUSD: { cg: 'solana',   type: 'cg' },
  CAC40:  { td: 'CAC',      type: 'td' },
  SP500:  { td: 'SPX',      type: 'td' },
};

async function fetchTD(endpoint, params) {
  const url = new URL(`https://api.twelvedata.com${endpoint}`);
  url.searchParams.set('apikey', TD_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  return r.json();
}

async function getTwelveData(symbol) {
  const [quote, ts, rsiD, macdD, ema20D, ema50D, bbD] = await Promise.all([
    fetchTD('/quote',       { symbol }),
    fetchTD('/time_series', { symbol, interval: '1h', outputsize: 60 }),
    fetchTD('/rsi',         { symbol, interval: '1h', time_period: 14, outputsize: 1 }),
    fetchTD('/macd',        { symbol, interval: '1h', outputsize: 1 }),
    fetchTD('/ema',         { symbol, interval: '1h', time_period: 20, outputsize: 1 }),
    fetchTD('/ema',         { symbol, interval: '1h', time_period: 50, outputsize: 1 }),
    fetchTD('/bbands',      { symbol, interval: '1h', time_period: 20, outputsize: 1 }),
  ]);

  const price     = parseFloat(quote.close || quote.price || 0);
  const changePct = parseFloat(quote.percent_change || 0);
  const change    = parseFloat(quote.change || 0);

  // Candles for chart
  const candles = ts.values
    ? [...ts.values].reverse().map(v => ({
        t: v.datetime,
        c: parseFloat(v.close),
      }))
    : [];

  const prices = candles.map(c => c.c);

  return {
    price, changePct, change,
    rsi:    rsiD.values  ? parseFloat(rsiD.values[0].rsi)            : 50,
    macd:   macdD.values ? parseFloat(macdD.values[0].macd)          : 0,
    macdSig:macdD.values ? parseFloat(macdD.values[0].signal)        : 0,
    macdHist:macdD.values? parseFloat(macdD.values[0].macd_histogram): 0,
    ema20:  ema20D.values? parseFloat(ema20D.values[0].ema)          : price,
    ema50:  ema50D.values? parseFloat(ema50D.values[0].ema)          : price,
    bbUpper:bbD.values   ? parseFloat(bbD.values[0].upper_band)      : price*1.02,
    bbMid:  bbD.values   ? parseFloat(bbD.values[0].middle_band)     : price,
    bbLower:bbD.values   ? parseFloat(bbD.values[0].lower_band)      : price*0.98,
    candles, prices,
  };
}

async function getCoinGecko(cgId) {
  const [marketRes, chartRes] = await Promise.all([
    fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${cgId}`),
    fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=1&interval=hourly`),
  ]);
  const [market, chart] = await Promise.all([marketRes.json(), chartRes.json()]);

  const coin      = market[0];
  const price     = coin.current_price;
  const changePct = coin.price_change_percentage_24h;
  const change    = coin.price_change_24h;

  const closes    = chart.prices.map(([, c]) => c);
  const candles   = chart.prices.map(([t, c]) => ({ t: new Date(t).toISOString(), c }));

  // Compute indicators server-side
  const rsi     = calcRSI(closes);
  const { macd, signal: macdSig, hist: macdHist } = calcMACD(closes);
  const ema20   = calcEMA(closes, 20);
  const ema50   = calcEMA(closes, 50);
  const { upper: bbUpper, mid: bbMid, lower: bbLower } = calcBollinger(closes);

  return {
    price, changePct, change,
    rsi, macd, macdSig, macdHist,
    ema20, ema50, bbUpper, bbMid, bbLower,
    candles, prices: closes,
  };
}

// ── Indicator math ────────────────────────────────────────────────────────

function calcEMA(arr, period) {
  if (arr.length < period) return arr[arr.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
}

function calcRSI(arr, period = 14) {
  if (arr.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = arr.length - period; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + (gains / period) / (losses / period));
}

function calcMACD(arr) {
  if (arr.length < 26) return { macd: 0, signal: 0, hist: 0 };
  const ema12 = calcEMA(arr, 12);
  const ema26 = calcEMA(arr, 26);
  const macd  = ema12 - ema26;
  const signal = macd * 0.85;
  return { macd, signal, hist: macd - signal };
}

function calcBollinger(arr, period = 20) {
  const slice = arr.slice(-Math.min(period, arr.length));
  const mid   = slice.reduce((a, b) => a + b, 0) / slice.length;
  const std   = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / slice.length);
  return { upper: mid + 2 * std, mid, lower: mid - 2 * std };
}

// ── Vercel handler ────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS headers — allow any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { asset } = req.query;
  if (!asset || !SYMBOLS[asset]) {
    return res.status(400).json({ error: 'Actif invalide. Utilise: XAUUSD, BTCUSD, SOLUSD, CAC40, SP500' });
  }

  try {
    const sym  = SYMBOLS[asset];
    const data = sym.type === 'cg'
      ? await getCoinGecko(sym.cg)
      : await getTwelveData(sym.td);

    return res.status(200).json({ ok: true, asset, ...data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
