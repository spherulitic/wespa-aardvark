# WESPA Backend Platform - System Design

## Component Summary

- **Reverse Proxy (Caddy/nginx)** — Routes traffic to backend services; handles TLS termination, load balancing, and path-based routing (e.g., `/api/players/*` → Player Service).

- **Auth Service (Keycloak)** — OIDC provider for third-party authentication; manages user roles (player, association admin, WESPA staff) and federation with existing member database.

- **Player Service (Go)** — Manages player profiles (WESPA ID, name, country, photo, titles); handles self-service updates, name→ID mapping for tournament uploads, and historical rating data.

- **Calendar API (Go)** — Manages tournament calendar and sanction applications; provides public calendar endpoints for upcoming and ongoing events.

- **Results API (existing Python/Flask)** — Serves historical tournament results to third parties; remains as-is during transition.

- **File Processing Service (Go)** — Validates and imports `.tou` and `.st4` files; maps entrant names to WESPA IDs; archives raw files to object storage; reports unresolved mappings.

- **Rating Service (Go — future)** — Server-based `.tou` processing and Glicko-2 rating calculation; updates player ratings asynchronously after tournament imports.

- **Portal Backend (Go)** — Serves Player Portal (self-service profile updates) and Member Portal (national association administration) frontend applications; aggregates data from core services.

## Architecture Diagram

**TODO**

## Component Breakdown

## Component 1: Reverse Proxy

**Purpose:** Traffic router and entry point for all HTTP requests to the WESPA backend.

**Responsibilities:**
- Accept incoming HTTPS requests (Caddy auto-handles TLS)
- Route requests to the correct backend service based on URL path:
  - `/api/players/*` → Player Service
  - `/api/calendar/*` → Calendar API
  - `/api/results/*` → Results API (existing Python)
  - `/api/files/*` → File Processing Service
  - `/api/portals/*` → Portal Backend
  - `/auth/*` → Keycloak
- Optional: Rate limiting per client IP or API key
- Optional: Request logging and basic observability

**Tech choice:** Caddy (automatic HTTPS, simple config)

**What it does NOT do:**
- No authentication/authorization — delegated to Keycloak and individual services
- No request transformation — just routing
- No static asset serving — handled separately (existing component, stack TBD)

## Component 2: Auth Service

**Purpose:** Identity and access management for all WESPA users and third-party applications.

**Implementation:** Keycloak (can share with Xerafin — new realm will be created for WESPA)

**Responsibilities:**
- OIDC provider for third-party sites (Woogles, Cross-tables, ABSP, etc.)
- User registration and credential management
- Role-based access control (RBAC):
  - `player` — self-service profile updates, view own data
  - `association_admin` — manage member players, submit tournament sanctions
  - `wespa_staff` — upload `.tou`/`.st4` files, override mappings, approve sanctions

**Integration points:**
- Player Portal → Keycloak login page (OIDC redirect)
- Member Portal → Keycloak login page
- Third-party apps → OAuth2 authorization endpoint
- Reverse Proxy → forwards `/auth/*` paths to Keycloak
- Individual services → validate bearer tokens via introspection endpoint or local JWT verification

**OIDC flows supported:**
- Authorization Code Flow (for web apps like Woogles)
- Implicit Flow (for SPAs — player/member portals)
- Client Credentials (for server-to-server integrations)

**Configuration notes:**
- Realm name: `wespa`
- Clients to configure:
  - `player-portal` (SPA)
  - `member-portal` (SPA)
  - `woogles` (third-party)
  - `cross-tables` (third-party, future)
  - `file-processor` (service account for internal auth)

**What it does NOT do:**
- No user profile storage beyond authentication (Player Service owns profile data)
- No rating or tournament data

## Component 3: Player Service (Go)

**Purpose:** Source of truth for all player-related data and operations.

**Existing schema:** `players` table (name, country, photo, rating, status flags) plus `player_alt_names` for alias resolution.

**Responsibilities:**
- CRUD operations for player profiles (name, country, photo, titles, WESPA rating)
- Self-service update workflow with approval (name/photo auto-approve; country requires association approval?)
- Name → WESPA ID mapping (batch lookup for .tou processing):
  - Exact match on name or alt names
  - Fuzzy matching for unresolved entrants
  - Return resolved IDs + flag unmapped names
- Historical rating data retrieval (from tournament results)

**API Endpoints (Notional):**
- GET /v1/players/{wespa_id} → public profile
- GET /v1/players?q={name}&country={country} → search
- PUT /v1/players/{wespa_id} → update (auth: player or staff)
- POST /v1/players/lookup → batch name → ID mapping
- GET /v1/players/{wespa_id}/ratings → historical ratings
- POST /v1/players/{wespa_id}/change-request → submit self-service update
- GET /v1/players/change-requests → pending approvals (assoc/staff)
- PUT /v1/players/change-requests/{id} → approve/deny


**Tech notes:**
- Go with chi router + JWT validation middleware
- JWT validation: libraries like `go-jwks` auto-discover Keycloak OIDC config and handle key rotation; explicit but not complex
- Direct MySQL access (existing schema, minimal additions expected)
- Fuzzy matching library for name resolution

**What it does NOT do:**
- No authentication (delegated to Keycloak)
- No tournament calendar (Calendar API)
- No rating calculation (Rating Service)

## Component 4: Calendar API (Go)

**Purpose:** Manage tournament calendar, sanction applications, and provide public schedule data.

**Existing schema:** `events` (event header info with dates, country, location) and `tournaments` (individual tournament within an event, with TD, name, dates).

**Responsibilities:**
- List upcoming and ongoing tournaments (public calendar)
- View tournament details (dates, location, TD, divisions)
- Submit tournament sanction applications (tournament directors)
- Review and approve/deny applications (WESPA staff)
- Once sanctioned, create/update `events` and `tournaments` records
- Provide calendar feeds (JSON, optionally iCalendar format)
- Provide data via API to WESPA tourament calendar front end

**API Endpoints (Notional):**
- GET /v1/calendar → list tournaments (upcoming + ongoing)
- GET /v1/calendar?year=2025&country= → filtered calendar
- GET /v1/calendar/{id} → tournament details
- POST /v1/calendar/apply → submit sanction application (assoc only)
- GET /v1/calendar/applications → pending applications (staff)
- PUT /v1/calendar/applications/{id} → approve/deny (staff)
- GET /v1/calendar/export/ical → iCalendar feed for external calendars

**Sanction application workflow:**
1. Tournament organiser submits: tournament name, dates, location, TD, divisions
2. System creates record in new `sanction_applications` table
3. WESPA staff reviews in portal
4. Upon approval: creates/updates `events` + `tournaments` in existing schema
5. Rejection sends notification back to organiser

**Database integration:**
- Reads from existing `events` and `tournaments` tables for public calendar
- New table `sanction_applications` for pending requests (no changes to existing schema)

**Tech notes:**
- Go with chi router
- Same JWT validation middleware as Player Service
- Role checks: `wespa_staff` for approvals, `wespa_director` for submissions

**What it does NOT do:**
- No results data (that's Results API)
- No player data (Player Service owns that)
- No file uploads (File Processing Service)

## Component 5: Results API (existing Python/Flask)

**Purpose:** Serve historical tournament results to third parties.

**Current state:** Already built and running at https://github.com/spherulitic/wespa-api

**Responsibilities:**
- Provide tournament results data via public endpoints
- Query existing schema (`tournament_results`, `player_results`, `games`, etc.)
- No changes planned during initial migration

**Integration:**
- Remains behind the reverse proxy (e.g., `/api/results/*` → existing service)
- Will eventually coexist with newer Go services
- Eventually to be rewritten in Go

**What it does NOT do:**
- No calendar or upcoming tournament data (Calendar API)
- No player self-service (Player Service)
- No file uploads or .tou processing (File Processing Service)
- No authentication — public read-only endpoints (to be evaluated later)

## Component 6: File Processing Service (Go)

**Purpose:** Validate and import `.tou` and `.st4` files into the WESPA database.

**Current state:** This is new; `.tou` parsing complexity is acknowledged.

**Responsibilities:**
- Accept `.tou` (tournament results) and `.st4` (player data) file uploads
- Validate file format and required fields (`.tou` format is complex — dedicated parser required)
- Parse tournament metadata, divisions, rounds, games, and player results
- Map entrant names to WESPA IDs (call Player Service batch lookup endpoint)
- Store raw files in object storage for archival
- Update existing schema: `tournaments`, `divisions`, `games`, `player_results`, `tournament_results`
- Report unresolved player names to uploader (Jian Rong) for manual resolution
- Support idempotent uploads (no duplicate tournaments if same file uploaded twice)

**API Endpoints (notional):**
- POST /v1/files/validate/tou → validate .tou without importing (directors) 
- POST /v1/files/upload/tou → upload .tou file (staff only)
- POST /v1/files/upload/st4 → upload .st4 file (staff only)
- GET /v1/files/processing/{job_id} → check processing status
- POST /v1/files/mappings/resolve → manual override for unmapped players

**Validation endpoint (for tournament directors):**
- Same parsing logic as import, but no database writes
- Returns: validation errors, unmapped player names, warnings
- Allows directors to fix names or file issues before submitting to Jian Rong

**Processing pipeline:**
1. Upload file to temporary storage
2. User selects tournament from calendar to map to
3. Run `.tou` parser
4. Validate required fields (dates, player names, scores, etc.)
5. Extract unique player names from results
6. Call Player Service `POST /v1/players/lookup` to resolve names → WESPA IDs
7. Store unresolved names with job_id for later manual resolution
8. For each resolved player, write to `tournament_results`, `player_results`, `games`
9. Archive raw file to Digital Ocean Spaces
10. Return job summary (processed, succeeded, unresolved)

**Tech notes:**
- Go — chosen for performance and robustness in parsing
- Dedicated `.tou` parser module (likely the most complex piece of code in the system)
- Async processing with job queue? (Bull/Redis or SQS) — parsing can be slow
- Idempotency key to prevent duplicate imports
- Existing `loaded_tournaments` table may be relevant for tracking imports
- How to handle corrections to old tournaments? (Probably need to reload all)

**What it does NOT do:**
- No rating calculation (that's Rating Service — future)
- No public APIs (staff-only, perhaps TDs to validate before submission)
- No calendar management (Calendar API)

## Component 7: Rating Service (Go — future)

**Purpose:** Server-based Glicko-2 rating calculation using existing MySQL schema.

**Current state:** Planned for future implementation; not in initial scope.

**Responsibilities:**
- Read tournament results from existing tables (`tournament_results`, `player_results`, `games`)
- Calculate Glicko-2 rating changes per player based on opponents faced
- Update `tournament_results.end_rating` and `new_rating_dev` for each player
- Update `players.rating` (current rating)
- Support cascading recalculations (tournaments submitted out of order, game corrections, player merges)
- **Validate rating consistency** — detect and report mismatches between tournaments

**API Endpoints (staff/admin only):**
- POST /v1/ratings/calculate/{tournament_id} → recalculate single tournament
- POST /v1/ratings/calculate/range → recalculate date range
- POST /v1/ratings/calculate/player/{player_id} → recalculate all tournaments for a player
- POST /v1/ratings/calculate/full → full historical recalculation
- GET /v1/ratings/validate/consistency → scan for rating mismatches
- GET /v1/ratings/job/{job_id}/status → check async job status

**Consistency validation:**
- For each player, compare `end_rating` of tournament N with `start_rating` of tournament N+1 (chronologically)
- Flag mismatches where ratings deviate beyond a small tolerance (e.g., 1 point)
- Report: player, tournament A (end_rating), tournament B (start_rating), date gap
- Expose via admin endpoint and portal dashboard for WESPA staff
- Optionally auto-heal by triggering recalculations

**Cascading recalculation logic:**
1. Determine affected tournaments (by date, by player, or manual list)
2. Sort chronologically
3. Recalculate in order — each tournament uses updated `end_rating` from previous tournaments
4. Idempotent and transaction-safe

**Tech notes:**
- Go with async job queue (full recalc could take minutes)
- Existing `tournament_results` schema already has `start_rating`, `end_rating`, `old_rating_dev`, `new_rating_dev`
- Pure Glicko-2 implementation, no external dependencies

**What it does NOT do:**
- No file parsing (File Processing Service)
- No public APIs
- No `.st4` generation (may be added as export later)

## Component 8: Portal Backend

**Purpose:** Support the Player Portal and Member Portal frontend applications.

**Current state:** Frontend stack determined by WESPA frontend developer. This component defines backend requirements, not implementation details.

**Responsibilities (backend provides):**
- Aggregated API endpoints that combine data from multiple services:
  - Player dashboard: profile + tournament history + rating chart + linked apps
  - Association dashboard: member players + sanction applications + payment status
- Session management via OIDC (Keycloak integration)
- Translation between frontend needs and backend service APIs

**Two portals required:**

**Player Portal** (self-service):
- View and edit own profile (name, photo, country) — changes go to Player Service approval workflow
- View personal tournament history and rating progression
- Link/unlink third-party applications (Woogles, etc.) via OIDC
- Request country transfer (requires association approval)

**Member Portal** (national associations):
- View all players in their country
- Approve/deny country transfer requests from players
- Update association contact information
- Submit tournament sanction applications
- View payment history and manage membership status

**Backend requirements:**
- Provide secure, authenticated endpoints for all portal functionality
- Role-based access: player vs. association_admin vs. wespa_staff
- No direct database access — all data comes from core services (Player Service, Calendar API, Results API, Rating Service)

**What the backend does NOT dictate:**
- Styling solution (CSS, Tailwind, etc.)
- Hosting of static assets (handled separately)

## Component 9: Static Assets

**Purpose:** Serve static frontend assets (HTML, CSS, JS, images, etc.) for the portals and any public-facing WESPA pages.

**Current state:** Existing component; stack and hosting to be determined by frontend developer. Migration path TBD.

**Responsibilities:**
- Serve compiled frontend bundles for Player Portal and Member Portal
- Serve public assets (logos, player photos, etc.)
- Handle asset caching and CDN distribution (optional)

**Integration:**
- Assets referenced by portals (no direct API calls)
- May sit behind the reverse proxy or on separate subdomain (e.g., `assets.wespa.org`)

**What this component does NOT do:**
- No business logic
- No authentication
- No API endpoints

**Notes:**
- Frontend developer owns this component's implementation
- Migration from existing setup will be planned separately

## Component 10: Third-party OIDC Integration

**Purpose:** Allow external applications (Woogles, Cross-tables, ABSP, etc.) to authenticate WESPA users and access authorized player data.

**Current state:** New; leverages Keycloak as OIDC provider.

**Responsibilities:**
- External apps register as OIDC clients in Keycloak
- WESPA users log in via Keycloak to grant consent
- External apps receive access tokens to call WESPA APIs on behalf of the user
- Define scopes for granular access control:
  - `profile` — basic player info (name, country, photo)
  - `rating` — current rating and history
  - `tournament_history` — past tournaments and results
  - `email` — for account linking (requires user consent)

**WESPA-managed responsibilities:**
- Register and approve third-party applications
- Define scope permissions per client
- Revoke access if needed
- Document integration process for developers

**What this component does NOT do:**
- No new code to write (configured in Keycloak)
- No custom OIDC implementation

## Future Considerations (Nice-to-Have)

These ideas are not in scope for the initial build but are kept for reference:

- Official WESPA-hosted tournament management software (Josh Castellano is exploring a Woogles-hosted version)
- Cooperation with Cross-tables, ABSP, or other national associations for comprehensive historical data
- `.st4` file generation for backward compatibility with existing tools
- Email notifications for sanction approvals, change request status, and rating recalculations
- Webhooks for third-party apps to subscribe to rating changes or new tournament results
- Admin audit log dashboard
- Player photo moderation workflow
- Social login (Google/Facebook) for portal convenience
