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
  $('btnRowBack').innerHTML = icon('arrowLeft', { size: 18 });
  $('btnLightboxClose').innerHTML = icon('x', { size: 20 });
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
  $('btnRowBack').onclick = () => goTab('detail');
  $('btnLightboxClose').onclick = () => $('lightbox').classList.add('hidden');
  $('lightbox').onclick = (e) => { if (e.target.id === 'lightbox') $('lightbox').classList.add('hidden'); };
}

function goTab(tab, opts = {}) {
  activeTab = tab;
  ['home', 'profiles', 'detail', 'rowdetail', 'emergency', 'more'].forEach((t) => {
    $('screen-' + t)?.classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  // the tab bar has no "detail"/"rowdetail" entry — keep Profiles highlighted while viewing a person
  if (tab === 'detail' || tab === 'rowdetail') document.querySelector('.tab-btn[data-tab="profiles"]').classList.add('active');
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
    { type: 'bloodgroup', icon: 'heartPulse', tone: 'red', label: 'Blood group', value: p.bloodGroup || 'Not set' },
    { type: 'allergies', icon: 'alertTriangle', tone: 'red', label: 'Allergies', value: (p.allergies || []).length ? p.allergies.join(', ') : 'None recorded' },
    { type: 'medicines', icon: 'pill', tone: 'blue', label: 'Medicines', value: (p.medications || []).length ? p.medications.join(', ') : 'None recorded' },
    { type: 'history', icon: 'clock', tone: 'amber', label: 'History', value: history.length ? history.join(', ') : 'None recorded' },
    { type: 'contact', icon: 'phone', tone: 'green', label: 'Contact', value: contact ? `${contact.name}${contact.phone ? ' · ' + contact.phone : ''}` : 'Not set' },
    { type: 'hospital', icon: 'hospital', tone: 'red', label: 'Hospital', value: p.preferredHospital || 'Not set' },
    { type: 'insurance', icon: 'shield', tone: 'blue', label: 'Insurance', value: p.insurance || 'Not set' },
  ];
  $('detailList').innerHTML = rows.map((r) => `
    <button class="drow tappable" data-row="${r.type}">
      <div class="ic ${r.tone}">${icon(r.icon, { size: 17 })}</div>
      <div class="body"><div class="label">${r.label}</div><div class="value ${r.value.startsWith('None') || r.value.startsWith('Not') ? 'plain' : ''}">${esc(r.value)}</div></div>
      <span class="chev">${icon('chevronRight', { size: 17 })}</span>
    </button>`).join('');
  $('detailList').querySelectorAll('.drow[data-row]').forEach((btn) => {
    btn.onclick = () => openRowDetail(btn.dataset.row, p);
  });

  $('btnStartEmergencyFor').onclick = () => {
    activeProfileId = p.id;
    localStorage.setItem('gb_activeProfileId', p.id);
    goTab('emergency');
  };

  goTab('detail');
}

// ---------------------------------------------------------------------------
// Row detail — tapping Allergies / Medicines / History / Contact / Hospital /
// Insurance opens this with the full list + any matching uploaded documents.
// ---------------------------------------------------------------------------
const ROW_META = {
  bloodgroup: { title: 'Blood group', icon: 'heartPulse',    tone: 'red',   docCategory: null },
  allergies:  { title: 'Allergies',  icon: 'alertTriangle', tone: 'red',   docCategory: null },
  medicines:  { title: 'Medicines',  icon: 'pill',           tone: 'blue',  docCategory: 'prescription' },
  history:    { title: 'History',    icon: 'clock',          tone: 'amber', docCategory: 'report' },
  contact:    { title: 'Contact',    icon: 'phone',          tone: 'green', docCategory: null },
  hospital:   { title: 'Hospital',   icon: 'hospital',       tone: 'red',   docCategory: null },
  insurance:  { title: 'Insurance',  icon: 'shield',         tone: 'blue',  docCategory: 'insurance' },
};

function docGalleryHTML(docs, emptyHint) {
  if (!docs || !docs.length) {
    return `<div class="doc-empty">${icon('camera', { size: 22 })}<span>${esc(emptyHint)}</span></div>`;
  }
  return `<div class="doc-grid">${docs.map((d) => `
    <button class="doc-thumb" data-doc="${d.id}"><img src="${d.dataUrl}" alt="${esc(d.name || 'document')}" /></button>
  `).join('')}</div>`;
}

function openRowDetail(type, p) {
  const meta = ROW_META[type];
  $('rowTitle').textContent = meta.title;
  const docs = (p.documents || []).filter((d) => d.category === meta.docCategory);

  let body = `<div class="row-hero"><div class="ic-lg ${meta.tone === 'red' ? 'drow' : ''}" style="background:${
    meta.tone === 'red' ? 'var(--red-soft)' : meta.tone === 'blue' ? 'var(--blue-soft)' : meta.tone === 'green' ? 'var(--green-soft)' : 'var(--amber-soft)'
  };color:${meta.tone === 'red' ? 'var(--red-dark)' : meta.tone === 'blue' ? 'var(--blue)' : meta.tone === 'green' ? 'var(--green)' : '#96701c'}">${icon(meta.icon, { size: 26 })}</div>
  <h2>${esc(p.fullName)}</h2><p>${meta.title}</p></div>`;

  if (type === 'bloodgroup') {
    body += p.bloodGroup
      ? `<div class="bg-badge">${esc(p.bloodGroup)}</div><p class="muted" style="text-align:center;margin-top:12px">Blood group for ${esc(p.fullName.split(' ')[0])} — first responders check this before any transfusion.</p>`
      : `<p class="muted" style="text-align:center">No blood group on file.</p>`;
  } else if (type === 'allergies') {
    const items = p.allergies || [];
    body += items.length
      ? `<ul class="row-list">${items.map((a) => `<li class="row-item"><span class="dot"></span>${esc(a)}</li>`).join('')}</ul>`
      : `<p class="muted" style="text-align:center">No allergies recorded.</p>`;
  } else if (type === 'medicines') {
    const items = p.medications || [];
    body += items.length
      ? `<ul class="row-list">${items.map((m) => `<li class="row-item"><span class="dot"></span>${esc(m)}</li>`).join('')}</ul>`
      : `<p class="muted" style="text-align:center">No medicines recorded.</p>`;
    body += `<h3 style="margin-top:18px">Prescription photos</h3>${docGalleryHTML(docs, 'No prescription photos added yet — add them from the profile’s edit form.')}`;
  } else if (type === 'history') {
    const items = [...(p.conditions || []), ...(p.pastEvents || [])];
    body += items.length
      ? `<ul class="row-list">${items.map((h) => `<li class="row-item"><span class="dot"></span>${esc(h)}</li>`).join('')}</ul>`
      : `<p class="muted" style="text-align:center">No history recorded.</p>`;
    body += `<h3 style="margin-top:18px">Medical reports</h3>${docGalleryHTML(docs, 'No report photos added yet.')}`;
  } else if (type === 'contact') {
    const c = (p.emergencyContacts || [])[0];
    if (c) {
      body += `<p class="muted" style="text-align:center;margin-bottom:14px">${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}</p>`;
      if (c.phone) {
        body += `<a class="call-btn" href="tel:${esc(c.phone.replace(/[^+\d]/g, ''))}">${icon('phone', { size: 18 })} Call ${esc(c.name.split(' ')[0])}</a>`;
      }
    } else {
      body += `<p class="muted" style="text-align:center">No emergency contact on file.</p>`;
    }
  } else if (type === 'hospital') {
    if (p.preferredHospital) {
      body += `<p class="muted" style="text-align:center;margin-bottom:14px">Preferred hospital for ${esc(p.fullName.split(' ')[0])}</p>`;
      body += `<a class="map-btn" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.preferredHospital)}" target="_blank" rel="noopener">${icon('mapPin', { size: 18 })} Open ${esc(p.preferredHospital)} in Maps</a>`;
    } else {
      body += `<p class="muted" style="text-align:center">No preferred hospital on file — GoldenBay will still auto-match the right one during a real emergency.</p>`;
    }
  } else if (type === 'insurance') {
    body += `<p class="muted" style="text-align:center;margin-bottom:4px">${p.insurance ? esc(p.insurance) : 'No insurer on file'}</p>`;
    body += `<h3 style="margin-top:14px">Policy documents</h3>${docGalleryHTML(docs, 'No insurance card / policy photos added yet.')}`;
  }

  $('rowBody').innerHTML = body;
  $('rowBody').querySelectorAll('.doc-thumb[data-doc]').forEach((btn) => {
    const doc = (p.documents || []).find((d) => d.id === btn.dataset.doc);
    if (doc) btn.onclick = () => openLightbox(doc.dataUrl);
  });

  goTab('rowdetail');
}

function openLightbox(dataUrl) {
  $('lightboxImg').src = dataUrl;
  $('lightbox').classList.remove('hidden');
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
    $('btnSaveProfile').disabled = true;
    try {
      const documents = [
        ...(await filesToDocuments($('docInsurance').files, 'insurance')),
        ...(await filesToDocuments($('docPrescription').files, 'prescription')),
        ...(await filesToDocuments($('docReport').files, 'report')),
      ];
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
        documents,
      });
      await loadProfiles();
      activeProfileId = profile.id;
      localStorage.setItem('gb_activeProfileId', profile.id);
      close();
      ['pfName','pfAge','pfBlood','pfAllergies','pfMeds','pfConditions','pfContact','pfHospital','pfInsurance'].forEach((id) => $(id).value = '');
      ['docInsurance','docPrescription','docReport','rxPhoto'].forEach((id) => $(id).value = '');
      $('draftStatus').textContent = '';
      toast('Profile saved ✔');
      goTab('profiles');
    } catch (err) {
      toast('Save failed: ' + err.message);
    }
    $('btnSaveProfile').disabled = false;
  };
}

// Reads a FileList into [{ id, category, name, mimeType, dataUrl }], skipping
// anything that isn't an image (documents are shown as photo thumbnails).
async function filesToDocuments(fileList, category) {
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
  return Promise.all(files.map((file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({
      id: 'doc-' + Math.random().toString(36).slice(2, 10),
      category,
      name: file.name,
      mimeType: file.type,
      dataUrl: r.result,
    });
    r.onerror = reject;
    r.readAsDataURL(file);
  })));
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

  // Browsers only ever show the native "Allow microphone?" popup themselves,
  // the FIRST time a page asks — and only JS-triggered by calling
  // rec.start()/getUserMedia(), never by us directly. Once someone has
  // dismissed or blocked it, no amount of JS can bring that popup back —
  // that's a deliberate browser security rule, not something a website can
  // override. So: first attempt → let the browser's own popup happen
  // naturally. If it's already blocked from a past visit, don't just fail
  // silently — show clear, exact steps to re-enable it (and make sure
  // typing is always right there as a zero-friction fallback either way).
  $('btnMic').onclick = async () => {
    if (!SR) return toast('Voice input is not supported in this browser — type instead');

    // Proactively check: if permission was already denied in an earlier
    // visit, calling rec.start() would just fail instantly with no popup.
    // Catch that case up front so we can show real instructions right away
    // instead of a vague "didn't work" moment.
    if (navigator.permissions?.query) {
      try {
        const status = await navigator.permissions.query({ name: 'microphone' });
        if (status.state === 'denied') return showMicHelp();
      } catch (_) {
        // Some browsers don't support querying 'microphone' — fall through
        // and let rec.start() itself surface the native prompt or error.
      }
    }

    const rec = new SR();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    $('btnMic').classList.add('listening');
    $('micLabel').textContent = 'LISTENING…';
    rec.onresult = (e) => {
      $('description').value = ($('description').value + ' ' + e.results[0][0].transcript).trim();
    };
    rec.onend = () => { $('btnMic').classList.remove('listening'); $('micLabel').textContent = 'TAP TO SPEAK'; };
    rec.onerror = (e) => {
      $('btnMic').classList.remove('listening');
      $('micLabel').textContent = 'TAP TO SPEAK';
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        showMicHelp();
      } else if (e.error === 'no-speech') {
        toast('Didn’t catch anything — try again, or just type it below');
      } else if (e.error === 'audio-capture') {
        toast('No microphone found on this device — type instead');
      } else if (e.error === 'network') {
        toast('Voice input needs an internet connection right now — type instead');
      } else {
        toast('Mic unavailable — type instead');
      }
    };
    rec.start();
  };

  function showMicHelp() {
    $('micHelpModal').classList.remove('hidden');
  }
  $('btnMicHelpClose').onclick = () => $('micHelpModal').classList.add('hidden');
  $('btnMicHelpOk').onclick = () => $('micHelpModal').classList.add('hidden');

  // Default OFF: GoldenBay's demo hospitals are all fixed in Delhi, so a real
  // GPS reading from anywhere else produces a real (huge) distance/ETA that
  // *looks* broken even though the math is correct. Keep the flow reliable
  // for anyone testing it out of town by defaulting to the demo location;
  // the checkbox lets someone nearby prove real GPS works.
  $('useRealGps').onchange = () => {
    if ($('useRealGps').checked) captureRealLocation();
    else $('locStatus').textContent = "📍 Using GoldenBay's demo service area so hospital matching stays realistic.";
  };

  $('btnConfirm').onclick = async () => {
    $('btnConfirm').disabled = true;
    try {
      const useReal = $('useRealGps').checked && currentLocation;
      const { emergency } = await api('POST', '/v1/emergencies', {
        profileId: activeProfileId || null,
        description: $('description').value,
        location: useReal ? currentLocation : null,
        useDemoLocation: !useReal,
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

function captureRealLocation() {
  if (!navigator.geolocation) {
    $('locStatus').textContent = '📍 No GPS in this browser — staying on the demo location.';
    $('useRealGps').checked = false;
    return;
  }
  $('locStatus').textContent = '📡 Getting your real location…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
      $('locStatus').textContent = `📍 Real location captured (±${currentLocation.accuracy}m) — note the demo hospitals are all in Delhi, so distance/ETA will only make sense if you're nearby.`;
    },
    () => {
      $('locStatus').textContent = '📍 Location unavailable/denied — staying on the demo location.';
      $('useRealGps').checked = false;
    },
    { enableHighAccuracy: true, timeout: 6000 }
  );
}

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