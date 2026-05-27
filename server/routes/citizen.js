/**
 * HYDROSENSE — Citizen Module API
 * Public environmental data, discussions, volunteer events,
 * citizen observations, and personal achievements.
 */
const express = require('express');
const { getDb } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { notifyRoles } = require('../utils/notify');

const router = express.Router();

/* ─────────────────────────────────────────────────────────────
   PUBLIC ENVIRONMENTAL DASHBOARD (no auth needed)
───────────────────────────────────────────────────────────── */
router.get('/dashboard', async (req, res) => {
  const db = await getDb();
  try {
    const totalWP = (await db.prepare(`SELECT COUNT(*) as c FROM water_points`).get()).c;
    const funcWP = (await db.prepare(`SELECT COUNT(*) as c FROM water_points WHERE status='functional'`).get()).c;
    const activeAlerts = (await db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE status='active'`).get()).c;
    const critAlerts = (await db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE status='active' AND severity IN ('critical','emergency')`).get()).c;
    const recentAlerts = await db.prepare(`SELECT title, severity, district, created_at FROM alerts WHERE status='active' ORDER BY created_at DESC LIMIT 5`).all();

    const safeTests = (await db.prepare(`SELECT COUNT(*) as c FROM water_quality_tests WHERE overall_safe=1 AND tested_at > NOW() - INTERVAL '30 days'`).get()).c;
    const totalTests = (await db.prepare(`SELECT COUNT(*) as c FROM water_quality_tests WHERE tested_at > NOW() - INTERVAL '30 days'`).get()).c;
    const avgQuality = (await db.prepare(`SELECT AVG(water_safety_score) as avg FROM water_quality_tests WHERE tested_at > NOW() - INTERVAL '30 days'`).get()).avg;

    const gwnTotal = (await db.prepare(`SELECT COUNT(*) as c FROM gwn_reports`).get()).c;
    const gwnToday = (await db.prepare(`SELECT COUNT(*) as c FROM gwn_reports WHERE created_at::date = CURRENT_DATE`).get()).c;
    const gwnCritical = (await db.prepare(`SELECT COUNT(*) as c FROM gwn_reports WHERE severity='critical' AND status != 'resolved'`).get()).c;
    const gwnRecent = await db.prepare(`SELECT report_type, severity, district, description, created_at FROM gwn_reports ORDER BY created_at DESC LIMIT 6`).all();

    const drought = await db.prepare(`SELECT severity, COUNT(*) as c FROM drought_index GROUP BY severity ORDER BY c DESC LIMIT 3`).all();
    const rainfall = await db.prepare(`SELECT AVG(rainfall_mm) as avg, MAX(rainfall_mm) as max FROM climate_readings WHERE timestamp > NOW() - INTERVAL '7 days'`).get();
    const tempAvg = await db.prepare(`SELECT AVG(temperature_max) as avg FROM climate_readings WHERE timestamp > NOW() - INTERVAL '7 days'`).get();

    const totalBene = (await db.prepare(`SELECT SUM(beneficiaries) as t FROM water_points WHERE status='functional'`).get()).t || 0;
    const districts = await db.prepare(`SELECT district, COUNT(*) as total, SUM(CASE WHEN status='functional' THEN 1 ELSE 0 END) as func FROM water_points GROUP BY district ORDER BY district`).all();

    res.json({
      success: true,
      data: {
        water: {
          total_points: totalWP, functional: funcWP,
          functionality_pct: totalWP ? Math.round(funcWP / totalWP * 100) : 0,
          beneficiaries: totalBene,
          quality_score: Math.round(avgQuality || 0),
          safe_tests_pct: totalTests ? Math.round(safeTests / totalTests * 100) : 0,
          districts
        },
        alerts: { total: activeAlerts, critical: critAlerts, recent: recentAlerts },
        gwn: { total: gwnTotal, today: gwnToday, critical: gwnCritical, recent: gwnRecent },
        climate: {
          drought_breakdown: drought,
          avg_rainfall_7d: Math.round((rainfall?.avg || 0) * 10) / 10,
          max_rainfall_7d: Math.round((rainfall?.max || 0) * 10) / 10,
          avg_temp_7d: Math.round((tempAvg?.avg || 0) * 10) / 10
        }
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   DISCUSSIONS (auth required)
───────────────────────────────────────────────────────────── */
router.get('/discussions', authMiddleware, async (req, res) => {
  const db = await getDb();
  const { category, limit = 20, offset = 0 } = req.query;
  let sql = `SELECT d.*, u.avatar as user_avatar,
    EXISTS(SELECT 1 FROM discussion_likes WHERE discussion_id=d.id AND user_id=?) as i_liked
    FROM citizen_discussions d LEFT JOIN users u ON d.user_id=u.id WHERE 1=1`;
  const params = [req.user.id];
  if (category && category !== 'all') {sql += ' AND d.category=?';params.push(category);}
  sql += ` ORDER BY d.pinned DESC, d.created_at DESC LIMIT ${+limit} OFFSET ${+offset}`;
  const rows = await db.prepare(sql).all(...params);
  const total = (await db.prepare(`SELECT COUNT(*) as c FROM citizen_discussions${category && category !== 'all' ? ' WHERE category=?' : ''}`).get(...(category && category !== 'all' ? [category] : []))).c;
  res.json({ success: true, data: rows, total });
});

router.post('/discussions', authMiddleware, async (req, res) => {
  const db = await getDb();
  const { title, content, category = 'general', media_url = null, media_type = null, link_url = null } = req.body;
  if (!title?.trim() || (!content?.trim() && !media_url)) return res.status(400).json({ success: false, error: 'Title and content (or a media attachment) required' });
  const VALID_CATS = ['general', 'water_quality', 'pollution', 'climate', 'health', 'events', 'governance'];
  if (!VALID_CATS.includes(category)) return res.status(400).json({ success: false, error: 'Invalid category' });
  // Only non-citizen roles may attach a link
  const canPostLink = req.user.role !== 'citizen';
  const safeLink = canPostLink && link_url?.trim() ? link_url.trim() : null;
  const r = await db.prepare(`INSERT INTO citizen_discussions (user_id, author_name, title, content, category, media_url, media_type, link_url) VALUES (?,?,?,?,?,?,?,?)`).run(req.user.id, req.user.name, title.trim(), content.trim() || '', category, media_url || null, media_type || null, safeLink);

  // Notify roles that care about this category
  const CAT_ROLES = {
    water_quality: ['health_officer', 'district_officer', 'citizen', 'community_committee', 'ngo_officer'],
    pollution:     ['health_officer', 'climate_scientist', 'district_officer', 'citizen', 'ngo_officer'],
    climate:       ['climate_scientist', 'district_officer', 'citizen'],
    health:        ['health_officer', 'district_officer', 'citizen', 'community_committee'],
    events:        ['citizen', 'community_committee', 'ngo_officer', 'district_officer'],
    governance:    ['district_officer', 'national_admin', 'community_committee'],
    general:       ['citizen', 'community_committee', 'ngo_officer'],
  };
  const roles = CAT_ROLES[category] || ['citizen', 'community_committee'];
  notifyRoles(
    roles, req.user.district || null,
    `New discussion: ${title.trim().slice(0, 60)}`,
    `${req.user.name} posted in ${category.replace(/_/g, ' ')}: "${title.trim().slice(0, 80)}"`,
    'discussion', r.lastInsertRowid
  );

  res.status(201).json({ success: true, id: r.lastInsertRowid });
});

router.post('/discussions/:id/like', authMiddleware, async (req, res) => {
  const db = await getDb();
  const did = +req.params.id;
  const existing = await db.prepare(`SELECT 1 FROM discussion_likes WHERE discussion_id=? AND user_id=?`).get(did, req.user.id);
  if (existing) {
    await db.prepare(`DELETE FROM discussion_likes WHERE discussion_id=? AND user_id=?`).run(did, req.user.id);
    await db.prepare(`UPDATE citizen_discussions SET like_count=MAX(0,like_count-1) WHERE id=?`).run(did);
    res.json({ success: true, liked: false });
  } else {
    await db.prepare(`INSERT INTO discussion_likes (discussion_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING`).run(did, req.user.id);
    await db.prepare(`UPDATE citizen_discussions SET like_count=like_count+1 WHERE id=?`).run(did);
    res.json({ success: true, liked: true });
  }
});

router.get('/discussions/:id/replies', authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = await db.prepare(`SELECT r.*, u.avatar as user_avatar FROM citizen_replies r LEFT JOIN users u ON r.user_id=u.id WHERE r.discussion_id=? ORDER BY r.created_at ASC`).all(req.params.id);
  res.json({ success: true, data: rows });
});

// Roles that can delete anyone's forum content (in addition to the original poster)
const FORUM_ADMINS = ['national_admin', 'district_officer', 'community_committee'];

router.delete('/discussions/:id', authMiddleware, async (req, res) => {
  const db = await getDb();
  const disc = await db.prepare(`SELECT user_id FROM citizen_discussions WHERE id=?`).get(req.params.id);
  if (!disc) return res.status(404).json({ success: false, error: 'Not found' });
  if (disc.user_id !== req.user.id && !FORUM_ADMINS.includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Only the author or an admin can delete this' });
  }
  await db.prepare(`DELETE FROM citizen_discussions WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

router.delete('/discussions/:id/replies/:replyId', authMiddleware, async (req, res) => {
  const db = await getDb();
  const reply = await db.prepare(`SELECT user_id FROM citizen_replies WHERE id=? AND discussion_id=?`).get(req.params.replyId, req.params.id);
  if (!reply) return res.status(404).json({ success: false, error: 'Not found' });
  if (reply.user_id !== req.user.id && !FORUM_ADMINS.includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Only the author or an admin can delete this' });
  }
  await db.prepare(`DELETE FROM citizen_replies WHERE id=?`).run(req.params.replyId);
  await db.prepare(`UPDATE citizen_discussions SET reply_count=GREATEST(0, reply_count-1) WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

router.post('/discussions/:id/replies', authMiddleware, async (req, res) => {
  const db = await getDb();
  const { content, media_url = null, media_type = null } = req.body;
  if (!content?.trim() && !media_url) return res.status(400).json({ success: false, error: 'Reply content or media required' });
  const did = +req.params.id;
  await db.prepare(`INSERT INTO citizen_replies (discussion_id, user_id, author_name, content, media_url, media_type) VALUES (?,?,?,?,?,?)`).run(did, req.user.id, req.user.name, content.trim(), media_url || null, media_type || null);
  await db.prepare(`UPDATE citizen_discussions SET reply_count=reply_count+1 WHERE id=?`).run(did);

  // Notify the discussion author (if not the same person replying)
  const disc = await db.prepare(`SELECT user_id, author_name, title, district FROM citizen_discussions WHERE id=?`).get(did);
  if (disc && disc.user_id !== req.user.id) {
    const author = await db.prepare(`SELECT role FROM users WHERE id=?`).get(disc.user_id);
    if (author) {
      // Insert a personal notification for the discussion author
      await db.prepare(
        `INSERT INTO notification_log (recipient_type, recipient_id, channel, subject, message, status, reference_type, reference_id, district)
         VALUES (?, ?, 'in_app', ?, ?, 'sent', 'discussion', ?, ?)`
      ).run(
        author.role, disc.user_id,
        `New reply on your discussion`,
        `${req.user.name} replied to your post "${disc.title.slice(0, 60)}": "${content.trim().slice(0, 100)}"`,
        did, disc.district || null
      );
    }
  }

  res.status(201).json({ success: true });
});

/* ─────────────────────────────────────────────────────────────
   VOLUNTEER EVENTS (auth required)
───────────────────────────────────────────────────────────── */
router.get('/events', authMiddleware, async (req, res) => {
  const db = await getDb();
  const { district } = req.query;
  let sql = `SELECT e.*,
    (SELECT COUNT(*) FROM event_registrations WHERE event_id=e.id) as registered_count,
    EXISTS(SELECT 1 FROM event_registrations WHERE event_id=e.id AND user_id=?) as i_joined
    FROM volunteer_events e WHERE e.status='active'`;
  const params = [req.user.id];
  if (district) {sql += ' AND e.district=?';params.push(district);}
  sql += ' ORDER BY e.event_date ASC';
  const rows = await db.prepare(sql).all(...params);
  res.json({ success: true, data: rows });
});

router.post('/events', authMiddleware, async (req, res) => {
  const db = await getDb();
  const ALLOWED = ['national_admin', 'district_officer', 'ngo_officer', 'community_committee'];
  if (!ALLOWED.includes(req.user.role)) return res.status(403).json({ success: false, error: 'Only admins and NGOs can create events' });
  const { title, description, location, district, event_date, event_time, event_type = 'cleanup', max_volunteers = 50, event_mode = 'physical', event_link = null } = req.body;
  if (!title || !event_date) return res.status(400).json({ success: false, error: 'Title and date required' });
  if (event_mode === 'online' && !event_link?.trim()) {
    return res.status(400).json({ success: false, error: 'A meeting link is required for online events' });
  }
  const linkLower = (event_link || '').toLowerCase();
  const onlineCap =
    /meet\.google\.com/.test(linkLower) ? 100 :
    /zoom\.us/.test(linkLower)           ? 100 :
    /teams\.microsoft\.com|teams\.live\.com/.test(linkLower) ? 100 : 100;
  const maxCap = event_mode === 'online' ? onlineCap : 1000;
  const safeMax = Math.min(+max_volunteers || 50, maxCap);
  const safeLink = event_mode === 'online' ? (event_link?.trim() || null) : null;
  const r = await db.prepare(`INSERT INTO volunteer_events (title, description, location, district, event_date, event_time, event_type, max_volunteers, created_by, event_mode, event_link) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(title, description, location, district, event_date, event_time, event_type, safeMax, req.user.id, event_mode, safeLink);
  const eid = r.lastInsertRowid;

  // Notify all community-relevant roles about the new event
  const dateLabel = event_date + (event_time ? ` at ${event_time}` : '');
  const locationLabel = event_mode === 'online' ? ' (online)' : (location ? ` at ${location}` : '');
  notifyRoles(
    ['citizen', 'community_committee', 'ngo_officer', 'district_officer', 'national_admin'],
    district || null,
    `📅 New Event: ${title}`,
    `${req.user.name} has scheduled a ${event_type.replace(/_/g, ' ')} event on ${dateLabel}${locationLabel}${district ? ` in ${district}` : ''}. Join now!`,
    'volunteer_event', eid
  );

  // Auto-post a forum thread for online events with the meeting link
  if (event_mode === 'online' && safeLink) {
    const body = `📅 *${title}* — an online ${event_type.replace(/_/g,' ')} event on ${dateLabel}${district ? ` in ${district}` : ''}.\n\nJoin via: ${safeLink}`;
    await db.prepare(`INSERT INTO citizen_discussions (user_id, author_name, title, content, category, link_url) VALUES (?,?,?,?,?,?)`)
      .run(req.user.id, req.user.name, `🌐 Online Event: ${title}`, body, 'events', safeLink);
  }

  res.status(201).json({ success: true, id: eid });
});

router.post('/events/:id/join', authMiddleware, async (req, res) => {
  const db = await getDb();
  const eid = +req.params.id;
  const ev = await db.prepare(`SELECT * FROM volunteer_events WHERE id=? AND status='active'`).get(eid);
  if (!ev) return res.status(404).json({ success: false, error: 'Event not found' });
  const count = (await db.prepare(`SELECT COUNT(*) as c FROM event_registrations WHERE event_id=?`).get(eid)).c;
  if (count >= ev.max_volunteers) return res.status(400).json({ success: false, error: 'Event is full' });
  await db.prepare(`INSERT INTO event_registrations (event_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING`).run(eid, req.user.id);

  // Personal confirmation notification for the person who joined
  const dateLabel = ev.event_date + (ev.event_time ? ` at ${ev.event_time}` : '');
  await db.prepare(
    `INSERT INTO notification_log (recipient_type, recipient_id, channel, subject, message, status, reference_type, reference_id, district)
     VALUES (?, ?, 'in_app', ?, ?, 'sent', 'volunteer_event', ?, ?)`
  ).run(
    req.user.role, req.user.id,
    `Registered: ${ev.title}`,
    `You're registered for "${ev.title}" on ${dateLabel}${ev.location ? ` at ${ev.location}` : ''}. See you there!`,
    eid, ev.district || null
  );

  res.json({ success: true, message: 'You have joined this event!' });
});

router.delete('/events/:id/leave', authMiddleware, async (req, res) => {
  const db = await getDb();
  await db.prepare(`DELETE FROM event_registrations WHERE event_id=? AND user_id=?`).run(+req.params.id, req.user.id);
  res.json({ success: true, message: 'You have left this event.' });
});

/* ─────────────────────────────────────────────────────────────
   CITIZEN OBSERVATIONS (auth required)
───────────────────────────────────────────────────────────── */
// Ensure media + link columns exist on discussions and replies (fire-and-forget)
getDb().exec(`ALTER TABLE citizen_discussions ADD COLUMN media_url TEXT`).catch(() => {});
getDb().exec(`ALTER TABLE citizen_discussions ADD COLUMN media_type TEXT`).catch(() => {});
getDb().exec(`ALTER TABLE citizen_discussions ADD COLUMN link_url TEXT`).catch(() => {});
getDb().exec(`ALTER TABLE citizen_replies ADD COLUMN media_url TEXT`).catch(() => {});
getDb().exec(`ALTER TABLE citizen_replies ADD COLUMN media_type TEXT`).catch(() => {});
// Ensure event mode + link columns exist on volunteer_events (fire-and-forget)
getDb().exec(`ALTER TABLE volunteer_events ADD COLUMN event_mode TEXT DEFAULT 'physical'`).catch(() => {});
getDb().exec(`ALTER TABLE volunteer_events ADD COLUMN event_link TEXT`).catch(() => {});

// Ensure status column exists (fire-and-forget migrations)
getDb().exec(`ALTER TABLE citizen_observations ADD COLUMN status TEXT DEFAULT 'new'`).catch(() => {});
getDb().exec(`ALTER TABLE citizen_observations ADD COLUMN reviewed_by TEXT`).catch(() => {});
getDb().exec(`ALTER TABLE citizen_observations ADD COLUMN review_note TEXT`).catch(() => {});

// GET /observations — role-filtered list for staff; own observations for citizens
router.get('/observations', authMiddleware, async (req, res) => {
  const db = await getDb();
  const { status, district: qDistrict, observation_type, limit = 100 } = req.query;
  const role = req.user.role;
  const userDistrict = req.user.district;

  let sql = `SELECT * FROM citizen_observations WHERE 1=1`;
  const params = [];

  // Citizens only see their own submissions
  if (role === 'citizen') {
    sql += ' AND user_id = ?'; params.push(req.user.id);
  } else if (role !== 'national_admin') {
    // District-scoped roles only see their district (unless a filter overrides)
    const d = qDistrict || userDistrict;
    if (d) { sql += ' AND district = ?'; params.push(d); }
  } else if (qDistrict) {
    sql += ' AND district = ?'; params.push(qDistrict);
  }

  if (status)           { sql += ' AND status = ?';           params.push(status); }
  if (observation_type) { sql += ' AND observation_type = ?'; params.push(observation_type); }

  sql += ` ORDER BY created_at DESC LIMIT ${parseInt(limit)}`;
  const rows = await db.prepare(sql).all(...params);
  res.json({ success: true, data: rows, total: rows.length });
});

// POST /observations — submit new observation + notify staff
router.post('/observations', authMiddleware, async (req, res) => {
  const db = await getDb();
  const { observation_type, district, location, description, value, unit, lat, lng, photo_base64 } = req.body;
  if (!observation_type || !description) return res.status(400).json({ success: false, error: 'Type and description required' });

  const r = await db.prepare(
    `INSERT INTO citizen_observations (user_id, author_name, observation_type, district, location, description, value, unit, lat, lng, photo_base64, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'new')`
  ).run(req.user.id, req.user.name, observation_type, district, location, description, value, unit, lat, lng, photo_base64 || null);

  // Determine which roles to notify based on observation type
  const obsLower = (observation_type || '').toLowerCase();
  const roles = ['district_officer'];
  if (/fish|health|disease|dead|contamin|algae/.test(obsLower)) roles.push('health_officer');
  if (/flood|overflow|climate|discharge|industrial/.test(obsLower)) roles.push('climate_scientist');
  if (/dump|illegal|oil|pollution/.test(obsLower)) roles.push('ngo_officer');

  try {
    notifyRoles(
      [...new Set(roles)], district,
      `New environmental observation: ${observation_type}`,
      `${req.user.name} reported a ${observation_type} in ${district}${location ? ' (' + location + ')' : ''}. Review required.`,
      'citizen_observation', r.lastInsertRowid
    );
  } catch {}

  res.status(201).json({ success: true, id: r.lastInsertRowid, message: 'Observation submitted. Relevant officers have been notified.' });
});

// PATCH /observations/:id/status — staff review action
router.patch('/observations/:id/status', authMiddleware, async (req, res) => {
  const db = await getDb();
  const { status, review_note } = req.body;
  const valid = ['new', 'under_review', 'resolved', 'escalated'];
  if (!valid.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
  await db.prepare(
    `UPDATE citizen_observations SET status=?, reviewed_by=?, review_note=? WHERE id=?`
  ).run(status, req.user.name, review_note || null, req.params.id);
  res.json({ success: true });
});

/* ─────────────────────────────────────────────────────────────
   PERSONAL ACHIEVEMENTS & STATS (auth required)
───────────────────────────────────────────────────────────── */
router.get('/achievements', authMiddleware, async (req, res) => {
  const db = await getDb();
  const uid = req.user.id;

  const gwnCount = (await db.prepare(`SELECT COUNT(*) as c FROM gwn_reports WHERE reporter_name=?`).get(req.user.name))?.c || 0;
  const discCount = (await db.prepare(`SELECT COUNT(*) as c FROM citizen_discussions WHERE user_id=?`).get(uid))?.c || 0;
  const replyCount = (await db.prepare(`SELECT COUNT(*) as c FROM citizen_replies WHERE user_id=?`).get(uid))?.c || 0;
  const eventCount = (await db.prepare(`SELECT COUNT(*) as c FROM event_registrations WHERE user_id=?`).get(uid))?.c || 0;
  const obsCount = (await db.prepare(`SELECT COUNT(*) as c FROM citizen_observations WHERE user_id=?`).get(uid))?.c || 0;

  const badges = [];
  const b = (id, name, icon, desc, earned) => earned && badges.push({ id, name, icon, description: desc });

  b('first_report', 'First Reporter', '🚨', 'Submitted your first pollution report', gwnCount >= 1);
  b('active_reporter', 'Active Reporter', '📸', 'Submitted 5+ pollution reports', gwnCount >= 5);
  b('guardian', 'Water Guardian', '🛡️', 'Submitted 25+ pollution reports', gwnCount >= 25);
  b('hero', 'Environmental Hero', '🌟', 'Submitted 50+ pollution reports', gwnCount >= 50);
  b('first_voice', 'Community Voice', '💬', 'Started your first discussion', discCount >= 1);
  b('discusser', 'Active Discusser', '🗣️', 'Started 5+ community discussions', discCount >= 5);
  b('helper', 'Community Helper', '🤝', 'Replied to 10+ discussions', replyCount >= 10);
  b('volunteer', 'Volunteer', '💪', 'Joined a volunteer event', eventCount >= 1);
  b('dedicated', 'Dedicated Volunteer', '🎖️', 'Joined 3+ volunteer events', eventCount >= 3);
  b('scientist', 'Citizen Scientist', '🔬', 'Submitted environmental observations', obsCount >= 1);
  b('data_hero', 'Data Champion', '📊', 'Submitted 10+ environmental observations', obsCount >= 10);

  const score = gwnCount * 10 + discCount * 5 + replyCount * 2 + eventCount * 15 + obsCount * 8;
  const level = score >= 300 ? 'Expert Guardian' :
  score >= 150 ? 'Advanced Advocate' :
  score >= 60 ? 'Active Citizen' :
  score >= 20 ? 'Community Member' :
  'Newcomer';

  const myGwnReports = await db.prepare(`SELECT report_type, severity, status, district, created_at FROM gwn_reports WHERE reporter_name=? ORDER BY created_at DESC LIMIT 8`).all(req.user.name);
  const myDiscussions = await db.prepare(`SELECT id, title, category, like_count, reply_count, created_at FROM citizen_discussions WHERE user_id=? ORDER BY created_at DESC LIMIT 8`).all(uid);
  const myEvents = await db.prepare(`SELECT e.title, e.event_date, e.district, e.event_type, er.joined_at FROM event_registrations er JOIN volunteer_events e ON er.event_id=e.id WHERE er.user_id=? ORDER BY er.joined_at DESC LIMIT 6`).all(uid);

  res.json({
    success: true,
    data: {
      score, level, badges,
      stats: { gwnCount, discCount, replyCount, eventCount, obsCount },
      myGwnReports, myDiscussions, myEvents
    }
  });
});

module.exports = router;