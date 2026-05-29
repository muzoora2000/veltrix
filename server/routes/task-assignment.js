const express = require('express');
const { getDb } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── Haversine distance (km) between two GPS coordinates ─────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return Infinity;
  const R = 6371;
  const toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Preferred roles per incident type (most appropriate first)
const ROLE_PREF = {
  water_pollution:       ['health_officer', 'technician', 'district_officer'],
  water_contamination:   ['health_officer', 'technician', 'district_officer'],
  sewage_leak:           ['technician', 'health_officer', 'district_officer'],
  sewage_overflow:       ['technician', 'health_officer', 'district_officer'],
  flooding:              ['technician', 'district_officer'],
  infrastructure_damage: ['technician', 'district_officer'],
  illegal_dumping:       ['technician', 'district_officer'],
  industrial_discharge:  ['health_officer', 'district_officer', 'technician'],
  environmental_hazard:  ['health_officer', 'technician', 'district_officer'],
};

const DEPT_MAP = {
  water_pollution:'Water Quality',    illegal_dumping:'Enforcement',
  sewage_leak:'Sanitation',           sewage_overflow:'Sanitation',
  flooding:'Emergency Response',      environmental_hazard:'Environmental Protection',
  infrastructure_damage:'Infrastructure', water_contamination:'Health & Safety',
  industrial_discharge:'Environmental Protection',
};

router.get('/', async (req, res) => {
  const db = await getDb();
  const { status, district, department, limit = 50 } = req.query;
  let sql = `SELECT ta.*, u.name as assigned_to_name, a.name as assigned_by_name, cr.incident_type, cr.description as report_description, cr.district as report_district
    FROM task_assignments ta
    LEFT JOIN users u ON ta.assigned_to = u.id
    LEFT JOIN users a ON ta.assigned_by = a.id
    LEFT JOIN citizen_reports cr ON ta.report_id = cr.id
    WHERE 1=1`;
  const params = [];

  if (req.user.role === 'citizen') {
    sql += ' AND (cr.user_id = ? OR ta.assigned_to = ?)';
    params.push(req.user.id, req.user.id);
  }
  if (status) {sql += ' AND ta.status = ?';params.push(status);}
  if (district) {sql += ' AND ta.district = ?';params.push(district);}
  if (department) {sql += ' AND ta.department = ?';params.push(department);}

  sql += ` ORDER BY ta.created_at DESC LIMIT ${+limit}`;
  res.json({ success: true, data: await db.prepare(sql).all(...params) });
});

router.get('/my-tasks', async (req, res) => {
  const db = await getDb();
  const tasks = await db.prepare(`
    SELECT ta.*, u.name as assigned_by_name, cr.incident_type, cr.description as report_description, cr.district as report_district, cr.severity
    FROM task_assignments ta
    LEFT JOIN users u ON ta.assigned_by = u.id
    LEFT JOIN citizen_reports cr ON ta.report_id = cr.id
    WHERE ta.assigned_to = ?
    ORDER BY CASE ta.priority WHEN 'emergency' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, ta.created_at DESC
  `).all(req.user.id);
  res.json({ success: true, data: tasks });
});

// ── Exported core: can be called programmatically from other routes ──────────
async function haversineAutoAssign(db, report_id, incident_id, assignedById) {

  // ── 1. Load source record ────────────────────────────────────────────
  const report   = report_id   ? await db.prepare('SELECT * FROM citizen_reports WHERE id = ?').get(report_id)   : null;
  const incident = incident_id ? await db.prepare('SELECT * FROM env_incidents   WHERE id = ?').get(incident_id) : null;

  const district     = report?.district     || incident?.district;
  const incidentType = report?.incident_type || incident?.incident_type || 'general';
  const rawSeverity  = report?.severity      || incident?.severity      || 'medium';
  const priority     = { emergency:'emergency', critical:'high', high:'high', medium:'medium', low:'low' }[rawSeverity] || 'medium';
  const dueHours     = { emergency:2, high:6, medium:24, low:72 }[priority] || 24;
  const dueBy        = new Date(Date.now() + dueHours * 3600_000).toISOString();

  if (!district) throw new Error('Cannot determine district for this incident');

  // ── 2. Incident GPS ──────────────────────────────────────────────────
  // Use citizen GPS if provided; fall back to the centroid of water points
  // in the affected district so distance scoring still works.
  let incLat = report?.lat ?? null;
  let incLng = report?.lng ?? null;
  let locSource = 'citizen_gps';

  if (!incLat || !incLng) {
    const centre = await db.prepare(`
      SELECT AVG(lat) AS lat, AVG(lng) AS lng
      FROM water_points WHERE district = ? AND lat IS NOT NULL AND lng IS NOT NULL
    `).get(district);
    incLat = centre?.lat ?? null;
    incLng = centre?.lng ?? null;
    locSource = incLat ? 'district_centroid' : 'none';
  }

  // ── 3. Candidate staff in the district ──────────────────────────────
  const candidates = await db.prepare(`
    SELECT u.id, u.name, u.role, u.sub_county,
           COUNT(CASE WHEN ta.status IN ('assigned','in_progress') THEN 1 END) AS open_tasks
    FROM   users u
    LEFT   JOIN task_assignments ta ON ta.assigned_to = u.id
    WHERE  u.district = ?
      AND  u.role IN ('technician','health_officer','district_officer')
      AND  u.active = 1
    GROUP  BY u.id, u.name, u.role, u.sub_county
    ORDER  BY open_tasks ASC, u.last_login DESC
  `).all(district);

  if (!candidates.length)
    throw new Error(`No available staff found in ${district}`);

  // ── 4. Score each candidate by proximity + workload + role fit ───────
  const preferredRoles = ROLE_PREF[incidentType] || ['technician','health_officer','district_officer'];

  let chosen = null;
  let distKm  = null;
  let proximityUsed = false;

  if (incLat && incLng) {
    // For each candidate: estimate their location as the centroid of water points
    // in their sub_county (or district if sub_county is unknown).
    // This is the best approximation without storing GPS per user.
    const scored = await Promise.all(candidates.map(async c => {
      const anchor = await db.prepare(`
        SELECT AVG(lat) AS lat, AVG(lng) AS lng
        FROM water_points
        WHERE district = ? ${c.sub_county ? 'AND sub_county = ?' : ''}
          AND lat IS NOT NULL AND lng IS NOT NULL
      `).get(...(c.sub_county ? [district, c.sub_county] : [district]));

      // Fall back to incident location if the technician's area has no water points
      const techLat = anchor?.lat ?? incLat;
      const techLng = anchor?.lng ?? incLng;
      const dist    = haversineKm(incLat, incLng, techLat, techLng);

      // Role preference bonus: each rank beyond the ideal costs 3 km
      const rolePenalty = preferredRoles.includes(c.role)
        ? preferredRoles.indexOf(c.role) * 3
        : 20; // non-preferred role penalised 20 km

      // Each open task costs 5 km — avoid overloading busy technicians
      const score = dist + (Number(c.open_tasks) * 5) + rolePenalty;
      return { ...c, dist_km: parseFloat(dist.toFixed(2)), score };
    }));

    scored.sort((a, b) => a.score - b.score);
    chosen = scored[0];
    distKm = chosen.dist_km;
    proximityUsed = true;
  } else {
    // No GPS at all — use role preference + least loaded
    chosen = [...candidates].sort((a, b) => {
      const ra = preferredRoles.indexOf(a.role) < 0 ? 99 : preferredRoles.indexOf(a.role);
      const rb = preferredRoles.indexOf(b.role) < 0 ? 99 : preferredRoles.indexOf(b.role);
      return (ra * 10 + Number(a.open_tasks)) - (rb * 10 + Number(b.open_tasks));
    })[0];
  }

  // ── 5. Insert task assignment ────────────────────────────────────────
  const distanceNote = distKm !== null
    ? ` | Nearest available — ${distKm} km from incident`
    : ' | Assigned by role fit + workload (no GPS)';

  const result = await db.prepare(`
    INSERT INTO task_assignments
      (report_id, incident_id, assigned_to, assigned_by,
       task_type, priority, status, department,
       district, sub_county, description, location, due_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    report_id || null, incident_id || null,
    chosen.id, req.user.id,
    `${incidentType.replace(/_/g,' ')} response`, priority, 'assigned',
    DEPT_MAP[incidentType] || 'General',
    district,
    report?.sub_county || incident?.sub_county || null,
    `${report?.description || incident?.description || 'Investigate and respond to incident'}${distanceNote}`,
    report?.village || report?.sub_county || district,
    dueBy
  );

  // ── 6. Update report status + tracking ──────────────────────────────
  if (report_id) {
    await db.prepare(`UPDATE citizen_reports SET status='assigned', updated_at=NOW() WHERE id=?`).run(report_id);
    await db.prepare(`
      INSERT INTO citizen_report_tracking (report_id, status, note, updated_by)
      VALUES (?, 'assigned', ?, ?)
    `).run(
      report_id,
      `Assigned to ${chosen.name} (${chosen.role.replace(/_/g,' ')})${distKm !== null ? ` — ${distKm} km from incident` : ', district team'}`,
      req.user.id
    );
  }

  // ── 7. Notify assigned technician immediately ────────────────────────
  await db.prepare(`
    INSERT INTO notification_log
      (recipient_type, recipient_id, channel, subject, message, status, reference_type, reference_id, district)
    VALUES ('technician', ?, 'in_app', ?, ?, 'sent', 'task_assignment', ?, ?)
  `).run(
    chosen.id,
    `🔧 Task Assigned: ${incidentType.replace(/_/g,' ')} in ${district}`,
    `You have been assigned a ${priority.toUpperCase()} priority task: ${incidentType.replace(/_/g,' ')} in ${district}` +
      (report?.sub_county ? `, ${report.sub_county}` : '') +
      (distKm !== null ? `. You are the nearest available staff (${distKm} km away).` : '.') +
      ` Due: ${new Date(dueBy).toLocaleDateString('en-UG')}.`,
    result.lastInsertRowid, district
  );

  // ── 8. Create response ticket ────────────────────────────────────────
  const ticketNum = `TKT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
  await db.prepare(`
    INSERT INTO response_tickets
      (report_id, incident_id, ticket_number, title, description, priority, status, assigned_team, district, location, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    report_id || null, incident_id || null, ticketNum,
    `${incidentType.replace(/_/g,' ')} Response — ${district}`,
    `Assigned to ${chosen.name}${distKm !== null ? ` (${distKm} km from incident)` : ' (district team)'}`,
    priority, 'open', chosen.name, district,
    report?.village || report?.sub_county || district, assignedById
  );

  console.log(`[AUTO-ASSIGN] ${ticketNum} → ${chosen.name} (${chosen.role}), ${distKm !== null ? distKm + ' km' : 'no GPS'}, open_tasks:${chosen.open_tasks}, priority:${priority}, source:${locSource}`);

  return {
    success: true,
    id: result.lastInsertRowid,
    ticket: ticketNum,
    assigned_to: { id: chosen.id, name: chosen.name, role: chosen.role },
    distance_km: distKm,
    proximity_used: proximityUsed,
    location_source: locSource,
    priority,
    due_by: dueBy,
    message: distKm !== null
      ? `Task assigned to ${chosen.name} — nearest available staff, ${distKm} km from incident. Ticket: ${ticketNum}`
      : `Task assigned to ${chosen.name} (district team — no GPS available). Ticket: ${ticketNum}`,
  };
}

// ── HTTP route wraps the core function ───────────────────────────────────────
router.post('/auto-assign', requireRole('national_admin', 'district_officer'), async (req, res) => {
  const db = await getDb();
  const { report_id, incident_id } = req.body;
  try {
    const result = await haversineAutoAssign(db, report_id, incident_id, req.user.id);
    res.status(201).json(result);
  } catch (err) {
    console.error('[AUTO-ASSIGN] Error:', err.message);
    res.status(500).json({ success: false, error: err.message || 'Auto-assign failed' });
  }
});

router.post('/', requireRole('national_admin', 'district_officer'), async (req, res) => {
  const db = await getDb();
  const { report_id, incident_id, assigned_to, task_type, priority, department, district, description, location, due_by } = req.body;
  if (!assigned_to || !task_type) return res.status(400).json({ success: false, error: 'assigned_to and task_type required' });

  const result = await db.prepare(`INSERT INTO task_assignments (report_id, incident_id, assigned_to, assigned_by, task_type, priority, status, department, district, description, location, due_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    report_id || null, incident_id || null, assigned_to, req.user.id,
    task_type, priority || 'medium', 'assigned', department || null,
    district || null, description || null, location || null, due_by || null
  );

  res.status(201).json({ success: true, id: result.lastInsertRowid });
});

router.put('/:id/status', async (req, res) => {
  const db = await getDb();
  const { status, notes } = req.body;
  const valid = ['assigned', 'in_progress', 'completed', 'cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });

  const completed_at = status === 'completed' ? new Date().toISOString() : null;
  await db.prepare(`UPDATE task_assignments SET status=?, notes=?, completed_at=? WHERE id=?`).run(status, notes || null, completed_at, req.params.id);

  if (status === 'completed') {
    const task = await db.prepare(`SELECT * FROM task_assignments WHERE id = ?`).get(req.params.id);
    if (task?.report_id) {
      await db.prepare(`UPDATE citizen_reports SET status = 'resolved', updated_at = NOW() WHERE id = ?`).run(task.report_id);
      await db.prepare(`INSERT INTO citizen_report_tracking (report_id, status, note, updated_by) VALUES (?, 'resolved', 'Issue resolved and task completed', ?)`).run(task.report_id, req.user.id);
    }
  }

  res.json({ success: true });
});

router.get('/stats', async (req, res) => {
  const db = await getDb();
  const total = (await db.prepare(`SELECT COUNT(*) as c FROM task_assignments`).get()).c;
  const byStatus = await db.prepare(`SELECT status, COUNT(*) as c FROM task_assignments GROUP BY status`).all();
  const byDepartment = await db.prepare(`SELECT department, COUNT(*) as c FROM task_assignments WHERE department IS NOT NULL GROUP BY department ORDER BY c DESC`).all();
  const byPriority = await db.prepare(`SELECT priority, COUNT(*) as c FROM task_assignments GROUP BY priority`).all();
  const pending = (await db.prepare(`SELECT COUNT(*) as c FROM task_assignments WHERE status IN ('assigned','in_progress')`).get()).c;
  const completed = (await db.prepare(`SELECT COUNT(*) as c FROM task_assignments WHERE status = 'completed'`).get()).c;
  res.json({ success: true, data: { total, by_status: byStatus, by_department: byDepartment, by_priority: byPriority, pending, completed } });
});

module.exports = router;
module.exports.haversineAutoAssign = haversineAutoAssign;