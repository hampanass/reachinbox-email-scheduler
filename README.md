# ReachInbox

ReachInbox is a full-stack scheduled email campaign application. It lets an authenticated user upload recipients, schedule campaigns, control sending pace, monitor scheduled and sent messages, inspect individual email details, and search indexed email content.

This repository is structured as a hiring-assignment project with a React/Vite frontend, an Express/TypeScript API, a BullMQ worker, PostgreSQL persistence, Redis-backed scheduling and rate limiting, Elasticsearch search, Ethereal SMTP delivery, and optional Google and Slack integrations.

## Features

- Google OAuth and email/password authentication
- CSV recipient upload with email validation, normalization, duplicate removal, and invalid-row reporting
- Scheduled email campaigns with a future start time
- BullMQ delayed jobs backed by Redis
- Persistent campaign and email scheduling state in PostgreSQL, with queue data persisted by Redis
- Configurable worker concurrency through `WORKER_CONCURRENCY`
- Configurable minimum delay between emails
- Redis-backed hourly campaign rate limiting
- Automatic rescheduling when the hourly limit is reached
- Idempotent email sending and send logs
- Ethereal SMTP delivery and preview URLs
- Slack OAuth installation and rate-limit notifications
- Elasticsearch indexing and fuzzy search across recipients, subjects, and bodies
- Bull Board queue monitoring
- Scheduled/Sent dashboard views
- Email detail view

## Architecture

```text
React/Vite frontend (:5173)
        |
        | HTTP + session cookies
        v
Express API (:5001)
  |             |              |
  |             |              +--> Elasticsearch (:9200)
  |             +-----------------> Redis (:6379)
  +-------------------------------> PostgreSQL (:5432)
                                  
Campaign creation stores campaign/email rows in PostgreSQL and creates one
BullMQ delayed job per email. The worker consumes those jobs, reserves a
Redis rate-limit slot, sends through Ethereal SMTP, updates PostgreSQL, and
indexes the result in Elasticsearch. A rate-limited job is returned to the
queue with a delay; the first rate-limit event for an hourly window is claimed
through a unique database event key before Slack delivery.
```

### Request and delivery flow

1. The user signs in with Google OAuth or email/password.
2. The frontend uploads and validates a CSV locally, then sends the normalized campaign payload to `POST /api/campaigns`.
3. The API stores the campaign and recipients in PostgreSQL and adds delayed BullMQ jobs.
4. The worker claims each email, checks the Redis campaign limiter, and sends allowed emails through Ethereal SMTP.
5. A denied email is left scheduled and re-added to BullMQ for its next eligible time.
6. A rate-limit event is persisted and sent to Slack once per campaign/hourly-window event.
7. Email state is indexed in Elasticsearch for dashboard search and kept in PostgreSQL for campaign and detail views.

## Technology Stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS/PostCSS
- API and worker: Node.js, TypeScript, Express 5, `tsx`
- Authentication: Passport Google OAuth 2.0, email/password sessions, `express-session`
- Database: PostgreSQL 16, Prisma 6
- Queue and rate limiting: BullMQ 6, Redis 7, ioredis
- Search: Elasticsearch 8.15 client/server
- Email: Nodemailer with Ethereal SMTP
- Notifications: Slack OAuth v2 and `chat.postMessage`
- Queue UI: Bull Board
- Local infrastructure: Docker Compose

## Prerequisites

Install the following before starting:

- Node.js with npm
- Docker Desktop with Docker Compose
- Google OAuth credentials if Google sign-in is required
- An Ethereal account if real SMTP preview delivery is required
- A Slack app configured for OAuth if Slack notifications are required

## Environment Variables

Create `backend/.env`. Keep it local and never commit it. Use the variable names below with your own values; no real credentials belong in this README.

| Variable | Purpose | Local example |
| --- | --- | --- |
| `DATABASE_URL` | Prisma connection string for PostgreSQL | `postgresql://postgres:postgres@localhost:5432/reachinbox?schema=public` |
| `PORT` | Express API port | `5001` |
| `REDIS_URL` | Redis connection used by BullMQ, sessions, and rate limiting | `redis://localhost:6379` |
| `ELASTICSEARCH_URL` | Elasticsearch node URL | `http://localhost:9200` |
| `WORKER_CONCURRENCY` | Number of BullMQ jobs processed concurrently | `5` |
| `ETHEREAL_HOST` | SMTP host | `smtp.ethereal.email` |
| `ETHEREAL_PORT` | SMTP port | `587` |
| `ETHEREAL_USER` | Ethereal SMTP username | your local value |
| `ETHEREAL_PASSWORD` | Ethereal SMTP password | your local value |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | your local value |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | your local value |
| `GOOGLE_CALLBACK_URL` | Google OAuth callback registered with Google | `http://localhost:5001/auth/google/callback` |
| `SESSION_SECRET` | Session signing secret; must be at least 32 characters | a random local value of 32+ characters |
| `FRONTEND_URL` | Frontend origin used for CORS and OAuth redirects | `http://localhost:5173` |
| `SLACK_CLIENT_ID` | Slack OAuth client ID | your local value |
| `SLACK_CLIENT_SECRET` | Slack OAuth client secret | your local value |
| `SLACK_REDIRECT_URI` | Slack OAuth callback registered with Slack | `http://localhost:5001/auth/slack/callback` |

`NODE_ENV=production` enables secure session cookies. The application also has local defaults for Redis and Elasticsearch, but setting them explicitly in `backend/.env` is recommended.

## Docker Setup

Start PostgreSQL, Redis, and Elasticsearch from the repository root:

```bash
docker compose up -d
```

The services expose:

- PostgreSQL: `localhost:5432`, database `reachinbox`, user `postgres`, password `postgres`
- Redis: `localhost:6379`
- Elasticsearch: `localhost:9200`

Docker Compose uses named volumes for all three services. Stop the services without deleting their data with:

```bash
docker compose down
```

Do not use `docker compose down -v` unless you intentionally want to delete local database, queue, and search data.

## Installation and Database Setup

Install dependencies in both applications:

```bash
cd backend
npm install
npm run prisma:generate
npm run prisma:migrate

cd ../frontend
npm install
```

The Prisma migration command applies the checked-in migrations to the PostgreSQL database. The current migration history includes the initial schema, send idempotency support, and Slack notification tables.

## Start the Application

Run Docker services first, then use separate terminal tabs.

### Backend API

```bash
cd backend
npm run dev
```

The API starts on `http://localhost:5001`.

### Email worker

```bash
cd backend
npm run worker
```

The worker consumes the `scheduled-emails` BullMQ queue. Set `WORKER_CONCURRENCY` before starting it to change concurrency.

### Frontend

```bash
cd frontend
npm run dev
```

Vite normally serves the UI at `http://localhost:5173`.

## Important Local URLs

- Frontend: [http://localhost:5173](http://localhost:5173)
- Frontend after Slack OAuth: [http://localhost:5173/?slack=connected](http://localhost:5173/?slack=connected)
- API root: [http://localhost:5001](http://localhost:5001)
- Database health: [http://localhost:5001/api/health/db](http://localhost:5001/api/health/db)
- Google sign-in: [http://localhost:5001/auth/google](http://localhost:5001/auth/google)
- Slack installation: [http://localhost:5001/auth/slack](http://localhost:5001/auth/slack)
- Bull Board: [http://localhost:5001/admin/queues](http://localhost:5001/admin/queues)
- Elasticsearch: [http://localhost:9200](http://localhost:9200)

The Google and Slack entry points require the user to have an active authenticated session where indicated.

## Testing

Run the complete backend test suite:

```bash
cd backend
npm test
```

The tests cover authentication, health, email routes, search, scheduling, Redis rate limiting, email idempotency, and Slack notification claiming. The scheduler tests that use Redis require Redis to be available at `REDIS_URL` or at the default `redis://localhost:6379`.

A focused rate-limit and notification check is:

```bash
cd backend
npm exec tsx --test src/services/scheduler.test.ts src/services/slackNotifications.test.ts
```

The Slack tests use fake installations and fetchers; they do not require a real Slack token or send a real Slack message.

## Production Builds

Build the backend TypeScript and the frontend bundle with:

```bash
cd backend
npm run build

cd ../frontend
npm run build
```

The backend build runs `tsc --noEmit`. The frontend build runs TypeScript project compilation followed by `vite build`.

## Google OAuth Setup

1. Create or select a Google Cloud project.
2. Configure an OAuth consent screen and create a Web application OAuth client.
3. Add `http://localhost:5001/auth/google/callback` as an authorized redirect URI.
4. Put the client ID and secret in `backend/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. Set `GOOGLE_CALLBACK_URL` to the same callback URI and restart the API.
6. Open `http://localhost:5001/auth/google` or use the Google sign-in control in the frontend.

The callback redirects to `http://localhost:5173/?auth=success` on success or `?auth=failed` on failure.

## Slack OAuth Setup

1. Create a Slack app for the workspace used for the demo.
2. Configure OAuth redirect URL `http://localhost:5001/auth/slack/callback`.
3. Grant the scopes used by the application: `chat:write` and `incoming-webhook`.
4. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_REDIRECT_URI` in `backend/.env`.
5. Start the API and sign in to the frontend first.
6. Open `http://localhost:5001/auth/slack` and complete the Slack authorization flow.
7. Confirm the browser returns to `http://localhost:5173/?slack=connected`.

The installation stores the workspace/channel association server-side. Slack access tokens are never intended for frontend display or README files.

## Elasticsearch Setup

Elasticsearch is started by Docker Compose at `http://localhost:9200`. The application lazily creates the `reachinbox-emails` index with mappings for recipient, subject, body, status, scheduled time, and sent time. Campaign creation and successful worker processing index email documents. Dashboard search uses fuzzy multi-field matching over recipient, subject, and body.

If Elasticsearch is unavailable, email indexing reports a warning and the core email workflow can continue; search itself requires Elasticsearch.

## Bull Board

Open [http://localhost:5001/admin/queues](http://localhost:5001/admin/queues) while the API is running. Bull Board is configured for the `scheduled-emails` BullMQ queue and shows delayed, active, completed, and failed jobs. The current route is intended for local development and assignment demonstration; it is not protected by an application authentication middleware.

## Project Structure

```text
backend/
  prisma/                 Prisma schema and migrations
  src/
    auth/                 Passport, password auth, sessions
    db/                   Prisma client
    queue/                BullMQ and Redis connections
    routes/               Auth, campaign, email, search, health, Slack OAuth
    services/             Scheduling, processing, rate limiting, mail, search, Slack
    app.ts                Express application and route registration
    server.ts             API entry point
    worker.ts             BullMQ worker entry point
frontend/
  src/
    App.tsx               Authentication gate and application shell
    Dashboard.tsx         Scheduled/Sent views, search, and email details
    ComposeCampaign.tsx   CSV upload, validation, and campaign scheduling form
    api.ts                Frontend API client and shared types
  index.html
  vite.config.ts
  package.json
docker-compose.yml       PostgreSQL, Redis, and Elasticsearch
```

## Design and Reliability Decisions

- PostgreSQL is the source of truth for users, campaigns, email state, send logs, Slack installations, and notification events.
- Redis provides an atomic Lua-based reservation gate. Redis server time is used so concurrent workers share one clock.
- BullMQ delayed jobs separate campaign scheduling from delivery. Queue job IDs and persisted Redis data support normal restarts without losing delayed jobs.
- Email claiming and send logs prevent duplicate processing. A unique idempotency key and the successful-send constraint protect against repeated delivery attempts.
- A rate-limited email returns to `SCHEDULED` before it is re-added with the limiter-provided delay.
- Slack notifications are claimed with a unique event key, so duplicate workers do not post the same hourly-window event repeatedly.
- Slack and Elasticsearch failures are isolated from the core worker path where possible: Slack failures do not fail the email job, and indexing failures are logged.
- CSV parsing is performed in the frontend and the API validates the campaign payload again before persistence.
- Sessions are stored in Redis and use an HTTP-only cookie. Production mode enables the cookie `secure` flag.

## Demo Flow

1. Start Docker services, apply migrations, then start the API, worker, and frontend.
2. Open `http://localhost:5173` and register with email/password or sign in through Google.
3. Connect Slack from `http://localhost:5001/auth/slack` and verify the `?slack=connected` redirect.
4. Open **Compose email**, upload a CSV with an `email` column, and confirm valid and invalid row counts.
5. Choose a future start time, set a delay between emails, and choose an hourly limit.
6. Schedule the campaign and watch its delayed jobs in Bull Board.
7. Inspect the Scheduled view, open an email detail, and search by recipient, subject, or body.
8. After delivery, switch to Sent and open the Ethereal preview URL printed by the worker.
9. For a rate-limit demonstration, use several recipients with `hourlyLimit` set to `1`; the first reservation is allowed, later jobs are delayed and the hourly-window Slack event is deduplicated.

## Known Limitations

- Email delivery is configured for Ethereal SMTP previews rather than a production email provider.
- Google and Slack require separately configured external applications and callback URLs.
- Search depends on the local Elasticsearch service; indexing failures are logged and search is unavailable while Elasticsearch is down.
- Bull Board is exposed at a local admin route without application-level authentication and should be protected before production deployment.
- The local Docker Compose configuration uses development credentials for PostgreSQL and disables Elasticsearch security; do not reuse these settings in production.
- The hourly limiter test suite requires a running Redis instance. The application itself also requires PostgreSQL for persistence and migrations.
