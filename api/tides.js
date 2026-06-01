const STORE = {};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { lat, lng, date } = req.query;
  if (!lat || !lng || !date) {
    return res.status(400).json({ error: 'Manjkajo: lat, lng, date' });
  }

  const sgKey = process.env.STORMGLASS_KEY;
  if (!sgKey) return res.status(500).json({ error: 'STORMGLASS_KEY ni nastavljen' });

  const locKey = `${parseFloat(lat).toFixed(2)}_${parseFloat(lng).toFixed(2)}`;
  const year = date.substring(0, 4);
  const yearKey = `${locKey}_${year}`;

  const filterDay = (extremes, date) => {
    const d0 = new Date(date + 'T00:00:00+02:00').getTime();
    const d1 = d0 + 86400000;
    return extremes.filter(e => new Date(e.time).getTime() >= d0 && new Date(e.time).getTime() < d1);
  };

  // Vrni iz keša samo če ima podatke
  if (STORE[yearKey] && STORE[yearKey].length > 0) {
    const dayData = filterDay(STORE[yearKey], date);
    if (dayData.length > 0) {
      return res.status(200).json({ extremes: dayData, date, cached: true });
    }
  }

  try {
    const d0 = new Date(`${year}-01-01T00:00:00+02:00`);
    const d1 = new Date(`${parseInt(year)+1}-01-01T00:00:00+02:00`);
    const start = Math.floor(d0.getTime() / 1000);
    const end = Math.floor(d1.getTime() / 1000);

    const response = await fetch(
      `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${start}&end=${end}`,
      { headers: { 'Authorization': sgKey } }
    );

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`Stormglass HTTP ${response.status}: ${txt}`);
    }

    const data = await response.json();
    if (data.errors) throw new Error(JSON.stringify(data.errors));

    const extremes = (data.data || []).map(e => ({
      time: e.time,
      height: parseFloat(e.height),
      type: e.type === 'high' ? 'high' : 'low'
    }));

    // Keširaj samo če ima podatke
    if (extremes.length > 0) {
      STORE[yearKey] = extremes;
    }

    const dayData = filterDay(extremes, date);
    return res.status(200).json({ 
      extremes: dayData, 
      date, 
      cached: false, 
      total: extremes.length,
      msg: extremes.length === 0 ? 'Stormglass kvota verjetno prekoračena — poskusi jutri' : 'OK'
    });

  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
