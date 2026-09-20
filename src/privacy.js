// privacy.js — the parts of DPDP that are actually code.
//
// WHAT THIS FILE IS, AND IS NOT
//
//   It implements the obligations a developer can implement: notice, a recorded
//   consent, the right to get your data, the right to have it erased, and a
//   retention limit so nothing is kept forever.
//
//   It does NOT make GoldenBay "DPDP compliant". Compliance is a legal status.
//   It needs a named grievance officer, breach procedures, and an assessment of
//   the cross-border transfer that happens every time we call Gemini. Those are
//   not code problems and we do not pretend otherwise.

const store = require('./store');

// Bump this when the notice text changes — a consent given against an older
// notice is not consent to the new one.
const NOTICE_VERSION = '2026-09-1';

const PURPOSES = [
  { id: 'emergency', label: 'Emergency response',
    detail: 'So an ambulance and hospital can be chosen for you, and the hospital can prepare before you arrive.' },
  { id: 'profile', label: 'Keeping your health profile',
    detail: 'Allergies, medicines and conditions, so they are available in an emergency instead of in a folder at home.' },
  { id: 'labs', label: 'Reading lab reports',
    detail: 'To check the values on your reports and show how they have changed over time.' },
];

const RETENTION = {
  emergencies: 30,     // days — an emergency record is not needed after a month
  labReports: 1095,    // days (3 years) — your own results, kept until you delete them
};

// ---------------------------------------------------------------------------
// CONSENT — recorded against a specific version of the notice, with a timestamp
// ---------------------------------------------------------------------------
function recordConsent(profileId, purposes) {
  return store.update('profiles', profileId, {
    consent: {
      givenAt: new Date().toISOString(),
      noticeVersion: NOTICE_VERSION,
      purposes: purposes && purposes.length ? purposes : PURPOSES.map((p) => p.id),
    },
  });
}

function withdrawConsent(profileId) {
  return store.update('profiles', profileId, {
    consent: { withdrawnAt: new Date().toISOString(), noticeVersion: NOTICE_VERSION, purposes: [] },
  });
}

function consentStatus(profile) {
  const c = profile?.consent;
  if (!c || c.withdrawnAt) return { ok: false, reason: c?.withdrawnAt ? 'withdrawn' : 'never given' };
  if (c.noticeVersion !== NOTICE_VERSION) return { ok: false, reason: 'notice has changed since consent was given' };
  return { ok: true, givenAt: c.givenAt, purposes: c.purposes };
}

// ---------------------------------------------------------------------------
// RIGHT TO ACCESS — everything we hold about one person, in one file
// ---------------------------------------------------------------------------
function exportEverything(profileId) {
  const profile = store.find('profiles', profileId);
  if (!profile) return null;

  const emergencies = store.all('emergencies').filter((e) => e.profileId === profileId);
  const labReports = store.all('labReports').filter((r) => r.profileId === profileId);

  return {
    exportedAt: new Date().toISOString(),
    noticeVersion: NOTICE_VERSION,
    aboutThisFile:
      'Everything GoldenBay holds about this person. Nothing is kept anywhere else. ' +
      'Live video from the CPR Co-Pilot is never stored, so it does not appear here.',
    profile,
    emergencies,
    labReports,
    counts: {
      emergencies: emergencies.length,
      labReports: labReports.length,
      documents: (profile.documents || []).length,
    },
  };
}

// ---------------------------------------------------------------------------
// RIGHT TO ERASURE — really gone, not flagged as deleted
// ---------------------------------------------------------------------------
function eraseEverything(profileId) {
  const profile = store.find('profiles', profileId);
  if (!profile) return null;

  const emergencies = store.all('emergencies').filter((e) => e.profileId === profileId);
  const labReports = store.all('labReports').filter((r) => r.profileId === profileId);

  for (const e of emergencies) store.remove('emergencies', e.id);
  for (const r of labReports) store.remove('labReports', r.id);
  store.remove('profiles', profileId);

  return {
    erasedAt: new Date().toISOString(),
    name: profile.fullName,
    removed: {
      profile: 1,
      emergencies: emergencies.length,
      labReports: labReports.length,
      documents: (profile.documents || []).length,
    },
  };
}

// ---------------------------------------------------------------------------
// RETENTION — nothing is kept forever. Runs on boot and hourly.
// ---------------------------------------------------------------------------
function purgeExpired() {
  const now = Date.now();
  const older = (item, days) => {
    const t = new Date(item.updatedAt || item.createdAt || 0).getTime();
    return t && (now - t) / 86400000 > days;
  };

  let emergencies = 0, labReports = 0;

  for (const e of [...store.all('emergencies')]) {
    if (older(e, RETENTION.emergencies)) { store.remove('emergencies', e.id); emergencies++; }
  }
  for (const r of [...store.all('labReports')]) {
    if (older(r, RETENTION.labReports)) { store.remove('labReports', r.id); labReports++; }
  }

  if (emergencies || labReports) {
    console.log(`[privacy] retention purge removed ${emergencies} emergencies, ${labReports} lab reports`);
  }
  return { emergencies, labReports, ranAt: new Date().toISOString() };
}

function startRetentionJob() {
  purgeExpired();
  setInterval(purgeExpired, 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// An honest status report. Note what it does NOT claim.
// ---------------------------------------------------------------------------
function status() {
  return {
    noticeVersion: NOTICE_VERSION,
    implemented: {
      notice: true,
      consentRecorded: true,
      rightToAccess: true,
      rightToErasure: true,
      retentionLimits: RETENTION,
      encryptionAtRest: !!process.env.DATA_ENCRYPTION_KEY,
      videoNeverStored: true,
    },
    notImplemented: {
      grievanceOfficer: 'a named person is required — not code',
      breachNotification: 'an organisational process',
      crossBorderAssessment: 'AI calls send data to Google servers; this has not been assessed',
      childrensData: 'verifiable guardian consent is not implemented',
      independentAudit: 'none',
    },
    claim: 'Designed against DPDP requirements. NOT certified or legally compliant. All demo data is synthetic.',
  };
}

module.exports = {
  NOTICE_VERSION, PURPOSES, RETENTION,
  recordConsent, withdrawConsent, consentStatus,
  exportEverything, eraseEverything,
  purgeExpired, startRetentionJob, status,
};