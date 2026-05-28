const jwt = require('jsonwebtoken');

const DEFAULT_SECRET = 'uma_water_monitor_secret_2025';
const SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;
if (!process.env.JWT_SECRET) {
  console.warn('[SECURITY] JWT_SECRET env var is not set — using insecure default. Set JWT_SECRET in production!');
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    next();
  };
}

// Verifies the requesting user is either a system admin or an active member of the
// specific committee identified by req.params.id. Prevents community_committee users
// from accessing committees outside their membership — the core isolation boundary.
function requireCommitteeAccess() {
  return async (req, res, next) => {
    const userRole = req.user?.role;
    if (['national_admin', 'district_officer'].includes(userRole)) return next();

    const committeeId = req.params.id || req.params.committeeId;
    if (!committeeId) return next();

    try {
      const { getDb } = require('../db');
      const db = getDb();
      const membership = await db.prepare(
        `SELECT id FROM committee_members WHERE committee_id = $1 AND user_id = $2 AND status = 'active'`
      ).get(committeeId, req.user.id);
      if (!membership) {
        return res.status(403).json({ success: false, error: 'Access restricted: not a member of this committee' });
      }
      next();
    } catch (err) {
      console.error('[requireCommitteeAccess]', err);
      res.status(500).json({ success: false, error: 'Access check failed' });
    }
  };
}

// Writes an entry to committee_audit_log for every cross-system or sensitive action.
// Every entry records: actor, role, action, resource, committee, jurisdiction, timestamp.
async function auditLog(req, action, resourceType, resourceId, committeeId, crossSystem = false, details = null) {
  try {
    const { getDb } = require('../db');
    const db = getDb();
    await db.prepare(`
      INSERT INTO committee_audit_log
        (actor_id, actor_role, actor_name, action, resource_type, resource_id,
         committee_id, jurisdiction, cross_system, details, ip_address)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `).run(
      req.user.id,
      req.user.role,
      req.user.name || 'Unknown',
      action,
      resourceType,
      resourceId || null,
      committeeId || null,
      req.user.district || null,
      crossSystem,
      details ? JSON.stringify(details) : null,
      req.ip || null,
    );
  } catch (err) {
    console.error('[auditLog]', err.message);
  }
}

module.exports = { authMiddleware, requireRole, requireCommitteeAccess, auditLog, SECRET };
