// hospital.js — the ambulance-bay screen: live incoming patients, richest data first.

const $ = (id) => document.getElementById(id);
const emergencies = new Map(); // id → latest emergency object
const socket = io();

setInterval(() => {
  $('clock').textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
}, 1000);

(async function boot() {
  const data = await api('GET', '/v1/emergencies');
  data.emergencies.forEach((e) => emergencies.set(e.id, e));
  render();
  socket.emit('watch:hospital-feed');
  socket.on('emergency:update', (e) => { emergencies.set(e.id, e); render(); });
  socket.on('ambulance:position', (msg) => {
    const e = emergencies.get(msg.emergencyId);
    if (e) { e.etaMinutes = msg.etaMinutes; render(); }
  });
})();

const URGENCY_RANK = { CRITICAL: 0, HIGH: 1, MODERATE: 2 };

function render() {
  const list = [...emergencies.values()]
    .filter((e) => e.status !== 'ARRIVED_AT_HOSPITAL' || minutesSince(e.updatedAt) < 3)
    .sort((a, b) => {
      const ua = URGENCY_RANK[a.clinicalPicture?.urgency] ?? 3;
      const ub = URGENCY_RANK[b.clinicalPicture?.urgency] ?? 3;
      return ua - ub || (a.createdAt < b.createdAt ? 1 : -1);
    });

  $('empty').style.display = list.length ? 'none' : 'block';
  $('grid').innerHTML = list.map(card).join('');
}

function minutesSince(ts) {
  return ts ? (Date.now() - new Date(ts).getTime()) / 60000 : 999;
}

function card(e) {
  const cp = e.clinicalPicture;
  const urgency = cp?.urgency || '…';
  const eta =
    e.status === 'ARRIVED_AT_HOSPITAL'
      ? '<span style="color:var(--green)">AT THE BAY</span>'
      : typeof e.etaMinutes === 'number'
      ? `${e.etaMinutes} min out`
      : 'dispatching…';
  return `
  <div class="card bay-card ${urgency}">
    <p>
      <span class="badge ${urgency}">${esc(urgency)}</span>
      <span class="badge source">${cp ? (cp._source === 'gemini' ? '✦ Gemini' : 'mock AI') : 'analysing…'}</span>
      <span style="float:right;font-weight:700">${eta}</span>
    </p>
    <p class="patient">${esc(e.patientName)}</p>
    <p class="kv"><b>Suspected</b> ${esc(cp?.suspectedCategory || 'analysing…')}</p>
    <p style="font-size:14px">${esc(cp?.clinicalSummary || '')}</p>
    ${cp?.keyRisks?.length ? `<h3>Key risks</h3><ul class="plain">${cp.keyRisks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    <p class="muted">→ ${esc(e.hospitalName || 'matching hospital…')} · caller said: “${esc(e.description || '—')}”</p>
  </div>`;
}
