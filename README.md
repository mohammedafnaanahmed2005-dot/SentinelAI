# SentinelAI — Adaptive Facial & Iris Biometric Authentication

A full-stack biometric authentication system combining **YuNet face detection**, **SFace 128-d embeddings**, **iris tracking**, keystroke dynamics, geo-proximity scoring, and a Snapdragon SPU simulation dashboard.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+, FastAPI, Uvicorn |
| AI Models | OpenCV YuNet (ONNX), SFace (ONNX), YOLOv8 |
| Frontend | TypeScript, Vite, Tailwind CSS v4 |
| Database | SQLite (embedded, no setup needed) |
| Auth | Adaptive risk engine, OTP step-up MFA |

---

## Project Structure

```
cyber/
├── backend/
│   ├── app.py              # FastAPI routes
│   ├── ai_engine.py        # Face detection & recognition
│   ├── risk_engine.py      # Adaptive risk scoring
│   ├── database.py         # SQLite helpers
│   ├── sessions_db.py      # Session management
│   └── models/             # ONNX model files
├── frontend/
│   ├── src/                # TypeScript source
│   ├── js/                 # Compiled/legacy JS
│   ├── signin.html
│   ├── dashboard.html
│   ├── admin.html
│   └── package.json
├── run.py                  # Backend entry point
├── start_all.bat           # One-click launcher (Windows)
└── .env.example            # Environment variable template
```

---

## Prerequisites

Make sure the following are installed before running:

- **Python 3.11+** — https://www.python.org/downloads/
- **Node.js 18+** — https://nodejs.org/
- **npm** (comes with Node.js)

---

## Setup & Installation

### Step 1 — Clone / open the project

```powershell
cd d:\cyber
```

### Step 2 — Set up Python virtual environment

The `.venv` folder is already included. If it is missing or broken, recreate it:

```powershell
python -m venv .venv
```

Then install Python dependencies:

```powershell
.venv\Scripts\pip install fastapi uvicorn[standard] opencv-contrib-python numpy pillow ultralytics
```

### Step 3 — Install frontend dependencies

```powershell
cd d:\cyber\frontend
npm install
```

### Step 4 — (Optional) Copy environment file

```powershell
cd d:\cyber
copy .env.example .env
```

Edit `.env` if you need to override any defaults. The app runs fine without changes for local development.

---

## Running the App

### Option A — One-click launcher (recommended)

Double-click `start_all.bat` in File Explorer, or run it in a terminal:

```powershell
cd d:\cyber
.\start_all.bat
```

This will:
1. Kill anything already running on ports `8000` and `5173`
2. Start the **frontend** Vite dev server at `http://localhost:5173`
3. Start the **backend** FastAPI server at `http://127.0.0.1:8000`
4. Auto-restart the backend if it crashes

Then open your browser:

```
http://localhost:5173/signin.html
```

---

### Option B — Run frontend and backend separately

Open **two separate terminals**.

**Terminal 1 — Backend:**

```powershell
cd d:\cyber
.venv\Scripts\python.exe run.py
```

**Terminal 2 — Frontend:**

```powershell
cd d:\cyber\frontend
npm run dev
```

Then open:

```
http://localhost:5173/signin.html
```

---

## Pages

| URL | Description |
|-----|-------------|
| `/signin.html` | Login page with live webcam facial auth |
| `/dashboard.html` | SOC dashboard — sessions, audit logs, risk charts |
| `/admin.html` | Admin panel — register users, manage policy |

---

## Default Admin Account

On first run the database is seeded automatically. Log in with:

```
Email:    admin@sentinel.ai
Password: admin123
```

> Admin accounts bypass facial verification (password-only by policy).

---

## Build for Production

To compile TypeScript and bundle the frontend:

```powershell
cd d:\cyber\frontend
npm run build
```

Output goes to `frontend/dist/`. Serve the backend with the built static files by pointing FastAPI's static mount at `dist/`.

---

## Troubleshooting

**`npm run dev` — "Cannot find package.json"**
You are in the wrong folder. Make sure you are inside `d:\cyber\frontend`, not `d:\cyber`.

**Webcam not detected**
- Allow camera permissions in the browser when prompted.
- Make sure no other app (Teams, Zoom, OBS) is holding the camera.
- The app falls back to **Neural Simulation Mode** automatically if the camera is unavailable.

**Port already in use**
`start_all.bat` kills processes on ports 8000 and 5173 automatically. If running manually:

```powershell
# Find and kill the process on port 8000
netstat -aon | findstr ":8000"
taskkill /F /PID <PID>
```

**Face not detected / low match score**
- Ensure good front lighting — avoid strong backlight (bright window behind you).
- Re-enrol from the admin page if the stored template is missing (`✗ NO TEMPLATE` shown in the user table).
- The face threshold is configurable in the admin dashboard under Security Policies (default 55%).

**Backend Python errors on startup**
Reinstall dependencies:

```powershell
cd d:\cyber
.venv\Scripts\pip install --upgrade fastapi uvicorn[standard] opencv-contrib-python numpy pillow ultralytics
```

---

## Stopping the App

If you used `start_all.bat`, close the two terminal windows it opened, or press `Ctrl+C` in each.

To forcefully free the ports:

```powershell
.\stop_all.bat
```
