const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { getDb } = require('../db');

const AI_PORT = parseInt(process.env.AI_PORT, 10) || 8000;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || null;
const CONFIG = { ai: { requestTimeoutMs: 55000 } };

// ═══════════════════════════════════════════════════════════════
// VOICE TRANSLATE — speech transcript → English explanation via Gemini
// ═══════════════════════════════════════════════════════════════
exports.voiceTranslate = async (req, res) => {
  try {
    let apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      try {
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf8');
          const match = content.match(/^GEMINI_API_KEY=(.*)$/m);
          if (match) apiKey = match[1].trim();
        }
      } catch {}
    }
    if (!apiKey) return res.status(503).json({ error: 'AI service not configured' });

    const { text, sourceLang = 'unknown', languageName = 'local language' } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });

    const prompt = `You are a water management assistant for Uganda's HydroSense platform.

A citizen reported an issue by speaking in ${languageName} (language code: ${sourceLang}).
Their speech was transcribed as: "${text}"

Please respond with a JSON object (no markdown, raw JSON only) in this exact format:
{
  "detectedLanguage": "the language the user spoke in",
  "english": "accurate English translation of the original message",
  "explanation": "clear 2-3 sentence explanation of the water/environmental issue described, what it means, and suggested urgency for the water management team",
  "incidentType": "best matching type from: water_contamination, broken_water_point, flooding, sewage_leak, illegal_dumping, pollution, environmental_hazard, infrastructure_damage, or 'other'",
  "severity": "low, medium, high, or critical based on the description"
}`;

    let response = null;
    for (const model of ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b']) {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 600 }
          })
        }
      );
      if (response.ok || response.status !== 429) break;
      await new Promise(r => setTimeout(r, 800));
    }

    if (!response.ok) return res.status(502).json({ error: 'AI translation failed. Please type your report manually.' });

    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: 'Could not parse AI response' });

    const result = JSON.parse(jsonMatch[0]);
    res.json({ success: true, original: text, ...result });
  } catch (err) {
    console.error('voice-translate error:', err);
    res.status(500).json({ error: 'Translation failed. Please type your report manually.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// AUDIO / VIDEO TRANSCRIBE — raw audio blob → Gemini multimodal
// Supports any language including Luganda, Acholi, Ateso, Lugbara,
// Runyankore, Lusoga, Rukiga, Luo, Swahili and any other language
// ═══════════════════════════════════════════════════════════════
exports.audioTranscribe = async (req, res) => {
  try {
    let apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      try {
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf8');
          const match = content.match(/^GEMINI_API_KEY=(.*)$/m);
          if (match) apiKey = match[1].trim();
        }
      } catch {}
    }
    if (!apiKey) return res.status(503).json({ error: 'AI service not configured' });

    const { audioBase64, mimeType = 'audio/webm' } = req.body;
    if (!audioBase64) return res.status(400).json({ error: 'No audio data provided' });

    const prompt = `You are an expert transcription and translation assistant for Uganda's HydroSense water management platform.

Listen carefully to this audio recording. The speaker may be speaking in ANY Ugandan or East African language, including but not limited to:
- Luganda, Acholi, Ateso/Teso, Lugbara, Runyankore/Nkore, Lusoga, Rukiga, Luo, Langi, Madi, Alur, Kakwa
- Swahili, English, or any mixture (code-switching is common)

Your task:
1. Transcribe the audio EXACTLY as spoken (in the original language)
2. Identify the language(s) spoken
3. Translate accurately to English — preserve all details about water issues, health problems, environmental damage, and locations
4. Classify the incident type and severity — this information is critical for Uganda's water, health, and environmental sectors

Respond ONLY with raw JSON (no markdown, no explanation outside JSON):
{
  "original": "exact transcription in the original language(s) spoken",
  "detectedLanguage": "name of the language(s) detected",
  "english": "accurate, complete English translation — do not omit any details",
  "explanation": "2-3 sentence professional summary of the reported issue, its urgency, and recommended action for the water/health management team",
  "incidentType": "one of: water_contamination | broken_water_point | flooding | sewage_leak | illegal_dumping | pollution | environmental_hazard | infrastructure_damage | health_outbreak | other",
  "severity": "low | medium | high | critical"
}`;

    let response = null;
    for (const model of ['gemini-2.5-flash', 'gemini-1.5-flash']) {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { inline_data: { mime_type: mimeType, data: audioBase64 } },
                { text: prompt }
              ]
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 1000 }
          })
        }
      );
      if (response.ok || response.status !== 429) break;
      await new Promise(r => setTimeout(r, 800));
    }

    if (!response.ok) {
      const err = await response.text();
      console.error('Gemini audio transcribe error:', err);
      return res.status(502).json({ error: 'Audio transcription failed' });
    }

    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: 'Could not parse transcription response' });

    const result = JSON.parse(jsonMatch[0]);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('audio-transcribe error:', err);
    res.status(500).json({ error: 'Transcription failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// NATIVE NODE.JS GEMINI CHAT FALLBACK
// ═══════════════════════════════════════════════════════════════

async function handleNativeNodeChat(req, res, targetPath) {
  let apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    try {
      const envPath = path.join(__dirname, '.env');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^GEMINI_API_KEY=(.*)$/m);
        if (match) apiKey = match[1].trim();
      }
    } catch {}
  }

  const { message = '', history = [], role = 'citizen', district = '' } = req.body || {};
  const db = getDb();

  // ── Pull live system data for context ──
  let statsStr = '';
  let healthStr = '';
  let waterQualityStr = '';
  let citizenReportStr = '';
  try {
    const totalWp  = await db.prepare("SELECT COUNT(*) as c FROM water_points").get();
    const funcWp   = await db.prepare("SELECT COUNT(*) as c FROM water_points WHERE status='functional'").get();
    const alerts   = await db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status='active'").get();
    const pending  = await db.prepare("SELECT COUNT(*) as c FROM maintenance_requests WHERE status='pending'").get();
    const unsafe   = await db.prepare("SELECT COUNT(*) as c FROM water_quality_tests WHERE overall_safe=0").get();
    statsStr = `Water infrastructure: ${totalWp.c} total water points, ${funcWp.c} functional. ` +
               `${alerts.c} active alerts. ${pending.c} pending maintenance. ` +
               `${unsafe.c} unsafe water quality records.`;

    // Health / disease outbreak data
    const outbreaks = await db.prepare(
      "SELECT disease_type, SUM(cases) as total_cases, SUM(deaths) as total_deaths, COUNT(*) as incidents, " +
      "STRING_AGG(DISTINCT district, ',') as districts, outbreak_status " +
      "FROM health_incidents GROUP BY disease_type, outbreak_status ORDER BY total_cases DESC LIMIT 10"
    ).all();
    if (outbreaks.length > 0) {
      healthStr = 'Disease & outbreak data: ' + outbreaks.map(o =>
        `${o.disease_type} — ${o.total_cases} cases, ${o.total_deaths} deaths across ${o.incidents} incidents in [${o.districts}], status: ${o.outbreak_status}`
      ).join('; ') + '.';
    } else {
      healthStr = 'No disease outbreaks currently recorded in the system.';
    }

    // Water quality summary
    const qualSummary = await db.prepare(
      "SELECT COUNT(*) as tests, SUM(CASE WHEN overall_safe=0 THEN 1 ELSE 0 END) as failed " +
      "FROM water_quality_tests"
    ).get();
    if (qualSummary && qualSummary.tests > 0) {
      waterQualityStr = `Water quality tests: ${qualSummary.failed}/${qualSummary.tests} failed.`;
    }

    // Recent citizen reports
    const reports = await db.prepare(
      "SELECT incident_type, COUNT(*) as c FROM citizen_reports WHERE status='pending' GROUP BY incident_type ORDER BY c DESC LIMIT 5"
    ).all();
    if (reports.length > 0) {
      citizenReportStr = 'Pending citizen reports: ' + reports.map(r => `${r.incident_type} (${r.c})`).join(', ') + '.';
    }
  } catch (e) {
    statsStr = 'System stats temporarily unavailable.';
  }

  const systemPrompt =
    `You are Hydro AI, the intelligent assistant for HydroSense — Uganda's national climate-resilient rural water management platform.\n\n` +
    `User role: ${role}. District: ${district || 'National'}.\n\n` +
    `LIVE SYSTEM DATA:\n` +
    `- ${statsStr}\n` +
    `- ${healthStr}\n` +
    (waterQualityStr ? `- ${waterQualityStr}\n` : '') +
    (citizenReportStr ? `- ${citizenReportStr}\n` : '') +
    `\nAnswer questions about water infrastructure, disease outbreaks, water quality, climate, and citizen reports using the data above. ` +
    `Be specific with numbers. Use **bold** for key figures. Keep responses concise and actionable.`;

  const contents = [
    { role: "user", parts: [{ text: `[SYSTEM CONTEXT]\n${systemPrompt}\n[/SYSTEM CONTEXT]` }] },
    { role: "model", parts: [{ text: "Understood. I have the latest HydroSense system data. How can I help?" }] }
  ];

  for (const turn of history.slice(-6)) {
    contents.push({
      role: turn.role === "user" ? "user" : "model",
      parts: [{ text: turn.content }]
    });
  }

  contents.push({ role: "user", parts: [{ text: message || "Hello" }] });

  const payload = {
    contents,
    generationConfig: { temperature: 0.3, maxOutputTokens: 1500 }
  };

  const isStream = targetPath.includes('/chat/stream');

  // ── Try Gemini (cascade through models) ──
  let geminiText = null;
  if (apiKey) {
    const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'];
    const action = isStream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    let response = null;
    for (const model of GEMINI_MODELS) {
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
        );
        if (response.ok) break;
        if (response.status === 429 && model !== GEMINI_MODELS[GEMINI_MODELS.length - 1]) {
          await new Promise(r => setTimeout(r, 800));
          continue;
        }
        break;
      } catch { break; }
    }

    if (response && response.ok) {
      if (isStream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ') && !line.includes('[DONE]')) {
              try {
                const chunk = JSON.parse(line.slice(6));
                const t = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
                if (t) res.write('data: ' + JSON.stringify({ type: 'chunk', text: t }) + '\n\n');
              } catch {}
            }
          }
        }
        res.write('data: ' + JSON.stringify({ type: 'done' }) + '\n\n');
        res.end();
        return;
      }
      const data = await response.json();
      geminiText = data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }
  }

  // ── DB-only fallback when Gemini unavailable or all models failed ──
  if (!geminiText) {
    const msg = message.toLowerCase();
    const isHealth   = /disease|outbreak|cholera|typhoid|dysentery|health|epidemic|infection|diarr|malaria/.test(msg);
    const isWater    = /water|borehole|pump|functional|non.functional|quality|contamina/.test(msg);
    const isMaint    = /maintenance|repair|broken|fix/.test(msg);
    const isAlert    = /alert|warning|critical|emergency/.test(msg);
    const isReport   = /report|citizen|complaint/.test(msg);

    let reply = '';
    try {
      const db2 = getDb();
      if (isHealth) {
        const outbreaks = await db2.prepare(
          "SELECT disease_type, SUM(cases) as c, SUM(deaths) as d, COUNT(*) as incidents, STRING_AGG(DISTINCT district, ',') as districts, outbreak_status " +
          "FROM health_incidents GROUP BY disease_type, outbreak_status ORDER BY c DESC LIMIT 8"
        ).all();
        if (outbreaks.length > 0) {
          reply = `**Disease Outbreak Summary — HydroSense System**\n\n` +
            outbreaks.map(o =>
              `- **${o.disease_type}**: ${o.c} cases, ${o.d} deaths across ${o.incidents} incident(s) in ${o.districts} — Status: *${o.outbreak_status}*`
            ).join('\n') +
            `\n\n**Action:** Investigate water-source-linked incidents and coordinate with health authorities for affected districts.`;
        } else {
          reply = `**No active disease outbreaks** are currently recorded in the HydroSense system.\n\n` +
            `The system monitors health incidents linked to water sources. All districts appear to be in normal health status at this time.`;
        }
      } else if (isWater) {
        const wp = await db2.prepare("SELECT status, COUNT(*) as c FROM water_points GROUP BY status").all();
        const unsafe2 = await db2.prepare("SELECT COUNT(*) as c FROM water_quality_tests WHERE overall_safe=0").get();
        reply = `**Water Infrastructure Status**\n\n` +
          wp.map(w => `- **${w.status}**: ${w.c} water points`).join('\n') +
          `\n- **Unsafe quality records**: ${unsafe2.c}`;
      } else if (isMaint) {
        const maint = await db2.prepare("SELECT status, COUNT(*) as c FROM maintenance_requests GROUP BY status").all();
        reply = `**Maintenance Summary**\n\n` + maint.map(m => `- **${m.status}**: ${m.c} requests`).join('\n');
      } else if (isAlert) {
        const alts = await db2.prepare("SELECT severity, COUNT(*) as c FROM alerts WHERE status='active' GROUP BY severity ORDER BY c DESC").all();
        reply = alts.length > 0
          ? `**Active Alerts**\n\n` + alts.map(a => `- **${a.severity}**: ${a.c}`).join('\n')
          : `No active alerts in the system.`;
      } else if (isReport) {
        const reps = await db2.prepare("SELECT incident_type, COUNT(*) as c FROM citizen_reports WHERE status='pending' GROUP BY incident_type ORDER BY c DESC LIMIT 6").all();
        reply = reps.length > 0
          ? `**Pending Citizen Reports**\n\n` + reps.map(r => `- **${r.incident_type}**: ${r.c}`).join('\n')
          : `No pending citizen reports at this time.`;
      } else {
        const twp = await db2.prepare("SELECT COUNT(*) as c FROM water_points").get();
        const fwp = await db2.prepare("SELECT COUNT(*) as c FROM water_points WHERE status='functional'").get();
        const ta  = await db2.prepare("SELECT COUNT(*) as c FROM alerts WHERE status='active'").get();
        reply = `**HydroSense System Overview**\n\n` +
          `- **${twp.c}** total water points · **${fwp.c}** functional\n` +
          `- **${ta.c}** active alerts\n\n` +
          `Ask me about water quality, disease outbreaks, maintenance, alerts, or citizen reports.`;
      }
    } catch {
      reply = `I have access to HydroSense water and health data. Ask me about water points, disease outbreaks, water quality, maintenance, or alerts.`;
    }

    if (isStream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('data: ' + JSON.stringify({ type: 'chunk', text: reply }) + '\n\n');
      res.write('data: ' + JSON.stringify({ type: 'done' }) + '\n\n');
      res.end();
    } else {
      res.status(200).json({ success: true, reply, model: 'HydroSense DB', source: 'database' });
    }
    return;
  }

  // Gemini succeeded — stream was returned early above; here only non-stream reaches
  res.status(200).json({ success: true, reply: geminiText, model: 'Hydro AI v4.0', source: 'gemini' });
}

// ═══════════════════════════════════════════════════════════════
// AI SERVICE PROXY
// ═══════════════════════════════════════════════════════════════

async function proxyToAI(req, res, targetPath) {
  const startTime = Date.now();
  let responded = false;
  const requestId = req.headers['x-request-id'] || crypto.randomUUID().slice(0, 8);
  const safeRespond = (statusCode, data) => {
    if (!responded) {responded = true;res.status(statusCode).json({ ...data, _request_id: requestId, _proxy_ms: Date.now() - startTime });}
  };

  const bodyData = ['POST', 'PUT', 'PATCH'].includes(req.method) && req.body ?
  JSON.stringify(req.body) :
  null;

  // Route to deployed Render AI service if AI_SERVICE_URL is configured,
  // otherwise fall back to the locally spawned process on localhost.
  let transport, options;
  if (AI_SERVICE_URL) {
    const u = new URL(targetPath, AI_SERVICE_URL);
    transport = u.protocol === 'https:' ? https : http;
    options = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        ...(bodyData ? { 'Content-Length': Buffer.byteLength(bodyData) } : {})
      },
      timeout: CONFIG.ai.requestTimeoutMs
    };
  } else {
    transport = http;
    options = {
      hostname: 'localhost',
      port: AI_PORT,
      path: targetPath,
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        ...(bodyData ? { 'Content-Length': Buffer.byteLength(bodyData) } : {})
      },
      timeout: CONFIG.ai.requestTimeoutMs
    };
  }

  const proxyReq = transport.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || '';
    const isStream = contentType.includes('text/event-stream');

    if (isStream) {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Request-ID': requestId
      });
      proxyRes.on('data', (chunk) => {
        if (!responded) responded = true;
        res.write(chunk);
      });
      proxyRes.on('end', () => {res.end();});
      return;
    }

    let data = '';
    proxyRes.on('data', (chunk) => data += chunk);
    proxyRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        res.set('X-Request-ID', requestId);
        safeRespond(proxyRes.statusCode, parsed);
      } catch {
        safeRespond(502, { status: 'error', message: 'Invalid AI response', _request_id: requestId });
      }
    });
  });

  proxyReq.on('error', async (err) => {
    // FALLBACK MOCK IF AI IS DOWN ON RENDER
    if (targetPath.includes('/health') || targetPath.includes('/system/ping')) {
      return safeRespond(200, { status: 'online', service: 'HydroSense AI (Fallback Mode)', version: '2.0.1 (Node)', latency: 15 });
    }
    
    if (targetPath.includes('/chat/stream') || targetPath.endsWith('/chat')) {
      if (!responded) {
        try {
          await handleNativeNodeChat(req, res, targetPath);
          responded = true;
          return;
        } catch (chatErr) {
          console.error("Native Node Chat Error:", chatErr.message);
          if (res.headersSent) {
            res.write('data: ' + JSON.stringify({ type: 'error', message: 'AI error: ' + chatErr.message }) + '\n\n');
            res.end();
            responded = true;
            return;
          }
          // Headers not yet sent — for stream endpoint send a proper SSE error so
          // the frontend's onError fires and triggers its non-stream fallback
          if (targetPath.includes('/chat/stream')) {
            responded = true;
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
            res.write('data: ' + JSON.stringify({ type: 'error', message: 'AI error: ' + chatErr.message }) + '\n\n');
            res.end();
            return;
          }
          req.nativeChatError = chatErr.message;
        }
      }
    }

    // GENERIC FALLBACK FOR ALL OTHER AI ENDPOINTS
    if (!responded) {
      responded = true;
      if (req.nativeChatError) {
        const isRateLimit = req.nativeChatError.toLowerCase().includes('busy') || req.nativeChatError.toLowerCase().includes('429');
        return res.status(isRateLimit ? 429 : 503).json({
          success: false,
          error: req.nativeChatError,
          rateLimit: isRateLimit,
          serverError: !isRateLimit,
          status: isRateLimit ? 429 : 503,
        });
      }
      return res.status(200).json({
        success: true,
        data: [],
        analysis: "Node.js Fallback: Data simulated because AI microservice is unavailable.",
        message: "Node.js Fallback Response",
        reply: "Node.js Fallback Response",
        risk_score: 50,
        predictions: []
      });
    }
  });

  proxyReq.setTimeout(CONFIG.ai.requestTimeoutMs, () => {
    proxyReq.destroy();
    if (targetPath.includes('/health')) return safeRespond(200, { status: 'online', service: 'Fallback Mode' });
    if (!responded) {
      responded = true;
      return res.status(200).json({ success: true, message: 'Timeout fallback' });
    }
  });

  if (bodyData) proxyReq.write(bodyData);
  proxyReq.end();
}

// Public AI health endpoints
exports.proxyHealth = (req, res) => proxyToAI(req, res, "/ai/health");
exports.proxyPing = (req, res) => proxyToAI(req, res, "/ai/system/ping");

// ══════════════════════════════════════════════════════════════════
// LIVE INTELLIGENCE FALLBACKS — query DB directly, no Python needed
// ══════════════════════════════════════════════════════════════════

async function fetchBaseStats(district) {
  const db = getDb();
  const p = district ? [district] : [];
  const w = district ? 'WHERE district = ?' : '';
  const wAnd = district ? 'AND district = ?' : '';
  try {
    const totalWp    = await db.prepare(`SELECT COUNT(*) as c FROM water_points ${w}`).get(...p);
    const funcWp     = await db.prepare(`SELECT COUNT(*) as c FROM water_points WHERE status='functional' ${wAnd}`).get(...p);
    const nonFuncWp  = await db.prepare(`SELECT COUNT(*) as c FROM water_points WHERE status!='functional' ${wAnd}`).get(...p);
    const critAlerts = await db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE severity='critical' AND status='active' ${wAnd}`).get(...p);
    const allAlerts  = await db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE status='active' ${wAnd}`).get(...p);
    const pendMaint  = await db.prepare(`SELECT COUNT(*) as c FROM maintenance_requests WHERE status='pending' ${wAnd}`).get(...p);
    const unsafeQ    = await db.prepare(`SELECT COUNT(*) as c FROM water_quality_tests WHERE overall_safe=0 ${wAnd}`).get(...p);
    const pendRep    = await db.prepare(`SELECT COUNT(*) as c FROM citizen_reports WHERE status='pending' ${wAnd}`).get(...p);
    return {
      total: totalWp.c, func: funcWp.c, nonFunc: nonFuncWp.c,
      critAlerts: critAlerts.c, allAlerts: allAlerts.c,
      pendMaint: pendMaint.c, unsafeQ: unsafeQ.c, pendRep: pendRep.c,
    };
  } catch {
    return { total: 0, func: 0, nonFunc: 0, critAlerts: 0, allAlerts: 0, pendMaint: 0, unsafeQ: 0, pendRep: 0 };
  }
}

exports.operationalInsights = async (req, res) => {
  try {
    const s = await fetchBaseStats(req.query.district || null);
    const funcRate = s.total > 0 ? Math.round((s.func / s.total) * 100) : 0;
    res.json({ status: 'ok', insights: { total_water_points: s.total, functionality_rate: funcRate, active_alerts: s.allAlerts, pending_maintenance: s.pendMaint } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

exports.liveSummary = async (req, res) => {
  try {
    const s = await fetchBaseStats(null);
    const level = s.critAlerts >= 5 ? 'critical' : s.critAlerts > 0 ? 'high' : s.allAlerts > 10 ? 'elevated' : 'normal';
    res.json({ status: 'ok', live_summary: {
      overall_alert_level: level,
      critical_alerts: s.critAlerts,
      high_risk_water_points: s.nonFunc,
      contamination_events_30d: s.unsafeQ,
      drought_affected_districts: 0,
      active_outbreaks: 0,
      pending_citizen_reports: s.pendRep,
      generated_at: new Date().toISOString(),
    }});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

exports.districtSummaries = async (req, res) => {
  try {
    const db = getDb();
    const districts = await db.prepare(`
      SELECT district,
        COUNT(*) as total,
        SUM(CASE WHEN status='functional' THEN 1 ELSE 0 END) as functional
      FROM water_points GROUP BY district ORDER BY district
    `).all();
    const alertRows = await db.prepare(`SELECT district, COUNT(*) as c FROM alerts WHERE status='active' GROUP BY district`).all();
    const alertMap  = Object.fromEntries(alertRows.map(r => [r.district, r.c]));
    const maintRows = await db.prepare(`SELECT district, COUNT(*) as c FROM maintenance_requests WHERE status='pending' GROUP BY district`).all();
    const maintMap  = Object.fromEntries(maintRows.map(r => [r.district, r.c]));

    const summaries = districts.map(d => {
      const funcPct    = d.total > 0 ? (d.functional / d.total) * 100 : 100;
      const infraRisk  = Math.round(100 - funcPct);
      const alertRisk  = Math.min((alertMap[d.district] || 0) * 15, 100);
      const qualRisk   = Math.min((maintMap[d.district] || 0) * 8, 100);
      const overall    = Math.round(infraRisk * 0.45 + alertRisk * 0.35 + qualRisk * 0.20);
      const risk_level = overall >= 75 ? 'critical' : overall >= 50 ? 'high' : overall >= 25 ? 'medium' : 'low';
      return {
        district: d.district, overall_risk: overall, risk_level,
        water_security_score: Math.round(funcPct),
        components: { water_quality_risk: alertRisk, infrastructure_risk: infraRisk, climate_risk: 25, health_risk: qualRisk, community_risk: 20 },
      };
    });
    res.json({ status: 'ok', summaries });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

exports.heatmap = async (req, res) => {
  try {
    const db = getDb();
    const district = req.query.district || null;
    const rows = await db.prepare(`
      SELECT wp.id, wp.name, wp.district, wp.status,
        (SELECT COUNT(*) FROM alerts a WHERE a.water_point_id = wp.id AND a.status='active') as alert_count,
        (SELECT COUNT(*) FROM citizen_reports cr WHERE cr.district = wp.district AND cr.created_at > NOW() - INTERVAL '30 days') as recent_reports
      FROM water_points wp
      ${district ? 'WHERE wp.district = ?' : ''}
      ORDER BY alert_count DESC, recent_reports DESC LIMIT 30
    `).all(...(district ? [district] : []));

    const heatmap = rows.map(r => {
      const infraPenalty = r.status !== 'functional' ? 40 : 0;
      const risk_score   = Math.min(infraPenalty + r.alert_count * 20 + r.recent_reports * 5, 100);
      const risk_level   = risk_score >= 75 ? 'critical' : risk_score >= 50 ? 'high' : risk_score >= 25 ? 'medium' : 'low';
      return { water_point_id: r.id, name: r.name, district: r.district, risk_score, risk_level, alert_count: r.alert_count, recent_reports: r.recent_reports };
    });
    res.json({ status: 'ok', heatmap });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

exports.environmentalIndex = async (req, res) => {
  try {
    const s = await fetchBaseStats(req.query.district || null);
    const funcPct   = s.total > 0 ? (s.func / s.total) * 100 : 100;
    const infraRisk = Math.round(100 - funcPct);
    const alertRisk = Math.min(s.allAlerts * 5, 100);
    const qualRisk  = Math.min(s.unsafeQ * 10, 100);
    const commRisk  = Math.min(s.pendRep * 5, 100);
    const overall   = Math.round(infraRisk * 0.35 + alertRisk * 0.25 + qualRisk * 0.25 + commRisk * 0.15);
    const risk_level = overall >= 75 ? 'critical' : overall >= 50 ? 'high' : overall >= 25 ? 'medium' : 'low';
    res.json({ status: 'ok', risk_index: { overall_risk_score: overall, risk_level, components: { infrastructure: infraRisk, water_quality: qualRisk, alerts: alertRisk, community: commRisk, climate: 25 } } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Native Node.js report generation (Gemini + DB — no Python service needed) ──
exports.generateReport = async (req, res) => {
  try {
    let apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      try {
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf8');
          const match = content.match(/^GEMINI_API_KEY=(.*)$/m);
          if (match) apiKey = match[1].trim();
        }
      } catch {}
    }

    const { role = 'district_officer', district = null } = req.body || {};
    const db = await getDb();
    const now = new Date().toISOString();

    // Pull live stats from DB
    let stats = {};
    try {
      const totalWp   = await db.prepare("SELECT COUNT(*) as c FROM water_points").get();
      const funcWp    = await db.prepare("SELECT COUNT(*) as c FROM water_points WHERE status='functional'").get();
      const alerts    = await db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status='active'").get();
      const pending   = await db.prepare("SELECT COUNT(*) as c FROM maintenance_requests WHERE status='pending'").get();
      const unsafe    = await db.prepare("SELECT COUNT(*) as c FROM water_quality_tests WHERE overall_safe=0").get();
      const reports   = await db.prepare("SELECT COUNT(*) as c FROM citizen_reports WHERE status='pending'").get();
      stats = {
        total: totalWp.c, functional: funcWp.c,
        activeAlerts: alerts.c, pendingMaint: pending.c,
        unsafeTests: unsafe.c, pendingReports: reports.c,
      };
    } catch { stats = { total: 0, functional: 0, activeAlerts: 0, pendingMaint: 0, unsafeTests: 0, pendingReports: 0 }; }

    const scope = district ? `District: ${district}` : 'National (All Districts)';
    const funcPct = stats.total > 0 ? Math.round((stats.functional / stats.total) * 100) : 0;

    const execSummary =
      `As of ${now.slice(0, 10)}, HydroSense AI has analysed ${stats.total} water points across ${scope}. ` +
      `${stats.functional} (${funcPct}%) are currently functional. ` +
      `${stats.activeAlerts} active alerts require attention, with ${stats.pendingMaint} pending maintenance requests ` +
      `and ${stats.unsafeTests} unsafe water quality records on file.`;

    const keyFindings = [
      `Total water points monitored: ${stats.total}`,
      `Functional water points: ${stats.functional} (${funcPct}%)`,
      `Active system alerts: ${stats.activeAlerts}`,
      `Pending maintenance requests: ${stats.pendingMaint}`,
      `Unsafe water quality records: ${stats.unsafeTests}`,
      `Pending citizen reports: ${stats.pendingReports}`,
    ];

    const defaultRecs = [
      'Prioritise inspection of non-functional water points to restore access.',
      'Investigate and resolve active alerts before they escalate.',
      'Clear backlog of pending maintenance requests, starting with high-priority sites.',
      'Follow up on unsafe water quality records with immediate testing.',
      'Review and process pending citizen reports for timely community response.',
    ];

    let narrative = null;
    if (apiKey) {
      const prompt =
        `Write a concise 2-paragraph executive summary for a water infrastructure management report. ` +
        `Scope: ${scope}. Role: ${role.replace(/_/g, ' ')}. ` +
        `Key data: ${stats.total} water points, ${funcPct}% functional, ${stats.activeAlerts} active alerts, ` +
        `${stats.pendingMaint} pending maintenance, ${stats.unsafeTests} unsafe water quality records. ` +
        `Be professional, specific to water infrastructure, and action-oriented.`;

      const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'];
      let gRes = null;
      for (const model of GEMINI_MODELS) {
        gRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.4, maxOutputTokens: 600 },
            }),
          }
        );
        if (gRes.ok) break;
        if (gRes.status === 429 && model !== GEMINI_MODELS[GEMINI_MODELS.length - 1]) {
          await new Promise(r => setTimeout(r, 800));
          continue;
        }
        break;
      }
      if (gRes && gRes.ok) {
        const gData = await gRes.json();
        narrative = gData.candidates?.[0]?.content?.parts?.[0]?.text || null;
      }
    }

    return res.json({
      status: 'ok',
      report: {
        title: `HydroSense AI ${(req.body?.report_type || 'executive_summary').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} Report`,
        generated_at: now,
        scope,
        role,
        executive_summary: execSummary,
        key_findings: keyFindings,
        recommendations: defaultRecs,
        narrative,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Wildcard route that captures full path after /api/ai/
exports.proxyWildcard = (req, res) => {
  const targetPath = '/ai/' + req.params.path;
  proxyToAI(req, res, targetPath);
});

