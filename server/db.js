const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Convert SQLite-flavoured SQL to PostgreSQL
function toPostgres(sql) {
  const hadOrIgnore = /INSERT\s+OR\s+IGNORE/i.test(sql);
  let i = 0;
  let s = sql
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO')
    .replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi, 'INSERT INTO')
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'BIGSERIAL PRIMARY KEY')
    .replace(/\bAUTOINCREMENT\b/gi, '')
    .replace(/\bdatetime\('now',\s*'([^']+)'\)/gi, (_, mod) => {
      const m = mod.match(/^([+-]?\d+)\s+(\w+)$/);
      return m ? `(NOW() + INTERVAL '${m[1]} ${m[2]}')` : 'NOW()';
    })
    .replace(/\bdatetime\('now'\)/gi, 'NOW()')
    .replace(/\bdatetime\(([^)]+)\)/gi, '($1::timestamptz)')
    .replace(/\bdate\('now'\)/gi, 'CURRENT_DATE')
    .replace(/\bdate\(([^)]+)\)/gi, '($1::date)')
    .replace(/\bstrftime\('%Y-%m',\s*([^)]+)\)/gi, "TO_CHAR($1::timestamptz, 'YYYY-MM')")
    .replace(/\bJULIANDAY\(/gi, 'EXTRACT(EPOCH FROM (')
    .replace(/\?/g, () => `$${++i}`);
  if (hadOrIgnore && !/ON CONFLICT/i.test(s)) s += ' ON CONFLICT DO NOTHING';
  return s;
}

function flatArgs(args) {
  if (!args.length) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

function getDb() {
  return {
    prepare(sql) {
      return {
        async get(...args) {
          const { rows } = await pool.query(toPostgres(sql), flatArgs(args));
          return rows[0] ?? null;
        },
        async all(...args) {
          const { rows } = await pool.query(toPostgres(sql), flatArgs(args));
          return rows;
        },
        async run(...args) {
          let q = toPostgres(sql);
          if (/^\s*INSERT\s/i.test(q) && !/RETURNING/i.test(q)) q += ' RETURNING id';
          const res = await pool.query(q, flatArgs(args));
          return { lastInsertRowid: res.rows[0]?.id ?? null, changes: res.rowCount ?? 0 };
        },
      };
    },
    async exec(sql) {
      const stmts = sql.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(s => s.length > 2);
      for (const stmt of stmts) {
        try { await pool.query(toPostgres(stmt)); } catch (_) {}
      }
    },
    pragma() {},
    transaction(fn) { return fn(); },
  };
}

async function initDb() {
  const db = getDb();
  await initSchema(db);
  await runMigrations(db);
  console.log('[DB] PostgreSQL schema ready.');
}

async function initSchema(db) {
  const e = async sql => { try { await pool.query(sql); } catch (_) {} };

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      district TEXT,
      sub_county TEXT,
      phone TEXT,
      organization TEXT,
      avatar TEXT,
      national_id TEXT,
      otp_verified INTEGER DEFAULT 0,
      community_id TEXT,
      location TEXT,
      language TEXT DEFAULT 'en',
      active INTEGER DEFAULT 1,
      last_login TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS water_points (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'functional',
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      district TEXT NOT NULL,
      sub_county TEXT,
      village TEXT,
      yield_lph REAL,
      depth_m REAL,
      water_table_m REAL,
      pump_type TEXT,
      solar_powered INTEGER DEFAULT 0,
      installed_date TEXT,
      last_maintained TEXT,
      next_maintenance TEXT,
      beneficiaries INTEGER DEFAULT 0,
      households INTEGER DEFAULT 0,
      infrastructure_score INTEGER DEFAULT 80,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sensors (
      id BIGSERIAL PRIMARY KEY,
      water_point_id BIGINT REFERENCES water_points(id),
      sensor_type TEXT NOT NULL,
      sensor_name TEXT NOT NULL,
      serial_number TEXT,
      status TEXT DEFAULT 'active',
      min_threshold REAL,
      max_threshold REAL,
      unit TEXT,
      last_reading REAL,
      last_seen TIMESTAMPTZ,
      battery_level INTEGER DEFAULT 100,
      signal_strength INTEGER DEFAULT 85,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sensor_readings (
      id BIGSERIAL PRIMARY KEY,
      sensor_id BIGINT REFERENCES sensors(id),
      water_point_id BIGINT REFERENCES water_points(id),
      value REAL NOT NULL,
      unit TEXT,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_requests (
      id BIGSERIAL PRIMARY KEY,
      water_point_id BIGINT REFERENCES water_points(id),
      reported_by BIGINT REFERENCES users(id),
      assigned_to BIGINT REFERENCES users(id),
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'medium',
      issue_type TEXT NOT NULL,
      description TEXT,
      estimated_cost REAL,
      actual_cost REAL,
      spare_parts TEXT,
      resolution_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS climate_readings (
      id BIGSERIAL PRIMARY KEY,
      district TEXT NOT NULL,
      station TEXT,
      rainfall_mm REAL DEFAULT 0,
      temperature_max REAL,
      temperature_min REAL,
      humidity_pct REAL,
      wind_speed_kmh REAL,
      soil_moisture REAL,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS drought_index (
      id BIGSERIAL PRIMARY KEY,
      district TEXT NOT NULL,
      spi_value REAL,
      severity TEXT,
      groundwater_recharge REAL,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS flood_alerts (
      id BIGSERIAL PRIMARY KEY,
      district TEXT NOT NULL,
      river_name TEXT,
      water_level_m REAL,
      flood_risk TEXT,
      affected_communities TEXT,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS water_quality_tests (
      id BIGSERIAL PRIMARY KEY,
      water_point_id BIGINT REFERENCES water_points(id),
      tested_by BIGINT REFERENCES users(id),
      turbidity_ntu REAL,
      ph REAL,
      tds_ppm REAL,
      e_coli_cfu REAL,
      nitrates_ppm REAL,
      fluoride_ppm REAL,
      chlorine_residual REAL,
      temperature_c REAL,
      overall_safe INTEGER DEFAULT 1,
      water_safety_score INTEGER DEFAULT 85,
      notes TEXT,
      tested_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id BIGSERIAL PRIMARY KEY,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      water_point_id BIGINT REFERENCES water_points(id),
      district TEXT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_reports (
      id BIGSERIAL PRIMARY KEY,
      reporter_name TEXT,
      reporter_phone TEXT,
      water_point_id BIGINT REFERENCES water_points(id),
      district TEXT NOT NULL,
      sub_county TEXT,
      village TEXT,
      issue_type TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'open',
      channel TEXT DEFAULT 'app',
      lat REAL,
      lng REAL,
      assigned_to BIGINT REFERENCES users(id),
      resolution_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS health_incidents (
      id BIGSERIAL PRIMARY KEY,
      district TEXT NOT NULL,
      sub_county TEXT,
      village TEXT,
      disease_type TEXT NOT NULL,
      cases INTEGER DEFAULT 0,
      deaths INTEGER DEFAULT 0,
      hospitalizations INTEGER DEFAULT 0,
      water_source_linked INTEGER DEFAULT 0,
      water_point_id BIGINT REFERENCES water_points(id),
      lat REAL,
      lng REAL,
      outbreak_status TEXT DEFAULT 'monitoring',
      investigation_notes TEXT,
      reported_date TIMESTAMPTZ DEFAULT NOW(),
      resolved_date TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS governance_audit (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id BIGINT,
      details TEXT,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS budget_records (
      id BIGSERIAL PRIMARY KEY,
      district TEXT NOT NULL,
      project_name TEXT NOT NULL,
      project_type TEXT,
      allocated_amount REAL NOT NULL,
      spent_amount REAL DEFAULT 0,
      fiscal_year TEXT,
      funding_source TEXT,
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_funds (
      id BIGSERIAL PRIMARY KEY,
      water_point_id BIGINT REFERENCES water_points(id),
      district TEXT NOT NULL,
      balance REAL DEFAULT 0,
      monthly_target REAL DEFAULT 50000,
      total_collected REAL DEFAULT 0,
      total_spent REAL DEFAULT 0,
      last_collection TIMESTAMPTZ,
      managed_by BIGINT REFERENCES users(id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS resilience_scores (
      id BIGSERIAL PRIMARY KEY,
      district TEXT NOT NULL,
      water_access_score INTEGER DEFAULT 70,
      infrastructure_score INTEGER DEFAULT 65,
      climate_adaptation_score INTEGER DEFAULT 55,
      governance_score INTEGER DEFAULT 60,
      community_capacity_score INTEGER DEFAULT 68,
      overall_resilience_score INTEGER DEFAULT 64,
      calculated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS spare_parts (
      id BIGSERIAL PRIMARY KEY,
      part_name TEXT NOT NULL,
      category TEXT,
      quantity INTEGER DEFAULT 0,
      min_quantity INTEGER DEFAULT 5,
      unit_cost REAL,
      supplier TEXT,
      district TEXT,
      last_restocked TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gwn_reports (
      id BIGSERIAL PRIMARY KEY,
      reporter_name TEXT,
      reporter_phone TEXT,
      reporter_type TEXT DEFAULT 'citizen',
      report_type TEXT NOT NULL,
      description TEXT,
      district TEXT NOT NULL,
      sub_county TEXT,
      village TEXT,
      lat REAL,
      lng REAL,
      severity TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'submitted',
      photo_key TEXT,
      is_anonymous INTEGER DEFAULT 0,
      channel TEXT DEFAULT 'app',
      community_votes INTEGER DEFAULT 0,
      satellite_verified INTEGER DEFAULT 0,
      escalated INTEGER DEFAULT 0,
      escalation_level TEXT DEFAULT 'district',
      assigned_agency TEXT,
      resolution_notes TEXT,
      ai_score REAL,
      ai_risk TEXT,
      ai_action TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS env_incidents (
      id BIGSERIAL PRIMARY KEY,
      incident_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      district TEXT NOT NULL,
      sub_county TEXT,
      village TEXT,
      lat REAL,
      lng REAL,
      severity TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'active',
      reported_by BIGINT REFERENCES users(id),
      affected_population INTEGER DEFAULT 0,
      response_agencies TEXT,
      ai_risk_score REAL DEFAULT 0,
      satellite_evidence INTEGER DEFAULT 0,
      enforcement_actions TEXT,
      resolution_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_assignments (
      id BIGSERIAL PRIMARY KEY,
      incident_id BIGINT NOT NULL REFERENCES env_incidents(id),
      agency_name TEXT NOT NULL,
      agency_role TEXT DEFAULT 'support',
      officer_name TEXT,
      contact TEXT,
      assigned_at TIMESTAMPTZ DEFAULT NOW(),
      status TEXT DEFAULT 'active'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pollution_hotspots (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      hotspot_type TEXT DEFAULT 'mixed',
      district TEXT,
      lat REAL,
      lng REAL,
      pollution_score REAL DEFAULT 0,
      report_count INTEGER DEFAULT 0,
      dominant_type TEXT,
      risk_level TEXT DEFAULT 'medium',
      active INTEGER DEFAULT 1,
      last_updated TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      otp TEXT NOT NULL,
      purpose TEXT DEFAULT 'registration',
      expires_at TIMESTAMPTZ NOT NULL,
      used INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      blocked_until TIMESTAMPTZ,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_attempt_log (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      ip_address TEXT,
      success INTEGER DEFAULT 0,
      attempted_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_delivery_log (
      id BIGSERIAL PRIMARY KEY,
      email TEXT,
      phone TEXT,
      channel TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT DEFAULT 'sent',
      provider_message_id TEXT,
      error_message TEXT,
      sent_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS citizen_reports (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id),
      reporter_name TEXT NOT NULL,
      reporter_phone TEXT,
      reporter_email TEXT,
      incident_type TEXT NOT NULL,
      description TEXT NOT NULL,
      district TEXT NOT NULL,
      sub_county TEXT,
      village TEXT,
      lat REAL,
      lng REAL,
      severity TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'pending',
      channel TEXT NOT NULL DEFAULT 'app',
      water_impact TEXT,
      affected_population INTEGER DEFAULT 0,
      is_anonymous INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_media (
      id BIGSERIAL PRIMARY KEY,
      report_id BIGINT REFERENCES citizen_reports(id) ON DELETE CASCADE,
      media_type TEXT NOT NULL,
      file_path TEXT,
      file_data TEXT,
      mime_type TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS incident_analysis (
      id BIGSERIAL PRIMARY KEY,
      report_id BIGINT REFERENCES citizen_reports(id) ON DELETE CASCADE,
      ai_severity TEXT,
      ai_category TEXT,
      ai_urgency TEXT DEFAULT 'medium',
      ai_risk_score REAL DEFAULT 0,
      extracted_location TEXT,
      ai_summary TEXT,
      is_duplicate INTEGER DEFAULT 0,
      duplicate_of_id BIGINT,
      is_false_report INTEGER DEFAULT 0,
      confidence_score REAL DEFAULT 0,
      speech_to_text TEXT,
      image_analysis TEXT,
      response_recommendation TEXT,
      analyzed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_assignments (
      id BIGSERIAL PRIMARY KEY,
      report_id BIGINT REFERENCES citizen_reports(id) ON DELETE SET NULL,
      incident_id BIGINT REFERENCES env_incidents(id) ON DELETE SET NULL,
      assigned_to BIGINT REFERENCES users(id),
      assigned_by BIGINT REFERENCES users(id),
      task_type TEXT NOT NULL,
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'assigned',
      department TEXT,
      due_by TIMESTAMPTZ,
      description TEXT,
      location TEXT,
      district TEXT,
      sub_county TEXT,
      village TEXT,
      notes TEXT,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS response_tickets (
      id BIGSERIAL PRIMARY KEY,
      report_id BIGINT REFERENCES citizen_reports(id) ON DELETE SET NULL,
      incident_id BIGINT REFERENCES env_incidents(id) ON DELETE SET NULL,
      ticket_number TEXT UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'open',
      assigned_team TEXT,
      assigned_agency TEXT,
      district TEXT,
      location TEXT,
      lat REAL,
      lng REAL,
      response_deadline TIMESTAMPTZ,
      resolution_notes TEXT,
      created_by BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_log (
      id BIGSERIAL PRIMARY KEY,
      recipient_type TEXT NOT NULL,
      recipient_id BIGINT,
      recipient_contact TEXT,
      channel TEXT NOT NULL,
      subject TEXT,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      reference_type TEXT,
      reference_id BIGINT,
      district TEXT,
      read_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      delivered_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS citizen_report_tracking (
      id BIGSERIAL PRIMARY KEY,
      report_id BIGINT REFERENCES citizen_reports(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      note TEXT,
      updated_by BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS citizen_discussions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      like_count INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      pinned INTEGER DEFAULT 0,
      district TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS citizen_replies (
      id BIGSERIAL PRIMARY KEY,
      discussion_id BIGINT REFERENCES citizen_discussions(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discussion_likes (
      discussion_id BIGINT REFERENCES citizen_discussions(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (discussion_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discussion_views (
      discussion_id BIGINT REFERENCES citizen_discussions(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      seen_at TIMESTAMPTZ DEFAULT NOW(),
      read_at TIMESTAMPTZ,
      PRIMARY KEY (discussion_id, user_id)
    )
  `);
  await e(`ALTER TABLE discussion_views ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_events (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      district TEXT,
      event_date TEXT,
      event_time TEXT,
      event_type TEXT DEFAULT 'cleanup',
      max_volunteers INTEGER DEFAULT 50,
      created_by BIGINT REFERENCES users(id),
      status TEXT DEFAULT 'active',
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_registrations (
      event_id BIGINT REFERENCES volunteer_events(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (event_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS citizen_observations (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id),
      author_name TEXT NOT NULL,
      observation_type TEXT NOT NULL,
      district TEXT,
      location TEXT,
      description TEXT NOT NULL,
      value REAL,
      unit TEXT,
      photo_base64 TEXT,
      lat REAL,
      lng REAL,
      verified INTEGER DEFAULT 0,
      status TEXT DEFAULT 'new',
      reviewed_by TEXT,
      review_note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      user_id BIGINT REFERENCES users(id),
      role TEXT NOT NULL,
      district TEXT,
      category TEXT DEFAULT 'general',
      incident_id BIGINT,
      location_id BIGINT,
      is_multi_user INTEGER DEFAULT 0,
      participants TEXT,
      summary TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT REFERENCES ai_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      content_type TEXT DEFAULT 'text',
      file_url TEXT,
      file_type TEXT,
      file_name TEXT,
      file_size INTEGER,
      metadata TEXT,
      tokens_used INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_analytics_cache (
      id BIGSERIAL PRIMARY KEY,
      cache_key TEXT UNIQUE NOT NULL,
      data TEXT NOT NULL,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_decision_log (
      id BIGSERIAL PRIMARY KEY,
      decision_type TEXT NOT NULL,
      input_data TEXT,
      output_data TEXT,
      confidence_score REAL,
      user_id BIGINT REFERENCES users(id),
      role TEXT,
      district TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS language_corpus (
      id BIGSERIAL PRIMARY KEY,
      language TEXT NOT NULL,
      term TEXT NOT NULL,
      english_equivalent TEXT,
      frequency INTEGER DEFAULT 1,
      context TEXT,
      source TEXT DEFAULT 'report',
      first_seen TIMESTAMPTZ DEFAULT NOW(),
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(language, term)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dialect_patterns (
      id BIGSERIAL PRIMARY KEY,
      language TEXT NOT NULL,
      region TEXT NOT NULL,
      pattern TEXT NOT NULL,
      english_translation TEXT,
      frequency INTEGER DEFAULT 1,
      confidence REAL DEFAULT 0.5,
      first_seen TIMESTAMPTZ DEFAULT NOW(),
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(language, region, pattern)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS accent_profiles (
      id BIGSERIAL PRIMARY KEY,
      language TEXT NOT NULL,
      speaker_id BIGINT,
      phonetic_pattern TEXT,
      accuracy_score REAL DEFAULT 0.5,
      recordings_count INTEGER DEFAULT 0,
      last_updated TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS translation_feedback (
      id BIGSERIAL PRIMARY KEY,
      original_text TEXT NOT NULL,
      translated_text TEXT NOT NULL,
      source_language TEXT NOT NULL,
      target_language TEXT NOT NULL,
      feedback_score INTEGER DEFAULT 0,
      corrected_translation TEXT,
      user_id BIGINT,
      reviewed INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS offline_queue (
      id BIGSERIAL PRIMARY KEY,
      message_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      channel TEXT DEFAULT 'app',
      recipient_id BIGINT,
      recipient_contact TEXT,
      language TEXT DEFAULT 'en',
      priority INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      synced_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── Community Committee Management ──────────────────────────
  await e(`
    CREATE TABLE IF NOT EXISTS committees (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      district TEXT NOT NULL,
      sub_county TEXT,
      village TEXT,
      jurisdiction TEXT,
      description TEXT,
      chairperson_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'active',
      established_date TEXT,
      meeting_frequency TEXT DEFAULT 'monthly',
      total_members INTEGER DEFAULT 0,
      created_by BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await e(`
    CREATE TABLE IF NOT EXISTS committee_members (
      id BIGSERIAL PRIMARY KEY,
      committee_id BIGINT REFERENCES committees(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      committee_role TEXT DEFAULT 'member',
      languages TEXT,
      phone TEXT,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      status TEXT DEFAULT 'active',
      UNIQUE(committee_id, user_id)
    )
  `);

  await e(`
    CREATE TABLE IF NOT EXISTS committee_meetings (
      id BIGSERIAL PRIMARY KEY,
      committee_id BIGINT REFERENCES committees(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      agenda TEXT,
      minutes TEXT,
      resolutions TEXT,
      meeting_date TEXT NOT NULL,
      meeting_time TEXT,
      location TEXT,
      status TEXT DEFAULT 'scheduled',
      created_by BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await e(`
    CREATE TABLE IF NOT EXISTS committee_meeting_attendees (
      meeting_id BIGINT REFERENCES committee_meetings(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      attended INTEGER DEFAULT 0,
      PRIMARY KEY (meeting_id, user_id)
    )
  `);

  await e(`
    CREATE TABLE IF NOT EXISTS committee_incident_assignments (
      id BIGSERIAL PRIMARY KEY,
      committee_id BIGINT REFERENCES committees(id) ON DELETE CASCADE,
      report_id BIGINT REFERENCES citizen_reports(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      incident_type TEXT DEFAULT 'water_quality',
      district TEXT,
      description TEXT,
      assigned_to BIGINT REFERENCES users(id),
      assigned_by BIGINT REFERENCES users(id),
      status TEXT DEFAULT 'new',
      priority TEXT DEFAULT 'medium',
      notes TEXT,
      evidence_url TEXT,
      escalated INTEGER DEFAULT 0,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await e(`
    CREATE TABLE IF NOT EXISTS committee_projects (
      id BIGSERIAL PRIMARY KEY,
      committee_id BIGINT REFERENCES committees(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      project_type TEXT DEFAULT 'water',
      description TEXT,
      district TEXT,
      location TEXT,
      status TEXT DEFAULT 'planned',
      priority TEXT DEFAULT 'medium',
      budget REAL DEFAULT 0,
      spent REAL DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      progress_pct INTEGER DEFAULT 0,
      lead_officer BIGINT REFERENCES users(id),
      created_by BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await e(`
    CREATE TABLE IF NOT EXISTS committee_announcements (
      id BIGSERIAL PRIMARY KEY,
      committee_id BIGINT REFERENCES committees(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      priority TEXT DEFAULT 'normal',
      created_by BIGINT REFERENCES users(id),
      author_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── Dual RBAC — Committee Governance Layer ──────────────────
  // Separate permission system for in-committee roles, isolated from core HydroSense RBAC

  await e(`
    CREATE TABLE IF NOT EXISTS committee_roles (
      id BIGSERIAL PRIMARY KEY,
      committee_id BIGINT REFERENCES committees(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      committee_role TEXT NOT NULL DEFAULT 'member',
      jurisdiction_level TEXT DEFAULT 'village',
      jurisdiction_area TEXT,
      permissions TEXT DEFAULT '[]',
      granted_by BIGINT REFERENCES users(id),
      granted_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      status TEXT DEFAULT 'active',
      UNIQUE(committee_id, user_id)
    )
  `);

  await e(`
    CREATE TABLE IF NOT EXISTS committee_permissions (
      id BIGSERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      scope TEXT DEFAULT 'committee',
      category TEXT DEFAULT 'general',
      is_dangerous BOOLEAN DEFAULT FALSE
    )
  `);

  await e(`
    CREATE TABLE IF NOT EXISTS committee_audit_log (
      id BIGSERIAL PRIMARY KEY,
      actor_id BIGINT REFERENCES users(id),
      actor_role TEXT NOT NULL,
      actor_name TEXT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id BIGINT,
      committee_id BIGINT REFERENCES committees(id) ON DELETE SET NULL,
      jurisdiction TEXT,
      cross_system BOOLEAN DEFAULT FALSE,
      details JSONB,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await e(`
    CREATE TABLE IF NOT EXISTS committee_votes (
      id BIGSERIAL PRIMARY KEY,
      committee_id BIGINT REFERENCES committees(id) ON DELETE CASCADE,
      meeting_id BIGINT REFERENCES committee_meetings(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT,
      vote_type TEXT DEFAULT 'yes_no',
      status TEXT DEFAULT 'open',
      created_by BIGINT REFERENCES users(id),
      closes_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await e(`
    CREATE TABLE IF NOT EXISTS committee_vote_responses (
      id BIGSERIAL PRIMARY KEY,
      vote_id BIGINT REFERENCES committee_votes(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      response TEXT NOT NULL,
      voted_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(vote_id, user_id)
    )
  `);

  // Column migrations — add columns that were missing from the original schema
  await e(`ALTER TABLE citizen_discussions ADD COLUMN IF NOT EXISTS media_url TEXT`);
  await e(`ALTER TABLE citizen_discussions ADD COLUMN IF NOT EXISTS media_type TEXT`);
  await e(`ALTER TABLE citizen_discussions ADD COLUMN IF NOT EXISTS link_url TEXT`);
  await e(`ALTER TABLE citizen_replies ADD COLUMN IF NOT EXISTS media_url TEXT`);
  await e(`ALTER TABLE citizen_replies ADD COLUMN IF NOT EXISTS media_type TEXT`);
  await e(`ALTER TABLE volunteer_events ADD COLUMN IF NOT EXISTS event_mode TEXT DEFAULT 'physical'`);
  await e(`ALTER TABLE volunteer_events ADD COLUMN IF NOT EXISTS event_link TEXT`);
  await e(`ALTER TABLE volunteer_events ADD COLUMN IF NOT EXISTS paid_plan INTEGER DEFAULT 0`);
  await e(`ALTER TABLE discussion_views ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`);

  // Indexes
  await e(`CREATE INDEX IF NOT EXISTS idx_wp_district ON water_points(district)`);
  await e(`CREATE INDEX IF NOT EXISTS idx_sr_time ON sensor_readings(timestamp)`);
  await e(`CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status)`);
  await e(`CREATE INDEX IF NOT EXISTS idx_mr_status ON maintenance_requests(status)`);
  await e(`CREATE INDEX IF NOT EXISTS idx_cr_district ON community_reports(district)`);
  await e(`CREATE INDEX IF NOT EXISTS idx_hi_district ON health_incidents(district)`);
  await e(`CREATE INDEX IF NOT EXISTS idx_gwn_district ON gwn_reports(district)`);
  await e(`CREATE INDEX IF NOT EXISTS idx_gwn_status ON gwn_reports(status)`);
  await e(`CREATE INDEX IF NOT EXISTS idx_ei_district ON env_incidents(district)`);
  await e(`CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notification_log(recipient_id)`);
  await e(`CREATE INDEX IF NOT EXISTS idx_notif_channel ON notification_log(channel)`);
}

async function runMigrations(db) {
  const bcrypt = require('bcryptjs');

  // Guarantee Walter Olum's credentials
  const walterV2 = await db.prepare("SELECT name FROM _migrations WHERE name = 'ensure_walter_v2'").get();
  if (!walterV2) {
    const walterEmail = 'walter.olum@hydrosense.ug';
    const walterHash  = bcrypt.hashSync('walter123', 10);
    const existing = await db.prepare('SELECT id FROM users WHERE email = $1').get(walterEmail);
    if (existing) {
      await db.prepare(
        `UPDATE users SET name='Walter Olum', password_hash=$1, role='national_admin', organization='Ministry of Water & Environment', active=1 WHERE email=$2`
      ).run(walterHash, walterEmail);
    } else {
      await db.prepare(
        `INSERT INTO users (name, email, password_hash, role, district, organization, active) VALUES ('Walter Olum', $1, $2, 'national_admin', 'Kampala', 'Ministry of Water & Environment', 1)`
      ).run(walterEmail, walterHash);
    }
    await pool.query(`INSERT INTO _migrations (name) VALUES ('ensure_walter_v2') ON CONFLICT DO NOTHING`);
    console.log('[MIGRATION] ensure_walter_v2: Walter Olum credentials set.');
  }

  // Bootstrap: ensure at least one admin exists
  const adminCount = await db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'national_admin' AND active = 1").get();
  if (!adminCount || parseInt(adminCount.c) === 0) {
    const adminEmail = (process.env.ADMIN_EMAIL || 'walter.olum@hydrosense.ug').toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || 'walter123';
    const adminName = process.env.ADMIN_NAME || 'Walter Olum';
    const hash = bcrypt.hashSync(adminPassword, 10);
    await db.prepare(
      `INSERT INTO users (name, email, password_hash, role, district, organization, active) VALUES ($1, $2, $3, 'national_admin', 'Kampala', 'Ministry of Water & Environment', 1) ON CONFLICT DO NOTHING`
    ).run(adminName, adminEmail, hash);
    console.log(`[BOOTSTRAP] Admin created: ${adminEmail}`);
  }
}

module.exports = { getDb, initDb };
