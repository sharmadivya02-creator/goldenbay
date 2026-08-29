// patient.js — the family app: manage profiles + run the emergency flow.

const $ = (id) => document.getElementById(id);
let profiles = [];
let hospitals = [];
let currentLocation = null;
let socket = null;
let liveMap = null;
let activeTab = 'home';
let activeProfileId = localStorage.getItem('gb_activeProfileId') || null;
let viewingProfileId = null; // profile currently open on the detail screen
let sheetMode = 'create';    // 'create' — editing existing profiles isn't wired to PUT yet
let currentEmergencyId = null;

// A calm, muted palette for avatar backgrounds — picked deterministically per name.
const AVATAR_COLORS = ['#b3122c', '#7c5b2f', '#3a6fb0', '#2f8f5b', '#8a5aa8', '#b9862f', '#5b6f8f'];
function avatarColor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}
function avatarHTML(name, size = 'md') {
  return `<div class="avatar ${size}" style="background:${avatarColor(name)}">${initials(name)}</div>`;
}

// ---------------------------------------------------------------------------
// Icons — fill every icon slot once the DOM + icons.js are ready.
// ---------------------------------------------------------------------------
function paintIcons() {
  $('brandMark').innerHTML = icon('heartPulse', { size: 19 });
  $('homeSosIcon').innerHTML = icon('heartPulse', { size: 24 });
  $('homeSosChev').innerHTML = icon('chevronRight', { size: 20 });
  $('addMemberIcon').innerHTML = icon('plus', { size: 17 });
  $('btnDetailBack').innerHTML = icon('arrowLeft', { size: 18 });
  $('emgBell').innerHTML = icon('bell', { size: 17 });
  $('emgWarnIcon').innerHTML = icon('alertTriangle', { size: 18 });
  $('micIcon').innerHTML = icon('mic', { size: 28 });
  $('moreFamilyIcon').innerHTML = icon('users', { size: 16 });
  $('moreFamilyChev').innerHTML = icon('chevronRight', { size: 16 });
  $('moreHospitalIcon').innerHTML = icon('hospital', { size: 16 });
  $('moreHospitalChev').innerHTML = icon('chevronRight', { size: 16 });
  $('moreManageIcon').innerHTML = icon('edit', { size: 16 });
  $('moreManageChev').innerHTML = icon('chevronRight', { size: 16 });
  $('tabHomeIcon').innerHTML = icon('home', { size: 21 });
  $('tabProfilesIcon').innerHTML = icon('users', { size: 21 });
  $('tabEmergencyIcon').innerHTML = icon('heartPulse', { size: 21 });
  $('tabMoreIcon').innerHTML = icon('menu', { size: 21 });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  paintIcons();
  setGreeting();
  wireTabs();
  wireSheet();
  wireEmergency();

  try {
    const health = await api('GET', '/v1/health');
    $('aiBadge').textContent = health.ai === 'gemini' ? '✦ Gemini' : 'mock AI';
    const h = await api('GET', '/v1/hospitals');
    hospitals = h.hospitals;
    await loadProfiles();
  } catch (err) {
    toast('Could not reach the server: ' + err.message);
  }
})();

function setGreeting() {
  const hour = new Date().getHours();
  const word = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  $('greetHi').textContent = `${word} 👋`;
  $('greetDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function loadProfiles() {
  const data = await api('GET', '/v1/profiles');
  profiles = data.profiles;
  if (!activeProfileId || !profiles.some((p) => p.id === activeProfileId)) {
    activeProfileId = profiles[0]?.id || null;
  }
  renderHome();
  renderProfilesList();
  renderEmergencyChip();
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.onclick = () => goTab(btn.dataset.tab);
  });
  $('btnHomeSos').onclick = () => goTab('emergency');
  $('btnHomeSwap').onclick = () => goTab('profiles');
  $('btnHomeSeeAll').onclick = (e) => { e.preventDefault(); goTab('profiles'); };
  $('btnMoreManage').onclick = () => goTab('profiles');
  $('btnDetailBack').onclick = () => goTab('profiles');
  $('btnEmgPickProfile').onclick = () => goTab('profiles');
  $('btnEmgSwap').onclick = () => goTab('profiles');
}

function goTab(tab, opts = {}) {
  activeTab = tab;
  ['home', 'profiles', 'detail', 'emergency', 'more'].forEach((t) => {
    $('screen-' + t)?.classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  // the tab bar has no "detail" entry — keep Profiles highlighted while viewing a person
  if (tab === 'detail') document.querySelector('.tab-btn[data-tab="profiles"]').classList.add('active');
  if (tab !== 'emergency') $('topbar').classList.remove('hidden');
  if (tab === 'home') renderHome();
  if (tab === 'profiles') renderProfilesList();
  if (tab === 'emergency') renderEmergencyChip();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
function renderHome() {
  const active = profiles.find((p) => p.id === activeProfileId);
  if (!active) {
    $('homeActiveCard').innerHTML = `<p class="muted">No family profile yet — add one to unlock the emergency flow.</p>`;
  } else {
    const flags = [...(active.allergies || []).map((a) => ({ icon: 'alertTriangle', text: a })),
                   ...(active.medications || []).slice(0, 2).map((m) => ({ icon: 'pill', text: m }))];
    $('homeActiveCard').innerHTML = `
      ${avatarHTML(active.fullName, 'md')}
      <div class="info">
        <div class="name">${esc(active.fullName)}</div>
        <div class="rel">${esc(active.relation || 'Family member')}${active.age ? ' · Age ' + active.age : ''}</div>
        <div class="chip-row">${
          flags.length
            ? flags.slice(0, 3).map((f) => `<span class="chip">${icon(f.icon, { size: 13 })}${esc(f.text)}</span>`).join('')
            : `<span class="chip calm">${icon('check', { size: 13 })}No known allergies flagged</span>`
        }</div>
      </div>`;
    $('homeActiveCard').onclick = () => openDetail(active.id);
    $('homeActiveCard').style.cursor = 'pointer';
  }
  $('homeFamilyList').innerHTML = profiles.length
    ? profiles.slice(0, 4).map(profileRowHTML).join('')
    : `<div class="prow"><span class="muted">No profiles yet.</span></div>`;
  bindProfileRows($('homeFamilyList'));
}

// ---------------------------------------------------------------------------
// Profiles list + detail
// ---------------------------------------------------------------------------
function profileRowHTML(p) {
  const activeCls = p.id === activeProfileId ? 'active-marker' : '';
  return `
    <button class="prow ${activeCls}" data-id="${p.id}">
      ${avatarHTML(p.fullName, 'sm')}
      <div class="info">
        <div class="name">${esc(p.fullName)}</div>
        <div class="rel">${esc(p.relation || 'Family member')}${p.age ? ', Age ' + p.age : ''}</div>
      </div>
      <span class="chev">${icon('chevronRight', { size: 18 })}</span>
    </button>`;
}
function bindProfileRows(container) {
  container.querySelectorAll('.prow[data-id]').forEach((row) => {
    row.onclick = () => openDetail(row.dataset.id);
  });
}

function renderProfilesList() {
  $('profilesList').innerHTML = profiles.length
    ? profiles.map(profileRowHTML).join('')
    : `<div class="prow"><span class="muted">No family profiles yet — add the first one below.</span></div>`;
  bindProfileRows($('profilesList'));
}

function openDetail(id) {
  const p = profiles.find((x) => x.id === id);
  if (!p) return;
  viewingProfileId = id;
  $('detailTopTitle').textContent = p.relation || 'Profile';
  $('detailAvatar').outerHTML = avatarHTML(p.fullName, 'lg').replace('class="avatar', 'id="detailAvatar" class="avatar');
  $('detailName').textContent = p.fullName;
  $('detailSub').textContent = `${p.relation || 'Family member'}${p.age ? ' · Age ' + p.age : ''}${p.bloodGroup ? ' · ' + p.bloodGroup : ''}`;

  const history = [...(p.conditions || []), ...(p.pastEvents || [])];
  const contact = (p.emergencyContacts || [])[0];
  const rows = [
    { icon: 'alertTriangle', tone: 'red', label: 'Allergies', value: (p.allergies || []).length ? p.allergies.join(', ') : 'None recorded' },
    { icon: 'pill', tone: 'blue', label: 'Medicines', value: (p.medications || []).length ? p.medications.join(', ') : 'None recorded' },
    { icon: 'clock', tone: 'amber', label: 'History', value: history.length ? history.join(', ') : 'None recorded' },
    { icon: 'phone', tone: 'green', label: 'Contact', value: contact ? `${contact.name}${contact.phone ? ' · ' + contact.phone : ''}` : 'Not set' },
    { icon: 'hospital', tone: 'red', label: 'Hospital', value: p.preferredHospital || 'Not set' },
    { icon: 'shield', tone: 'blue', label: 'Insurance', value: p.insurance || 'Not set' },
  ];
  $('detailList').innerHTML = rows.map((r) => `
    <div class="drow">
      <div class="ic ${r.tone}">${icon(r.icon, { size: 17 })}</div>
      <div class="body"><div class="label">${r.label}</div><div class="value ${r.value.startsWith('None') || r.value.startsWith('Not') ? 'plain' : ''}">${esc(r.value)}</div></div>
    </div>`).join('');

  $('btnStartEmergencyFor').onclick = () => {
    activeProfileId = p.id;
    localStorage.setItem('gb_activeProfileId', p.id);
    goTab('emergency');
  };

  goTab('detail');
}

// ---------------------------------------------------------------------------
// New profile — bottom sheet + AI draft from photo
// ---------------------------------------------------------------------------
function wireSheet() {
  const open = () => { $('sheetBackdrop').classList.add('open'); $('profileSheet').classList.add('open'); };
  const close = () => { $('sheetBackdrop').classList.remove('open'); $('profileSheet').classList.remove('open'); };

  $('btnAddMember').onclick = open;
  $('sheetBackdrop').onclick = close;
  $('btnSheetCancel').onclick = close;

  $('btnDraft').onclick = async () => {
    const file = $('rxPhoto').files[0];
    if (!file) return toast('Choose a prescription photo first');
    $('btnDraft').disabled = true;
    $('draftStatus').textContent = '✦ Reading the document…';
    try {
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(',')[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const { draft } = await api('POST', '/v1/profiles/draft-from-image', { imageBase64: base64, mimeType: file.type });
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
    const name = $('pfName').value.trim();
    if (!name) return toast('Name is required');
    const contactRaw = $('pfContact').value.trim();
    const [cName, cPhone] = contactRaw.split(',').map((s) => s?.trim());
    try {
      const { profile } = await api('POST', '/v1/profiles', {
        fullName: name,
        relation: $('pfRelation').value,
        age: $('pfAge').value,
        bloodGroup: $('pfBlood').value,
        allergies: split($('pfAllergies').value),
        medications: split($('pfMeds').value),
        conditions: split($('pfConditions').value),
        emergencyContacts: contactRaw ? [{ name: cName || contactRaw, phone: cPhone || '' }] : [],
        preferredHospital: $('pfHospital').value.trim() || null,
        insurance: $('pfInsurance').value.trim() || null,
      });
      await loadProfiles();
      activeProfileId = profile.id;
      localStorage.setItem('gb_activeProfileId', profile.id);
      close();
      ['pfName','pfAge','pfBlood','pfAllergies','pfMeds','pfConditions','pfContact','pfHospital','pfInsurance'].forEach((id) => $(id).value = '');
      $('draftStatus').textContent = '';
      toast('Profile saved ✔');
      goTab('profiles');
    } catch (err) {
      toast('Save failed: ' + err.message);
    }
  };
}

// ---------------------------------------------------------------------------
// Emergency flow: describe → confirm → live status
// ---------------------------------------------------------------------------
function renderEmergencyChip() {
  const p = profiles.find((x) => x.id === activeProfileId);
  const has = !!p;
  $('emgNoProfile').classList.toggle('hidden', has);
  $('emgChip').classList.toggle('hidden', !has);
  if (has) {
    $('emgChipAvatar').outerHTML = avatarHTML(p.fullName, 'sm').replace('class="avatar', 'id="emgChipAvatar" class="avatar');
    $('emgChipName').textContent = p.fullName;
    $('emgChipStatus').textContent = `${p.relation || 'Profile'} · Active`;
  }
}

function wireEmergency() {
  $('btnCancel').onclick = () => goTab('home');
  $('btnNewEmergency').onclick = () => {
    currentEmergencyId = null;
    $('emgLiveState').classList.add('hidden');
    $('emgDescribeState').classList.remove('hidden');
    $('emgLiveText').textContent = 'Ready';
    $('description').value = '';
    if (socket) { socket.disconnect(); socket = null; }
  };

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  $('btnMic').onclick = () => {
    if (!SR) return toast('Voice input is not supported in this browser — type instead');
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    $('btnMic').classList.add('listening');
    $('micLabel').textContent = 'LISTENING…';
    rec.onresult = (e) => {
      $('description').value = ($('description').value + ' ' + e.results[0][0].transcript).trim();
    };
    rec.onend = () => { $('btnMic').classList.remove('listening'); $('micLabel').textContent = 'TAP TO SPEAK'; };
    rec.onerror = () => { $('btnMic').classList.remove('listening'); $('micLabel').textContent = 'TAP TO SPEAK'; toast('Mic unavailable — type instead'); };
    rec.start();
  };

  $('btnConfirm').onclick = async () => {
    $('btnConfirm').disabled = true;
    try {
      captureLocationOnce();
      const { emergency } = await api('POST', '/v1/emergencies', {
        profileId: activeProfileId || null,
        description: $('description').value,
        location: currentLocation,
        useDemoLocation: !currentLocation,
      });
      currentEmergencyId = emergency.id;
      $('emgDescribeState').classList.add('hidden');
      $('emgLiveState').classList.remove('hidden');
      $('emgLiveText').textContent = 'Active';
      $('emgId').textContent = '#' + emergency.id.slice(0, 8);
      watchEmergency(emergency);
    } catch (err) {
      toast('Could not create emergency: ' + err.message);
    }
    $('btnConfirm').disabled = false;
  };
}

function captureLocationOnce() {
  if (currentLocation || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
      $('locStatus').textContent = `📍 Location captured (±${currentLocation.accuracy}m)`;
    },
    () => { $('locStatus').textContent = '📍 Location unavailable — using demo location so the flow continues.'; },
    { enableHighAccuracy: true, timeout: 6000 }
  );
}
// Kick off location capture as soon as the emergency tab is opened, not just on confirm.
document.addEventListener('DOMContentLoaded', captureLocationOnce);

function watchEmergency(emergency) {
  renderEmergency(emergency);
  socket = io();
  socket.emit('watch:emergency', emergency.id);
  socket.on('emergency:update', (e) => { if (e.id === emergency.id) renderEmergency(e); });
  const poll = setInterval(async () => {
    if (!currentEmergencyId) return clearInterval(poll);
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
      <p class="kv" style="color:#fff;font-size:16px"><b>🏥</b> <strong>${esc(e.hospitalName)}</strong></p>
      <p class="kv"><b>Distance</b> ${e.hospitalDistanceKm} km · <b>Capability match</b> ${e.capabilityMatch}%</p>
      ${e.alternatives?.length ? `<p class="muted">Also considered: ${e.alternatives.map((a) => `${esc(a.name)} (${a.capabilityMatch}%, ${a.distanceKm}km)`).join(' · ')}</p>` : ''}
    `;
    if (!liveMap) liveMap = createLiveMap('map');
    const hosp = hospitals.find((h) => h.id === e.hospitalId);
    liveMap.setScene(e, hosp);
  }
  if (typeof e.etaMinutes === 'number') {
    $('etaBox').classList.remove('hidden');
    $('etaMin').textContent = e.status === 'ARRIVED_AT_HOSPITAL' ? 'Arrived' : e.etaMinutes + ' min';
  }
}
