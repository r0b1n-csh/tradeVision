const AI_MODEL = 'claude-sonnet-4-20250514';
const TD_KEY   = 'ee0ce47963f74929bfa2fcc54bed6e1a';

const SYMBOLS = {
  XAUUSD: { name:'Or / Dollar (XAU/USD)',  unit:'$', dec:2, type:'gold',   yhSym:'GC=F'   },
  BTCUSD: { name:'Bitcoin (BTC/USD)',       unit:'$', dec:0, type:'crypto', cgId:'bitcoin' },
  SOLUSD: { name:'Solana (SOL/USD)',        unit:'$', dec:2, type:'crypto', cgId:'solana'  },
  CAC40:  { name:'CAC 40 (Paris)',          unit:'',  dec:0, type:'yahoo',  yhSym:'^FCHI'  },
  SP500:  { name:'S&P 500 (USA)',           unit:'',  dec:0, type:'yahoo',  yhSym:'^GSPC'  },
};

const TF_YAHOO = {
  '1min': {interval:'1m',range:'1d'},  '3min': {interval:'5m',range:'1d'},
  '15min':{interval:'15m',range:'5d'}, '1h':   {interval:'1h',range:'1mo'},
  '4h':   {interval:'1h',range:'3mo'}, '1day': {interval:'1d',range:'1y'},
};
const TF_CG = {'1min':'1','3min':'1','15min':'1','1h':'1','4h':'7','1day':'90'};

// ── Indicators ────────────────────────────────────────────────────────────

function calcEMA(arr, period) {
  if(!arr||arr.length<2) return arr?.[arr.length-1]||0;
  const p=Math.min(period,arr.length-1), k=2/(p+1);
  let ema=arr.slice(0,p).reduce((a,b)=>a+b,0)/p;
  for(let i=p;i<arr.length;i++) ema=arr[i]*k+ema*(1-k);
  return ema;
}
function calcRSI(arr,period=14) {
  if(!arr||arr.length<period+1) return 50;
  let g=0,l=0;
  for(let i=arr.length-period;i<arr.length;i++){const d=arr[i]-arr[i-1];if(d>0)g+=d;else l-=d;}
  if(l===0) return 100;
  return 100-100/(1+(g/period)/(l/period));
}
function calcMACD(arr) {
  if(!arr||arr.length<26) return {macd:0,signal:0,hist:0};
  const m=calcEMA(arr,12)-calcEMA(arr,26);
  return {macd:m,signal:m*0.85,hist:m*0.15};
}
function calcBollinger(arr,period=20) {
  if(!arr||arr.length<2) return {upper:0,mid:0,lower:0};
  const s=arr.slice(-Math.min(period,arr.length));
  const mid=s.reduce((a,b)=>a+b,0)/s.length;
  const std=Math.sqrt(s.reduce((a,b)=>a+(b-mid)**2,0)/s.length);
  return {upper:mid+2*std,mid,lower:mid-2*std};
}
function buildEMASeries(candles,period) {
  if(!candles||!candles.length) return [];
  const k=2/(period+1); let ema=candles[0].close;
  return candles.map((c,i)=>{if(i>0)ema=c.close*k+ema*(1-k);return{time:c.time,value:parseFloat(ema.toFixed(6))};});
}

// ── MODULE 1 — Pattern Recognition ───────────────────────────────────────

function detectPatterns(candles) {
  const patterns = [];
  if(candles.length < 5) return patterns;
  const n = candles.length;
  const c = candles;

  // Helper: body size, wick sizes
  const body  = i => Math.abs(c[i].close - c[i].open);
  const range = i => c[i].high - c[i].low;
  const isGreen = i => c[i].close > c[i].open;
  const isRed   = i => c[i].close < c[i].open;
  const upperWick = i => c[i].high - Math.max(c[i].open, c[i].close);
  const lowerWick = i => Math.min(c[i].open, c[i].close) - c[i].low;

  const last = n - 1;

  // ── Doji (indécision) ──
  if(body(last) < range(last) * 0.1 && range(last) > 0) {
    patterns.push({ name:'Doji', type:'neutral', desc:'Indécision du marché — attendre confirmation', strength:1 });
  }

  // ── Marteau (Hammer) — bullish reversal ──
  if(isGreen(last) && lowerWick(last) > body(last)*2 && upperWick(last) < body(last)*0.5) {
    patterns.push({ name:'Marteau', type:'bullish', desc:'Signal de retournement haussier potentiel', strength:2 });
  }

  // ── Marteau inversé (Inverted Hammer) ──
  if(upperWick(last) > body(last)*2 && lowerWick(last) < body(last)*0.5) {
    patterns.push({ name:'Marteau inversé', type:'bullish', desc:'Possible retournement haussier', strength:1 });
  }

  // ── Étoile filante (Shooting Star) — bearish ──
  if(isRed(last) && upperWick(last) > body(last)*2 && lowerWick(last) < body(last)*0.5) {
    patterns.push({ name:'Étoile filante', type:'bearish', desc:'Signal de retournement baissier', strength:2 });
  }

  // ── Engulfing haussier ──
  if(n>=2 && isRed(last-1) && isGreen(last) &&
     c[last].open < c[last-1].close && c[last].close > c[last-1].open) {
    patterns.push({ name:'Engulfing haussier', type:'bullish', desc:'Reprise puissante par les acheteurs', strength:3 });
  }

  // ── Engulfing baissier ──
  if(n>=2 && isGreen(last-1) && isRed(last) &&
     c[last].open > c[last-1].close && c[last].close < c[last-1].open) {
    patterns.push({ name:'Engulfing baissier', type:'bearish', desc:'Prise de contrôle par les vendeurs', strength:3 });
  }

  // ── Morning Star (3 bougies) ──
  if(n>=3 && isRed(last-2) && body(last-1)<body(last-2)*0.5 && isGreen(last) &&
     c[last].close > (c[last-2].open+c[last-2].close)/2) {
    patterns.push({ name:'Morning Star', type:'bullish', desc:'Retournement haussier fort sur 3 bougies', strength:3 });
  }

  // ── Evening Star ──
  if(n>=3 && isGreen(last-2) && body(last-1)<body(last-2)*0.5 && isRed(last) &&
     c[last].close < (c[last-2].open+c[last-2].close)/2) {
    patterns.push({ name:'Evening Star', type:'bearish', desc:'Retournement baissier fort sur 3 bougies', strength:3 });
  }

  // ── Three White Soldiers ──
  if(n>=3 && isGreen(last) && isGreen(last-1) && isGreen(last-2) &&
     c[last].close>c[last-1].close && c[last-1].close>c[last-2].close &&
     body(last)>range(last)*0.6 && body(last-1)>range(last-1)*0.6) {
    patterns.push({ name:'Trois soldats blancs', type:'bullish', desc:'Tendance haussière forte et confirmée', strength:3 });
  }

  // ── Three Black Crows ──
  if(n>=3 && isRed(last) && isRed(last-1) && isRed(last-2) &&
     c[last].close<c[last-1].close && c[last-1].close<c[last-2].close &&
     body(last)>range(last)*0.6 && body(last-1)>range(last-1)*0.6) {
    patterns.push({ name:'Trois corbeaux noirs', type:'bearish', desc:'Tendance baissière forte et confirmée', strength:3 });
  }

  // ── Double Top (sur les 30 dernières bougies) ──
  if(n>=30) {
    const highs = c.slice(n-30).map(x=>x.high);
    const maxH  = Math.max(...highs);
    const peaks = highs.reduce((acc,h,i)=>{ if(h>maxH*0.998) acc.push(i); return acc; },[]);
    if(peaks.length>=2 && peaks[peaks.length-1]-peaks[0]>=5) {
      patterns.push({ name:'Double top', type:'bearish', desc:`Résistance double à ~${maxH.toFixed(2)} — retournement probable`, strength:3 });
    }
  }

  // ── Double Bottom ──
  if(n>=30) {
    const lows = c.slice(n-30).map(x=>x.low);
    const minL = Math.min(...lows);
    const troughs = lows.reduce((acc,l,i)=>{ if(l<minL*1.002) acc.push(i); return acc; },[]);
    if(troughs.length>=2 && troughs[troughs.length-1]-troughs[0]>=5) {
      patterns.push({ name:'Double bottom', type:'bullish', desc:`Support double à ~${minL.toFixed(2)} — rebond probable`, strength:3 });
    }
  }

  return patterns;
}

// ── MODULE 2 — Confluence Score ───────────────────────────────────────────

function computeConfluence(price, rsi, macd, macdSig, ema20, ema50, bbUpper, bbMid, bbLower, changePct, patterns) {
  const signals = [];

  // RSI
  if(rsi<30)      signals.push({ind:'RSI',verdict:'ACHAT',detail:`RSI survendu (${rsi.toFixed(1)})`,weight:2});
  else if(rsi>70) signals.push({ind:'RSI',verdict:'VENTE',detail:`RSI suracheté (${rsi.toFixed(1)})`,weight:2});
  else if(rsi<45) signals.push({ind:'RSI',verdict:'ACHAT',detail:`RSI en zone basse (${rsi.toFixed(1)})`,weight:1});
  else if(rsi>55) signals.push({ind:'RSI',verdict:'VENTE',detail:`RSI en zone haute (${rsi.toFixed(1)})`,weight:1});
  else            signals.push({ind:'RSI',verdict:'NEUTRE',detail:`RSI neutre (${rsi.toFixed(1)})`,weight:0});

  // MACD
  if(macd>macdSig && macd>0)       signals.push({ind:'MACD',verdict:'ACHAT',detail:'MACD haussier au-dessus de 0',weight:2});
  else if(macd>macdSig && macd<=0) signals.push({ind:'MACD',verdict:'ACHAT',detail:'MACD haussier sous 0 (faible)',weight:1});
  else if(macd<macdSig && macd<0)  signals.push({ind:'MACD',verdict:'VENTE',detail:'MACD baissier sous 0',weight:2});
  else                             signals.push({ind:'MACD',verdict:'VENTE',detail:'MACD baissier au-dessus de 0',weight:1});

  // EMA Cross
  if(ema20>ema50)      signals.push({ind:'EMA',verdict:'ACHAT',detail:'EMA20 > EMA50 (golden cross)',weight:2});
  else if(ema20<ema50) signals.push({ind:'EMA',verdict:'VENTE',detail:'EMA20 < EMA50 (death cross)',weight:2});
  else                 signals.push({ind:'EMA',verdict:'NEUTRE',detail:'EMA20 ≈ EMA50',weight:0});

  // Prix vs EMA50
  if(price>ema50)      signals.push({ind:'Tendance',verdict:'ACHAT',detail:'Prix au-dessus EMA50',weight:1});
  else                 signals.push({ind:'Tendance',verdict:'VENTE',detail:'Prix sous EMA50',weight:1});

  // Bollinger
  if(price<=bbLower*1.001)    signals.push({ind:'Bollinger',verdict:'ACHAT',detail:'Prix en bande basse (survente)',weight:2});
  else if(price>=bbUpper*0.999) signals.push({ind:'Bollinger',verdict:'VENTE',detail:'Prix en bande haute (surachat)',weight:2});
  else if(price>bbMid)         signals.push({ind:'Bollinger',verdict:'ACHAT',detail:'Prix au-dessus bande médiane',weight:1});
  else                         signals.push({ind:'Bollinger',verdict:'VENTE',detail:'Prix sous bande médiane',weight:1});

  // Momentum (variation 24h)
  if(changePct>1)       signals.push({ind:'Momentum',verdict:'ACHAT',detail:`Momentum fort +${changePct.toFixed(2)}%`,weight:1});
  else if(changePct<-1) signals.push({ind:'Momentum',verdict:'VENTE',detail:`Momentum baissier ${changePct.toFixed(2)}%`,weight:1});
  else                  signals.push({ind:'Momentum',verdict:'NEUTRE',detail:`Momentum faible (${changePct.toFixed(2)}%)`,weight:0});

  // Patterns
  const bullPatterns = patterns.filter(p=>p.type==='bullish');
  const bearPatterns = patterns.filter(p=>p.type==='bearish');
  const bullStr = bullPatterns.reduce((a,p)=>a+p.strength,0);
  const bearStr = bearPatterns.reduce((a,p)=>a+p.strength,0);
  if(bullStr>bearStr && bullStr>0) signals.push({ind:'Patterns',verdict:'ACHAT',detail:bullPatterns.map(p=>p.name).join(', '),weight:bullStr>3?3:bullStr});
  else if(bearStr>bullStr && bearStr>0) signals.push({ind:'Patterns',verdict:'VENTE',detail:bearPatterns.map(p=>p.name).join(', '),weight:bearStr>3?3:bearStr});
  else signals.push({ind:'Patterns',verdict:'NEUTRE',detail:'Aucun pattern significatif',weight:0});

  // Compute weighted score
  let totalBuy=0, totalSell=0, totalWeight=0;
  signals.forEach(s=>{
    totalWeight+=s.weight;
    if(s.verdict==='ACHAT') totalBuy+=s.weight;
    else if(s.verdict==='VENTE') totalSell+=s.weight;
  });

  const raw = totalWeight>0 ? ((totalBuy-totalSell)/totalWeight) : 0;
  const score = Math.round(50 + raw*50);
  const bounded = Math.max(0,Math.min(100,score));
  const buyCount  = signals.filter(s=>s.verdict==='ACHAT').length;
  const sellCount = signals.filter(s=>s.verdict==='VENTE').length;
  const neutCount = signals.filter(s=>s.verdict==='NEUTRE').length;
  const signal = bounded>=75?'ACHAT FORT':bounded>=60?'ACHAT':bounded<=25?'VENTE FORTE':bounded<=40?'VENTE':'NEUTRE';
  const confidence = Math.round(50+Math.abs(bounded-50)*0.85);

  return { score:bounded, signal, confidence, signals, buyCount, sellCount, neutCount };
}

// ── MODULE 3 — Fibonacci Retracements ────────────────────────────────────

function calcFibonacci(candles) {
  if(candles.length<10) return null;
  const recent = candles.slice(-50);
  const swingHigh = Math.max(...recent.map(c=>c.high));
  const swingLow  = Math.min(...recent.map(c=>c.low));
  const diff = swingHigh - swingLow;
  return {
    swingHigh, swingLow,
    fib236: parseFloat((swingHigh - diff*0.236).toFixed(4)),
    fib382: parseFloat((swingHigh - diff*0.382).toFixed(4)),
    fib500: parseFloat((swingHigh - diff*0.500).toFixed(4)),
    fib618: parseFloat((swingHigh - diff*0.618).toFixed(4)),
    fib786: parseFloat((swingHigh - diff*0.786).toFixed(4)),
  };
}

// ── MODULE 4 — Support / Resistance Zones ────────────────────────────────

function calcSupportResistance(candles) {
  if(candles.length<20) return {supports:[],resistances:[]};
  const zones = [];
  const tolerance = (Math.max(...candles.map(c=>c.high)) - Math.min(...candles.map(c=>c.low))) * 0.005;

  for(let i=2;i<candles.length-2;i++){
    // Local high (resistance)
    if(candles[i].high>=candles[i-1].high && candles[i].high>=candles[i-2].high &&
       candles[i].high>=candles[i+1].high && candles[i].high>=candles[i+2].high) {
      const existing = zones.find(z=>z.type==='resistance' && Math.abs(z.price-candles[i].high)<tolerance);
      if(existing) existing.touches++;
      else zones.push({type:'resistance', price:parseFloat(candles[i].high.toFixed(4)), touches:1});
    }
    // Local low (support)
    if(candles[i].low<=candles[i-1].low && candles[i].low<=candles[i-2].low &&
       candles[i].low<=candles[i+1].low && candles[i].low<=candles[i+2].low) {
      const existing = zones.find(z=>z.type==='support' && Math.abs(z.price-candles[i].low)<tolerance);
      if(existing) existing.touches++;
      else zones.push({type:'support', price:parseFloat(candles[i].low.toFixed(4)), touches:1});
    }
  }

  const currentPrice = candles[candles.length-1].close;
  const supports = zones.filter(z=>z.type==='support' && z.price<currentPrice)
    .sort((a,b)=>b.price-a.price).slice(0,3)
    .map(z=>({...z, strength:z.touches>=3?'Fort':z.touches===2?'Moyen':'Faible'}));
  const resistances = zones.filter(z=>z.type==='resistance' && z.price>currentPrice)
    .sort((a,b)=>a.price-b.price).slice(0,3)
    .map(z=>({...z, strength:z.touches>=3?'Fort':z.touches===2?'Moyen':'Faible'}));

  return {supports, resistances};
}

// ── Data fetchers ─────────────────────────────────────────────────────────

async function fetchYahoo(yhSym, tf) {
  const {interval,range} = TF_YAHOO[tf]||TF_YAHOO['1h'];
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yhSym)}?interval=${interval}&range=${range}`;
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});
  if(!r.ok) throw new Error(`Yahoo ${r.status}`);
  const d=await r.json();
  const result=d.chart?.result?.[0];
  if(!result) throw new Error('Yahoo: pas de données');
  const meta=result.meta;
  const price=meta.regularMarketPrice;
  const prev=meta.previousClose||meta.chartPreviousClose;
  const changePct=prev?((price-prev)/prev)*100:0;
  const ts=result.timestamp||[];
  const q=result.indicators?.quote?.[0]||{};
  const candles=[];
  for(let i=0;i<ts.length;i++){
    const o=q.open?.[i],h=q.high?.[i],l=q.low?.[i],c=q.close?.[i];
    if(o==null||h==null||l==null||c==null) continue;
    candles.push({time:ts[i],open:parseFloat(o.toFixed(4)),high:parseFloat(h.toFixed(4)),low:parseFloat(l.toFixed(4)),close:parseFloat(c.toFixed(4)),volume:q.volume?.[i]||0});
  }
  if(candles.length){
    candles[candles.length-1].close=price;
    if(price>candles[candles.length-1].high) candles[candles.length-1].high=price;
    if(price<candles[candles.length-1].low)  candles[candles.length-1].low=price;
  }
  return {price,changePct,candles};
}

async function fetchCoinGecko(cgId, tf) {
  const days=TF_CG[tf]||'1';
  const [pr,oc]=await Promise.all([
    fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true`),
    fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${days}`),
  ]);
  const [pd,od]=await Promise.all([pr.json(),oc.json()]);
  const price=pd[cgId].usd, changePct=pd[cgId].usd_24h_change||0;
  const candles=od.map(([t,o,h,l,c])=>({time:Math.floor(t/1000),open:o,high:h,low:l,close:c,volume:0}));
  if(candles.length){
    candles[candles.length-1].close=price;
    if(price>candles[candles.length-1].high) candles[candles.length-1].high=price;
    if(price<candles[candles.length-1].low)  candles[candles.length-1].low=price;
  }
  return {price,changePct,candles};
}

// ── AI Analysis ───────────────────────────────────────────────────────────


// ── TRADE ENGINE — Calcul du trade optimal ───────────────────────────────

function calcATR(candles, period=14) {
  if(!candles||candles.length<period+1) return candles?.[candles.length-1]?.close*0.005||0;
  let atr=0;
  for(let i=candles.length-period;i<candles.length;i++){
    const tr=Math.max(
      candles[i].high-candles[i].low,
      Math.abs(candles[i].high-candles[i-1].close),
      Math.abs(candles[i].low-candles[i-1].close)
    );
    atr+=tr;
  }
  return atr/period;
}

function computeTrade(price, confluence, fibonacci, sr, patterns, candles, dec) {
  const score      = confluence?.score||50;
  const confidence = confluence?.confidence||50;
  const signals    = confluence?.signals||[];
  const atr        = calcATR(candles);

  // Direction du trade
  const direction = score>=60?'LONG':score<=40?'SHORT':null;
  if(!direction) return { direction:'NEUTRE', reason:'Signal trop faible — pas de trade recommandé. Attendre une meilleure opportunité.', score };

  // Forces supplémentaires
  const bullPatterns = (patterns||[]).filter(p=>p.type==='bullish').reduce((a,p)=>a+p.strength,0);
  const bearPatterns = (patterns||[]).filter(p=>p.type==='bearish').reduce((a,p)=>a+p.strength,0);
  const patternBoost = direction==='LONG' ? bullPatterns : bearPatterns;

  // Niveau de conviction (0-100)
  const conviction = Math.min(100, Math.round(confidence + patternBoost*3));

  // Taille de position recommandée (% du capital)
  const positionSize = conviction>=80?'2-3%':conviction>=65?'1-2%':'0.5-1%';
  const riskLabel    = conviction>=80?'Élevée':conviction>=65?'Modérée':'Faible';

  // ── Prix d'entrée ──
  // Zone d'entrée optimale : légèrement retracée sur le prix actuel
  const entryOffset = direction==='LONG' ? -atr*0.15 : atr*0.15;
  const entry = parseFloat((price + entryOffset).toFixed(dec));

  // ── Stop Loss ──
  // Basé sur ATR x 1.5 + support/résistance le plus proche
  let slBase = direction==='LONG'
    ? entry - atr*1.5
    : entry + atr*1.5;

  // Affiner avec S/R
  if(direction==='LONG' && sr?.supports?.length) {
    const nearSup = sr.supports.filter(s=>s.price<entry).sort((a,b)=>b.price-a.price)[0];
    if(nearSup && nearSup.price > slBase) slBase = nearSup.price - atr*0.3;
  }
  if(direction==='SHORT' && sr?.resistances?.length) {
    const nearRes = sr.resistances.filter(r=>r.price>entry).sort((a,b)=>a.price-b.price)[0];
    if(nearRes && nearRes.price < slBase) slBase = nearRes.price + atr*0.3;
  }
  const stopLoss = parseFloat(slBase.toFixed(dec));
  const risk     = Math.abs(entry - stopLoss);

  // ── Take Profits (ratio R:R) ──
  const tp1 = parseFloat((direction==='LONG' ? entry+risk*1.5  : entry-risk*1.5).toFixed(dec));
  const tp2 = parseFloat((direction==='LONG' ? entry+risk*3    : entry-risk*3).toFixed(dec));
  const tp3 = parseFloat((direction==='LONG' ? entry+risk*5    : entry-risk*5).toFixed(dec));

  // Affiner TP avec Fibonacci
  if(fibonacci) {
    const fibLevels = direction==='LONG'
      ? [fibonacci.fib236, fibonacci.fib382, fibonacci.fib500].filter(f=>f&&f>entry)
      : [fibonacci.fib618, fibonacci.fib786].filter(f=>f&&f<entry);
    // TP1 = niveau Fib le plus proche si plus avantageux
    if(fibLevels.length && direction==='LONG') {
      const bestFib = fibLevels.sort((a,b)=>a-b)[0];
      if(bestFib > tp1*0.98 && bestFib < tp2) {
        // use fib as tp1 refinement — keep tp1 as is for simplicity
      }
    }
  }

  // ── Invalidation ──
  const invalidation = direction==='LONG'
    ? parseFloat((stopLoss - atr*0.5).toFixed(dec))
    : parseFloat((stopLoss + atr*0.5).toFixed(dec));

  // ── Ratio R:R ──
  const rrRatio = parseFloat((risk>0 ? (Math.abs(tp2-entry)/risk).toFixed(2) : 0));

  // ── Raison du trade ──
  const buySignals  = signals.filter(s=>s.verdict==='ACHAT').map(s=>s.ind);
  const sellSignals = signals.filter(s=>s.verdict==='VENTE').map(s=>s.ind);
  const mainSignals = direction==='LONG' ? buySignals : sellSignals;

  const reason = direction==='LONG'
    ? `Signal LONG confirmé par : ${mainSignals.join(', ')}. ${bullPatterns>0?`Patterns haussiers détectés (force ${bullPatterns}).`:''}  Entrée sur retracement avec SL sous le support clé.`
    : `Signal SHORT confirmé par : ${mainSignals.join(', ')}. ${bearPatterns>0?`Patterns baissiers détectés (force ${bearPatterns}).`:''} Entrée sur rejet avec SL au-dessus de la résistance clé.`;

  return {
    direction, conviction, positionSize, riskLabel,
    entry, stopLoss, tp1, tp2, tp3, invalidation,
    risk: parseFloat(risk.toFixed(dec)),
    rrRatio, reason, atr: parseFloat(atr.toFixed(dec)),
    score,
  };
}

async function getAIAnalysis(sym, price, changePct, confluence, fibonacci, sr, patterns) {
  const dec=sym.dec;
  const fmt=n=>Number(n).toFixed(dec);
  const {score,signal,confidence,signals,buyCount,sellCount} = confluence;
  const patternStr = patterns.length ? patterns.map(p=>`${p.name} (${p.type})`).join(', ') : 'Aucun pattern détecté';
  const fibStr = fibonacci ? `Fib 38.2%: ${fmt(fibonacci.fib382)} | Fib 50%: ${fmt(fibonacci.fib500)} | Fib 61.8%: ${fmt(fibonacci.fib618)}` : 'N/A';
  const srStr = [
    ...sr.resistances.map(r=>`Résistance ${r.strength} à ${fmt(r.price)} (${r.touches} touches)`),
    ...sr.supports.map(s=>`Support ${s.strength} à ${fmt(s.price)} (${s.touches} touches)`),
  ].join(' | ') || 'N/A';

  const prompt=`Tu es un analyste technique expert en trading. Voici l'analyse complète de ${sym.name} :

PRIX : ${fmt(price)} ${sym.unit} | Variation 24h : ${Number(changePct).toFixed(2)}%
CONFLUENCE : Score ${score}/100 → ${signal} (confiance ${confidence}%) | ${buyCount} signaux ACHAT, ${sellCount} signaux VENTE
DÉTAIL INDICATEURS : ${signals.map(s=>`${s.ind}: ${s.verdict} (${s.detail})`).join(' | ')}
PATTERNS DÉTECTÉS : ${patternStr}
FIBONACCI : ${fibStr} | Swing High: ${fibonacci?fmt(fibonacci.swingHigh):'N/A'} | Swing Low: ${fibonacci?fmt(fibonacci.swingLow):'N/A'}
NIVEAUX CLÉS : ${srStr}

Rédige une analyse de 4-5 phrases en français, professionnelle et précise. Intègre les patterns détectés, les niveaux de Fibonacci clés, les supports/résistances importants et le signal de confluence. Mentionne concrètement ce qu'un day trader doit surveiller. Uniquement le texte de l'analyse.`;

  try {
    const res=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:AI_MODEL,max_tokens:400,messages:[{role:'user',content:prompt}]}),
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
  const {asset,tf='1h'}=req.query;
  if(!asset||!SYMBOLS[asset]) return res.status(400).json({error:'Actif invalide'});
  const sym=SYMBOLS[asset];

  try {
    let price,changePct,candles;

    if(sym.type==='gold') {
      // Twelve Data for live spot price
      let livePrice=null;
      try {
        const r=await fetch(`https://api.twelvedata.com/quote?symbol=XAU/USD&apikey=${TD_KEY}`);
        const d=await r.json();
        if(d&&d.close) livePrice=parseFloat(d.close);
      } catch {}
      const {price:fp,changePct:fc,candles:fc2}=await fetchYahoo(sym.yhSym,tf);
      price=livePrice||fp; changePct=livePrice?((livePrice-fp)/fp*100+fc)/2:fc; candles=fc2;
      if(candles.length&&livePrice){
        const diff=livePrice-fp;
        candles.forEach(cv=>{cv.open=parseFloat((cv.open+diff).toFixed(2));cv.high=parseFloat((cv.high+diff).toFixed(2));cv.low=parseFloat((cv.low+diff).toFixed(2));cv.close=parseFloat((cv.close+diff).toFixed(2));});
      }
    } else if(sym.type==='crypto') {
      ({price,changePct,candles}=await fetchCoinGecko(sym.cgId,tf));
    } else {
      ({price,changePct,candles}=await fetchYahoo(sym.yhSym,tf));
    }

    const closes=candles.map(c=>c.close);
    const rsi    =calcRSI(closes);
    const {macd,signal:macdSig,hist:macdHist}=calcMACD(closes);
    const ema20  =calcEMA(closes,20);
    const ema50  =calcEMA(closes,50);
    const {upper:bbUpper,mid:bbMid,lower:bbLower}=calcBollinger(closes);
    const ema20Series=buildEMASeries(candles,20);
    const ema50Series=buildEMASeries(candles,50);

    // 4 precision modules
    const patterns   = detectPatterns(candles);
    const confluence = computeConfluence(price,rsi,macd,macdSig,ema20,ema50,bbUpper,bbMid,bbLower,changePct,patterns);
    const fibonacci  = calcFibonacci(candles);
    const sr         = calcSupportResistance(candles);
    const analysis   = await getAIAnalysis(sym,price,changePct,confluence,fibonacci,sr,patterns);

    return res.status(200).json({
      ok:true, asset, price, changePct,
      rsi, macd, macdSig, macdHist,
      ema20, ema50, bbUpper, bbMid, bbLower,
      candles, ema20Series, ema50Series,
      patterns, confluence, fibonacci, sr, analysis,
    });
  } catch(err) {
    console.error(err);
    return res.status(500).json({error:err.message});
  }
}
