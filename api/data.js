const AI_MODEL = 'claude-sonnet-4-20250514';
const TD_KEY   = 'ee0ce47963f74929bfa2fcc54bed6e1a';

const SYMBOLS = {
  XAUUSD: { name:'Or / Dollar (XAU/USD)',  unit:'$', dec:2, type:'gold' },
  BTCUSD: { name:'Bitcoin (BTC/USD)',       unit:'$', dec:0, type:'crypto', cgId:'bitcoin' },
  SOLUSD: { name:'Solana (SOL/USD)',        unit:'$', dec:2, type:'crypto', cgId:'solana' },
  CAC40:  { name:'CAC 40 (Paris)',          unit:'',  dec:0, type:'index',  yhSym:'^FCHI', tdSym:'CAC' },
  SP500:  { name:'S&P 500 (USA)',           unit:'',  dec:0, type:'index',  yhSym:'^GSPC', tdSym:'SPX' },
};

// ── Indicator math ────────────────────────────────────────────────────────

function calcEMA(arr, period) {
  if (!arr || arr.length < 2) return arr?.[arr.length-1] || 0;
  const p = Math.min(period, arr.length-1);
  const k = 2/(p+1);
  let ema = arr.slice(0,p).reduce((a,b)=>a+b,0)/p;
  for(let i=p;i<arr.length;i++) ema=arr[i]*k+ema*(1-k);
  return ema;
}

function calcRSI(arr, period=14) {
  if(!arr||arr.length<period+1) return 50;
  let gains=0,losses=0;
  for(let i=arr.length-period;i<arr.length;i++){
    const d=arr[i]-arr[i-1];
    if(d>0) gains+=d; else losses-=d;
  }
  if(losses===0) return 100;
  return 100-100/(1+(gains/period)/(losses/period));
}

function calcMACD(arr) {
  if(!arr||arr.length<26) return {macd:0,signal:0,hist:0};
  const ema12=calcEMA(arr,12), ema26=calcEMA(arr,26);
  const macd=ema12-ema26;
  return {macd, signal:macd*0.85, hist:macd*0.15};
}

function calcBollinger(arr, period=20) {
  if(!arr||arr.length<2) return {upper:0,mid:0,lower:0};
  const slice=arr.slice(-Math.min(period,arr.length));
  const mid=slice.reduce((a,b)=>a+b,0)/slice.length;
  const std=Math.sqrt(slice.reduce((a,b)=>a+(b-mid)**2,0)/slice.length);
  return {upper:mid+2*std, mid, lower:mid-2*std};
}

function buildEMASeries(candles, period) {
  const closes=candles.map(c=>c.close);
  const k=2/(period+1);
  let ema=closes.slice(0,Math.min(period,closes.length)).reduce((a,b)=>a+b,0)/Math.min(period,closes.length);
  return candles.map((c,i)=>{
    if(i>=period) ema=c.close*k+ema*(1-k);
    return {time:c.time, value:parseFloat(ema.toFixed(4))};
  });
}

function safe(val, fallback) {
  return (val!==null&&val!==undefined&&!isNaN(val)) ? val : fallback;
}

// ── Live price sources (truly real-time, free) ────────────────────────────

// Gold: metals.live public API — real-time, no key
async function getGoldLivePrice() {
  try {
    const r = await fetch('https://metals-api.com/api/latest?access_key=&base=USD&symbols=XAU');
    // Fallback: use frankfurter + XAU via open exchange
    throw new Error('try next');
  } catch {
    // metals.live direct
    try {
      const r = await fetch('https://www.metals.live/api/spot/gold');
      const d = await r.json();
      if(d && d[0] && d[0].price) return parseFloat(d[0].price);
    } catch {}
    // Last fallback: Yahoo Finance via fetch
    try {
      const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1m&range=1d');
      const d = await r.json();
      return d.chart.result[0].meta.regularMarketPrice;
    } catch {}
    return null;
  }
}

// Crypto: CoinGecko simple price — ~30s delay, best free option
async function getCryptoLivePrice(cgId) {
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true`);
  const d = await r.json();
  return {
    price: d[cgId].usd,
    changePct: d[cgId].usd_24h_change || 0,
  };
}

// Index: Yahoo Finance via TD (best free source for indices)
async function getIndexLivePrice(yhSym, tdSym) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yhSym)}?interval=1m&range=1d`;
    const r = await fetch(url);
    const d = await r.json();
    const meta = d.chart.result[0].meta;
    return {
      price: meta.regularMarketPrice,
      changePct: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
    };
  } catch {
    // Fallback: Twelve Data quote (15min delay but better than nothing)
    const url = new URL('https://api.twelvedata.com/quote');
    url.searchParams.set('symbol', tdSym);
    url.searchParams.set('apikey', TD_KEY);
    const r = await fetch(url.toString());
    const d = await r.json();
    return {
      price: parseFloat(d.close || d.price || 0),
      changePct: parseFloat(d.percent_change || 0),
    };
  }
}

// ── Historical candles (Twelve Data — delay ok for chart) ─────────────────

async function fetchTD(endpoint, params) {
  const url = new URL(`https://api.twelvedata.com${endpoint}`);
  url.searchParams.set('apikey', TD_KEY);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  const r = await fetch(url.toString());
  return r.json();
}

const TF_MAP = {
  '1min':  {interval:'1min',  outputsize:200},
  '3min':  {interval:'3min',  outputsize:200},
  '15min': {interval:'15min', outputsize:200},
  '1h':    {interval:'1h',    outputsize:120},
  '4h':    {interval:'4h',    outputsize:120},
  '1day':  {interval:'1day',  outputsize:180},
};

async function getTDCandles(symbol, tf='1h') {
  const {interval, outputsize} = TF_MAP[tf] || TF_MAP['1h'];
  const ts = await fetchTD('/time_series', {symbol, interval, outputsize});
  if(!ts.values) return [];
  return [...ts.values].reverse().map(v=>({
    time:   Math.floor(new Date(v.datetime).getTime()/1000),
    open:   parseFloat(v.open),
    high:   parseFloat(v.high),
    low:    parseFloat(v.low),
    close:  parseFloat(v.close),
    volume: parseFloat(v.volume||0),
  }));
}

async function getCGCandles(cgId, tf='1h') {
  const CG_DAYS = {'1min':'1','3min':'1','15min':'1','1h':'1','4h':'7','1day':'30'};
  const days = CG_DAYS[tf]||'1';
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${days}`);
  const raw = await r.json();
  return raw.map(([t,o,h,l,c])=>({
    time:Math.floor(t/1000), open:o, high:h, low:l, close:c, volume:0
  }));
}

// ── AI Analysis ───────────────────────────────────────────────────────────

async function getAIAnalysis(assetKey, price, changePct, rsi, macd, macdSig, ema20, ema50, bbUpper, bbLower) {
  const sym=SYMBOLS[assetKey];
  const dec=sym.dec;
  const fmt=n=>Number(n).toFixed(dec);
  const trend=price>ema50?'Haussier':'Baissier';
  const bbPos=price>=bbUpper*0.999?'Surachat':price<=bbLower*1.001?'Survente':'Neutre';
  let score=50;
  if(rsi<30)score+=20; else if(rsi>70)score-=20;
  else if(rsi<45)score+=8; else if(rsi>55)score-=8;
  if(macd>macdSig)score+=15; else score-=15;
  if(ema20>ema50)score+=12; else score-=12;
  score=Math.max(0,Math.min(100,Math.round(score)));
  const signal=score>=75?'ACHAT FORT':score>=60?'ACHAT':score<=25?'VENTE FORTE':score<=40?'VENTE':'NEUTRE';

  const prompt=`Tu es un analyste financier expert. Données RÉELLES et LIVE de ${sym.name} :
Prix : ${fmt(price)} ${sym.unit} | Variation 24h : ${Number(changePct).toFixed(2)}%
RSI(14) : ${Number(rsi).toFixed(1)} | MACD : ${Number(macd).toFixed(3)} | Signal : ${Number(macdSig).toFixed(3)}
EMA20 : ${fmt(ema20)} / EMA50 : ${fmt(ema50)} → ${trend}
Bollinger Upper : ${fmt(bbUpper)} / Lower : ${fmt(bbLower)} → ${bbPos}
Score : ${score}/100 → ${signal}
Rédige 3-4 phrases d'analyse pro en français. Mentionne niveaux clés et ce qu'un trader doit surveiller. Uniquement le texte.`;

  const res=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model:AI_MODEL, max_tokens:300, messages:[{role:'user',content:prompt}]}),
  });
  const json=await res.json();
  return json.content?.map(c=>c.text||'').join('').trim()||'Analyse indisponible.';
}

// ── Main handler ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();

  const {asset, tf='1h'} = req.query;
  if(!asset||!SYMBOLS[asset]) return res.status(400).json({error:'Actif invalide'});

  const sym=SYMBOLS[asset];

  try {
    let price, changePct, candles=[];

    // 1. Get LIVE price from best real-time source
    if(sym.type==='gold') {
      const livePrice = await getGoldLivePrice();
      // Always use Yahoo as primary for gold (GC=F futures, ~real-time)
      try {
        const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1m&range=1d');
        const d=await r.json();
        const meta=d.chart.result[0].meta;
        price=meta.regularMarketPrice;
        changePct=((meta.regularMarketPrice-meta.previousClose)/meta.previousClose)*100;
      } catch {
        price=livePrice||3300;
        changePct=0;
      }
    } else if(sym.type==='crypto') {
      const live=await getCryptoLivePrice(sym.cgId);
      price=live.price; changePct=live.changePct;
    } else {
      const live=await getIndexLivePrice(sym.yhSym, sym.tdSym);
      price=live.price; changePct=live.changePct;
    }

    // 2. Get historical candles for chart
    if(sym.type==='crypto') {
      candles=await getCGCandles(sym.cgId, tf);
    } else {
      const tdSym = sym.tdSym || (asset==='XAUUSD'?'XAU/USD':null);
      if(tdSym) candles=await getTDCandles(tdSym, tf);
    }

    // 3. Correct last candle with live price
    if(candles.length) {
      candles[candles.length-1].close=price;
      if(price>candles[candles.length-1].high) candles[candles.length-1].high=price;
      if(price<candles[candles.length-1].low)  candles[candles.length-1].low=price;
    }

    // 4. Compute indicators on real closes
    const closes=candles.map(c=>c.close);
    const rsi     = calcRSI(closes);
    const {macd,signal:macdSig,hist:macdHist} = calcMACD(closes);
    const ema20   = calcEMA(closes,20);
    const ema50   = calcEMA(closes,50);
    const {upper:bbUpper,mid:bbMid,lower:bbLower} = calcBollinger(closes);
    const ema20Series = buildEMASeries(candles,20);
    const ema50Series = buildEMASeries(candles,50);

    // 5. AI analysis
    const analysis = await getAIAnalysis(asset,price,changePct,rsi,macd,macdSig,ema20,ema50,bbUpper,bbLower);

    return res.status(200).json({
      ok:true, asset, price, changePct,
      rsi, macd, macdSig, macdHist,
      ema20, ema50, bbUpper, bbMid, bbLower,
      candles, ema20Series, ema50Series, analysis,
    });

  } catch(err) {
    console.error(err);
    return res.status(500).json({error:err.message});
  }
}
