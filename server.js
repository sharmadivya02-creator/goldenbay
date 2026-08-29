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

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.get('/v1/health', (_req, res) => {
  res.json({ ok: true, ai: ai.geminiEnabled() ? 'gemini' : 'mock', demoCenter: DEMO_CENTER });
});

app.get('/v1/hospitals', (_req, res) => res.json({ hospitals: store.all('hospitals') }));

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

  // 3) Simulated ambulance runs the rest of the lifecycle.
  dispatch.simulateAmbulance(io, updated);
}

// ---------------------------------------------------------------------------
// WebSockets — clients join rooms to receive only what concerns them
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.on('watch:emergency', (emergencyId) => socket.join(`emergency:${emergencyId}`));
  socket.on('watch:hospital-feed', () => socket.join('hospital-feed'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`GoldenBay demo running → http://localhost:${PORT}`);
  console.log(`AI mode: ${ai.geminiEnabled() ? 'Gemini (' + (process.env.GEMINI_MODEL || 'gemini-2.5-flash') + ')' : 'MOCK (no key configured — flows still work)'}`);
});