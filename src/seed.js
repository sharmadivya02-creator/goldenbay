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

const DEMO_PROFILE = {
  fullName: 'Ramesh Kumar (DEMO)',
  age: 62,
  bloodGroup: 'B+',
  allergies: ['Penicillin'],
  medications: ['Metformin 500mg (twice daily)', 'Telmisartan 40mg (morning)'],
  conditions: ['Type 2 Diabetes (since 2014)', 'Hypertension'],
  pastEvents: ['Angioplasty, 2021'],
  insurance: 'DemoCare Health — Policy #DEMO-4821',
  preferredHospital: 'Lotus Heart Centre',
  emergencyContacts: [
    { name: 'Priya Kumar (daughter)', phone: '+91-90000-00001' },
    { name: 'Amit Kumar (son)', phone: '+91-90000-00002' },
  ],
  isDemo: true,
};

function seed() {
  if (store.all('hospitals').length === 0) {
    store.setAll(
      'hospitals',
      HOSPITALS.map((h, i) => ({ id: `hosp-${i + 1}`, ...h }))
    );
    console.log(`[seed] loaded ${HOSPITALS.length} fictional hospitals`);
  }
  const hasDemoProfile = store.all('profiles').some((p) => p.isDemo);
  if (!hasDemoProfile) {
    store.insert('profiles', DEMO_PROFILE);
    console.log('[seed] loaded demo patient profile (Ramesh Kumar)');
  }
}

module.exports = { seed, DEMO_CENTER };
