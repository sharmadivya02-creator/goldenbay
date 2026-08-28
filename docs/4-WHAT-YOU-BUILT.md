# Guide 4 — What you just built (read after submitting, tea in hand)

You now own a real **distributed system**. This is the map of it — and the concepts inside it. After the hackathon we'll rebuild these pieces slowly, by hand, and each of these terms will get its full lesson.

## The pieces

```
public/            THE FRONTEND — runs in the browser of whoever opens the page
  index.html       patient view structure   (HTML = the skeleton of a page)
  app.css          all styling              (CSS = the appearance)
  patient.js       patient view behaviour   (JavaScript = the behaviour)
  family.html/js   family's live view
  hospital.html/js the ambulance-bay screen
  shared.js        helpers all three views use

server.js          THE BACKEND — one Node.js process: serves the pages,
                   answers the API, pushes real-time events
src/ai.js          the AI layer (Gemini + mock fallback)
src/dispatch.js    hospital matching + the simulated ambulance
src/store.js       the "database" (a JSON file, behind a swappable interface)
src/seed.js        synthetic demo data

package.json       the project manifest: name, scripts, dependencies
.env               your secrets (never in git); .env.example is its public template
```

## Ten concepts you already used today

1. **Client–server**: the browser (client) asks; `server.js` (server) decides and answers. All trust lives on the server.
2. **API endpoint**: `POST /v1/emergencies` — a named door on the server. The SOS button's tap becomes exactly one call to it. Look inside `server.js` and find it.
3. **JSON**: the text format every request and response travels in. Open `data/db.json` after a demo run — that's your entire database, readable with your own eyes.
4. **HTTP methods & status codes**: GET = read, POST = create, PUT = update; 201 = created, 400 = you sent nonsense, 404 = not found. Our validation returns 400 with a machine-readable error code.
5. **Validation ("never trust the client")**: `server.js` checks coordinates are real numbers in valid ranges before touching them. Anyone can send fake requests to a public API — the app is just the polite way to call it.
6. **Async processing**: the emergency endpoint answers in milliseconds and does the slow work (AI, matching) *after* responding. A panicking user never stares at a spinner.
7. **WebSockets**: the always-open two-way pipe (Socket.IO) the server uses to *push* ambulance positions to every watching screen. Compare with the safety-net **polling** in `patient.js` — the same data, pulled every 4 seconds. We use both, deliberately: push for speed, poll for reliability. (We hit a real **race condition** here in testing — the server emitted updates before the phone finished subscribing. The poll is the fix.)
8. **Structured output from an LLM**: `src/ai.js` doesn't ask Gemini for prose — it demands a JSON shape (urgency, summary, neededCapabilities) that the *code* can act on. That's the difference between AI as a chatbot and AI as a system component.
9. **Graceful degradation**: no GPS → demo location; no Gemini key → mock AI; missed socket events → polling. Every failure path has a landing spot. In an emergency product, this isn't polish — it's the product.
10. **Secrets & environment config**: the Gemini key lives in `.env` locally and in Render's environment settings in production — never in code, never in git.

## What is honestly missing (our post-hackathon roadmap)

- **Authentication/authorization** — today, anyone can read any emergency. Real: accounts, JWT tokens, roles (patient/family/hospital), row-level access rules.
- **A real database** — PostgreSQL with transactions, constraints, and relationships instead of a JSON file.
- **Real dispatch** — the simulator's WebSocket broadcast is the socket a real ambulance partner's GPS feed would plug into.
- **The native mobile app** — React Native, with real push notifications (the family currently has to open a page; production taps them on the shoulder via APNs/FCM).
- **Medical-grade privacy** — encryption at rest, audit logs, consent management, data minimisation, DPDP Act analysis. Until then: synthetic data only, always.
