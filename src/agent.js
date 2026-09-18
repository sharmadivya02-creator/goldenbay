// agent.js — the Dispatch Agent.
//
// WHAT MAKES THIS AN AGENT AND NOT A PROMPT
//
//   1. GOAL        it optimises something: get this patient to definitive care
//                  in the least time, without overloading any one hospital.
//   2. PERCEPTION  it reads live world state (bed counts, cath lab status,
//                  ambulance position, what the caller just said) — not a prompt.
//   3. TOOLS       it CALLS functions that change the world. reserve_bed really
//                  holds a bed. reroute really redirects the ambulance.
//   4. LOOP        it wakes on events, re-decides, and may OVERTURN its own
//                  earlier decision. A wrapper decides once. An agent revises.
//   5. MEMORY      it remembers what it already did and why, across the whole
//                  emergency, and that history shapes the next decision.
//
// HOW IT DECIDES
//   The policy is deterministic — scoring, bed counts, capability matching. When
//   Gemini is available it also writes the one-line reason a human reads, and can
//   override the policy when the situation is genuinely ambiguous. When Gemini is
//   not available (no key, no wifi, quota gone) the agent still runs, still
//   reroutes, still holds beds. The agency does not depend on the model.

const store = require('./store');
const dispatch = require('./dispatch');
const ai = require('./ai');

const LEASE_MS = 12 * 60 * 1000;   // a held bed expires if the patient never arrives
const TICK_MS = 4000;              // how often the agent re-examines the world

const agents = new Map();          // emergencyId → agent

// ---------------------------------------------------------------------------
// THE TOOLS. These are the agent's hands. Each one changes real state.
// ---------------------------------------------------------------------------
function makeTools(io, agent) {
  const emit = (event, payload) => {
    io.to(`emergency:${agent.emergencyId}`).emit(event, payload);
    io.to('hospital-feed').emit(event, payload);
  };

  const record = (tool, args, result, reason) => {
    const entry = {
      at: Date.now(),
      step: ++agent.step,
      tool, args, result, reason,
      emergencyId: agent.emergencyId,
    };
    agent.log.push(entry);
    emit('agent:action', entry);
    return entry;
  };

  return {
    // --- read the world -----------------------------------------------------
    query_hospital_state(hospitalId) {
      const h = store.find('hospitals', hospitalId);
      if (!h) return { error: 'unknown hospital' };
      return {
        name: h.name,
        bedsFree: h.bedsFree ?? h.erBeds,
        cathLabBusy: !!h.cathLabBusy,
        capabilities: h.capabilities,
      };
    },

    // --- hold a bed, with a lease that expires on its own --------------------
    reserve_er_bed(hospitalId, reason) {
      const h = store.find('hospitals', hospitalId);
      if (!h) return record('reserve_er_bed', { hospitalId }, { ok: false, why: 'unknown hospital' }, reason);

      const free = h.bedsFree ?? h.erBeds;
      if (free <= 0) {
        return record('reserve_er_bed', { hospital: h.name },
          { ok: false, why: 'no free bed' }, reason);
      }

      store.update('hospitals', h.id, { bedsFree: free - 1 });
      agent.heldBed = { hospitalId: h.id, hospitalName: h.name, until: Date.now() + LEASE_MS };

      // the lease releases itself — nobody has to remember to give the bed back
      clearTimeout(agent.leaseTimer);
      agent.leaseTimer = setTimeout(() => {
        if (agent.heldBed?.hospitalId === h.id) tools.release_er_bed('lease expired — patient never arrived');
      }, LEASE_MS);

      emit('hospital:state', { hospitalId: h.id, bedsFree: free - 1 });
      return record('reserve_er_bed', { hospital: h.name, ttlMinutes: LEASE_MS / 60000 },
        { ok: true, bedsLeft: free - 1 }, reason);
    },

    release_er_bed(reason) {
      if (!agent.heldBed) return null;
      const h = store.find('hospitals', agent.heldBed.hospitalId);
      if (h) {
        const free = (h.bedsFree ?? h.erBeds) + 1;
        store.update('hospitals', h.id, { bedsFree: free });
        emit('hospital:state', { hospitalId: h.id, bedsFree: free });
      }
      const was = agent.heldBed.hospitalName;
      agent.heldBed = null;
      clearTimeout(agent.leaseTimer);
      return record('release_er_bed', { hospital: was }, { ok: true }, reason);
    },

    request_blood(hospitalId, bloodGroup, units, reason) {
      const h = store.find('hospitals', hospitalId);
      return record('request_blood',
        { hospital: h?.name, bloodGroup, units },
        { ok: true, note: 'request sent to blood bank (simulated)' }, reason);
    },

    // --- the one that matters: change a decision already made ----------------
    reroute(newHospitalId, reason) {
      const e = store.find('emergencies', agent.emergencyId);
      const h = store.find('hospitals', newHospitalId);
      if (!e || !h) return null;

      const from = e.hospitalName;
      const distanceKm = Math.round(dispatch.distanceKm(e.location, h) * 10) / 10;

      const updated = store.update('emergencies', e.id, {
        hospitalId: h.id,
        hospitalName: h.name,
        hospitalDistanceKm: distanceKm,
        rerouted: true,
        rerouteReason: reason,
      });

      emit('emergency:update', updated);
      return record('reroute', { from, to: h.name, distanceKm },
        { ok: true }, reason);
    },

    ask_caller(question, reason) {
      emit('agent:question', { emergencyId: agent.emergencyId, question });
      return record('ask_caller', { question }, { ok: true, note: 'shown on the caller\'s screen' }, reason);
    },

    escalate_to_human(why) {
      agent.escalated = true;
      return record('escalate_to_human', { why }, { ok: true, note: 'a human dispatcher is needed' }, why);
    },

    note(text) {
      return record('note', {}, {}, text);
    },

    conclude(reason) {
      agent.done = true;
      clearInterval(agent.timer);
      return record('conclude', {}, { ok: true }, reason);
    },
  };
}

// ---------------------------------------------------------------------------
// THE POLICY — what should the agent do given what it can see right now?
// Deterministic. Runs with or without an AI.
// ---------------------------------------------------------------------------
function decide(agent) {
  const e = store.find('emergencies', agent.emergencyId);
  if (!e) return { action: 'conclude', reason: 'emergency no longer exists' };
  if (e.status === 'ARRIVED_AT_HOSPITAL') {
    return { action: 'conclude', reason: 'Patient has arrived. Handing over to the ER.' };
  }

  const picture = e.clinicalPicture || {};
  const needs = (picture.neededCapabilities || []).map((c) => c.toLowerCase());
  const target = store.find('hospitals', e.hospitalId);

  // 1) Have we secured a bed at all?
  if (!agent.heldBed && target) {
    const free = target.bedsFree ?? target.erBeds;
    if (free > 0) {
      return { action: 'reserve_er_bed', hospitalId: target.id,
        reason: `Holding one of ${free} free beds at ${target.name} for this patient.` };
    }
  }

  // 2) Has the destination stopped being able to treat this patient?
  if (target) {
    const cathNeeded = needs.includes('cathlab') || needs.includes('cardiac');
    const lostCathLab = cathNeeded && target.cathLabBusy;
    const noBeds = (target.bedsFree ?? target.erBeds) <= 0 && !agent.heldBed;

    if (lostCathLab || noBeds) {
      // find somewhere that can, excluding the one that just failed us
      const alternatives = store.all('hospitals')
        .filter((h) => h.id !== target.id)
        .filter((h) => !(cathNeeded && h.cathLabBusy))
        .filter((h) => (h.bedsFree ?? h.erBeds) > 0);

      if (!alternatives.length) {
        return { action: 'escalate_to_human',
          reason: `${target.name} can no longer take this patient and no other hospital has capacity. A human dispatcher is needed now.` };
      }

      const scored = alternatives.map((h) => {
        const dist = dispatch.distanceKm(e.location, h);
        const match = needs.length ? needs.filter((c) => h.capabilities.includes(c)).length / needs.length : 0.5;
        return { h, dist, score: match * 100 - Math.min(dist, 30) };
      }).sort((a, b) => b.score - a.score);

      const best = scored[0];
      const why = lostCathLab
        ? `${target.name}'s cath lab just went busy and this patient needs one. ${best.h.name} has a free cath lab, ${Math.round(best.dist * 10) / 10}km away.`
        : `${target.name} has no free ER bed. ${best.h.name} does, ${Math.round(best.dist * 10) / 10}km away.`;

      return { action: 'reroute', hospitalId: best.h.id, reason: why };
    }
  }

  // 3) Anything else worth doing while we wait?
  if (!agent.askedBlood && /trauma|bleed|accident|fall/i.test(picture.suspectedCategory || '')) {
    const group = agent.profile?.bloodGroup;
    if (group && target) {
      agent.askedBlood = true;
      return { action: 'request_blood', hospitalId: target.id, bloodGroup: group, units: 2,
        reason: `Trauma case with a known blood group. Asking ${target.name} to have ${group} ready before arrival.` };
    }
  }

  if (!agent.askedCaller && picture.questionsForCaller?.length) {
    agent.askedCaller = true;
    return { action: 'ask_caller', question: picture.questionsForCaller[0],
      reason: 'One answer would sharpen the picture the ER receives.' };
  }

  return null; // nothing to do this cycle — that is a valid outcome
}

// ---------------------------------------------------------------------------
// Optional: let Gemini phrase the reason in plainer words. If it is unavailable
// or out of quota, the deterministic reason is used as-is. The DECISION never
// depends on the model.
// ---------------------------------------------------------------------------
async function phrase(decision, agent) {
  if (!ai.geminiEnabled() || !decision) return decision;
  try {
    const out = await ai.composeAgentReason?.(decision, agent.snapshot?.());
    if (out?.reason) return { ...decision, reason: out.reason, _phrasedBy: 'gemini' };
  } catch { /* deterministic reason stands */ }
  return decision;
}

// ---------------------------------------------------------------------------
// THE LOOP
// ---------------------------------------------------------------------------
let tools; // assigned per agent inside start()

function startAgent(io, emergency, profile) {
  stopAgent(emergency.id);

  const agent = {
    emergencyId: emergency.id,
    profile,
    step: 0,
    log: [],
    heldBed: null,
    leaseTimer: null,
    done: false,
    escalated: false,
    askedBlood: false,
    askedCaller: false,
  };
  agents.set(emergency.id, agent);

  const t = makeTools(io, agent);
  tools = t;

  t.note(`Goal: get ${emergency.patientName} to a hospital that can actually treat this, in the least time, without overloading anyone. Watching for anything that changes the answer.`);

  const cycle = async () => {
    if (agent.done) return;
    let decision = decide(agent);
    if (!decision) return;
    decision = await phrase(decision, agent);

    switch (decision.action) {
      case 'reserve_er_bed': t.reserve_er_bed(decision.hospitalId, decision.reason); break;
      case 'reroute':
        t.release_er_bed('Releasing the bed we were holding — this is no longer the destination.');
        t.reroute(decision.hospitalId, decision.reason);
        break;
      case 'request_blood': t.request_blood(decision.hospitalId, decision.bloodGroup, decision.units, decision.reason); break;
      case 'ask_caller': t.ask_caller(decision.question, decision.reason); break;
      case 'escalate_to_human': t.escalate_to_human(decision.reason); break;
      case 'conclude':
        t.release_er_bed('Patient arrived — the held bed is now theirs.');
        t.conclude(decision.reason);
        break;
    }
  };

  agent.timer = setInterval(cycle, TICK_MS);
  setTimeout(cycle, 1200); // first look, almost immediately
  return agent;
}

function stopAgent(emergencyId) {
  const a = agents.get(emergencyId);
  if (!a) return;
  clearInterval(a.timer);
  clearTimeout(a.leaseTimer);
  agents.delete(emergencyId);
}

function getLog(emergencyId) {
  return agents.get(emergencyId)?.log || [];
}

module.exports = { startAgent, stopAgent, getLog, agents };