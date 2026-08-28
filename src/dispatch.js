// dispatch.js — hospital matching + the simulated ambulance.
//
// Matching: "right hospital, not just nearest". We score every hospital by
//   (a) capability match with what this emergency needs, and
//   (b) distance (closer is better).
// Capability dominates: a cath-lab 4km away beats a general hospital 1km away
// for a suspected cardiac event.
//
// The ambulance is SIMULATED: a timer moves it along the route and broadcasts
// its position over WebSockets. Later, a real ambulance partner's GPS feed
// plugs into this exact same broadcast — that boundary is the whole point.

const store = require('./store');

// Haversine formula: distance in km between two lat/lng points on a sphere.
function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function matchHospital(location, neededCapabilities) {
  const hospitals = store.all('hospitals');
  const needed = (neededCapabilities || []).map((c) => c.toLowerCase());

  const scored = hospitals.map((h) => {
    const dist = distanceKm(location, h);
    const matches = needed.filter((c) => h.capabilities.includes(c)).length;
    const capabilityScore = needed.length ? matches / needed.length : 0.5;
    // Weighted score: capability worth up to 100 points, distance subtracts up to ~30.
    const score = capabilityScore * 100 - Math.min(dist, 30);
    return { hospital: h, dist, capabilityScore, score };
  });

  scored.sort((x, y) => y.score - x.score);
  const best = scored[0];
  return {
    hospital: best.hospital,
    distanceKm: Math.round(best.dist * 10) / 10,
    capabilityMatch: Math.round(best.capabilityScore * 100),
    alternatives: scored.slice(1, 3).map((s) => ({
      name: s.hospital.name,
      distanceKm: Math.round(s.dist * 10) / 10,
      capabilityMatch: Math.round(s.capabilityScore * 100),
    })),
  };
}

// Straight-line interpolation between two points, n steps.
function makeRoute(from, to, steps) {
  const route = [];
  for (let i = 0; i <= steps; i++) {
    route.push({
      lat: from.lat + ((to.lat - from.lat) * i) / steps,
      lng: from.lng + ((to.lng - from.lng) * i) / steps,
    });
  }
  return route;
}

const AMBULANCE_SPEED_KMH = 40; // assumed average city speed for ETA maths
const TICK_MS = 2000; // broadcast position every 2 seconds
const DEMO_TIME_SCALE = 10; // demo runs 10x faster than real time

// Runs the whole ambulance lifecycle for one emergency, emitting Socket.IO events.
function simulateAmbulance(io, emergency) {
  const hospital = store.find('hospitals', emergency.hospitalId);
  const patientLoc = emergency.location;
  const hospitalLoc = { lat: hospital.lat, lng: hospital.lng };

  // The ambulance starts near the hospital (as if dispatched from its bay).
  const start = { lat: hospitalLoc.lat + 0.004, lng: hospitalLoc.lng - 0.004 };

  const legOutKm = distanceKm(start, patientLoc);
  const legBackKm = distanceKm(patientLoc, hospitalLoc);
  const etaOutMin = Math.max(1, Math.round((legOutKm / AMBULANCE_SPEED_KMH) * 60));
  const etaBackMin = Math.max(1, Math.round((legBackKm / AMBULANCE_SPEED_KMH) * 60));

  const outSteps = Math.max(4, Math.round(((etaOutMin * 60) / DEMO_TIME_SCALE / TICK_MS) * 1000));
  const backSteps = Math.max(4, Math.round(((etaBackMin * 60) / DEMO_TIME_SCALE / TICK_MS) * 1000));
  const routeOut = makeRoute(start, patientLoc, outSteps);
  const routeBack = makeRoute(patientLoc, hospitalLoc, backSteps);

  const emit = (event, payload) => {
    io.to(`emergency:${emergency.id}`).emit(event, payload);
    io.to('hospital-feed').emit(event, payload);
  };

  const setStatus = (status, extra = {}) => {
    const updated = store.update('emergencies', emergency.id, { status, ...extra });
    emit('emergency:update', updated);
  };

  setStatus('AMBULANCE_DISPATCHED', { etaMinutes: etaOutMin, ambulance: start, route: [...routeOut, ...routeBack] });

  let i = 0;
  const leg1 = setInterval(() => {
    i++;
    const pos = routeOut[Math.min(i, routeOut.length - 1)];
    const remainingMin = Math.max(0, Math.round(etaOutMin * (1 - i / routeOut.length)));
    store.update('emergencies', emergency.id, { ambulance: pos, etaMinutes: remainingMin });
    emit('ambulance:position', { emergencyId: emergency.id, position: pos, etaMinutes: remainingMin, leg: 'to_patient' });

    if (i >= routeOut.length - 1) {
      clearInterval(leg1);
      setStatus('PATIENT_PICKED_UP', { etaMinutes: etaBackMin });

      let j = 0;
      const leg2 = setInterval(() => {
        j++;
        const pos2 = routeBack[Math.min(j, routeBack.length - 1)];
        const remaining2 = Math.max(0, Math.round(etaBackMin * (1 - j / routeBack.length)));
        store.update('emergencies', emergency.id, { ambulance: pos2, etaMinutes: remaining2 });
        emit('ambulance:position', { emergencyId: emergency.id, position: pos2, etaMinutes: remaining2, leg: 'to_hospital' });

        if (j >= routeBack.length - 1) {
          clearInterval(leg2);
          setStatus('ARRIVED_AT_HOSPITAL', { etaMinutes: 0 });
        }
      }, TICK_MS);
    }
  }, TICK_MS);
}

module.exports = { matchHospital, simulateAmbulance, distanceKm, AMBULANCE_SPEED_KMH };
