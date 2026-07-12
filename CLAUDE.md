# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

MicroRealEstate (MRE) is an open-source (MIT) application that helps landlords manage properties, tenants, leases and rent payments. It ships as a Yarn workspaces monorepo: several Node.js microservices under `services/`, two Next.js frontends under `webapps/` (landlord portal and tenant portal), a shared TypeScript types package (`types/`), a Cypress E2E suite (`e2e/`), and a CLI (`cli/`) that orchestrates everything via Docker Compose.

Two documents in the repo root are worth reading before making architectural changes:
- [`system.md`](./system.md) — detailed architecture analysis (services, data model, auth, business logic, CI/CD) plus the current feature roadmap (finance/cashflow/XS2A open-banking focus).
- [`useCases.md`](./useCases.md) — use cases derived from that roadmap.

## Commands

Node 20 and Yarn 3.3.0 (Berry, pinned via `packageManager`) are required; run `yarn` once at the repo root to install all workspaces.

**Run the app** (all orchestration goes through the `cli/` tool via these root scripts — don't call `docker compose` directly):
```
yarn dev            # dev mode, hot reload, logs streamed to the console; supports VS Code "Docker: Attach to <service>" debug configs
yarn build           # build all services/images
yarn start           # run in prod-like mode (built images); use `docker logs` to inspect services, no console output
yarn ci              # run in CI mode (used by e2e tests)
yarn stop            # stop everything
```

**Lint / format** (ESLint config at root `.eslintrc.json`, Prettier config at root `.prettierrc.json`):
```
yarn lint                                        # yarn workspaces foreach -pv run lint — all workspaces
yarn workspace @microrealestate/api run lint      # single workspace (landlord/tenant use `next lint` instead of eslint)
yarn format                                       # yarn workspaces foreach run format — writes changes (Prettier --write)
```

**Unit tests** — `@microrealestate/api`, `@microrealestate/common`, `@microrealestate/cli` and `@microrealestate/banking` have real Jest suites (the latter two use `ts-jest`'s ESM preset since they're TypeScript; `banking`'s non-test code imports `@microrealestate/common`'s compiled `dist/`, so build that first: `yarn workspace @microrealestate/types run build && yarn workspace @microrealestate/common run build`). The other services' `test` script is currently a stub (`exit 1`, no tests written yet); the webapps have no unit tests at all (frontend correctness is checked via `next lint` and the Docker build, not Jest).
```
yarn workspace @microrealestate/api run test                      # run api's suite
yarn workspace @microrealestate/api run test path/to/file.test.js  # single file (jest args pass through)
yarn workspace @microrealestate/api run test -t "test name"        # by test name
yarn workspace @microrealestate/common run test
yarn workspace @microrealestate/cli run test
yarn workspace @microrealestate/banking run test
```
Jest configs (`jest.config.js` per workspace) collect coverage into `coverage/` via the `v8` provider.

**End-to-end tests** (Cypress, against the app running in CI mode — run `yarn build && yarn ci` first):
```
yarn e2e:ci    # headless, as used in CI
yarn e2e:run   # headed browser
yarn e2e:open  # Cypress UI
```

## Architecture

**Monorepo/runtime**: Yarn Berry workspaces (`cli`, `e2e`, `services/*`, `webapps/*`, `types`), all backend services are ES modules. Services communicate exclusively over synchronous REST/HTTP (`axios`) — there is no message queue or event bus. MongoDB is the single persistent datastore, read/written directly by several services (no strict "one service, one DB"). Redis is used only as a session/refresh-token store, not as a message bus.

**Backend services** (`services/`), each built on a shared bootstrap (`Service` class in `services/common/src/utils/service.ts`):
- `gateway` — stateless reverse proxy (Express + `http-proxy-middleware`); the only externally exposed port, routes `/api/v2/*` and `/tenantapi/*` to the other services and can optionally proxy the two frontends.
- `authenticator` — JWT auth: password login for landlords, passwordless email-OTP login for tenants, refresh tokens stored in Redis, M2M `clientId`/`clientSecret` credentials.
- `api` — the landlord portal's core backend: realms/organizations, leases, tenants, properties, rent computation, payments, CSV accounting export.
- `tenantapi` — read-mostly API for the tenant portal (aggregated lease/balance data).
- `emailer` — sends rent calls, reminders, invoices, OTP emails via Gmail/Mailgun/SMTP (configured per `Realm`).
- `pdfgenerator` — renders PDFs (receipts, rent calls/reminders, contracts) via Puppeteer + EJS/Handlebars templates; also handles document uploads (optional S3/B2 backend).
- `resetservice` — dev/CI-only helper to wipe the databases; not exposed in production.
- `banking` — XS2A/open-banking connection and payment-reconciliation service (TypeScript). `src/aggregator/adapter.ts` is a provider-agnostic interface (`src/aggregator/mockadapter.ts` implements it deterministically until a real aggregator like finAPI/Enable Banking is contracted, see `system.md`'s provider comparison); `src/managers/bankaccountlogic.ts` and `src/managers/matchingengine.ts` hold the pure, heavily-unit-tested business logic (account-selection mapping, consent-expiry handling, payment-matching scoring), while `bankaccountmanager.ts`/`matchingmanager.ts` are the thin Express/Mongo wrappers around them — same pure-logic/IO-wrapper split as `contract.js`/`rentmanager.js` in `api`. Exposed under `/api/v2/banking/*` via the gateway.
- `common` — shared Mongoose schemas (`src/collections/`), auth middlewares, Mongo/Redis clients, the `Service` bootstrap framework.

**Data model** (Mongoose schemas in `services/common/src/collections/*.ts`): `Realm` (landlord organization — members/roles, `bankInfo` display field, email-provider config), `Account` (landlord login), `Lease` (lease template), `Tenant` — registered in Mongo as model **`Occupant`** — holds contract data and the dynamically-computed `rents` array, `Property`, `Document`, `Template`, `Expense` (manual cost tracking per property), `BankAccount` and `Transaction` (XS2A-imported bank data, see `banking` service below). Relations are plain string IDs with Mongoose `ref`.

**Rent/payment business logic**: `services/api/src/businesslogic/` runs a 7-step task pipeline (`1_base.js` … `7_total.js`) per rent period ("term", format `YYYYMMDDHH`) to compute amounts due, discounts, VAT, balance and totals. Payments are entered manually by the landlord (`services/api/src/managers/rentmanager.js`, route `PATCH /api/v2/rents/payment/:id/:term`) or applied automatically once a bank transaction match is confirmed (`services/banking`'s `matchingmanager.confirmMatch`, which calls this same endpoint); payment status (`paid`/`partiallypaid`/`notpaid`) is not persisted but derived at read time (`services/api/src/managers/frontdata.js`). `services/api/src/managers/cashflow.js` (per-property/portfolio income vs. expenses, feeds the `/dashboard` endpoint) and `services/api/src/managers/datevexport.js` (DATEV-style booking export, `/accounting/:year/:month/datev`) are the other pure business-logic modules worth knowing about — see `system.md`/`useCases.md` for the full finance/XS2A roadmap these implement.

**Auth model**: pure JWT, no server sessions. Landlord: password + bcrypt, short-lived access token, refresh token in an httpOnly cookie + Redis. Tenant: passwordless OTP email login, access token delivered as a `sessionToken` cookie. Central middleware in `services/common/src/utils/middlewares.ts` (`needAccessToken`, `checkOrganization`, `onlyRoles`) enforces multi-tenancy — a landlord account can belong to multiple `Realm`s, each with its own role.

**Frontends**:
- `webapps/landlord` — Next.js 14 **Pages Router** (`src/pages/[organization]/...`), state via **MobX** (`src/store/*.js`) plus `@tanstack/react-query`, Tailwind + Radix UI (shadcn-style) with some legacy Material UI, Formik/Yup forms.
- `webapps/tenant` — Next.js 14 **App Router** (`src/app/[lang]/...`), TypeScript, React Hook Form + Zod, no MobX.
- `webapps/commonui` — shared legacy Material UI/utility package, consumed only by the landlord app.

Both frontends talk to the backend exclusively through the `gateway`.

**Deployment**: multiple Docker Compose files at the repo root (`docker-compose.yml` for self-hosting with prebuilt `ghcr.io` images, `docker-compose.microservices.{base,dev,prod,test}.yml` for building individual services, `docker-compose.monitoring.yml`). Secrets/config flow through `base.env` / `.env.domain` → `.env`. The `cli/` tool wraps these compose files for the `yarn dev/build/start/stop/ci` scripts.

**CI/CD** (`.github/workflows/`):
- `pr-ci.yml` — runs on every PR to `master`: ESLint, Prettier check, TypeScript build/typecheck, `actions/dependency-review-action`, TruffleHog secret scan, Hadolint on all Dockerfiles, Jest unit tests, then builds a Docker image per service tagged with a PR pre-release version (pushed to GHCR only for same-repo PRs, not forks), and posts the version back as a PR comment. A final `pr-pipeline-status` job aggregates all checks for branch protection.
- `ci.yml` — on push to `master`: lint, build+push images, deploy to a remote CI host, health check, then run Cypress e2e against it.
- `release.yml` — on GitHub Release publish: builds the `mre` CLI executable for linux/macos/windows and pushes versioned + `latest` Docker images.
- `codeql-analysis.yml` — CodeQL security scanning on push/PR to `master` and weekly on a schedule.
