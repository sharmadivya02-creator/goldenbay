// family.js — the family member's live view of an emergency.

const $ = (id) => document.getElementById(id);
let hospitals = [];
let liveMap = null;
let watchingId = null;
const socket = io();

(async function boot() {
  hospitals = (await api('GET', '/v1/hospitals')).hospitals;
  await refreshList();
  // If a new emergency starts while this page is open, show it.
  socket.emit('watch:hospital-feed');
  socket.on('emergency:update', (e) => {
    if (watchingId && e.id === watchingId) render(e);
    else if (!watchingId) refreshList();
  });
  socket.on('ambulance:position', (msg) => {
    if (msg.emergencyId !== watchingId) return;
    $('etaBox').classList.remove('hidden');
    $('etaMin').textContent = msg.etaMinutes + ' min';
    if (liveMap) liveMap.moveAmbulance(msg.position);
  });
})();

async function refreshList() {
  const { emergencies } = await api('GET', '/v1/emergencies');
  const active = emergencies.filter((e) => e.status !== 'ARRIVED_AT_HOSPITAL');
  if (!active.length && !emergencies.length) {
    $('list').textContent = 'No emergencies right now. Trigger one from the patient view to see this update live.';
    return;
  }
  const items = (active.length ? active : emergencies.slice(0, 3));
  $('list').innerHTML = items
    .map(
      (e) => `<p><a href="#" data-id="${e.id}" style="color:var(--blue)">
        ${esc(e.patientName)} — ${new Date(e.createdAt).toLocaleTimeString()} (${esc(e.status)})</a></p>`
    )
    .join('');
  $('list').querySelectorAll('a').forEach((a) => {
    a.onclick = async (ev) => {
      ev.preventDefault();
      const { emergency } = await api('GET', '/v1/emergencies/' + a.dataset.id);
      watch(emergency);
    };
  });
}

function watch(e) {
  watchingId = e.id;
  $('pickCard').classList.add('hidden');
  $('liveCard').classList.remove('hidden');
  $('who').textContent = `${e.patientName} — emergency #${e.id.slice(0, 8)}`;
  socket.emit('watch:emergency', e.id);
  render(e);
}

function render(e) {
  renderTimeline($('timeline'), e.status);
  if (e.hospitalName) {
    $('hospitalBox').innerHTML = `<strong>${esc(e.hospitalName)}</strong> · ${e.hospitalDistanceKm} km away · capability match ${e.capabilityMatch}%`;
    if (!liveMap) liveMap = createLiveMap('map');
    liveMap.setScene(e, hospitals.find((h) => h.id === e.hospitalId));
    if (e.ambulance) liveMap.moveAmbulance(e.ambulance);
  }
  if (typeof e.etaMinutes === 'number') {
    $('etaBox').classList.remove('hidden');
    $('etaMin').textContent = e.status === 'ARRIVED_AT_HOSPITAL' ? 'Arrived ✔' : e.etaMinutes + ' min';
  }
}
