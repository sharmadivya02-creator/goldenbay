// ai.js — the AI layer: Gemini when a key is available, mock AI otherwise.
//
// Two jobs, both "information extraction", never diagnosis:
//   1. draftProfileFromImage  — read a prescription photo, draft profile fields
//   2. composeClinicalPicture — turn a panicked plain-words description + the
//      stored profile into a structured, readable clinical picture + urgency
//
// SAFETY: GoldenBay's AI organises information for humans. It does not diagnose,
// prescribe, or make clinical decisions. Every output is labelled accordingly.
//
// RESILIENCE: any Gemini failure (bad key, network, rate limit) automatically
// falls back to the mock — the demo can never die on stage because of the AI.

const GEMINI_URL = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

function geminiEnabled() {
  const key = process.env.GEMINI_API_KEY || '';
  const mock = String(process.env.MOCK_AI || '').toLowerCase() === 'true';
  return !mock && key && !key.startsWith('paste-');
}

async function callGemini(parts) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(GEMINI_URL(model, process.env.GEMINI_API_KEY), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no text');
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// 1) Prescription photo → draft profile fields
// ---------------------------------------------------------------------------

const PROFILE_PROMPT = `You are an information-extraction assistant for GoldenBay, an emergency-preparedness app.
Read this photo of a medical document (often a handwritten Indian prescription or a lab/discharge report).
Extract ONLY what is actually legible. Never guess or invent values. Use [] or null for anything unclear.
Return JSON exactly in this shape:
{
  "fullName": string|null,
  "age": number|null,
  "bloodGroup": string|null,
  "allergies": string[],
  "medications": string[],        // include dose/frequency if written
  "conditions": string[],         // conditions explicitly named in the document
  "notes": string|null,           // anything important that fits nowhere else
  "confidence": "high"|"medium"|"low",
  "illegibleParts": string[]      // what you could NOT read, so a human checks
}`;

function mockProfileDraft() {
  return {
    fullName: null,
    age: null,
    bloodGroup: null,
    allergies: ['Penicillin (mock extraction)'],
    medications: ['Metformin 500mg twice daily (mock extraction)', 'Telmisartan 40mg morning (mock extraction)'],
    conditions: ['Type 2 Diabetes (mock extraction)', 'Hypertension (mock extraction)'],
    notes: 'MOCK MODE: no Gemini key configured — these are sample values to demonstrate the flow.',
    confidence: 'low',
    illegibleParts: [],
    _source: 'mock',
  };
}

async function draftProfileFromImage(base64Data, mimeType) {
  if (geminiEnabled()) {
    try {
      const result = await callGemini([
        { text: PROFILE_PROMPT },
        { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64Data } },
      ]);
      return { ...result, _source: 'gemini' };
    } catch (err) {
      console.error('[ai] Gemini profile draft failed, using mock:', err.message);
    }
  }
  return mockProfileDraft();
}

// ---------------------------------------------------------------------------
// 2) Description + profile → clinical picture + urgency
// ---------------------------------------------------------------------------

const CLINICAL_PROMPT = (description, profile) => `You are the information organiser for GoldenBay, an emergency response system.
A bystander or family member just reported an emergency in plain, possibly panicked words.
You also have the patient's pre-built health profile.

Your job: organise information for the ambulance and ER team. You must NOT diagnose or recommend treatment.

Caller's words: "${description}"

Patient profile (JSON): ${JSON.stringify(profile)}

Return JSON exactly in this shape:
{
  "urgency": "CRITICAL"|"HIGH"|"MODERATE",
  "urgencyReason": string,                  // one sentence, plain language
  "suspectedCategory": string,              // e.g. "cardiac event — unconfirmed", "trauma/fall — unconfirmed"; always append "— unconfirmed"
  "clinicalSummary": string,                // 3-4 short sentences an ER doctor can absorb in 10 seconds
  "keyRisks": string[],                     // e.g. drug allergies, relevant history, current medications that matter now
  "neededCapabilities": string[],           // choose from: cardiac, cathlab, stroke, neuro, trauma, burns, orthopedic, pediatric, icu, general
  "questionsForCaller": string[]            // max 3 simple questions a dispatcher could ask right now
}`;

function mockClinicalPicture(description, profile) {
  const d = (description || '').toLowerCase();
  let urgency = 'HIGH';
  let category = 'medical emergency — unconfirmed';
  let needed = ['general', 'icu'];
  if (/(chest|heart|seene|छाती|breath|saans|सांस)/.test(d)) {
    urgency = 'CRITICAL';
    category = 'cardiac event — unconfirmed';
    needed = ['cardiac', 'cathlab', 'icu'];
  } else if (/(fell|fall|gir|accident|bike|blood|khoon|खून)/.test(d)) {
    urgency = 'HIGH';
    category = 'trauma/fall — unconfirmed';
    needed = ['trauma', 'orthopedic', 'icu'];
  } else if (/(faint|behosh|बेहोश|unconscious|stroke|slur|face)/.test(d)) {
    urgency = 'CRITICAL';
    category = 'possible neurological event — unconfirmed';
    needed = ['stroke', 'neuro', 'icu'];
  }
  const allergies = profile?.allergies?.length ? profile.allergies.join(', ') : 'none recorded';
  return {
    urgency,
    urgencyReason: 'Assessed from the caller’s description (mock mode).',
    suspectedCategory: category,
    clinicalSummary:
      `${profile?.fullName || 'Patient'}, ${profile?.age ?? 'age unknown'}. Caller reports: "${description}". ` +
      `Known conditions: ${(profile?.conditions || []).join(', ') || 'none recorded'}. ` +
      `Current medications: ${(profile?.medications || []).join(', ') || 'none recorded'}. ` +
      `Allergies: ${allergies}.`,
    keyRisks: [
      ...(profile?.allergies || []).map((a) => `ALLERGY: ${a}`),
      ...(profile?.pastEvents || []).map((e) => `History: ${e}`),
    ],
    neededCapabilities: needed,
    questionsForCaller: ['Is the patient conscious and breathing?', 'When did this start?', 'Is there any bleeding?'],
    _source: 'mock',
  };
}

async function composeClinicalPicture(description, profile) {
  if (geminiEnabled()) {
    try {
      const result = await callGemini([{ text: CLINICAL_PROMPT(description, profile) }]);
      return { ...result, _source: 'gemini' };
    } catch (err) {
      console.error('[ai] Gemini clinical picture failed, using mock:', err.message);
    }
  }
  return mockClinicalPicture(description, profile);
}

// ---------------------------------------------------------------------------
// 3) Profile → plain-language medical summary (shown under the profile's
//    "Medical summary" tab, next to Insurance — a fast, readable overview
//    for anyone (family, a new doctor, an insurer) who needs the picture
//    without reading every individual field).
// ---------------------------------------------------------------------------

const SUMMARY_PROMPT = (profile) => `You are the information organiser for GoldenBay, a family medical-preparedness app.
Turn this person's stored health profile into a short, plain-language medical summary — the kind a family member could read aloud to a new doctor, or attach when filing an insurance claim. You must NOT diagnose, predict, or recommend treatment — only organise what's already recorded.

Patient profile (JSON): ${JSON.stringify(profile)}

Return JSON exactly in this shape:
{
  "summary": string,          // 3-5 plain sentences: who they are, key conditions, what matters most for their care
  "keyPoints": string[],      // short, scannable highlights — allergies first, then critical medications/conditions
  "insuranceNote": string     // one sentence: insurer + preferred hospital, phrased for a claims or admissions desk
}`;

function mockProfileSummary(profile) {
  const name = profile?.fullName || 'This person';
  const first = name.split(' ')[0];
  const age = profile?.age != null ? `, age ${profile.age}` : '';
  const bg = profile?.bloodGroup ? ` Blood group ${profile.bloodGroup}.` : '';
  const allergies = profile?.allergies || [];
  const meds = profile?.medications || [];
  const conditions = profile?.conditions || [];
  const pastEvents = profile?.pastEvents || [];

  const summary =
    `${name}${age}.${bg} ` +
    (conditions.length ? `Ongoing conditions: ${conditions.join(', ')}. ` : 'No ongoing conditions recorded. ') +
    (meds.length ? `Currently takes ${meds.join('; ')}. ` : 'No regular medications on file. ') +
    (allergies.length ? `Known allergies: ${allergies.join(', ')} — flag before any new medication or contrast dye.` : 'No known allergies on file.');

  const keyPoints = [
    ...allergies.map((a) => `ALLERGY — ${a}`),
    ...meds.map((m) => `Medication — ${m}`),
    ...conditions.map((c) => `Condition — ${c}`),
    ...pastEvents.map((e) => `Past event — ${e}`),
  ];

  const insuranceNote = profile?.insurance
    ? `Insured with ${profile.insurance}${profile.preferredHospital ? `; prefers ${profile.preferredHospital} for admission` : ''} — verify policy details directly with the insurer before relying on this for a claim.`
    : `No insurer on file for ${first} — confirm coverage separately before admission.`;

  return { summary, keyPoints, insuranceNote, _source: 'mock' };
}

async function summarizeProfile(profile) {
  if (geminiEnabled()) {
    try {
      const result = await callGemini([{ text: SUMMARY_PROMPT(profile) }]);
      return { ...result, _source: 'gemini' };
    } catch (err) {
      console.error('[ai] Gemini profile summary failed, using mock:', err.message);
    }
  }
  return mockProfileSummary(profile);
}

module.exports = { draftProfileFromImage, composeClinicalPicture, summarizeProfile, geminiEnabled };