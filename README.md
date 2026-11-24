# CMA Office

Team work system for Creative International, Coastal Manpower and SM Enterprise:
interview-driven video timelines, tasks, requests, log sheet, recruitment and call broadcast.
One backend serves the website, the Windows desktop app and the mobile app.

The approved UI prototypes are the spec:
mobile https://claude.ai/artifact/GT3ZTFdJte3irjSCsg1e7a · web https://claude.ai/artifact/4hU3FivKr3vzpQi13qLYWK

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Next.js website + API, Prisma/PostgreSQL database |
| `packages/core` | Shared rules: timeline counted back from the interview, modules/permissions/responsibilities, log sheet reports, company name check |
| `apps/mobile` | (phase 3) Expo app: attendance, notifications, requests |
| `apps/desktop` | (phase 4) Electron app: web app + Work Monitor |

## Phases

1. **Backend + web** (in progress): login, users, levels, module access, responsibilities, settings, New interview → automatic chain (script → approve → shoot slot → shoot → raw upload → edit → QC → handover → publish → ads) with Start / Done & hand over / QC pass-fail / Already done, requests, notifications, Log Sheet backup row. Log Sheet (day tabs, Status_Check, Report), Recruitment Command Center, Call & SMS Broadcast, one-time import of the existing sheet data.
2. Google Sheets two-way sync (interview list, log sheet, Banglalink call panel) + WhatsApp Business notifications.
3. Mobile app + attendance (office WiFi / location).
4. Desktop app + Work Monitor (consent, visible indicator, only while checked in).
5. AI Command Center, payroll, performance.

## Run locally

```bash
pnpm install
cp .env.example apps/web/.env   # set DATABASE_URL=postgresql://... and SESSION_SECRET
cd apps/web
npx prisma migrate dev
pnpm db:seed                    # loads the team; everyone's first password is cma12345
pnpm dev
pnpm test                       # needs the database; also run in packages/core
```

Seed phone numbers are placeholders `01700000001`…`01700000019` (Jamil = `01700000002`,
Khalid = `01700000001`). Change them in Users & Permissions.

## Put it on a VPS

New VPS, own domain, room for more sites on the same server: see [DEPLOY-NEW-VPS.md](DEPLOY-NEW-VPS.md) (`install.sh` + shared proxy in `proxy/`).
The manual steps below run the app with its own built-in Caddy (only this one site on the VPS).

Any Ubuntu VPS with 2 GB RAM or more (Hetzner, DigitalOcean, Contabo...).

```bash
# 1. on the VPS, once
curl -fsSL https://get.docker.com | sh
git clone https://github.com/timestodayit-eng/cma-office-repo.git cma-office && cd cma-office
cp .env.example .env && nano .env      # DB_PASSWORD, SESSION_SECRET (openssl rand -hex 32), DOMAIN

# 2. start (also used for every update after git pull)
docker compose up -d --build
```

Import the existing sheet data once (interviews, broadcast panel, all log sheet days):

```bash
docker compose cp sheet-snapshot.json web:/tmp/snap.json
docker compose exec web sh -c 'cd apps/web && ./node_modules/.bin/tsx prisma/import-snapshot.ts /tmp/snap.json'
```

The snapshot file is kept in the project's private files, not in this repository.

Point the domain's DNS A record at the VPS IP; Caddy gets the HTTPS certificate by itself.
Database backups are written daily to `./backups` (14 days kept).

## Windows desktop app and Work Monitor

`desktop/` is an Electron app (npm, not part of the pnpm workspace). It opens the same office app in its own window and adds **Start work / Stop work**:

- Only between Start work and Stop work: a screenshot of every screen at a random moment every 5–10 minutes (admin sets it), compressed to JPEG; once a minute the app in front, its window title and idle time.
- Locking the PC, sleep, logging out or quitting ends the session. Nothing is recorded outside a session. No keystrokes, passwords or messages.
- Admins (super admins or the "Work Monitor admin" duty) can open a live view while a person is working; the person sees "Admin is viewing your screen" and a red tray icon. Live pictures stay in memory, never on disk.
- Staff read the notice in the installer and on first start; the tray icon is green while working.
- Screenshots are stored on the server in the `shots` Docker volume (`SHOTS_DIR`). Admins delete them on Work Monitor → Rules & storage (by person / dates), plus auto-delete after N days (default 30).

The workflow `.github/workflows/desktop.yml` builds `CMA-Office-Setup.exe` on Windows and puts it on the release tag `desktop-latest`. The installer is not code-signed, so Windows shows "Windows protected your PC": More info → Run anyway.
