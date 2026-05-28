const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { authMiddleware, requireRole, requireCommitteeAccess, auditLog } = require('../middleware/auth');

// ── Role constants ────────────────────────────────────────────
const ADMIN_ROLES     = ['national_admin', 'district_officer'];
const COMMITTEE_ROLES = ['national_admin', 'district_officer', 'community_committee'];

// ── Jurisdiction scope helper ─────────────────────────────────
// Returns SQL fragment + params to restrict committee queries to the user's
// geographic jurisdiction when the caller is a community_committee member.
function jurisdictionScope(req, alias = 'c', startIndex = 1) {
  if (ADMIN_ROLES.includes(req.user.role)) return { clause: '', params: [], nextIndex: startIndex };
  if (req.user.role === 'community_committee' && req.user.district) {
    return { clause: `AND ${alias}.district = $${startIndex}`, params: [req.user.district], nextIndex: startIndex + 1 };
  }
  return { clause: '', params: [], nextIndex: startIndex };
}

// ── Stats / Dashboard ────────────────────────────────────────

router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const isAdmin = ADMIN_ROLES.includes(req.user.role);
    const districtParam = isAdmin ? [] : [req.user.district];
    const districtClause = isAdmin ? '' : `WHERE district = $1`;
    const dAnd = isAdmin ? '' : `AND district = $1`;

    const [total, active, members, meetings, incidents, projects] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as c FROM committees ${districtClause}`).get(...districtParam),
      db.prepare(`SELECT COUNT(*) as c FROM committees WHERE status='active' ${dAnd}`).get(...districtParam),
      db.prepare(`SELECT COUNT(*) as c FROM committee_members WHERE status='active'`).get(),
      db.prepare(`SELECT COUNT(*) as c FROM committee_meetings WHERE status='scheduled' AND meeting_date >= CURRENT_DATE::text`).get(),
      db.prepare(`SELECT COUNT(*) as c FROM committee_incident_assignments WHERE status NOT IN ('resolved','closed')`).get(),
      db.prepare(`SELECT COUNT(*) as c FROM committee_projects WHERE status NOT IN ('completed','cancelled')`).get(),
    ]);

    const announcements = await db.prepare(`SELECT * FROM committee_announcements ORDER BY created_at DESC LIMIT 5`).all();

    const incidentsByStatus = await db.prepare(
      `SELECT status, COUNT(*) as c FROM committee_incident_assignments GROUP BY status`
    ).all();

    const projectsByType = await db.prepare(
      `SELECT project_type, COUNT(*) as c FROM committee_projects GROUP BY project_type`
    ).all();

    const recentIncidents = await db.prepare(`
      SELECT cia.*, u.name as assigned_to_name
      FROM committee_incident_assignments cia
      LEFT JOIN users u ON u.id = cia.assigned_to
      ORDER BY cia.created_at DESC LIMIT 5
    `).all();

    const recentMeetings = await db.prepare(`
      SELECT cm.*, c.name as committee_name
      FROM committee_meetings cm
      LEFT JOIN committees c ON c.id = cm.committee_id
      ORDER BY cm.meeting_date DESC LIMIT 5
    `).all();

    res.json({
      success: true,
      data: {
        overview: {
          total_committees:  parseInt(total?.c   || 0),
          active_committees: parseInt(active?.c  || 0),
          total_members:     parseInt(members?.c || 0),
          upcoming_meetings: parseInt(meetings?.c  || 0),
          open_incidents:    parseInt(incidents?.c || 0),
          active_projects:   parseInt(projects?.c  || 0),
        },
        incidents_by_status: incidentsByStatus,
        projects_by_type:    projectsByType,
        recent_incidents:    recentIncidents,
        recent_meetings:     recentMeetings,
        announcements,
      },
    });
  } catch (err) {
    console.error('[committees/stats]', err);
    res.status(500).json({ success: false, error: 'Failed to load stats' });
  }
});

// ── My Committees — committees where the current user is an active member ──

router.get('/my-committees', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare(`
      SELECT c.*,
        cm.committee_role as my_role, cm.joined_at,
        u.name as chairperson_name,
        (SELECT COUNT(*) FROM committee_members m WHERE m.committee_id = c.id AND m.status='active') as member_count,
        (SELECT COUNT(*) FROM committee_meetings mtg WHERE mtg.committee_id = c.id
          AND mtg.status='scheduled' AND mtg.meeting_date >= CURRENT_DATE::text) as upcoming_meetings,
        (SELECT COUNT(*) FROM committee_incident_assignments cia
          WHERE cia.committee_id = c.id AND cia.status NOT IN ('resolved','closed')) as open_incidents,
        (SELECT COUNT(*) FROM committee_projects cp
          WHERE cp.committee_id = c.id AND cp.status NOT IN ('completed','cancelled')) as active_projects,
        (SELECT ca.title FROM committee_announcements ca
          WHERE ca.committee_id = c.id ORDER BY ca.created_at DESC LIMIT 1) as latest_announcement
      FROM committee_members cm
      JOIN committees c ON c.id = cm.committee_id
      LEFT JOIN users u ON u.id = c.chairperson_id
      WHERE cm.user_id = $1 AND cm.status = 'active' AND c.status = 'active'
      ORDER BY cm.joined_at DESC
    `).all(req.user.id);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[committees/my-committees]', err);
    res.status(500).json({ success: false, error: 'Failed to load your committees' });
  }
});

// ── Committees CRUD ──────────────────────────────────────────

router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { district, status, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const params = [];
    let i = 1;

    if (district) { conditions.push(`c.district = $${i++}`); params.push(district); }
    if (status)   { conditions.push(`c.status = $${i++}`);   params.push(status); }

    // Jurisdiction isolation: community_committee users see only their district
    if (req.user.role === 'community_committee' && req.user.district && !district) {
      conditions.push(`c.district = $${i++}`);
      params.push(req.user.district);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), parseInt(offset));

    const rows = await db.prepare(`
      SELECT c.*,
        u.name as chairperson_name, u.phone as chairperson_phone,
        cb.name as created_by_name,
        (SELECT COUNT(*) FROM committee_members cm WHERE cm.committee_id = c.id AND cm.status='active') as member_count,
        (SELECT COUNT(*) FROM committee_meetings mtg WHERE mtg.committee_id = c.id AND mtg.status='scheduled') as upcoming_meetings,
        (SELECT COUNT(*) FROM committee_incident_assignments cia WHERE cia.committee_id = c.id AND cia.status NOT IN ('resolved','closed')) as open_incidents
      FROM committees c
      LEFT JOIN users u ON u.id = c.chairperson_id
      LEFT JOIN users cb ON cb.id = c.created_by
      ${where}
      ORDER BY c.created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `).all(...params);

    const countWhere = where.replace(/c\./g, '');
    const total = await db.prepare(`SELECT COUNT(*) as c FROM committees ${countWhere}`)
      .get(...params.slice(0, -2));

    res.json({ success: true, data: rows, total: parseInt(total?.c || 0) });
  } catch (err) {
    console.error('[committees/list]', err);
    res.status(500).json({ success: false, error: 'Failed to list committees' });
  }
});

router.post('/', authMiddleware, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDb();
    const { name, district, sub_county, village, jurisdiction, description,
            chairperson_id, established_date, meeting_frequency } = req.body;
    if (!name || !district) return res.status(400).json({ success: false, error: 'name and district are required' });

    const result = await db.prepare(`
      INSERT INTO committees (name, district, sub_county, village, jurisdiction, description,
        chairperson_id, established_date, meeting_frequency, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
    `).run(name, district, sub_county || null, village || null, jurisdiction || null,
           description || null, chairperson_id || null, established_date || null,
           meeting_frequency || 'monthly', req.user.id);

    await auditLog(req, 'CREATE', 'committee', result.lastInsertRowid, result.lastInsertRowid, false, { name, district });
    res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    console.error('[committees/create]', err);
    res.status(500).json({ success: false, error: 'Failed to create committee' });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDb();

    // Jurisdiction boundary: community_committee may only view committees in their district
    // or committees they are a member of
    if (req.user.role === 'community_committee') {
      const c = await db.prepare(`SELECT district FROM committees WHERE id = $1`).get(req.params.id);
      if (c && c.district !== req.user.district) {
        const membership = await db.prepare(
          `SELECT id FROM committee_members WHERE committee_id=$1 AND user_id=$2 AND status='active'`
        ).get(req.params.id, req.user.id);
        if (!membership) {
          return res.status(403).json({ success: false, error: 'Access restricted to your jurisdiction' });
        }
      }
    }

    const committee = await db.prepare(`
      SELECT c.*, u.name as chairperson_name, u.phone as chairperson_phone
      FROM committees c LEFT JOIN users u ON u.id = c.chairperson_id
      WHERE c.id = $1
    `).get(req.params.id);

    if (!committee) return res.status(404).json({ success: false, error: 'Committee not found' });

    const members = await db.prepare(`
      SELECT cm.*, u.name, u.email, u.phone, u.district, u.avatar, u.role as system_role
      FROM committee_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.committee_id = $1 AND cm.status='active'
      ORDER BY cm.committee_role, u.name
    `).all(req.params.id);

    res.json({ success: true, data: { ...committee, members } });
  } catch (err) {
    console.error('[committees/get]', err);
    res.status(500).json({ success: false, error: 'Failed to get committee' });
  }
});

router.put('/:id', authMiddleware, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDb();
    const { name, district, sub_county, village, jurisdiction, description,
            chairperson_id, status, established_date, meeting_frequency } = req.body;
    await db.prepare(`
      UPDATE committees SET name=$1, district=$2, sub_county=$3, village=$4, jurisdiction=$5,
        description=$6, chairperson_id=$7, status=$8, established_date=$9,
        meeting_frequency=$10, updated_at=NOW()
      WHERE id=$11
    `).run(name, district, sub_county || null, village || null, jurisdiction || null,
           description || null, chairperson_id || null, status || 'active',
           established_date || null, meeting_frequency || 'monthly', req.params.id);

    await auditLog(req, 'UPDATE', 'committee', req.params.id, req.params.id, false);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update committee' });
  }
});

router.delete('/:id', authMiddleware, requireRole('national_admin'), async (req, res) => {
  try {
    const db = getDb();
    await db.prepare(`UPDATE committees SET status='archived', updated_at=NOW() WHERE id=$1`).run(req.params.id);
    await auditLog(req, 'ARCHIVE', 'committee', req.params.id, req.params.id, false);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to archive committee' });
  }
});

// ── Members ──────────────────────────────────────────────────

router.get('/:id/members', authMiddleware, requireCommitteeAccess(), async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare(`
      SELECT cm.*, u.name, u.email, u.phone, u.district, u.sub_county, u.avatar, u.role as system_role, u.organization
      FROM committee_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.committee_id = $1
      ORDER BY cm.committee_role, u.name
    `).all(req.params.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to list members' });
  }
});

router.post('/:id/members', authMiddleware, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDb();
    const { user_id, committee_role, languages, phone } = req.body;
    if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

    await db.prepare(`
      INSERT INTO committee_members (committee_id, user_id, committee_role, languages, phone)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (committee_id, user_id) DO UPDATE SET committee_role=$3, status='active', languages=$4, phone=$5
    `).run(req.params.id, user_id, committee_role || 'member', languages || null, phone || null);

    await db.prepare(`UPDATE committees SET updated_at=NOW() WHERE id=$1`).run(req.params.id);
    await auditLog(req, 'ADD_MEMBER', 'committee_member', user_id, req.params.id, false, { committee_role });
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('[committees/members/add]', err);
    res.status(500).json({ success: false, error: 'Failed to add member' });
  }
});

router.delete('/:id/members/:userId', authMiddleware, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDb();
    await db.prepare(
      `UPDATE committee_members SET status='inactive' WHERE committee_id=$1 AND user_id=$2`
    ).run(req.params.id, req.params.userId);
    await auditLog(req, 'REMOVE_MEMBER', 'committee_member', req.params.userId, req.params.id, false);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to remove member' });
  }
});

// ── Meetings ─────────────────────────────────────────────────

router.get('/:id/meetings', authMiddleware, requireCommitteeAccess(), async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare(`
      SELECT cm.*, u.name as created_by_name,
        (SELECT COUNT(*) FROM committee_meeting_attendees WHERE meeting_id=cm.id AND attended=1) as attendee_count
      FROM committee_meetings cm
      LEFT JOIN users u ON u.id = cm.created_by
      WHERE cm.committee_id = $1
      ORDER BY cm.meeting_date DESC, cm.meeting_time DESC
    `).all(req.params.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to list meetings' });
  }
});

router.post('/:id/meetings', authMiddleware, requireRole(...COMMITTEE_ROLES), requireCommitteeAccess(), async (req, res) => {
  try {
    const db = getDb();
    const { title, agenda, meeting_date, meeting_time, location } = req.body;
    if (!title || !meeting_date) return res.status(400).json({ success: false, error: 'title and meeting_date required' });

    const result = await db.prepare(`
      INSERT INTO committee_meetings (committee_id, title, agenda, meeting_date, meeting_time, location, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
    `).run(req.params.id, title, agenda || null, meeting_date, meeting_time || null, location || null, req.user.id);

    await auditLog(req, 'CREATE', 'meeting', result.lastInsertRowid, req.params.id, false, { title, meeting_date });
    res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    console.error('[committees/meetings/create]', err);
    res.status(500).json({ success: false, error: 'Failed to create meeting' });
  }
});

router.put('/meetings/:meetingId', authMiddleware, requireRole(...COMMITTEE_ROLES), async (req, res) => {
  try {
    const db = getDb();
    const { title, agenda, minutes, resolutions, meeting_date, meeting_time, location, status } = req.body;
    await db.prepare(`
      UPDATE committee_meetings SET title=$1, agenda=$2, minutes=$3, resolutions=$4,
        meeting_date=$5, meeting_time=$6, location=$7, status=$8, updated_at=NOW()
      WHERE id=$9
    `).run(title, agenda || null, minutes || null, resolutions || null,
           meeting_date, meeting_time || null, location || null, status || 'scheduled',
           req.params.meetingId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update meeting' });
  }
});

// ── Incident Assignments (cross-system shared module) ────────

router.get('/:id/incidents', authMiddleware, requireCommitteeAccess(), async (req, res) => {
  try {
    const db = getDb();
    const { status, priority, limit = 50, offset = 0 } = req.query;
    const conditions = [`cia.committee_id = $1`];
    const params = [req.params.id];
    let i = 2;

    if (status)   { conditions.push(`cia.status = $${i++}`);   params.push(status); }
    if (priority) { conditions.push(`cia.priority = $${i++}`); params.push(priority); }
    params.push(parseInt(limit), parseInt(offset));

    const rows = await db.prepare(`
      SELECT cia.*,
        at.name as assigned_to_name, at.phone as assigned_to_phone,
        ab.name as assigned_by_name
      FROM committee_incident_assignments cia
      LEFT JOIN users at ON at.id = cia.assigned_to
      LEFT JOIN users ab ON ab.id = cia.assigned_by
      WHERE ${conditions.join(' AND ')}
      ORDER BY CASE cia.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
               cia.created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `).all(...params);

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to list incidents' });
  }
});

router.post('/:id/incidents', authMiddleware, requireRole(...COMMITTEE_ROLES), requireCommitteeAccess(), async (req, res) => {
  try {
    const db = getDb();
    const { title, incident_type, district, description, assigned_to, priority, report_id } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'title required' });

    const result = await db.prepare(`
      INSERT INTO committee_incident_assignments
        (committee_id, report_id, title, incident_type, district, description, assigned_to, assigned_by, priority)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
    `).run(req.params.id, report_id || null, title, incident_type || 'water_quality',
           district || null, description || null, assigned_to || null, req.user.id, priority || 'medium');

    // Cross-system log: incident assignment links committee governance to core HydroSense reports
    await auditLog(req, 'ASSIGN_INCIDENT', 'incident', result.lastInsertRowid, req.params.id, !!report_id, { title, incident_type, report_id });
    res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    console.error('[committees/incidents/create]', err);
    res.status(500).json({ success: false, error: 'Failed to create incident assignment' });
  }
});

router.put('/incidents/:incidentId', authMiddleware, requireRole(...COMMITTEE_ROLES), async (req, res) => {
  try {
    const db = getDb();
    const { status, priority, notes, assigned_to, escalated, committee_id } = req.body;

    await db.prepare(`
      UPDATE committee_incident_assignments
      SET status=$1, priority=$2, notes=$3, assigned_to=$4, escalated=$5,
          resolved_at=${status === 'resolved' ? 'NOW()' : 'NULL'}, updated_at=NOW()
      WHERE id=$6
    `).run(status, priority, notes || null, assigned_to || null, escalated ? 1 : 0, req.params.incidentId);

    // Escalation is a cross-system action — always logged
    if (escalated) {
      await auditLog(req, 'ESCALATE', 'incident', req.params.incidentId, committee_id || null, true,
        { status, priority, reason: notes });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update incident' });
  }
});

// ── Projects ─────────────────────────────────────────────────

router.get('/:id/projects', authMiddleware, requireCommitteeAccess(), async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare(`
      SELECT cp.*, u.name as lead_officer_name, cb.name as created_by_name
      FROM committee_projects cp
      LEFT JOIN users u ON u.id = cp.lead_officer
      LEFT JOIN users cb ON cb.id = cp.created_by
      WHERE cp.committee_id = $1
      ORDER BY CASE cp.status WHEN 'active' THEN 1 WHEN 'planned' THEN 2 WHEN 'on_hold' THEN 3 ELSE 4 END,
               cp.created_at DESC
    `).all(req.params.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to list projects' });
  }
});

router.post('/:id/projects', authMiddleware, requireRole(...COMMITTEE_ROLES), requireCommitteeAccess(), async (req, res) => {
  try {
    const db = getDb();
    const { title, project_type, description, district, location, priority, budget, start_date, end_date, lead_officer } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'title required' });

    const result = await db.prepare(`
      INSERT INTO committee_projects
        (committee_id, title, project_type, description, district, location, priority, budget, start_date, end_date, lead_officer, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
    `).run(req.params.id, title, project_type || 'water', description || null, district || null,
           location || null, priority || 'medium', parseFloat(budget) || 0, start_date || null,
           end_date || null, lead_officer || null, req.user.id);

    await auditLog(req, 'CREATE', 'project', result.lastInsertRowid, req.params.id, false, { title, project_type });
    res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    console.error('[committees/projects/create]', err);
    res.status(500).json({ success: false, error: 'Failed to create project' });
  }
});

router.put('/projects/:projectId', authMiddleware, requireRole(...COMMITTEE_ROLES), async (req, res) => {
  try {
    const db = getDb();
    const { title, project_type, description, district, location, status, priority,
            budget, spent, progress_pct, start_date, end_date, lead_officer } = req.body;
    await db.prepare(`
      UPDATE committee_projects
      SET title=$1, project_type=$2, description=$3, district=$4, location=$5, status=$6,
          priority=$7, budget=$8, spent=$9, progress_pct=$10, start_date=$11, end_date=$12,
          lead_officer=$13, updated_at=NOW()
      WHERE id=$14
    `).run(title, project_type || 'water', description || null, district || null, location || null,
           status || 'planned', priority || 'medium', parseFloat(budget) || 0, parseFloat(spent) || 0,
           parseInt(progress_pct) || 0, start_date || null, end_date || null, lead_officer || null,
           req.params.projectId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update project' });
  }
});

// ── Announcements ────────────────────────────────────────────

router.get('/:id/announcements', authMiddleware, requireCommitteeAccess(), async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare(`
      SELECT ca.*, u.name as author_name
      FROM committee_announcements ca
      LEFT JOIN users u ON u.id = ca.created_by
      WHERE ca.committee_id = $1
      ORDER BY ca.created_at DESC LIMIT 20
    `).all(req.params.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to list announcements' });
  }
});

router.post('/:id/announcements', authMiddleware, requireRole(...COMMITTEE_ROLES), requireCommitteeAccess(), async (req, res) => {
  try {
    const db = getDb();
    const { title, content, priority } = req.body;
    if (!title || !content) return res.status(400).json({ success: false, error: 'title and content required' });

    await db.prepare(`
      INSERT INTO committee_announcements (committee_id, title, content, priority, created_by, author_name)
      VALUES ($1,$2,$3,$4,$5,$6)
    `).run(req.params.id, title, content, priority || 'normal', req.user.id, req.user.name);

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to post announcement' });
  }
});

// ── Votes (committee internal governance — not shared with core system) ──

router.get('/:id/votes', authMiddleware, requireCommitteeAccess(), async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare(`
      SELECT cv.*,
        u.name as created_by_name,
        (SELECT COUNT(*) FROM committee_vote_responses WHERE vote_id = cv.id) as total_votes,
        (SELECT COUNT(*) FROM committee_vote_responses WHERE vote_id = cv.id AND response = 'yes') as yes_count,
        (SELECT COUNT(*) FROM committee_vote_responses WHERE vote_id = cv.id AND response = 'no') as no_count,
        (SELECT COUNT(*) FROM committee_vote_responses WHERE vote_id = cv.id AND response = 'abstain') as abstain_count,
        (SELECT response FROM committee_vote_responses WHERE vote_id = cv.id AND user_id = $2) as my_response
      FROM committee_votes cv
      LEFT JOIN users u ON u.id = cv.created_by
      WHERE cv.committee_id = $1
      ORDER BY cv.created_at DESC
    `).all(req.params.id, req.user.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to list votes' });
  }
});

router.post('/:id/votes', authMiddleware, requireRole(...COMMITTEE_ROLES), requireCommitteeAccess(), async (req, res) => {
  try {
    const db = getDb();
    const { title, description, vote_type, meeting_id, closes_at } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'title required' });

    const result = await db.prepare(`
      INSERT INTO committee_votes (committee_id, meeting_id, title, description, vote_type, created_by, closes_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
    `).run(req.params.id, meeting_id || null, title, description || null,
           vote_type || 'yes_no', req.user.id, closes_at || null);

    await auditLog(req, 'CREATE', 'vote', result.lastInsertRowid, req.params.id, false, { title });
    res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to create vote' });
  }
});

router.post('/votes/:voteId/respond', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { response } = req.body;
    if (!['yes', 'no', 'abstain'].includes(response)) {
      return res.status(400).json({ success: false, error: 'response must be yes, no, or abstain' });
    }

    const vote = await db.prepare(`SELECT committee_id, status FROM committee_votes WHERE id=$1`).get(req.params.voteId);
    if (!vote) return res.status(404).json({ success: false, error: 'Vote not found' });
    if (vote.status !== 'open') return res.status(400).json({ success: false, error: 'Vote is closed' });

    // Only committee members may vote — core system users are excluded
    const membership = await db.prepare(
      `SELECT id FROM committee_members WHERE committee_id=$1 AND user_id=$2 AND status='active'`
    ).get(vote.committee_id, req.user.id);
    if (!membership && !ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Only committee members may vote' });
    }

    await db.prepare(`
      INSERT INTO committee_vote_responses (vote_id, user_id, response)
      VALUES ($1,$2,$3)
      ON CONFLICT (vote_id, user_id) DO UPDATE SET response=$3, voted_at=NOW()
    `).run(req.params.voteId, req.user.id, response);

    await auditLog(req, 'VOTE', 'vote', req.params.voteId, vote.committee_id, false, { response });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to record vote' });
  }
});

router.put('/votes/:voteId/close', authMiddleware, requireRole(...COMMITTEE_ROLES), async (req, res) => {
  try {
    const db = getDb();
    await db.prepare(`UPDATE committee_votes SET status='closed' WHERE id=$1`).run(req.params.voteId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to close vote' });
  }
});

// ── Audit Log (admin-only cross-system visibility) ───────────

router.get('/:id/audit-log', authMiddleware, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDb();
    const { limit = 50, offset = 0 } = req.query;
    const rows = await db.prepare(`
      SELECT cal.*, u.name as actor_name_full, u.role as actor_system_role
      FROM committee_audit_log cal
      LEFT JOIN users u ON u.id = cal.actor_id
      WHERE cal.committee_id = $1
      ORDER BY cal.created_at DESC
      LIMIT $2 OFFSET $3
    `).all(req.params.id, parseInt(limit), parseInt(offset));

    const total = await db.prepare(
      `SELECT COUNT(*) as c FROM committee_audit_log WHERE committee_id = $1`
    ).get(req.params.id);

    res.json({ success: true, data: rows, total: parseInt(total?.c || 0) });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load audit log' });
  }
});

// ── Available Users (admin member picker) ────────────────────

router.get('/available-users', authMiddleware, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDb();
    const { district } = req.query;
    const rows = await db.prepare(`
      SELECT id, name, email, phone, role, district, organization
      FROM users WHERE active=1 ${district ? 'AND district=$1' : ''}
      ORDER BY name
    `).all(...(district ? [district] : []));
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to list users' });
  }
});

module.exports = router;
