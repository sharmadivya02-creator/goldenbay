# 🌊 GoldenBay

**Right hospital. Already prepared.**

GoldenBay helps any family — or even a stranger nearby — get a collapsing person to the *right, prepared* hospital, so doctors start treatment informed within the golden hour, without the panicked hunt through old papers and hospital-by-hospital phone calls.

> ⚠️ **Hackathon prototype.** All data is synthetic; hospital names are fictional. This is not a real emergency service — in a real emergency in India, call **112** (ambulance: **108**). The AI organises information; it does not diagnose.

## What the demo shows

One emergency, three live views of the same event:

| View | URL | What happens |
|---|---|---|
| **Patient** | `/` | Build a health profile (Gemini drafts it from a prescription photo), tap **SOS**, describe the emergency in plain words (or speak it) |
| **Family** | `/family` | An emergency contact follows the emergency live — status, hospital, ambulance on the map |
| **Ambulance Bay** | `/hospital` | The hospital's screen glows with the AI-composed clinical picture and ETA *before* the patient arrives |

The flow: **SOS tap → GPS captured → Gemini composes a clinical picture (urgency + summary + key risks) from the caller's plain words + the stored profile → capability-based hospital matching (right hospital, not just nearest) → simulated ambulance with live tracking → ER prepared before arrival.**

## Where Gemini is used

1. **Profile drafting** — reads a photographed prescription/report (multimodal) and drafts profile fields; a human always reviews before saving.
2. **Clinical picture** — turns a panicked plain-language description plus the stored profile into structured JSON: urgency class, 10-second clinical summary, key risks (allergies, relevant history), and the hospital capabilities this emergency needs — which drives the matching.

A **mock-AI fallback** keeps every flow alive if no API key is configured.

## Run it

```bash
npm install
cp .env.example .env    # then paste your Gemini API key into .env
npm start               # → http://localhost:3000
```

No key? It runs in mock-AI mode — every flow still works.

## Architecture

```
Browser (patient / family / hospital views — plain HTML+JS, Leaflet maps)
   │  HTTPS JSON API (/v1/...)  +  WebSockets (Socket.IO) for live updates
   ▼
Node.js + Express backend
   ├─ src/ai.js        Gemini integration + mock fallback (information extraction only)
   ├─ src/dispatch.js  capability-first hospital matching + simulated ambulance
   ├─ src/seed.js      fictional hospitals + demo patient (synthetic data)
   └─ src/store.js     JSON-file data layer (swappable for PostgreSQL)
```

Honest demo boundaries: ambulance movement is **simulated** (a real partner's GPS feed plugs into the same WebSocket broadcast); there is **no authentication** yet; production healthcare would require auth, encryption at rest, audit logs, and consent management before any real data.
