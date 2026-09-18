// hospital.js — the ambulance-bay screen.
//
// THE RULE OF THIS SCREEN: it is not a grid of equals. It is a priority screen.
// If someone is doing CPR right now, nothing else matters as much — that
// patient takes over the top of the screen and everyone else shrinks.

const $ = (id) => document.getElementById(id);
const emergencies  = new Map();  // id → latest emergency
const copilotFeeds = new Map();  // id → { jpeg, stats, at }
const copilotScenes = new Map(); // id → what Gemini can see
const socket = io();

let heroId = null;               // which patient currently owns the big slot

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

  // Live pictures from the scene, about twice a second.
  socket.on('copilot:frame', (msg) => {
    const id = msg.emergencyId || newestEmergencyId();
    if (!id) return;
    const isNew = !copilotFeeds.has(id);
    copilotFeeds.set(id, { jpeg: msg.jpeg, stats: msg.stats || {}, at: msg.at });
    if (isNew || heroId !== id) render();   // build or promote the card
    else updateHero();                      // otherwise just swap the picture
  });

  // Gemini's reading of the scene, every few seconds.
  socket.on('copilot:scene', (msg) => {
    const id = msg.emergencyId || newestEmergencyId();
    if (!id) return;
    copilotScenes.set(id, msg.scene);
    updateScene(id);
  });
})();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const URGENCY_RANK = { CRITICAL: 0, HIGH: 1, MODERATE: 2 };

function newestEmergencyId() {
  const list = [...emergencies.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return list[0]?.id || null;
}

function minutesSince(ts) {
  return ts ? (Date.now() - new Date(ts).getTime()) / 60000 : 999;
}

function rateClass(r) {
  if (!r) return 'off';
  if (r >= 100 && r <= 120) return 'good';
  if (r < 70 || r > 150) return 'bad';
  return 'off';
}

function mmss(sec) {
  if (!sec && sec !== 0) return '--:--';
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}

function etaText(e) {
  if (e.status === 'ARRIVED_AT_HOSPITAL') return '<span style="color:var(--green)">AT THE BAY</span>';
  if (typeof e.etaMinutes === 'number') return `${e.etaMinutes} min out`;
  return 'dispatching…';
}

// A feed older than 8 seconds means the rescuer closed the page.
setInterval(() => {
  let changed = false;
  for (const [id, f] of copilotFeeds) {
    if (Date.now() - f.at > 8000) {
      copilotFeeds.delete(id);
      copilotScenes.delete(id);
      changed = true;
    }
  }
  if (changed) render();
}, 2000);

// ---------------------------------------------------------------------------
// the main draw
// ---------------------------------------------------------------------------
function render() {
  const list = [...emergencies.values()]
    .filter((e) => e.status !== 'ARRIVED_AT_HOSPITAL' || minutesSince(e.updatedAt) < 3)
    .sort((a, b) => {
      // 1st: anyone with CPR happening right now
      const fa = copilotFeeds.has(a.id) ? 0 : 1;
      const fb = copilotFeeds.has(b.id) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      // 2nd: how urgent
      const ua = URGENCY_RANK[a.clinicalPicture?.urgency] ?? 3;
      const ub = URGENCY_RANK[b.clinicalPicture?.urgency] ?? 3;
      if (ua !== ub) return ua - ub;
      // 3rd: newest first
      return a.createdAt < b.createdAt ? 1 : -1;
    });

  $('empty').style.display = list.length ? 'none' : 'block';

  const withFeed = list.filter((e) => copilotFeeds.has(e.id));
  heroId = withFeed[0]?.id || null;

  let html = '';

  if (heroId) {
    const hero = list.find((e) => e.id === heroId);
    html += heroCard(hero);

    // a second CPR case, if there somehow is one
    if (withFeed.length > 1) {
      html += `<div class="bay-secondary-feeds">` +
        withFeed.slice(1).map((e) => secondaryFeed(e)).join('') +
        `</div>`;
    }

    const rest = list.filter((e) => !withFeed.slice(0, 1).some((h) => h.id === e.id));
    if (rest.length) {
      html += `<div class="bay-others-label">Other incoming — ${rest.length}</div>`;
      html += `<div class="bay-grid">` + rest.map(card).join('') + `</div>`;
    }
  } else {
    html += `<div class="bay-grid">` + list.map(card).join('') + `</div>`;
  }

  $('grid').outerHTML = `<div id="grid">${html}</div>`;
}

// ---------------------------------------------------------------------------
// the big card — a patient with CPR happening right now
// ---------------------------------------------------------------------------
function heroCard(e) {
  const cp = e.clinicalPicture;
  const f  = copilotFeeds.get(e.id) || {};
  const s  = f.stats || {};
  const urgency = cp?.urgency || 'CRITICAL';

  return `
  <div class="card bay-hero ${urgency}">
    <div class="bay-hero__alert">CPR IN PROGRESS AT THE SCENE</div>

    <div class="bay-hero__body">
      <div class="bay-hero__left">
        <div class="feed" id="feed-${e.id}">
          <img id="feedImg-${e.id}" src="${f.jpeg || ''}" alt="live view from the scene" />
          <div class="feed__tag">LIVE FROM THE SCENE</div>
        </div>
        <div class="bay-hero__scene" id="scene-${e.id}">
          <span class="muted">reading the scene…</span>
        </div>
      </div>

      <div class="bay-hero__right">
        <p class="patient" style="margin-top:0">${esc(e.patientName)}</p>
        <p>
          <span class="badge ${urgency}">${esc(urgency)}</span>
          <span style="float:right;font-weight:700">${etaText(e)}</span>
        </p>

        <div class="vitals" id="vitals-${e.id}">${vitalsHTML(s)}</div>

        <p class="kv"><b>Suspected</b> ${esc(cp?.suspectedCategory || 'analysing…')}</p>
        <p style="font-size:14px">${esc(cp?.clinicalSummary || '')}</p>
        ${cp?.keyRisks?.length
          ? `<h3>Key risks</h3><ul class="plain">${cp.keyRisks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
          : ''}
        <p class="muted">→ ${esc(e.hospitalName || 'matching hospital…')}</p>
      </div>
    </div>
  </div>`;
}

// The numbers. These matter more to a doctor than the picture does.
function vitalsHTML(s) {
  return `
    <div class="vital big">
      <div class="vital__num ${rateClass(s.rate)}">${s.rate || '--'}</div>
      <div class="vital__lbl">compressions / min</div>
    </div>
    <div class="vital">
      <div class="vital__num">${mmss(s.elapsedSec)}</div>
      <div class="vital__lbl">CPR duration</div>
    </div>
    <div class="vital">
      <div class="vital__num">${s.compressions || 0}</div>
      <div class="vital__lbl">total compressions</div>
    </div>
    <div class="vital">
      <div class="vital__num ${s.handsOk === false ? 'bad' : s.handsOk ? 'good' : ''}">${
        s.handsOk === false ? 'OFF' : s.handsOk ? 'OK' : '—'
      }</div>
      <div class="vital__lbl">hand placement</div>
    </div>`;
}

// Swap the picture and numbers without redrawing the page.
function updateHero() {
  if (!heroId) return;
  const f = copilotFeeds.get(heroId);
  const img = document.getElementById('feedImg-' + heroId);
  const box = document.getElementById('vitals-' + heroId);
  if (!f || !img || !box) return render();
  if (f.jpeg) img.src = f.jpeg;
  box.innerHTML = vitalsHTML(f.stats || {});
}

// Gemini's description of the scene.
function updateScene(id) {
  const el = document.getElementById('scene-' + id);
  const sc = copilotScenes.get(id);
  if (!el || !sc) return;

  const chips = [];
  if (sc.surface === 'soft') chips.push(['bad', 'SOFT SURFACE — move to floor']);
  if (sc.visibleBleeding === 'significant') chips.push(['bad', 'significant bleeding visible']);
  if (sc.cprInProgress) chips.push(['good', 'compressions visible']);
  if (sc.peopleHelping) chips.push(['', sc.peopleHelping + ' helping']);
  (sc.hazards || []).forEach((h) => chips.push(['bad', 'hazard: ' + h]));

  el.innerHTML = `
    <div class="scene__tag">✦ ${sc._source === 'gemini' ? 'Gemini' : 'mock AI'} — what the camera can see</div>
    <p class="scene__note">${esc(sc.notesForER || '')}</p>
    <div class="scene__chips">${chips.map(([t, txt]) => `<span class="scene__chip ${t}">${esc(txt)}</span>`).join('')}</div>
    ${sc.cannotSee?.length ? `<p class="scene__cant">Not visible in this view: ${esc(sc.cannotSee.join(', '))}</p>` : ''}`;
}

// ---------------------------------------------------------------------------
// a small feed, if a second CPR case ever appears
// ---------------------------------------------------------------------------
function secondaryFeed(e) {
  const f = copilotFeeds.get(e.id) || {};
  const s = f.stats || {};
  return `
  <div class="feed feed--small">
    <img src="${f.jpeg || ''}" alt="scene" />
    <div class="feed__stats">
      <span class="feed__rate ${rateClass(s.rate)}">${s.rate || '--'}</span>
      <span class="feed__unit">/min · ${esc(e.patientName)}</span>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// the ordinary card — everyone without CPR happening
// ---------------------------------------------------------------------------
function card(e) {
  const cp = e.clinicalPicture;
  const urgency = cp?.urgency || '…';
  return `
  <div class="card bay-card ${urgency}">
    <p>
      <span class="badge ${urgency}">${esc(urgency)}</span>
      <span class="badge source">${cp ? (cp._source === 'gemini' ? '✦ Gemini' : 'mock AI') : 'analysing…'}</span>
      <span style="float:right;font-weight:700">${etaText(e)}</span>
    </p>
    <p class="patient">${esc(e.patientName)}</p>
    <p class="kv"><b>Suspected</b> ${esc(cp?.suspectedCategory || 'analysing…')}</p>
    <p style="font-size:14px">${esc(cp?.clinicalSummary || '')}</p>
    ${cp?.keyRisks?.length
      ? `<h3>Key risks</h3><ul class="plain">${cp.keyRisks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
      : ''}
    <p class="muted">→ ${esc(e.hospitalName || 'matching hospital…')} · caller said: “${esc(e.description || '—')}”</p>
  </div>`;
}