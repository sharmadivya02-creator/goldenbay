# Guide 2 — Put GoldenBay on GitHub (~10 minutes)

GitHub is where developers store and share code. The hackathon wants your repo link, and the deployment in Guide 3 needs the code to be on GitHub anyway.

## Step 1: Create an account

1. Go to **https://github.com** → Sign up (use any email; pick a professional username — it appears in your repo link)

## Step 2: Create the repository

> **Repository ("repo")** = one project's folder on GitHub, with full history of every change.

1. Click the **+** (top right) → **New repository**
2. Repository name: `goldenbay`
3. Description: `Emergency response system — right hospital, prepared before the patient arrives. Gemini hackathon prototype.`
4. Keep it **Public** (judges must be able to open it)
5. Do NOT tick "Add a README" (we already have one)
6. Click **Create repository**

## Step 3: Upload the code (no Git commands needed today)

1. On the new repo page, click the link **"uploading an existing file"**
2. Open your extracted `goldenbay` folder in File Explorer
3. Select everything **EXCEPT** these two, which must never be uploaded:
   - ❌ `node_modules` (machine-generated — anyone can recreate it with `npm install`)
   - ❌ `.env` (contains your SECRET Gemini key — a leaked key on GitHub gets stolen by bots within minutes)
4. Drag the selected files/folders onto the GitHub upload page and wait for all of them to list
5. In the "Commit changes" box write: `GoldenBay hackathon demo` → click **Commit changes**

> **Commit** = a saved snapshot of the project with a message describing it. Professional projects are thousands of commits, each one a small, described change. (The proper way to do this is the `git` command-line tool — we'll learn it right after the hackathon; the web upload is today's shortcut.)

## Step 4: Check yourself

Open your repo link — `https://github.com/<your-username>/goldenbay` — and confirm:

- ✅ README displays with the GoldenBay description
- ✅ `server.js`, `src/`, `public/`, `docs/` are all there
- ✅ There is **no** `.env` file and **no** `node_modules` folder
- ✅ `.env.example` IS there (it contains no secret — that's the point of it)

That repo link is one of your two submission links. Guide 3 gets you the other.
