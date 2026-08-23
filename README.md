# SwachhLens

SwachhLens is a KIIT Bhubaneswar cleanliness response prototype. It connects citizen reports to AI-assisted triage, duplicate consolidation, crew assignment, ETA, and resolution tracking.

Submission artifacts: [implementation documentation](SwachhLens_Documentation.md), [architecture source](docs/architecture.md), [architecture diagram](docs/architecture.svg), and [10-slide pitch deck](SwachhLens_Pitch_Deck.pptx).

## Run locally

```powershell
cd backend
npm.cmd install
Copy-Item .env.example .env
npm.cmd run dev
```

In another terminal:

```powershell
cd mobile
npm.cmd install
npx.cmd expo start
```

The app now detects the Expo development host automatically. For a physical phone, keep the phone and computer on the same Wi-Fi and make sure Windows Firewall allows port `5050`. If automatic detection is not available, set `EXPO_PUBLIC_API_URL` in `mobile/.env` to your computer's LAN IP plus `/api`, then restart Expo with `npx.cmd expo start -c`.

The administrator defaults are `admin` / `admin123`; if you changed them, use the values in `backend/.env`.

For a bcrypt-protected administrator password, generate the value with:

```powershell
cd backend
npm.cmd run hash:admin -- "YourStrongPassword"
```

Copy the printed `ADMIN_PASSWORD_HASH=...` line into `backend/.env`. The hash is one-way; you generate a new one when the password changes. `ADMIN_PASSWORD_HASH` takes precedence over `ADMIN_PASSWORD`.

The report screen shows an in-app dummy campus map with the selected campus coordinate and the report pin. It captures foreground GPS when permitted and falls back to the selected campus coordinates when GPS is unavailable. No Google Maps preview is used.

Users must create an account with name, email, phone, and password before reporting. Accounts are stored in `backend/data/users.json` with bcrypt password hashes. Individual submissions are stored in `backend/data/reports.json`; same-campus active submissions remain separate report records while incrementing the canonical issue's report count.

The user sign-in screen includes email/phone password recovery. In development, the API returns a demo verification code in the response so the flow can be tested without an SMS/email provider. A production deployment should connect `/api/auth/forgot-password` to its approved email/SMS provider and leave `NODE_ENV=production` so the code is not returned to the client.

The admin operations base is fixed at Campus 25 (`20.364657, 85.816969`). Expected response time is calculated from that base to each campus at the configured planning speed, and the admin dashboard shows both the distance and estimate.

The admin Playbook tab is the source of truth for routing. NVIDIA Vision returns one normalized waste category; that category is matched to a playbook intervention, safety actions, escalation guidance, and specialty crew types. The issue queue then offers available crews whose specialties match the detected category, with distance and capacity used as the fallback recommendation.

The mobile client is upgraded to Expo SDK 54 (React Native 0.81 / React 19.1), uses an in-app dummy map with coordinate pins, and has a light/dark toggle in the upper-right corner. Google Maps is not required.

## Important campus-data note

The required 30 campus records are present in `backend/data/campuses.json`. The file includes verified KIIT Navigator coordinates where available and clearly labels approximate campus-zone pins for facilities that do not have an individual Navigator pin. The API keeps the 30-campus restriction.

## API highlights

- `GET /api/health`
- `GET /api/campuses`
- `GET /api/issues`
- `POST /api/issues` multipart form: `photo`, `campusId`, `latitude`, `longitude`, `description`
- `POST /api/auth/login`
- `GET /api/admin/dashboard` (JWT)
- `POST /api/admin/issues/:id/assign` (JWT)
- `PATCH /api/admin/issues/:id/status` (JWT)

NVIDIA is the only configured vision provider. If NVIDIA is unavailable or fails, reports are saved using an explicitly labeled local fallback estimate and manual review flag.

Authentication endpoints are rate-limited in the API. For a real deployment, set a strong `JWT_SECRET`, use `ADMIN_PASSWORD_HASH`, run behind HTTPS, and connect password recovery to an approved email/SMS provider before enabling production mode.

## Hackathon demo checklist

1. Copy `backend/.env.example` to `backend/.env` and add an NVIDIA API key.
2. Start the API, then start Expo (`npm.cmd run dev` in `backend`; `npx.cmd expo start` in `mobile`).
3. Register a local user, upload a waste photo, and submit the report.
4. Sign in to Administrator with the configured credentials, open Issues, choose the playbook-matched crew, and advance the issue through En route, On site, and Resolved.
5. For a clean demo reset, use the admin-only `POST /api/admin/demo/reset` route.

## Verification

```powershell
cd backend
npm run build
npm run seed
```

JSON files are atomically replaced on writes and survive backend restarts. Uploaded images remain in `backend/uploads`.
