const NEWS_KEY = '8ff9c490774343a883451c649234d18c';

// Mots-clés par actif
const QUERIES = {
  XAUUSD: 'gold XAU price market',
  BTCUSD: 'bitcoin BTC crypto market',
  SOLUSD: 'solana SOL crypto',
  CAC40:  'CAC 40 bourse Paris',
  SP500:  'S&P 500 stock market wall street',
};

// Mots positifs / négatifs pour scoring
const POSITIVE = ['surge','rally','rise','gain','bullish','high','record','growth','up','strong','beat','jump','soar','boost','buy'];
const NEGATIVE = ['drop','fall','crash','bearish','low','loss','decline','down','weak','sell','plunge','risk','fear','worry','miss'];

function scoreSentiment(text) {
  const lower = text.toLowerCase();
  let pos = 0, neg = 0;
  POSITIVE.forEach(w => { if(lower.includes(w)) pos++; });
  NEGATIVE.forEach(w => { if(lower.includes(w)) neg++; });
  return { pos, neg };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { asset } = req.query;
  if (!asset || !QUERIES[asset]) {
    return res.status(400).json({ error: 'Actif invalide' });
  }

  try {
    const query = encodeURIComponent(QUERIES[asset]);
    const url = `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${NEWS_KEY}`;
    const r = await fetch(url);
    const d = await r.json();

    if (d.status !== 'ok') throw new Error(d.message || 'NewsAPI error');

    const articles = d.articles.slice(0, 10);

    // Score chaque article
    let totalPos = 0, totalNeg = 0;
    const scored = articles.map(a => {
      const text = (a.title || '') + ' ' + (a.description || '');
      const { pos, neg } = scoreSentiment(text);
      totalPos += pos; totalNeg += neg;
      return {
        title: a.title,
        source: a.source?.name || 'Unknown',
        publishedAt: a.publishedAt,
        url: a.url,
        sentiment: pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral',
        pos, neg,
      };
    });

    const total = totalPos + totalNeg || 1;
    const sentimentScore = Math.round((totalPos / total) * 100); // 0=très négatif, 100=très positif
    const sentimentLabel = sentimentScore >= 60 ? 'Haussier' : sentimentScore <= 40 ? 'Baissier' : 'Neutre';

    return res.status(200).json({
      ok: true,
      asset,
      sentimentScore,
      sentimentLabel,
      totalPos,
      totalNeg,
      articles: scored,
    });

  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
