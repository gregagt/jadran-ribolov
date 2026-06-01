// Netlify Function: Stormglass proxy s LETNIM kešom
// Samo 1 API klic/lokacijo/leto → 7 klicev skupaj za vse lokacije

const STORE = {}; // in-memory (deli se med klici dokler se ne restarta)

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=43200'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { lat, lng, date } = event.queryStringParameters || {};
  if (!lat || !lng || !date) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Manjkajo: lat, lng, date' }) };
  }

  const sgKey = process.env.STORMGLASS_KEY;
  if (!sgKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'STORMGLASS_KEY ni nastavljen' }) };
  }

  const locKey = `${parseFloat(lat).toFixed(2)}_${parseFloat(lng).toFixed(2)}`;
  const yearKey = `${locKey}_${date.substring(0,4)}`; // keš po letu

  // ── Filtriraj ekstrema za zahtevani dan ──────────────────────────────
  const filterDay = (extremes, date) => {
    // lokalni dan = 00:00 do 24:00 CEST (UTC+2)
    const d0 = new Date(date + 'T00:00:00+02:00').getTime();
    const d1 = d0 + 86400000;
    return extremes.filter(e => {
      const t = new Date(e.time).getTime();
      return t >= d0 && t < d1;
    });
  };

  // ── Poišči v pomnilniku ──────────────────────────────────────────────
  if (STORE[yearKey]) {
    console.log(`Memory hit: ${yearKey} → filter ${date}`);
    const dayData = filterDay(STORE[yearKey], date);
    return {
      statusCode: 200,
      headers: { ...headers, 'X-Cache': 'MEMORY' },
      body: JSON.stringify({ extremes: dayData, date, cached: true })
    };
  }

  // ── Naloži celo leto z 1 API klicem ──────────────────────────────────
  try {
    const year = parseInt(date.substring(0, 4));
    const d0 = new Date(`${year}-01-01T00:00:00+02:00`);
    const d1 = new Date(`${year + 1}-01-01T00:00:00+02:00`);
    const start = Math.floor(d0.getTime() / 1000);
    const end = Math.floor(d1.getTime() / 1000);

    console.log(`Stormglass: pridobivam CELO LETO ${year} za ${locKey}`);

    const res = await fetch(
      `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${start}&end=${end}`,
      { headers: { 'Authorization': sgKey } }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const data = await res.json();
    if (data.errors) throw new Error(JSON.stringify(data.errors));

    const extremes = (data.data || []).map(e => ({
      time: e.time,
      height: parseFloat(e.height),
      type: e.type === 'high' ? 'high' : 'low'
    }));

    console.log(`Shranjujem ${extremes.length} ekstremov za ${year}`);
    STORE[yearKey] = extremes;

    const dayData = filterDay(extremes, date);
    return {
      statusCode: 200,
      headers: { ...headers, 'X-Cache': 'MISS' },
      body: JSON.stringify({ extremes: dayData, date, cached: false, total: extremes.length })
    };

  } catch (err) {
    console.error('Napaka:', err.message);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
