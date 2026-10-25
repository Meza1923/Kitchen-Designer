# Kitchen Designer

Schematic kitchen planner with a top-down plan view, per-wall elevations and an orbit 3D view (spec: `.CLAUDE`).

## Quick start (Windows, macOS, Linux)

Everything runs in Docker containers, so you don't need Node, Python or PostgreSQL on your computer.

### Windows

1. Install **[Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)** and accept the WSL 2 setup it offers (it may ask you to restart). Start Docker Desktop and wait until it shows *Engine running*.
2. Get the project:
   - **Without git:** on the GitHub page click **Code → Download ZIP**, then right-click the ZIP → **Extract All**.
   - **With git:** `git clone <repository URL>`
3. Open **PowerShell** in the project folder (in Explorer: open the folder, type `powershell` in the address bar, press Enter) and run:

   ```powershell
   docker compose up --build
   ```

   The first start downloads and builds everything (a few minutes). It's ready when the log shows `VITE ... ready`.
4. Open **http://localhost:5173** in your browser.

Stop it with **Ctrl+C** in PowerShell, or `docker compose down`. The next time, `docker compose up` starts in seconds. Saved projects are kept in a Docker volume, so they survive restarts (`docker compose down -v` would delete them).

**If something goes wrong**

- *"port is already allocated"*: another program uses port 5173, 8000 or 5432 (often a locally installed PostgreSQL). In `docker-compose.yml` change the left number of the clashing `ports:` entry, e.g. `"5433:5432"`, and run `docker compose up` again.
- *"docker: command not found"* or *"cannot connect to the Docker daemon"*: Docker Desktop isn't running. Start it and wait for *Engine running*.
- After pulling a newer version that changes `package.json` or `requirements.txt`, rebuild with `docker compose up --build`.

### macOS / Linux

```bash
docker compose up --build
```

On macOS this works with Docker Desktop or with Podman (`podman machine start`, plus `brew install docker-compose`).

### Addresses

- App: http://localhost:5173
- API: http://localhost:8000/api/projects (docs at http://localhost:8000/docs)
- PostgreSQL: localhost:5432 (`kitchen` / `kitchen`, db `kitchen`; a local-only development database), data persisted in the `pgdata` volume

### Without Docker

```bash
# backend (any SQLAlchemy URL works; SQLite is handy for local dev)
cd backend && pip install -r requirements.txt
DATABASE_URL=sqlite:///dev.db uvicorn app.main:app --reload --port 8000

# frontend (proxies /api to localhost:8000)
cd frontend && npm install && npm run dev
```

Live reload works inside the containers: Vite and uvicorn poll for file changes (`VITE_USE_POLLING`, `WATCHFILES_FORCE_POLLING` in `docker-compose.yml`), because file events don't cross Docker/Podman bind mounts on macOS and Windows.

Podman on macOS: if Docker reports `failed to connect to the docker API at unix:///var/run/docker.sock`, the Podman VM's network proxy has died. Restart it with `podman machine stop && podman machine start`.

## Layout

- `backend/app` – FastAPI + SQLAlchemy 2.0 (`kitchen_projects` table, JSONB `data`), Pydantic v2 schemas
- `frontend/src/lib/geometry.ts` – coordinate conversion, snapping, gap/overlap detection, countertop merging
- `frontend/src/lib/plan.ts` – room/wall frames, wall-local → plan mapping, cross-wall clash detection
- `frontend/src/lib/migrate.ts` – upgrades projects saved before the plan view
- `frontend/src/components/PlanDrawing.tsx` / `PlanCanvas.tsx` – top-down plan (rendering / interaction)
- `frontend/src/components/Drawing.tsx` + `ItemShape.tsx` – elevation schematic (shared by canvas and PNG/print export)
- `frontend/src/components/Canvas.tsx` – drag, snap (Shift = freeform), zoom/pan
- `frontend/src/components/Inspector.tsx` – element properties, drawer splits, tower zones

## Shortcuts

⌘/Ctrl+Z undo · ⇧⌘/Ctrl+Shift+Z or Ctrl+Y redo · Delete/Backspace removes the selection · arrows nudge 1 cm (Shift = 10 cm) · Esc deselects · double-click a wall tab to rename.
