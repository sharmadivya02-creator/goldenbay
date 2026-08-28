# Guide 3 — Deploy GoldenBay for a live link (~15 minutes, free)

We'll use **Render** (render.com) — it takes code straight from GitHub, runs it on a server in the cloud, and gives you a public **https** link. Free tier, no credit card needed for this.

> **What "deploying" means:** until now the server ran on `localhost` — your PC, reachable only by you. Deploying runs the same `npm install` + `npm start` on a machine on the public internet, so judges (and your phone, from anywhere) can open it. Bonus: the link is **https**, so real GPS works on phones.

## Step 1: Create the service

1. Go to **https://render.com** → **Get Started** → sign up with **GitHub** (this lets Render see your repos)
2. In the dashboard: **New +** → **Web Service**
3. Choose your **goldenbay** repository → **Connect**
4. Fill the form:
   - **Name**: `goldenbay` (your link becomes `https://goldenbay-xxxx.onrender.com`)
   - **Region**: **Singapore** (closest to India → fastest for judges here)
   - **Branch**: `main`
   - **Runtime/Language**: Node (usually auto-detected)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type / Plan**: **Free**

## Step 2: Add your secret key (the deployed server needs its own `.env`-equivalent)

Still on the form (or later under the service's **Environment** tab), add an **Environment Variable**:

- Key: `GEMINI_API_KEY` → Value: your key from aistudio.google.com
- (Optional) Key: `GEMINI_MODEL` → Value: `gemini-2.5-flash`

> This is why we never committed `.env` — every environment (your PC, Render) gets its own secrets, entered directly, never through code.

## Step 3: Deploy

Click **Deploy Web Service** and watch the log scroll — it's literally running `npm install` and `npm start` on a fresh Linux machine. In a few minutes you'll see the green **Live** badge and your URL at the top.

Open the URL. Test **all three views**: `/`, `/family`, `/hospital`.

## The two free-tier gotchas (know these before the demo!)

1. **It sleeps.** A free service spins down after ~15 minutes without traffic, and the next visitor waits up to a minute while it wakes. **Open your link 5 minutes before judging** so it's warm.
2. **Data resets.** Our JSON-file storage lives on the machine's disk, which is wiped whenever the service restarts or redeploys. The demo hospitals and Ramesh's demo profile re-seed automatically, so the demo always works — but profiles you created earlier may vanish. (This is exactly why production uses a real database like PostgreSQL — which is our next chapter after the hackathon.)

## Updating the deployed app

Change the code on GitHub (upload a new version of a file) → Render redeploys automatically. That pipeline — push code, it goes live — is called **CI/CD**, and you now have one.

## Submission checklist

- ✅ Live link: `https://goldenbay-xxxx.onrender.com` (test from your phone on mobile data, not just Wi-Fi)
- ✅ Repo link: `https://github.com/<you>/goldenbay`
- ✅ Warm the live link right before judges look
- ✅ If the hackathon form still says "FastAPI", update it to: *Node.js (Express) backend with Gemini structured-output calls, WebSocket real-time layer*
