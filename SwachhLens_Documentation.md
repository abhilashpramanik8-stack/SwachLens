# SwachhLens implementation documentation

SwachhLens is a KIIT Bhubaneswar cleanliness-response prototype. A citizen submits a waste photo and location; the system classifies the report with NVIDIA Vision, applies a deterministic response playbook, recommends a specialty cleanup crew, and lets an administrator track the issue through resolution.

This document describes the implementation that exists in this repository. It is intentionally different from a future-state specification: names, routes, data files, fallback behavior, and limitations below are based on the current source code.

## 1. Product scope

### Citizen experience

- Create an account with name, email, phone, and password.
- Sign in with email or phone.
- Recover a password with a six-digit verification code. Development returns a demo code; production is intended to connect an approved email/SMS provider.
- Select one of the 30 seeded KIIT campus records.
- Capture a photo from the camera or choose one from the gallery.
- Capture foreground GPS when permission is granted, or submit the selected campus coordinate as a fallback.
- Submit a report with an optional 500-character description.
- View the detected category, severity, AI explanation, duplicate status, estimated response time, assigned crew, and lifecycle status.
- View the user’s own submitted issues.

### Administrator experience

- Sign in with the configured administrator credentials.
- View KPI counts for active, severe, duplicate, user, total report, and resolved records.
- Inspect the live issue queue and each report image.
- See the NVIDIA/fallback provider label, severity, intervention, safety actions, escalation guidance, campus distance, and crew distance.
- See the playbook-matched crew types and assign an available crew.
- Manually reclassify an issue to a valid playbook category.
- Move an assigned issue through `en_route`, `on_site`, and `resolved`.
- Review campus hotspots and the response-time plan.
- Remove resolved issues and their stored images.
- Reset demo issues and reports with the admin-only reset endpoint.

## 2. Architecture

The primary architecture diagram is [`docs/architecture.svg`](docs/architecture.svg). Its editable source and Mermaid version are in [`docs/architecture.md`](docs/architecture.md).

At runtime, the system is organized as:

1. The Expo client collects authentication, photo, location, and administrator actions.
2. The Express API authenticates the request, validates input, stores uploads, and coordinates business logic.
3. The image is sent to NVIDIA’s OpenAI-compatible `/chat/completions` endpoint when `NVIDIA_API_KEY` is configured.
4. The response is normalized to one of the supported waste categories plus volume, confidence, image-processing score, severity, and explanation.
5. The deterministic playbook maps the category and volume to response actions, escalation guidance, and specialty crew types.
6. The crew matcher chooses an available specialty crew by category first, then uses volume/capacity and distance as a fallback.
7. The API persists issues, reports, users, crews, tokens, campus configuration, and audit logs in JSON files.
8. The client refreshes the issue or dashboard view and shows the resulting status/ETA to the appropriate user.

## 3. Technology stack

| Layer | Technology | Implementation use |
| --- | --- | --- |
| Mobile UI | Expo SDK 54, React Native 0.81, React 19.1, TypeScript | Single responsive app with citizen and admin modes |
| Mobile capabilities | `expo-image-picker`, `expo-location`, AsyncStorage, native picker | Camera/gallery, foreground GPS, theme persistence, campus selection |
| API | Node.js 22-compatible TypeScript, Express 4 | REST endpoints, middleware, lifecycle actions |
| Validation | Zod | Registration, reset, issue, and campus input validation |
| Authentication | JSON Web Tokens, bcryptjs | User/admin role separation and password hashing |
| Uploads | Multer, Sharp | Image upload validation, disk storage, fallback image signal |
| AI | NVIDIA Vision API | Image-to-JSON sanitation classification |
| Security middleware | Helmet, CORS, Morgan, express-rate-limit | HTTP headers, cross-origin development support, logs, auth throttling |
| Persistence | JSON files with atomic replacement | Lightweight demo persistence without a database server |
| Packaging | Docker Compose | Optional backend container for local/demo startup |

Important implementation choice: Groq is not used. NVIDIA is the only configured remote vision provider. If NVIDIA is unavailable, the API uses the local deterministic fallback and sets `manualReviewRequired` plus `aiProvider: "local-fallback"`.

## 4. Repository layout

```text
Swachlens/
├── backend/
│   ├── data/                         Demo JSON persistence
│   ├── src/
│   │   ├── app.ts                    Express app, routes, middleware
│   │   ├── services.ts               AI, playbook, crews, ETA, persistence helpers
│   │   ├── store.ts                  Atomic JSON read/write helpers
│   │   ├── types.ts                  Domain types
│   │   ├── server.ts                 dotenv load + HTTP listener
│   │   ├── seed.ts                   Demo issue/report reset
│   │   ├── smoke-test.ts             API smoke verification
│   │   └── generate-admin-hash.ts    bcrypt hash utility
│   ├── uploads/                      Runtime image storage; ignored by Git
│   ├── .env.example                  Backend configuration template
│   ├── package.json                  Backend scripts and dependencies
│   └── tsconfig.json
├── mobile/
│   ├── assets/                       App logo
│   ├── App.tsx                       Complete Expo client
│   ├── app.json                      Expo metadata and plugins
│   ├── .env.example                  Optional API URL override
│   ├── package.json                  Mobile scripts and dependencies
│   └── tsconfig.json
├── docs/
│   ├── architecture.md               Diagram source and runtime notes
│   └── architecture.svg              Submission-ready architecture diagram
├── README.md                          Quick start and demo checklist
├── SwachhLens_Documentation.md        This implementation documentation
├── docker-compose.yml                 Optional backend container
└── .gitignore
```

Generated directories such as `node_modules/`, `backend/build/`, and `mobile/.expo/` are local tooling artifacts and should not be included in a submission archive. `backend/uploads/` is runtime data and is also ignored.

## 5. End-to-end data flow

### Report submission

1. The user signs in and receives a 30-day user JWT.
2. The app submits multipart form data to `POST /api/issues` with `photo`, `campusId`, `latitude`, `longitude`, and `description`.
3. Multer accepts image MIME types only and limits the file to 10 MB. A random UUID filename prevents user-controlled path traversal.
4. `analyzeImage()` computes a local fallback first. If a file and NVIDIA key are available, the image is base64 encoded and sent to NVIDIA with the allowed category list in the prompt.
5. `normalizeVisionResult()` rejects unknown categories, clamps confidence/severity scores, validates volume, and stores a plain-language explanation.
6. The API checks for an active issue at the same campus. If one exists, the new report remains a separate report record while the existing issue’s report count and severity are updated.
7. Otherwise, the API creates an issue with status `analyzed`, an issue reference, response estimate, source report ID, and AI metadata.
8. Both `issues.json` and `reports.json` are updated with atomic JSON replacement.
9. The user receives the issue object and the client opens the details view.

### Admin assignment and resolution

1. The admin signs in and receives an eight-hour admin JWT.
2. `GET /api/admin/dashboard` returns KPIs, issues, enriched playbook categories, available crews, campus ETA data, and the fixed Campus 25 admin base.
3. For each issue, the dashboard computes `matchingCrews` by intersecting the playbook’s `crewTypes` with crew specialties.
4. `POST /api/admin/issues/:id/assign` accepts an optional `crewId`. A valid requested crew is used; otherwise `chooseCrew()` selects a matching available specialty crew, then falls back to capacity and distance.
5. Assignment sets the issue to `assigned`, stores crew and ETA information, marks the crew `assigned`, and writes an audit event.
6. Status transitions are enforced by a state machine: `analyzed → assigned → en_route → on_site → resolved`.
7. Resolving an issue records `resolvedAt` and releases the assigned crew to `available`.

## 6. Vision and playbook implementation

### NVIDIA contract

The prompt requests JSON with:

- `category`: one of the normalized category IDs
- `volumeClass`: `small`, `medium`, `large`, or `very_large`
- `confidence`: 0 to 1
- `imageProcessingScore`: 0 to 100
- `severity`: 0 to 100
- `explanation`: plain-language reasoning

The implementation is defensive: unknown categories fall back to the local classifier, numeric scores are clamped, and malformed API output is treated as an API failure. The local fallback uses the description plus a small image-statistics signal from Sharp; it is not presented as equivalent to visual inference.

### Playbook routing table

| Category | Operational response | Specialty crew types |
| --- | --- | --- |
| Overflowing dustbin | Empty, sanitize, and inspect collection frequency | `manual_cleanup`, `bulk_collection` |
| Illegal garbage dump | Bulk cleanup and enforcement inspection | `bulk_collection`, `enforcement_inspection` |
| Misplaced waste | Move waste to the correct collection point | `manual_cleanup` |
| Construction debris | PPE-based debris removal with mini truck | `construction_debris`, `bulk_collection` |
| Plastic near drains | Clear drain edge and route plastic to recycling | `drain_clearing`, `recycling_sorting` |
| Recyclable mixed with wet waste | Separate and route dry recyclables | `recycling_sorting`, `manual_cleanup` |
| Organic waste | Sealed collection and composting route | `organic_collection`, `bulk_collection` |
| E-waste | Isolate electronics and use an authorised recycler | `e_waste_handling` |
| Hazardous waste | Isolate area, use PPE, licensed handling | `hazardous_response` |
| Drain blockage | Clear blockage and restore flow | `drain_clearing`, `bulk_collection` |
| Glass or sharp waste | Puncture-safe cleanup and rigid containment | `hazardous_response`, `manual_cleanup` |
| Sanitary/bio-waste | Isolate and use an authorised handler | `hazardous_response` |
| Street litter | Sweep, collect, and inspect nearby bins | `manual_cleanup` |
| Waste near school/hospital | Safety perimeter and priority cleanup | `manual_cleanup`, `hazardous_response` |

The playbook is deterministic and administrator-visible. Vision supplies the category; it does not directly choose an arbitrary crew or bypass the operational rules.

## 7. Data model and persistence

The JSON files under `backend/data/` are seedable demo state. The main entities are:

- `users.json`: public profile fields plus bcrypt password hashes.
- `issues.json`: canonical operational issues, classification scores, current status, duplicate counts, crew assignment, ETA, and AI explanation.
- `reports.json`: every citizen submission, including reports consolidated into an existing campus issue.
- `crews.json`: crew status, capacity, coordinates, and specialty list.
- `campuses.json`: 30 KIIT campus records with coordinates, radius, active flag, and location quality where available.
- `passwordResetTokens.json`: bcrypt-hashed, expiring, one-use recovery codes.
- `auditLogs.json`: assignment, status, reclassification, and removal events.
- `settings.json`: demo mode and fixed Campus 25 admin position.

`store.ts` writes to `<file>.tmp` and renames the temporary file into place. This is suitable for a single-process hackathon demo, not for concurrent multi-instance production traffic.

## 8. API surface

### Public and user routes

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | None | Health check |
| GET | `/api/campuses` | None | Return the 30 campus records |
| GET | `/api/issues` | None | Return unresolved issues for public status lookup |
| GET | `/api/issues/:id` | None | Return an issue by UUID or reference ID |
| POST | `/api/auth/register` | None | Create a user and return a JWT |
| POST | `/api/auth/user-login` | None | Sign in with email or phone |
| POST | `/api/auth/forgot-password` | None | Create a 15-minute recovery code |
| POST | `/api/auth/reset-password` | None | Verify code and update password |
| GET | `/api/user/me` | User JWT | Return current user profile |
| GET | `/api/user/issues` | User JWT | Return issues linked to the user’s reports |
| POST | `/api/issues` | User JWT | Upload and analyze a report |

### Administrator routes

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | Administrator login |
| GET | `/api/admin/dashboard` | KPIs, issues, playbook, crews, campus ETAs |
| POST | `/api/admin/issues/:id/assign` | Assign a requested or recommended crew |
| DELETE | `/api/admin/issues/:id` | Remove a resolved issue and its images |
| PATCH | `/api/admin/issues/:id/classification` | Change category to a valid playbook category |
| PATCH | `/api/admin/issues/:id/status` | Advance the lifecycle state |
| POST | `/api/admin/demo/reset` | Clear issues and reports for a clean demo |

### Static upload route

`GET /uploads/:filename` serves an existing image by basename only. The route resolves the path and rejects anything outside the configured uploads directory.

## 9. Security and compliance checks

Implemented checks:

- Passwords are hashed with bcryptjs; raw passwords are not stored.
- User and admin JWTs carry distinct roles and are validated by separate middleware.
- Admin credentials support `ADMIN_PASSWORD_HASH`; a plaintext development default exists only for the local demo.
- Auth routes are rate-limited with `express-rate-limit`.
- Helmet adds security headers; CORS is enabled for local mobile/web development.
- Zod validates required fields, campus IDs, coordinate ranges, descriptions, password reset codes, and category updates.
- Uploads are MIME-filtered, capped at 10 MB, assigned server-generated filenames, and path-safe when served/deleted.
- Password-reset responses do not reveal whether an account exists. Demo codes are only returned outside production mode.
- Uploaded images and `.env` files are ignored by Git.
- The app does not request background location; it uses foreground location only.

Before submission or deployment:

- Replace `JWT_SECRET=change-me` with a strong random secret.
- Set `ADMIN_PASSWORD_HASH` and remove reliance on `ADMIN_PASSWORD`.
- Rotate any credential that has ever been placed in a local `.env` file or shared archive.
- Set `NODE_ENV=production` only after wiring an approved email/SMS password-recovery provider.
- Run behind HTTPS and add a production origin allowlist instead of broad CORS.
- Review the approximate campus-zone coordinates with KIIT operations.
- Replace JSON storage with a transactional database if multiple API instances are required.

## 10. Local setup and demo

### Backend

```powershell
cd backend
npm.cmd install
Copy-Item .env.example .env
# Add NVIDIA_API_KEY and change JWT/admin values in backend/.env
npm.cmd run dev
```

The backend listens on port `5050` by default.

### Mobile

```powershell
cd mobile
npm.cmd install
npx.cmd expo start
```

The client detects the Expo host automatically. If needed, set `EXPO_PUBLIC_API_URL` in `mobile/.env` to `http://<computer-lan-ip>:5050/api`.

### Demo sequence

1. Register a citizen account.
2. Choose a campus, capture/upload a waste photo, and submit.
3. Open Administrator and sign in.
4. Open Issues, confirm the AI category and playbook actions, and assign the matching crew.
5. Advance the issue through En route, On site, and Resolved.
6. Submit another nearby report to demonstrate same-campus consolidation.
7. Use the reset endpoint for the next demo run.

## 11. Verification

Run these commands before submitting:

```powershell
cd backend
npm.cmd run build
npm.cmd test

cd ..\mobile
npm.cmd run typecheck
```

Expected results:

- TypeScript compilation succeeds.
- API smoke checks pass for health, campus count, unauthorized admin access, admin login, and dashboard access.
- Mobile TypeScript check returns without diagnostics.

The repository also contains `docker-compose.yml` for a backend-only container workflow. It is intended for demo convenience; local Expo still runs separately.

## 12. Known limitations and next steps

- JSON persistence is intentionally lightweight and single-process.
- The map is a responsive coordinate-based visual, not a live map provider.
- Campus data includes approximate pins where an exact operational pin is unavailable.
- Duplicate consolidation currently groups active reports by campus rather than using a full perceptual image/vector similarity pipeline.
- Password recovery has no production message delivery integration.
- Crew locations are seeded demo coordinates, not live GPS telemetry.
- The fallback classifier is a continuity path and must be manually reviewed when NVIDIA is unavailable or confidence is low.

## 13. Submission checklist

- [x] Working mobile citizen report flow
- [x] Working administrator operations flow
- [x] Architecture diagram and source code
- [x] NVIDIA Vision integration with explicit fallback
- [x] Waste playbook and specialty crew routing
- [x] Documentation of stacks, modules, data flow, and APIs
- [x] Source-level smoke test and mobile typecheck
- [x] Secrets excluded from templates and ignored files
- [x] 10-slide pitch deck: `SwachhLens_Pitch_Deck.pptx`
- [ ] Record and attach the requested demo video separately
