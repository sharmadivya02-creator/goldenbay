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

// The demo family — deliberately the same four people GoldenBay's design
// reference uses, so a live demo matches the pitch deck exactly.
const DEMO_FAMILY = [
  {
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
    isDemo: true,
  },
  {
    fullName: 'Aisha Sharma (DEMO)',
    relation: 'Wife',
    age: 51,
    bloodGroup: 'O+',
    allergies: ['Penicillin'],
    medications: [],
    conditions: [],
    pastEvents: [],
    insurance: 'Star Health',
    preferredHospital: 'Apex Hospital',
    emergencyContacts: [{ name: 'Rajesh (Husband)', phone: '+91-90000-00002' }],
    isDemo: true,
  },
  {
    fullName: 'Mridula Sharma (DEMO)',
    relation: 'Mother',
    age: 79,
    bloodGroup: 'A+',
    allergies: [],
    medications: ['Calcium supplement — daily'],
    conditions: ['Osteoporosis', 'Mild hearing loss'],
    pastEvents: ['Hip fracture, 2022'],
    insurance: 'Star Health',
    preferredHospital: 'Apex Hospital',
    emergencyContacts: [{ name: 'Rajesh (Son)', phone: '+91-90000-00002' }],
    isDemo: true,
  },
  {
    fullName: 'Rohan Sharma (DEMO)',
    relation: 'Son',
    age: 8,
    bloodGroup: 'B+',
    allergies: ['Peanuts'],
    medications: [],
    conditions: ['Mild asthma'],
    pastEvents: [],
    insurance: 'Star Health',
    preferredHospital: "Greenfield Children's Hospital",
    emergencyContacts: [{ name: 'Aisha (Mother)', phone: '+91-90000-00001' }],
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
  const hasDemoProfiles = store.all('profiles').some((p) => p.isDemo);
  if (!hasDemoProfiles) {
    DEMO_FAMILY.forEach((p) => store.insert('profiles', p));
    console.log(`[seed] loaded demo family (${DEMO_FAMILY.length} profiles)`);
  }
}

module.exports = { seed, DEMO_CENTER };
