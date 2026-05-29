const express = require('express');
const { getDb } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/overview', async (req, res) => {
  const db = await getDb();
  const wps = await db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status='functional' THEN 1 ELSE 0 END) as functional, SUM(CASE WHEN status='non_functional' THEN 1 ELSE 0 END) as broken, SUM(beneficiaries) as beneficiaries FROM water_points").get();
  const alerts = await db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN severity='emergency' THEN 1 ELSE 0 END) as emergency, SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) as critical FROM alerts WHERE status='active'").get();
  const maintenance = await db.prepare("SELECT COUNT(*) as pending FROM maintenance_requests WHERE status NOT IN ('completed','cancelled')").get();
  const quality = await db.prepare('SELECT AVG(water_safety_score) as avg_score, SUM(CASE WHEN overall_safe=0 THEN 1 ELSE 0 END) as unsafe FROM water_quality_tests').get();
  const health = await db.prepare("SELECT SUM(cases) as cases, COUNT(*) as incidents FROM health_incidents WHERE outbreak_status IN ('outbreak','alert')").get();
  const climate = await db.prepare("SELECT COUNT(*) as districts_drought FROM drought_index WHERE severity IN ('extreme_drought','severe_drought','moderate_drought')").get();
  const coverage = wps.total > 0 ? Math.round(wps.functional / wps.total * 100) : 0;

  res.json({
    success: true,
    data: {
      water_points: { total: wps.total, functional: wps.functional, broken: wps.broken, coverage_pct: coverage, beneficiaries: wps.beneficiaries || 0 },
      alerts: { total_active: alerts.total, emergency: alerts.emergency, critical: alerts.critical },
      maintenance: { pending: maintenance.pending },
      water_quality: { avg_score: Math.round(quality.avg_score || 0), unsafe_sources: quality.unsafe },
      health: { active_cases: health.cases || 0, active_incidents: health.incidents },
      climate: { districts_in_drought: climate.districts_drought }
    }
  });
});

router.get('/water-security', async (req, res) => {
  const db = await getDb();
  const byDistrict = await db.prepare(`
    SELECT wp.district,
      COUNT(*) as total_points,
      SUM(CASE WHEN wp.status='functional' THEN 1 ELSE 0 END) as functional,
      SUM(wp.beneficiaries) as total_beneficiaries,
      AVG(wp.infrastructure_score) as avg_infra_score,
      AVG(wqt.water_safety_score) as avg_quality_score,
      rs.overall_resilience_score
    FROM water_points wp
    LEFT JOIN water_quality_tests wqt ON wp.id = wqt.water_point_id
    LEFT JOIN resilience_scores rs ON wp.district = rs.district
    GROUP BY wp.district
    ORDER BY functional DESC
  `).all();
  res.json({ success: true, data: byDistrict });
});

router.get('/trends', async (req, res) => {
  const db = await getDb();
  const { months = 6 } = req.query;
  const climateMonthly = await db.prepare(`
    SELECT TO_CHAR(timestamp::timestamptz, 'YYYY-MM') as month, district, AVG(rainfall_mm) as avg_rainfall, AVG(temperature_max) as avg_temp
    FROM climate_readings WHERE timestamp >= NOW() - INTERVAL '${parseInt(months)} months'
    GROUP BY month, district ORDER BY month
  `).all();
  const maintenanceMonthly = await db.prepare(`
    SELECT TO_CHAR(created_at::timestamptz, 'YYYY-MM') as month, COUNT(*) as requests,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
    FROM maintenance_requests WHERE created_at >= NOW() - INTERVAL '${parseInt(months)} months'
    GROUP BY month ORDER BY month
  `).all();
  const healthMonthly = await db.prepare(`
    SELECT TO_CHAR(reported_date::date, 'YYYY-MM') as month, SUM(cases) as cases, COUNT(*) as incidents
    FROM health_incidents WHERE reported_date >= NOW() - INTERVAL '${parseInt(months)} months'
    GROUP BY month ORDER BY month
  `).all();
  res.json({ success: true, data: { climate: climateMonthly, maintenance: maintenanceMonthly, health: healthMonthly } });
});

router.get('/predictions', async (req, res) => {
  const db = await getDb();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const cur = new Date().getMonth();

  // Pull real baseline metrics from DB
  const [infra, pending, droughtRow, floodRow, qualityRow] = await Promise.all([
    db.prepare(`SELECT AVG(infrastructure_score) as avg_infra, COUNT(*) as total,
      SUM(CASE WHEN status='non_functional' THEN 1 ELSE 0 END) as broken FROM water_points`).get(),
    db.prepare(`SELECT COUNT(*) as cnt FROM maintenance_requests WHERE status NOT IN ('completed','cancelled')`).get(),
    db.prepare(`SELECT COUNT(*) as severe FROM drought_index WHERE severity IN ('extreme_drought','severe_drought')`).get(),
    db.prepare(`SELECT COUNT(*) as active FROM flood_alerts WHERE status='active'`).get(),
    db.prepare(`SELECT AVG(water_safety_score) as avg_score FROM water_quality_tests`).get(),
  ]);

  const avgInfra     = parseFloat(infra?.avg_infra) || 65;
  const totalPoints  = parseInt(infra?.total) || 1;
  const brokenRatio  = (parseInt(infra?.broken) || 0) / totalPoints;
  const pendingMaint = parseInt(pending?.cnt) || 5;
  const severeD      = parseInt(droughtRow?.severe) || 0;
  const activeFlood  = parseInt(floodRow?.active) || 0;
  const qualityScore = parseFloat(qualityRow?.avg_score) || 60;

  // Uganda rainy seasons: Mar–May (long rains), Oct–Nov (short rains)
  const RAINY = new Set([2, 3, 4, 9, 10]);

  const predictions = Array.from({ length: 6 }, (_, i) => {
    const m = (cur + i) % 12;
    const rainy = RAINY.has(m);
    // Borehole failure risk: driven by actual infra score + broken ratio
    const baseFailure  = Math.round(100 - avgInfra + brokenRatio * 30);
    const boreholeRisk = Math.min(95, rainy ? baseFailure + 8 : baseFailure);
    // Drought: real severe-drought district count → probability
    const droughtBase  = Math.min(90, severeD * 5 + (rainy ? 0 : 20));
    // Flood: active flood alerts + seasonal bump
    const floodBase    = Math.min(90, activeFlood * 10 + (rainy ? 35 : 5));
    // Contamination: low quality score = higher risk; rain washes in pollutants
    const contamRisk   = qualityScore < 50 ? 'critical' : qualityScore < 70 ? 'high' : rainy ? 'moderate' : 'low';
    return {
      month: months[m],
      borehole_failure_risk_pct: boreholeRisk,
      water_demand_increase_pct: rainy ? 8 : 22,
      drought_probability_pct:   droughtBase,
      flood_probability_pct:     floodBase,
      maintenance_needed_est:    pendingMaint + (rainy ? 4 : 2),
      contamination_risk:        contamRisk,
    };
  });

  res.json({ success: true, data: predictions });
});

router.get('/climate-risk', async (req, res) => {
  const db = await getDb();
  const drought = await db.prepare('SELECT * FROM drought_index ORDER BY spi_value ASC').all();
  const flood = await db.prepare('SELECT * FROM flood_alerts ORDER BY water_level_m DESC').all();
  const resilience = await db.prepare('SELECT * FROM resilience_scores ORDER BY overall_resilience_score ASC').all();
  const high_risk_wps = await db.prepare(`
    SELECT wp.*, di.severity as drought_severity, di.spi_value
    FROM water_points wp
    JOIN drought_index di ON wp.district = di.district
    WHERE di.severity IN ('extreme_drought','severe_drought','moderate_drought')
    ORDER BY di.spi_value ASC LIMIT 20
  `).all();
  res.json({ success: true, data: { drought_index: drought, flood_alerts: flood, resilience_scores: resilience, high_risk_water_points: high_risk_wps } });
});

module.exports = router;