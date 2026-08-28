# Guide 1 — Run GoldenBay on your Windows PC (~15 minutes)

Follow these steps exactly, in order. Nothing here can damage your computer.

## Step 1: Install Node.js (one time, ~5 min)

Node.js is the program that runs our JavaScript server.

1. Go to **https://nodejs.org**
2. Click the big green **LTS** download button (LTS = Long Term Support, the stable version)
3. Run the downloaded installer. Click **Next** through everything (all defaults are fine). If it asks about "Tools for Native Modules", you can leave it **unchecked**.
4. **Verify it worked:** press the Windows key, type `powershell`, press Enter. In the blue window, type:
   ```
   node --version
   ```
   and press Enter. You should see something like `v22.x.x`. If you see an error, close PowerShell, reopen it, and try again (the installer updates a setting that only fresh windows pick up).

> **What is PowerShell?** A window where you control the computer by typing commands instead of clicking. Developers call this "the terminal" or "the CLI" (Command Line Interface). You'll use it constantly from now on.

## Step 2: Unzip the project

1. Find `goldenbay.zip` (downloaded from our chat)
2. Right-click → **Extract All…** → extract it somewhere easy, e.g. `C:\Users\<you>\Desktop\goldenbay`

## Step 3: Open a terminal *inside* the project folder

1. Open the extracted `goldenbay` folder in File Explorer (you should see `server.js` and `package.json` in it)
2. Click the **address bar** at the top, type `powershell`, press Enter — a terminal opens already pointed at this folder

## Step 4: Install the project's dependencies (~1 min)

In that terminal, type:

```
npm install
```

> **What this does:** reads `package.json` (the project's ingredient list), downloads the two libraries we use (`express` — the web server framework, and `socket.io` — real-time updates) into a folder called `node_modules`. This folder is machine-generated — you never edit it and never upload it to GitHub.

## Step 5: Add your Gemini key

1. In the goldenbay folder, find the file **`.env.example`**. Copy it and rename the copy to exactly **`.env`** (if Windows warns about changing the extension, accept).
2. Open `.env` with Notepad and replace `paste-your-key-here` with your real key from https://aistudio.google.com
3. Save and close.

> **Why a separate file?** Secrets never go inside code, and `.env` is listed in `.gitignore`, so it can never be accidentally uploaded to GitHub. This is a rule you'll keep forever.
>
> **No key yet?** Skip this step — the app runs in **mock AI** mode and every flow still works.

## Step 6: Start the server 🚀

```
npm start
```

You should see:

```
GoldenBay demo running → http://localhost:3000
AI mode: Gemini (gemini-2.5-flash)
```

> **What is localhost:3000?** `localhost` means "this computer". `3000` is the **port** — a numbered door on the computer where our server is listening. Your PC is now literally running a web server.

## Step 7: Try it

1. On the **PC browser**: open **http://localhost:3000** — the patient view
2. Open **http://localhost:3000/hospital** in a second window — put it side by side
3. Tap **SOS**, type something like *"Papa is holding his chest and can't breathe properly"*, confirm — and watch the hospital screen light up

**On your Android phone** (same Wi-Fi as the PC):
1. In the PC terminal, open a *second* PowerShell and type `ipconfig`. Find **IPv4 Address**, e.g. `192.168.1.5`
2. On your phone's browser, open `http://192.168.1.5:3000`
3. If it doesn't load, Windows Firewall is blocking it: when Windows asked "Allow Node.js to communicate on networks?" you must click **Allow** (it asks the first time you run `npm start`).
   - Note: phone browsers only share GPS with secure (https) sites, so on the phone the app will use the demo location — that's expected and fine. The deployed version (Guide 3) is https, so real GPS works there.

## To stop the server

In the terminal, press **Ctrl + C**.

## If something goes wrong

Copy the exact error message from the terminal and paste it to me in our chat. Never retype it from memory — exact text matters.
