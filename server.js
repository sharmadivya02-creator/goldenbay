// server.js — the GoldenBay backend.
//
// One Node.js process doing three jobs:
//   1. Serve the web app (the files in /public)
//   2. Expose the JSON API under /v1/...  (the app talks to these endpoints)
//   3. Push real-time updates over WebSockets (Socket.IO)
//
// DEMO NOTICE: this is a hackathon prototype using synthetic data. It has no
// authentication — a production medical system would require auth, encryption
// at rest, audit logs, and consent management before touching real data.

// Load .env into process.env (tiny hand-rolled loader: zero dependencies).
const fs = require('fs');
const path = require('path');
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const store = require('./src/store');
const { seed, DEMO_CENTER } = require('./src/seed');
const ai = require('./src/ai');
const dispatch = require('./src/dispatch');
const labs = require('./src/labs');
const agent = require('./src/agent');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '15mb' })); // prescription photos arrive as base64 JSON
app.use(express.static(path.join(__dirname, 'public')));

store.load();
seed();

// ---------------------------------------------------------------------------
// Pages (three views of the same emergency)
// ---------------------------------------------------------------------------
app.get('/family', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'family.html')));
app.get('/hospital', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'hospital.html')));
app.get('/copilot', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'copilot.html')));
app.get('/labs', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'labs.html')));

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.get('/v1/health', (_req, res) => {
  res.json({ ok: true, ai: ai.geminiEnabled() ? 'gemini' : 'mock', demoCenter: DEMO_CENTER });
});

// Open http://localhost:3000/v1/ai-status in a browser to see, in plain JSON,
// whether Gemini is actually working and exactly why it isn't if it isn't.
app.get('/v1/ai-status', async (_req, res) => {
  res.json(await ai.selfTest());
});

app.get('/v1/hospitals', (_req, res) => res.json({ hospitals: store.all('hospitals') }));

// ---------------------------------------------------------------------------
// The Dispatch Agent
// ---------------------------------------------------------------------------

// everything the agent has done on this emergency, with its reasoning
app.get('/v1/agent/:emergencyId', (req, res) => {
  res.json({ log: agent.getLog(req.params.emergencyId) });
});

// THE DEMO SPANNER.
// Take a hospital's cath lab out of service, or its last bed. Nobody tells the
// agent what to do about it — it notices on its next cycle and decides.
app.post('/v1/hospitals/:id/state', (req, res) => {
  const h = store.find('hospitals', req.params.id);
  if (!h) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'hospital not found' } });

  const changes = {};
  if ('cathLabBusy' in req.body) changes.cathLabBusy = !!req.body.cathLabBusy;
  if ('bedsFree' in req.body) changes.bedsFree = Math.max(0, parseInt(req.body.bedsFree, 10) || 0);

  const updated = store.update('hospitals', h.id, changes);
  io.to('hospital-feed').emit('hospital:state', {
    hospitalId: h.id, name: h.name,
    bedsFree: updated.bedsFree ?? updated.erBeds,
    cathLabBusy: !!updated.cathLabBusy,
  });
  res.json({ hospital: updated });
});

// ---------------------------------------------------------------------------
// Lab reports — read, VERIFY, trend.
// ---------------------------------------------------------------------------

// every report we already hold for this person, oldest first
app.get('/v1/labs/:profileId', (req, res) => {
  const reports = store.all('labReports')
    .filter((r) => r.profileId === req.params.profileId)
    .sort((a, b) => new Date(a.reportDate || a.createdAt) - new Date(b.reportDate || b.createdAt));
  res.json({ reports });
});

// analyse a new one
app.post('/v1/labs/analyze', async (req, res) => {
  const { profileId, imageBase64, mimeType } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'imageBase64 is required' } });
  }

  const profile = profileId ? store.find('profiles', profileId) : null;
  const previousReports = store.all('labReports')
    .filter((r) => r.profileId === profileId)
    .sort((a, b) => new Date(a.reportDate || a.createdAt) - new Date(b.reportDate || b.createdAt));

  try {
    const analysis = await labs.analyseReport({
      base64: imageBase64, mimeType, profile, previousReports,
    });

    // only keep it if it was actually a lab report we could use
    let saved = null;
    if (analysis.values.length) {
      saved = store.insert('labReports', {
        profileId: profileId || null,
        reportDate: analysis.reportDate || new Date().toISOString().slice(0, 10),
        labName: analysis.labName || null,
        values: analysis.values,
        source: analysis.source,
      });
    }

    res.json({ analysis, savedId: saved?.id || null });
  } catch (err) {
    console.error('[labs] analysis failed:', err);
    res.status(500).json({ error: { code: 'LAB_ANALYSIS_FAILED', message: err.message } });
  }
});

// delete one (so a demo can be reset without touching profiles)
app.delete('/v1/labs/:id', (req, res) => {
  const ok = store.remove ? store.remove('labReports', req.params.id) : null;
  res.json({ ok: !!ok });
});

// DEMO SAFETY: drop two older reports in for this person so the trend line has
// history to draw even with no internet, no Gemini and no real paperwork. The
// values are synthetic and labelled as such.
app.post('/v1/labs/demo-history', (req, res) => {
  const { profileId } = req.body || {};
  if (!profileId) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'profileId required' } });

  // clear any previous demo history for this person so it never doubles up
  for (const r of store.all('labReports').filter((r) => r.profileId === profileId && r.isDemo)) {
    store.remove('labReports', r.id);
  }

  const mk = (monthsAgo, creat, hba1c, hb, k) => {
    const d = new Date();
    d.setMonth(d.getMonth() - monthsAgo);
    return store.insert('labReports', {
      profileId,
      isDemo: true,
      reportDate: d.toISOString().slice(0, 10),
      labName: 'Demo Diagnostics (synthetic)',
      source: 'demo',
      values: [
        { key: 'creatinine', testName: 'Creatinine', value: creat, unit: 'mg/dL',
          normalRange: [0.7, 1.3], status: creat > 1.3 ? 'high' : 'normal',
          verdict: 'verified', confidence: 97, checks: [], means: 'how well the kidneys are filtering' },
        { key: 'hba1c', testName: 'HbA1c', value: hba1c, unit: '%',
          normalRange: [4.0, 5.6], status: hba1c > 5.6 ? 'high' : 'normal',
          verdict: 'verified', confidence: 96, checks: [], means: 'average blood sugar over three months' },
        { key: 'haemoglobin', testName: 'Haemoglobin', value: hb, unit: 'g/dL',
          normalRange: [13.0, 17.0], status: hb < 13 ? 'low' : 'normal',
          verdict: 'verified', confidence: 95, checks: [], means: 'oxygen-carrying capacity of the blood' },
        { key: 'potassium', testName: 'Potassium', value: k, unit: 'mEq/L',
          normalRange: [3.5, 5.1], status: k > 5.1 ? 'high' : 'normal',
          verdict: 'verified', confidence: 94, checks: [], means: 'affects the heart rhythm directly' },
      ],
    });
  };

  // 18 months of quiet deterioration nobody put side by side
  const a = mk(18, 1.1, 6.1, 14.2, 4.4);
  const b = mk(6, 1.4, 6.8, 13.1, 4.9);
  res.json({ ok: true, created: [a.id, b.id] });
});

app.get('/v1/profiles', (_req, res) => res.json({ profiles: store.all('profiles') }));

app.post('/v1/profiles', (req, res) => {
  const p = req.body || {};
  if (!p.fullName || typeof p.fullName !== 'string') {
    return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'fullName is required' } });
  }
  const profile = store.insert('profiles', {
    fullName: p.fullName.trim(),
    relation: p.relation || null,
    age: Number.isFinite(+p.age) ? +p.age : null,
    bloodGroup: p.bloodGroup || null,
    allergies: p.allergies || [],
    medications: p.medications || [],
    conditions: p.conditions || [],
    pastEvents: p.pastEvents || [],
    insurance: p.insurance || null,
    preferredHospital: p.preferredHospital || null,
    emergencyContacts: p.emergencyContacts || [],
    documents: Array.isArray(p.documents) ? p.documents.slice(0, 24) : [],
  });
  res.status(201).json({ profile });
});

app.put('/v1/profiles/:id', (req, res) => {
  const updated = store.update('profiles', req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'profile not found' } });
  res.json({ profile: updated });
});

// Gemini reads a prescription/report photo and drafts profile fields.
// The human ALWAYS reviews and confirms — the AI only drafts.
app.post('/v1/profiles/draft-from-image', async (req, res) => {
  const { imageBase64, mimeType } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'imageBase64 is required' } });
  }
  const draft = await ai.draftProfileFromImage(imageBase64, mimeType);
  res.json({ draft });
});

// AI-generated plain-language medical summary for one profile — shown under
// the profile's "Medical summary" tab. Not cached server-side (cheap mock
// fallback, and Gemini calls are fast) so it always reflects the latest
// profile data; the frontend caches it in memory per screen visit.
app.get('/v1/profiles/:id/summary', async (req, res) => {
  const profile = store.find('profiles', req.params.id);
  if (!profile) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'profile not found' } });
  const summary = await ai.summarizeProfile(profile);
  res.json({ summary });
});

app.get('/v1/emergencies', (_req, res) => {
  const emergencies = store
    .all('emergencies')
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ emergencies });
});

app.get('/v1/emergencies/:id', (req, res) => {
  const emergency = store.find('emergencies', req.params.id);
  if (!emergency) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'emergency not found' } });
  res.json({ emergency });
});

// THE endpoint — the emergency button calls this.
// Design principle: respond fast (create the record, return 201), then do the
// slow work (AI, matching, dispatch) asynchronously and stream progress over
// WebSockets. A panicking user must never stare at a spinner.
app.post('/v1/emergencies', async (req, res) => {
  const { profileId, description, location, useDemoLocation } = req.body || {};

  // Validation — never trust the client.
  let loc = location;
  const validLoc =
    loc && Number.isFinite(+loc.lat) && Number.isFinite(+loc.lng) &&
    Math.abs(+loc.lat) <= 90 && Math.abs(+loc.lng) <= 180;
  if (!validLoc || useDemoLocation) {
    // No GPS (denied permission / desktop browser) → demo location keeps the flow alive.
    loc = { lat: DEMO_CENTER.lat + 0.01, lng: DEMO_CENTER.lng + 0.005, accuracy: null, isDemoLocation: true };
  } else {
    loc = { lat: +loc.lat, lng: +loc.lng, accuracy: loc.accuracy ?? null, isDemoLocation: false };
  }

  const profile = profileId ? store.find('profiles', profileId) : null;

  const emergency = store.insert('emergencies', {
    status: 'RECEIVED',
    profileId: profile ? profile.id : null,
    patientName: profile ? profile.fullName : 'Unknown patient',
    description: String(description || '').slice(0, 2000),
    location: loc,
    clinicalPicture: null,
    hospitalId: null,
    hospitalName: null,
    etaMinutes: null,
    ambulance: null,
  });

  // Respond immediately — the client already has its emergency ID.
  res.status(201).json({ emergency });

  // Slow work continues in the background.
  processEmergency(emergency, profile).catch((err) => {
    console.error('[emergency] processing failed:', err);
    const failed = store.update('emergencies', emergency.id, { status: 'NEEDS_MANUAL_DISPATCH' });
    io.to(`emergency:${emergency.id}`).emit('emergency:update', failed);
  });
});

async function processEmergency(emergency, profile) {
  const emit = (updated) => {
    io.to(`emergency:${emergency.id}`).emit('emergency:update', updated);
    io.to('hospital-feed').emit('emergency:update', updated);
  };

  // 1) AI composes the clinical picture (Gemini, or mock fallback).
  emit(store.update('emergencies', emergency.id, { status: 'ANALYZING' }));
  const picture = await ai.composeClinicalPicture(emergency.description, profile || {});

  // 2) Match the right hospital — capability first, then distance.
  const match = dispatch.matchHospital(emergency.location, picture.neededCapabilities);

  const updated = store.update('emergencies', emergency.id, {
    status: 'HOSPITAL_MATCHED',
    clinicalPicture: picture,
    hospitalId: match.hospital.id,
    hospitalName: match.hospital.name,
    hospitalDistanceKm: match.distanceKm,
    capabilityMatch: match.capabilityMatch,
    alternatives: match.alternatives,
  });
  emit(updated);

  // 3) THE DISPATCH AGENT takes over. It has a goal, real tools, and the right
  //    to change this decision later if the world changes. It runs for the whole
  //    emergency, not once.
  agent.startAgent(io, updated, profile || {});

  // 4) Simulated ambulance runs the rest of the lifecycle.
  dispatch.simulateAmbulance(io, updated);
}

// ---------------------------------------------------------------------------
// WebSockets — clients join rooms to receive only what concerns them
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.on('watch:emergency', (emergencyId) => socket.join(`emergency:${emergencyId}`));
  socket.on('watch:hospital-feed', () => socket.join('hospital-feed'));

  // ---- CPR Co-Pilot ----
  // The rescuer's phone sends a small picture + live CPR numbers a couple of
  // times a second. We pass them straight through to the hospital screen and
  // to anyone watching this particular emergency. Nothing is stored.
  socket.on('copilot:frame', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const safe = {
      emergencyId: payload.emergencyId || null,
      jpeg: typeof payload.jpeg === 'string' ? payload.jpeg.slice(0, 400000) : null,
      stats: payload.stats || {},
      at: Date.now(),
    };
    io.to('hospital-feed').emit('copilot:frame', safe);
    if (safe.emergencyId) io.to(`emergency:${safe.emergencyId}`).emit('copilot:frame', safe);

    // Every few seconds, hand one frame to Gemini and ask what it can SEE.
    maybeReadScene(safe);
  });
});

// ---------------------------------------------------------------------------
// Gemini watches the scene — but only every SCENE_EVERY_MS, because frames
// arrive twice a second and we are not going to make 120 AI calls a minute.
// ---------------------------------------------------------------------------
// How often Gemini looks at the scene. Keep this HIGH: the free tier allows
// only ~10-15 requests a minute, and reading the scene every few seconds will
// burn through the whole quota in one demo run and push everything to mock.
const SCENE_EVERY_MS = 20000;
const lastSceneAt = new Map();   // emergency id → when we last asked Gemini
const sceneBusy   = new Set();   // don't start a second call while one is running

async function maybeReadScene(frame) {
  const key = frame.emergencyId || 'unassigned';
  if (!frame.jpeg) return;
  if (sceneBusy.has(key)) return;
  if (Date.now() - (lastSceneAt.get(key) || 0) < SCENE_EVERY_MS) return;

  lastSceneAt.set(key, Date.now());
  sceneBusy.add(key);
  try {
    // strip the "data:image/jpeg;base64," prefix — Gemini wants the raw part
    const base64 = frame.jpeg.split(',')[1];
    if (!base64) return;

    const scene = await ai.readScene(base64, 'image/jpeg');
    const msg = { emergencyId: frame.emergencyId, scene, at: Date.now() };

    io.to('hospital-feed').emit('copilot:scene', msg);
    if (frame.emergencyId) io.to(`emergency:${frame.emergencyId}`).emit('copilot:scene', msg);
  } catch (err) {
    console.error('[copilot] scene read failed:', err.message);
  } finally {
    sceneBusy.delete(key);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`GoldenBay demo running → http://localhost:${PORT}`);
  if (ai.geminiEnabled()) {
    const k = (process.env.GEMINI_API_KEY || '').trim();
    console.log(`AI mode: Gemini (${process.env.GEMINI_MODEL || 'gemini-3.6-flash'})`);
    console.log(`         key loaded: ${k.slice(0, 6)}…${k.slice(-4)} (${k.length} chars)`);
  } else {
    console.log('AI mode: MOCK (no key configured — every flow still works)');
  }
});