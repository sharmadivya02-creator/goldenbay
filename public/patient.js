// patient.js — the patient view: profile management + the emergency flow.

const $ = (id) => document.getElementById(id);
let profiles = [];
let currentLocation = null;
let socket = null;
let liveMap = null;
let hospitals = [];

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  try {
    const health = await api('GET', '/v1/health');
    $('aiBadge').textContent = health.ai === 'gemini' ? '✦ Gemini live' : 'mock AI';
    const h = await api('GET', '/v1/hospitals');
    hospitals = h.hospitals;
    await loadProfiles();
  } catch (err) {
    toast('Could not reach the server: ' + err.message);
  }
})();

async function loadProfiles() {
  const data = await api('GET', '/v1/profiles');
  profiles = data.profiles;
  $('profileSelect').innerHTML = profiles
    .map((p) => `<option value="${p.id}">${esc(p.fullName)}${p.age ? ', ' + p.age : ''}</option>`)
    .join('');
}

// ---------------------------------------------------------------------------
// Profile creation + AI draft
// ---------------------------------------------------------------------------
$('btnNewProfile').onclick = () => $('profileForm').classList.toggle('hidden');

$('btnDraft').onclick = async () => {
  const file = $('rxPhoto').files[0];
  if (!file) return toast('Choose a prescription photo first');
  $('btnDraft').disabled = true;
  $('draftStatus').textContent = '✦ Reading the document…';
  try {
    // FileReader turns the image into base64 text so it can travel inside JSON.
    const base64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const { draft } = await api('POST', '/v1/profiles/draft-from-image', {
      imageBase64: base64,
      mimeType: file.type,
    });
    if (draft.fullName) $('pfName').value = draft.fullName;
    if (draft.age) $('pfAge').value = draft.age;
    if (draft.bloodGroup) $('pfBlood').value = draft.bloodGroup;
    $('pfAllergies').value = (draft.allergies || []).join(', ');
    $('pfMeds').value = (draft.medications || []).join(', ');
    $('pfConditions').value = (draft.conditions || []).join(', ');
    const extra = draft.illegibleParts?.length ? ` Could not read: ${draft.illegibleParts.join('; ')}.` : '';
    $('draftStatus').textContent =
      `${draft._source === 'gemini' ? '✦ Gemini' : 'Mock AI'} drafted the fields below (confidence: ${draft.confidence}).` +
      extra + ' Please review and correct before saving.';
  } catch (err) {
    $('draftStatus').textContent = 'Draft failed: ' + err.message;
  }
  $('btnDraft').disabled = false;
};

$('btnSaveProfile').onclick = async () => {
  const split = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
  const contactRaw = $('pfContact').value.trim();
  const [cName, cPhone] = contactRaw.split(',').map((s) => s?.trim());
  try {
    const { profile } = await api('POST', '/v1/profiles', {
      fullName: $('pfName').value,
      age: $('pfAge').value,
      bloodGroup: $('pfBlood').value,
      allergies: split($('pfAllergies').value),
      medications: split($('pfMeds').value),
      conditions: split($('pfConditions').value),
      emergencyContacts: contactRaw ? [{ name: cName || contactRaw, phone: cPhone || '' }] : [],
    });
    await loadProfiles();
    $('profileSelect').value = profile.id;
    $('profileForm').classList.add('hidden');
    toast('Profile saved ✔');
  } catch (err) {
    toast('Save failed: ' + err.message);
  }
};

// ---------------------------------------------------------------------------
// Emergency flow: SOS → location → describe → confirm → live status
// ---------------------------------------------------------------------------
$('btnSos').onclick = () => {
  $('sosCard').classList.add('hidden');
  $('describeCard').classList.remove('hidden');
  captureLocation();
};

function captureLocation() {
  currentLocation = null;
  if (!navigator.geolocation) {
    $('locStatus').textContent = '📍 No GPS in this browser — using demo location.';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy),
      };
      $('locStatus').textContent = `📍 Location captured (±${currentLocation.accuracy}m)`;
    },
    () => {
      $('locStatus').textContent = '📍 Location unavailable/denied — using demo location so the flow continues.';
    },
    { enableHighAccuracy: true, timeout: 6000 }
  );
}

// Voice input via the browser's speech recognition (Chrome on Android supports it).
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('btnMic').style.display = 'none';
$('btnMic').onclick = () => {
  const rec = new SR();
  rec.lang = 'en-IN';
  rec.interimResults = false;
  $('btnMic').classList.add('listening');
  rec.onresult = (e) => {
    $('description').value = ($('description').value + ' ' + e.results[0][0].transcript).trim();
  };
  rec.onend = () => $('btnMic').classList.remove('listening');
  rec.onerror = () => { $('btnMic').classList.remove('listening'); toast('Mic unavailable — type instead'); };
  rec.start();
};

$('btnCancel').onclick = () => {
  $('describeCard').classList.add('hidden');
  $('sosCard').classList.remove('hidden');
};

$('btnConfirm').onclick = async () => {
  $('btnConfirm').disabled = true;
  try {
    const { emergency } = await api('POST', '/v1/emergencies', {
      profileId: $('profileSelect').value || null,
      description: $('description').value,
      location: currentLocation,
      useDemoLocation: !currentLocation,
    });
    $('describeCard').classList.add('hidden');
    $('liveCard').classList.remove('hidden');
    $('emgId').textContent = '#' + emergency.id.slice(0, 8);
    watchEmergency(emergency);
  } catch (err) {
    toast('Could not create emergency: ' + err.message);
  }
  $('btnConfirm').disabled = false;
};

function watchEmergency(emergency) {
  renderEmergency(emergency);
  socket = io();
  socket.emit('watch:emergency', emergency.id);
  socket.on('emergency:update', (e) => { if (e.id === emergency.id) renderEmergency(e); });
  // Safety net for a classic race: the backend can emit updates BEFORE our
  // socket finishes joining the room. Poll the latest state so nothing is missed.
  const poll = setInterval(async () => {
    try {
      const { emergency: fresh } = await api('GET', '/v1/emergencies/' + emergency.id);
      renderEmergency(fresh);
      if (fresh.status === 'ARRIVED_AT_HOSPITAL') clearInterval(poll);
    } catch { /* transient network issue — next poll retries */ }
  }, 4000);
  socket.on('ambulance:position', (msg) => {
    if (msg.emergencyId !== emergency.id) return;
    $('etaBox').classList.remove('hidden');
    $('etaMin').textContent = msg.etaMinutes + ' min';
    if (liveMap) liveMap.moveAmbulance(msg.position);
  });
}

function renderEmergency(e) {
  renderTimeline($('timeline'), e.status);
  renderClinicalPicture($('clinicalBox'), e.clinicalPicture);

  if (e.hospitalName) {
    $('hospitalBox').innerHTML = `
      <p class="kv" style="color:var(--text);font-size:16px"><b>🏥</b> <strong>${esc(e.hospitalName)}</strong></p>
      <p class="kv"><b>Distance</b> ${e.hospitalDistanceKm} km · <b>Capability match</b> ${e.capabilityMatch}%</p>
      ${e.alternatives?.length ? `<p class="muted">Also considered: ${e.alternatives.map((a) => `${esc(a.name)} (${a.capabilityMatch}%, ${a.distanceKm}km)`).join(' · ')}</p>` : ''}
    `;
    if (!liveMap) {
      liveMap = createLiveMap('map');
    }
    const hosp = hospitals.find((h) => h.id === e.hospitalId);
    liveMap.setScene(e, hosp);
  }
  if (typeof e.etaMinutes === 'number') {
    $('etaBox').classList.remove('hidden');
    $('etaMin').textContent = e.status === 'ARRIVED_AT_HOSPITAL' ? 'Arrived' : e.etaMinutes + ' min';
  }
}
