// seed.js — loads demo data on first boot.
//
// EVERYTHING here is synthetic. Hospital names are fictional on purpose:
// a demo must never make claims ("accepts patients", "has an ICU bed") about
// real institutions. The demo patient profile is equally fictional.

const store = require('./store');

// Demo city centre (New Delhi). If a user's real GPS is far from here,
// the frontend offers a "demo location" so the map still makes sense.
const DEMO_CENTER = { lat: 28.6139, lng: 77.209 };

const HOSPITALS = [
  {
    name: 'Sunrise Multispeciality Hospital',
    lat: 28.6318, lng: 77.2205,
    capabilities: ['cardiac', 'icu', 'trauma', 'stroke'],
    erBeds: 4, cathLab: true,
  },
  {
    name: 'Yamuna Valley Institute of Medical Sciences',
    lat: 28.5955, lng: 77.244,
    capabilities: ['trauma', 'orthopedic', 'icu', 'burns'],
    erBeds: 6, cathLab: false,
  },
  {
    name: 'Lotus Heart Centre',
    lat: 28.5672, lng: 77.21,
    capabilities: ['cardiac', 'cathlab', 'icu'],
    erBeds: 2, cathLab: true,
  },
  {
    name: 'Ashoka General Hospital',
    lat: 28.6448, lng: 77.1734,
    capabilities: ['general', 'pediatric', 'maternity'],
    erBeds: 8, cathLab: false,
  },
  {
    name: 'Silverline Neuro & Stroke Institute',
    lat: 28.588, lng: 77.166,
    capabilities: ['stroke', 'neuro', 'icu'],
    erBeds: 3, cathLab: false,
  },
  {
    name: 'Greenfield Children’s Hospital',
    lat: 28.653, lng: 77.231,
    capabilities: ['pediatric', 'general'],
    erBeds: 5, cathLab: false,
  },
];

// Generates a plain, schematic placeholder "photo" for a document — a flat
// card with a title and a few blank lines. Deliberately generic (no real
// logos or layouts copied from any real institution's actual paperwork) so
// the demo can show the "tap Insurance / Medicines to see the photo" feature
// without needing the presenter to snap a real photo first.
function demoDoc(id, category, title, subtitle, bg, fg) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="380">
    <rect width="600" height="380" rx="18" fill="${bg}"/>
    <rect x="24" y="24" width="552" height="332" rx="12" fill="none" stroke="${fg}" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="6 8"/>
    <text x="48" y="90" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="${fg}">${title}</text>
    <text x="48" y="122" font-family="Arial, sans-serif" font-size="16" fill="${fg}" fill-opacity="0.75">${subtitle}</text>
    ${[1, 2, 3, 4].map((i) => `<rect x="48" y="${150 + i * 34}" width="${i % 2 ? 420 : 320}" height="10" rx="5" fill="${fg}" fill-opacity="0.18"/>`).join('')}
    <text x="48" y="352" font-family="Arial, sans-serif" font-size="12" fill="${fg}" fill-opacity="0.5">SYNTHETIC DEMO DOCUMENT — not a real record</text>
  </svg>`;
  return { id, category, name: title, mimeType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg) };
}

// The demo family — deliberately the same four people GoldenBay's design
// reference uses, so a live demo matches the pitch deck exactly.
const DEMO_FAMILY = [
  {
    id: 'demo-rajesh',
    fullName: 'Rajesh Sharma (DEMO)',
    relation: 'Husband',
    age: 55,
    bloodGroup: 'B+',
    allergies: ['Sulfa drugs', 'Shellfish'],
    medications: ['Statins — daily', 'Ace inhibitors — daily'],
    conditions: ['Hypertension', 'Pre-diabetes'],
    pastEvents: [],
    insurance: 'Star Health',
    preferredHospital: 'Apex Hospital',
    emergencyContacts: [{ name: 'Aisha (Wife)', phone: '+91-90000-00001' }],
    documents: [
      demoDoc('doc-demo-1', 'insurance', 'Policy card (DEMO)', 'Star Health · Member ID DEMO-8821', '#eaf1fb', '#3a6fb0'),
      demoDoc('doc-demo-2', 'prescription', 'Prescription (DEMO)', 'Statins + Ace inhibitors — daily', '#fbe9ec', '#7c0d20'),
      demoDoc('doc-demo-3', 'report', 'Lab report (DEMO)', 'Fasting glucose panel, June 2026', '#fbf1de', '#96701c'),
    ],
    isDemo: true,
  },
  {
    id: 'demo-aisha',
    fullName: 'Aisha Sharma (DEMO)',
    relation: 'Wife',
    age: 51,
    bloodGroup: 'O+',
    allergies: ['Penicillin'],
    medications: ['Levothyroxine 50mcg — daily, morning'],
    conditions: ['Mild hypothyroidism'],
    pastEvents: ['Appendectomy, 2011'],
    insurance: 'Star Health',
    preferredHospital: 'Apex Hospital',
    emergencyContacts: [{ name: 'Rajesh (Husband)', phone: '+91-90000-00002' }],
    documents: [
      demoDoc('doc-demo-4', 'insurance', 'Policy card (DEMO)', 'Star Health · Member ID DEMO-8822', '#eaf1fb', '#3a6fb0'),
      demoDoc('doc-demo-5', 'prescription', 'Prescription (DEMO)', 'Levothyroxine 50mcg — daily, morning', '#fbe9ec', '#7c0d20'),
      demoDoc('doc-demo-6', 'report', 'Lab report (DEMO)', 'Thyroid panel (TSH), March 2026', '#fbf1de', '#96701c'),
    ],
    isDemo: true,
  },
  {
    id: 'demo-mridula',
    fullName: 'Mridula Sharma (DEMO)',
    relation: 'Mother',
    age: 79,
    bloodGroup: 'A+',
    allergies: ['Aspirin'],
    medications: ['Calcium supplement — daily', 'Alendronate — weekly, Sunday morning'],
    conditions: ['Osteoporosis', 'Mild hearing loss'],
    pastEvents: ['Hip fracture, 2022'],
    insurance: 'Star Health',
    preferredHospital: 'Apex Hospital',
    emergencyContacts: [{ name: 'Rajesh (Son)', phone: '+91-90000-00002' }],
    documents: [
      demoDoc('doc-demo-7', 'insurance', 'Policy card (DEMO)', 'Star Health · Member ID DEMO-8823', '#eaf1fb', '#3a6fb0'),
      demoDoc('doc-demo-8', 'prescription', 'Prescription (DEMO)', 'Calcium + Alendronate — see schedule', '#fbe9ec', '#7c0d20'),
      demoDoc('doc-demo-9', 'report', 'Scan report (DEMO)', 'Bone density (DEXA) scan, Jan 2026', '#fbf1de', '#96701c'),
    ],
    isDemo: true,
  },
  {
    id: 'demo-rohan',
    fullName: 'Rohan Sharma (DEMO)',
    relation: 'Son',
    age: 8,
    bloodGroup: 'B+',
    allergies: ['Peanuts'],
    medications: ['Salbutamol inhaler — as needed for asthma'],
    conditions: ['Mild asthma'],
    pastEvents: ['Hospitalised for bronchitis, 2023'],
    insurance: 'Star Health',
    preferredHospital: "Greenfield Children's Hospital",
    emergencyContacts: [{ name: 'Aisha (Mother)', phone: '+91-90000-00001' }],
    documents: [
      demoDoc('doc-demo-10', 'insurance', 'Policy card (DEMO)', 'Star Health · Member ID DEMO-8824', '#eaf1fb', '#3a6fb0'),
      demoDoc('doc-demo-11', 'prescription', 'Prescription (DEMO)', 'Salbutamol inhaler — as needed', '#fbe9ec', '#7c0d20'),
      demoDoc('doc-demo-12', 'report', 'Allergy report (DEMO)', 'Peanut allergy panel, Nov 2025', '#fbf1de', '#96701c'),
    ],
    isDemo: true,
  },
];

function seed() {
  if (store.all('hospitals').length === 0) {
    store.setAll(
      'hospitals',
      HOSPITALS.map((h, i) => ({ id: `hosp-${i + 1}`, ...h }))
    );
    console.log(`[seed] loaded ${HOSPITALS.length} fictional hospitals`);
  }
  // Demo profiles now carry stable ids (demo-rajesh, demo-aisha, ...) instead
  // of random ones. That means every boot can SYNC them to whatever's
  // currently written above — so editing this file and redeploying always
  // shows up live, instead of silently no-op'ing because "some demo profile
  // already exists" (which is what happened before: Rohan's medicines stayed
  // "None recorded" on the live site even after the seed data was fixed,
  // because the already-stored record was never touched again).
  const fixedIds = new Set(DEMO_FAMILY.map((p) => p.id));
  // Also drop any leftover demo profiles from before this fix (they had
  // random ids), so upgrading doesn't leave stale duplicate family members.
  const withoutStaleDemo = store.all('profiles').filter((p) => !p.isDemo || fixedIds.has(p.id));
  if (withoutStaleDemo.length !== store.all('profiles').length) {
    store.setAll('profiles', withoutStaleDemo);
  }
  DEMO_FAMILY.forEach((p) => {
    if (store.find('profiles', p.id)) store.update('profiles', p.id, p);
    else store.insert('profiles', p);
  });
  console.log(`[seed] synced demo family (${DEMO_FAMILY.length} profiles)`);
}

module.exports = { seed, DEMO_CENTER };