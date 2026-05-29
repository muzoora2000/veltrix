const express = require('express');
const { getDb } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/readings', async (req, res) => {
  const db = await getDb();
  const { district, months = 12 } = req.query;
  let sql = `SELECT * FROM climate_readings WHERE timestamp >= NOW() - INTERVAL '${parseInt(months)} months'`;
  const params = [];
  if (district) {sql += ' AND district = ?';params.push(district);}
  sql += ' ORDER BY district, timestamp';
  const data = await db.prepare(sql).all(...params);
  res.json({ success: true, data });
});

router.get('/drought-index', async (req, res) => {
  const db = await getDb();
  const data = await db.prepare('SELECT * FROM drought_index ORDER BY spi_value ASC').all();
  res.json({ success: true, data });
});

router.get('/flood-alerts', async (req, res) => {
  const db = await getDb();
  const data = await db.prepare('SELECT * FROM flood_alerts ORDER BY water_level_m DESC').all();
  res.json({ success: true, data });
});

router.get('/resilience', async (req, res) => {
  const db = await getDb();
  const data = await db.prepare('SELECT * FROM resilience_scores ORDER BY overall_resilience_score ASC').all();
  res.json({ success: true, data });
});

// Uganda long-term monthly rainfall norms (mm) — Jan through Dec
// Derived from WMO 1991-2020 climatological normals for central Uganda.
// Used as instant fallback when Open-Meteo is unreachable.
const UG_MONTHLY_NORM_MM = [46, 62, 118, 148, 125, 68, 34, 38, 88, 138, 118, 52];

function forecastFromNorms(norms, curMonth, confidence = 72) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return Array.from({ length: 6 }, (_, i) => {
    const m    = (curMonth + i) % 12;
    const mm   = norms[m];
    return {
      month:                  MONTHS[m],
      predicted_rainfall_mm:  mm,
      drought_risk:           mm < 40 ? 'high' : mm < 80 ? 'moderate' : 'low',
      flood_risk:             mm > 180 ? 'high' : mm > 100 ? 'moderate' : 'low',
      groundwater_recharge:   parseFloat((mm * 0.28).toFixed(1)),
      confidence_pct:         confidence,
    };
  });
}

router.get('/forecast', async (req, res) => {
  const { district } = req.query;
  const curMonth = new Date().getMonth();

  try {
    // Fetch 3 years of daily precipitation from Open-Meteo Archive (free, no API key).
    // Kampala, Uganda: lat 0.3476, lon 32.5825 — representative for the country centre.
    const end   = new Date(); end.setDate(end.getDate() - 2); // archive lags ~2 days
    const start = new Date(end); start.setFullYear(start.getFullYear() - 3);
    const fmt   = d => d.toISOString().slice(0, 10);

    const url = `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=0.3476&longitude=32.5825` +
      `&start_date=${fmt(start)}&end_date=${fmt(end)}` +
      `&daily=precipitation_sum&timezone=Africa%2FNairobi`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();

    // Aggregate daily values into per-year monthly totals, then average across years.
    const byYearMonth = {}; // key: 'YYYY-M'
    const dates  = json.daily?.time || [];
    const precip = json.daily?.precipitation_sum || [];

    for (let i = 0; i < dates.length; i++) {
      if (precip[i] == null) continue;
      const d   = new Date(dates[i]);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      byYearMonth[key] = (byYearMonth[key] || 0) + precip[i];
    }

    // Group totals by calendar month
    const byMonth = {};
    for (const [key, total] of Object.entries(byYearMonth)) {
      const m = parseInt(key.split('-')[1]);
      (byMonth[m] = byMonth[m] || []).push(total);
    }

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const forecast = Array.from({ length: 6 }, (_, i) => {
      const m      = (curMonth + i) % 12;
      const vals   = byMonth[m] || [];
      const avg    = vals.length
        ? vals.reduce((a, b) => a + b, 0) / vals.length
        : UG_MONTHLY_NORM_MM[m];
      const mm     = parseFloat(avg.toFixed(1));
      // Confidence grows with the number of historical years available
      const conf   = Math.min(92, 60 + vals.length * 10);
      return {
        month:                 MONTHS[m],
        predicted_rainfall_mm: mm,
        drought_risk:          mm < 40 ? 'high' : mm < 80 ? 'moderate' : 'low',
        flood_risk:            mm > 180 ? 'high' : mm > 100 ? 'moderate' : 'low',
        groundwater_recharge:  parseFloat((mm * 0.28).toFixed(1)),
        confidence_pct:        conf,
      };
    });

    res.json({
      success: true,
      district: district || 'All Districts',
      forecast,
      source: 'Open-Meteo 3-Year Historical Climate Normals',
    });
  } catch (err) {
    console.warn('[climate/forecast] Open-Meteo unavailable, using WMO norms:', err.message);
    res.json({
      success: true,
      district: district || 'All Districts',
      forecast: forecastFromNorms(UG_MONTHLY_NORM_MM, curMonth),
      source: 'WMO Uganda Climatological Normals 1991-2020 (offline)',
    });
  }
});

router.get('/summary', async (req, res) => {
  const db = await getDb();
  const droughtCritical = await db.prepare("SELECT COUNT(*) as count FROM drought_index WHERE severity IN ('extreme_drought','severe_drought')").get();
  const floodCritical = await db.prepare("SELECT COUNT(*) as count FROM flood_alerts WHERE flood_risk IN ('critical','high')").get();
  const avgRainfall = await db.prepare("SELECT AVG(rainfall_mm) as avg FROM climate_readings WHERE timestamp >= NOW() - INTERVAL '3 months'").get();
  const districtSummary = await db.prepare(`
    SELECT cr.district, AVG(cr.rainfall_mm) as avg_rainfall, MAX(cr.temperature_max) as max_temp,
      di.severity as drought_severity, di.spi_value
    FROM climate_readings cr
    LEFT JOIN drought_index di ON cr.district = di.district
    GROUP BY cr.district
    ORDER BY avg_rainfall ASC
  `).all();
  res.json({
    success: true,
    data: {
      districts_in_drought: droughtCritical.count,
      districts_flood_risk: floodCritical.count,
      avg_recent_rainfall_mm: parseFloat((avgRainfall.avg || 0).toFixed(1)),
      district_summary: districtSummary
    }
  });
});

module.exports = router;