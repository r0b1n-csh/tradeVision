const AI_MODEL = 'claude-sonnet-4-20250514';

const SYMBOLS = {
  XAUUSD: { name:'Or / Dollar (XAU/USD)',  unit:'$', dec:2, type:'gold',  yhSym:'GC=F'        },
  BTCUSD: { name:'Bitcoin (BTC/USD)',       unit:'$', dec:0, type:'crypto', cgId:'bitcoin' },
  SOLUSD: { name:'Solana (SOL/USD)',        unit:'$', dec:2, type:'crypto', cgId:'solana'  },
  CAC40:  { name:'CAC 40 (Paris)',          unit:'',  dec:0, type:'yahoo', yhSym:'^FCHI'  },
  SP500:  { name:'S&P 500 (USA)',           unit:'',  dec:0, type:'yahoo', yhSym:'^GSPC'  },
};

// Timeframe → Yahoo interval + range
const TF_YAHOO = {
  '1min':  { interval:'1m',  range:'1d'  },
  '3min':  { interval:'5m',  range:'1d'  }, // Yahoo doesn't have 3m, use 5m
  '15min': { interval:'15m', range:'5d'  },
  '1h':    { interval:'1h',  range:'1mo' },
  '4h':    { interval:'1h',  range:'3mo' }, // aggregate 4 x 1h client-side
  '1day':  { interval:'1d',  range:'1y'  },
};

// Timeframe → CoinGecko days
const TF_CG_DAYS = {
  '1min':'1', '3min':'1', '15min':'1', '1h':'1', '4h':'7', '1day':'90',
};

// ── Indicators ────────────────────────────────────────────────────────────

function calcEMA(arr, period) {
  if(!arr||arr.length<2) return arr?.[arr.length-1]||0;
  const p=Math.min(period,arr.length-1);
  const k=2/(p+1);
  let ema=arr.slice(0,p).reduce((a,b)=>a+b,0)/p;
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
  return {upper:mid+2*std,mid,lower:mid-2*std};
}

function buildEMASeries(candles, period) {
  if(!candles||!candles.length) return [];
  const k=2/(period+1);
  let ema=candles[0].close;
  return candles.map((c,i)=>{
    if(i>0) ema=c.close*k+ema*(1-k);
    return {time:c.time, value:parseFloat(ema.toFixed(6))};
  });
}

// ── Yahoo Finance ─────────────────────────────────────────────────────────

async function fetchYahoo(yhSym, tf) {
  const {interval, range} = TF_YAHOO[tf] || TF_YAHOO['1h'];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yhSym)}?interval=${interval}&range=${range}`;
  const r = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'} });
  if(!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
  const d = await r.json();

  const result = d.chart?.result?.[0];
  if(!result) throw new Error('Yahoo: pas de données');

  const meta       = result.meta;
  const price      = meta.regularMarketPrice;
  const prevClose  = meta.previousClose || meta.chartPreviousClose;
  const changePct  = prevClose ? ((price-prevClose)/prevClose)*100 : 0;
  const timestamps = result.timestamp || [];
  const quote      = result.indicators?.quote?.[0] || {};
  const opens      = quote.open  || [];
  const highs      = quote.high  || [];
  const lows       = quote.low   || [];
  const closes     = quote.close || [];
  const volumes    = quote.volume|| [];

  // Build clean candles (filter nulls)
  const candles = [];
  for(let i=0;i<timestamps.length;i++){
    const o=opens[i], h=highs[i], l=lows[i], c=closes[i];
    if(o==null||h==null||l==null||c==null) continue;
    candles.push({
      time:   timestamps[i],
      open:   parseFloat(o.toFixed(4)),
      high:   parseFloat(h.toFixed(4)),
      low:    parseFloat(l.toFixed(4)),
      close:  parseFloat(c.toFixed(4)),
      volume: volumes[i]||0,
    });
  }

  // Patch last candle with live price
  if(candles.length){
    candles[candles.length-1].close=price;
    if(price>candles[candles.length-1].high) candles[candles.length-1].high=price;
    if(price<candles[candles.length-1].low)  candles[candles.length-1].low=price;
  }

  return {price, changePct, candles};
}

// ── CoinGecko ─────────────────────────────────────────────────────────────

async function fetchCoinGecko(cgId, tf) {
  const days = TF_CG_DAYS[tf]||'1';

  // Live price
  const priceRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true`);
  const priceData = await priceRes.json();
  const price     = priceData[cgId].usd;
  const changePct = priceData[cgId].usd_24h_change||0;

  // OHLC candles
  const ohlcRes = await fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${days}`);
  const ohlcRaw = await ohlcRes.json();

  const candles = ohlcRaw.map(([t,o,h,l,c])=>({
    time:  Math.floor(t/1000),
    open:  o, high:h, low:l, close:c, volume:0,
  }));

  // Patch last candle
  if(candles.length){
    candles[candles.length-1].close=price;
    if(price>candles[candles.length-1].high) candles[candles.length-1].high=price;
    if(price<candles[candles.length-1].low)  candles[candles.length-1].low=price;
  }

  return {price, changePct, candles};
}

// ── AI Analysis ───────────────────────────────────────────────────────────

async function getAIAnalysis(assetKey, price, changePct, rsi, macd, macdSig, ema20, ema50, bbUpper, bbLower) {
  const sym  = SYMBOLS[assetKey];
  const dec  = sym.dec;
  const fmt  = n=>Number(n).toFixed(dec);
  const trend= price>ema50?'Haussier':'Baissier';
  const bbPos= price>=bbUpper*0.999?'Surachat':price<=bbLower*1.001?'Survente':'Neutre';
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

  try {
    const res=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:AI_MODEL,max_tokens:300,messages:[{role:'user',content:prompt}]}),
    });
    const json=await res.json();
    return json.content?.map(c=>c.text||'').join('').trim()||'Analyse indisponible.';
  } catch { return 'Analyse indisponible.'; }
}

// ── Handler ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();

  const {asset, tf='1h'} = req.query;
  if(!asset||!SYMBOLS[asset]) return res.status(400).json({error:'Actif invalide'});

  const sym=SYMBOLS[asset];

  try {
    let price, changePct, candles;

    if(sym.type==='gold') {
      // Spot price via Open Exchange Rates (XAU, free, no key needed for base rates)
      // Primary: frankfurter.app doesn't have XAU
      // Best free option: gold-api.com public endpoint
      let livePrice = null;

      // Try gold-api.com — free, no key, real spot price
      try {
        const r = await fetch('https://gold-api.com/price/XAU', {
          headers: { 'Accept': 'application/json' }
        });
        const d = await r.json();
        if(d && d.price) livePrice = parseFloat(d.price);
      } catch {}

      // Try commodity-price API (free)
      if(!livePrice) {
        try {
          const r = await fetch('https://api.commodity-price.com/metals?api_key=free&metal=gold');
          const d = await r.json();
          if(d && d.gold) livePrice = parseFloat(d.gold);
        } catch {}
      }

      // Candles from Yahoo GC=F
      const {price:futPrice, changePct, candles} = await fetchYahoo(sym.yhSym, tf);
      const price = livePrice || futPrice;

      // If we got a spot price, shift all candles by the diff
      if(candles.length && livePrice && livePrice !== futPrice) {
        const diff = livePrice - futPrice;
        candles.forEach(cv => {
          cv.open  = parseFloat((cv.open  + diff).toFixed(2));
          cv.high  = parseFloat((cv.high  + diff).toFixed(2));
          cv.low   = parseFloat((cv.low   + diff).toFixed(2));
          cv.close = parseFloat((cv.close + diff).toFixed(2));
        });
      }

      const closes      = candles.map(cv=>cv.close);
      const rsi         = calcRSI(closes);
      const {macd,signal:macdSig,hist:macdHist} = calcMACD(closes);
      const ema20       = calcEMA(closes,20);
      const ema50       = calcEMA(closes,50);
      const {upper:bbUpper,mid:bbMid,lower:bbLower} = calcBollinger(closes);
      const ema20Series = buildEMASeries(candles,20);
      const ema50Series = buildEMASeries(candles,50);
      const analysis    = await getAIAnalysis(asset,price,changePct,rsi,macd,macdSig,ema20,ema50,bbUpper,bbLower);

      return res.status(200).json({
        ok:true, asset, price, changePct,
        rsi, macd, macdSig, macdHist,
        ema20, ema50, bbUpper, bbMid, bbLower,
        candles, ema20Series, ema50Series, analysis,
        _debug: { livePrice, futPrice }
      });

    } else if(sym.type==='crypto') {
      ({price,changePct,candles}=await fetchCoinGecko(sym.cgId,tf));
    } else {
      ({price,changePct,candles}=await fetchYahoo(sym.yhSym,tf));
    }

    const closes      = candles.map(c=>c.close);
    const rsi2        = calcRSI(closes);
    const {macd:m2,signal:ms2,hist:mh2} = calcMACD(closes);
    const ema20b      = calcEMA(closes,20);
    const ema50b      = calcEMA(closes,50);
    const {upper:bbU2,mid:bbM2,lower:bbL2} = calcBollinger(closes);
    const e20s        = buildEMASeries(candles,20);
    const e50s        = buildEMASeries(candles,50);
    const analysis2   = await getAIAnalysis(asset,price,changePct,rsi2,m2,ms2,ema20b,ema50b,bbU2,bbL2);

    return res.status(200).json({
      ok:true, asset, price, changePct,
      rsi:rsi2, macd:m2, macdSig:ms2, macdHist:mh2,
      ema20:ema20b, ema50:ema50b, bbUpper:bbU2, bbMid:bbM2, bbLower:bbL2,
      candles, ema20Series:e20s, ema50Series:e50s, analysis:analysis2,
    });
  } catch(err) {
    console.error(err);
    return res.status(500).json({error:err.message});
  }
}
