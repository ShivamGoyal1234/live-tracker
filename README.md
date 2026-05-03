# Live location tracking

Production-style real-time map sharing: OAuth login, Socket.IO for live updates, Apache Kafka (KafkaJS) for fan-out and batched database writes, and PostgreSQL for history.

## Architecture

```
Browser (Leaflet + OSM)
        |
        |  HTTPS / WebSocket
        v
+------------------+
|  Express +       |
|  Socket.IO       |
|  (JWT on socket) |
+--------+---------+
         |
         | publish userId-keyed events
         v
+------------------+      +------------------------+
| Kafka topic      |      | Consumer: socket-      |
| location-events  +----->+ broadcaster            |
| (3 partitions)   |      | io.emit(all clients)   |
+--------+---------+      +------------------------+
         |
         | same messages
         v
+------------------------+
| Consumer: db-writer    |
| buffer 2s -> bulk INSERT
+------------------------+
         |
         v
+------------------------+
| PostgreSQL             |
| users, location_history|
+------------------------+
```

Map tiles: [OpenStreetMap](https://www.openstreetmap.org/copyright) — © OpenStreetMap contributors.

## Quick start

1. **Environment**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, and optionally `JWT_SECRET`, `SESSION_SECRET`, and `CALLBACK_URL` (must match Google Cloud Console).

2. **Run with Docker Compose**

   From the project root:

   ```bash
   docker compose up --build
   ```

3. **Open the app**

   Visit [http://localhost:3000](http://localhost:3000), click **Login with Google**, approve location when prompted, and watch markers update on the map.

## Google OAuth setup

1. Open [Google Cloud Console — Credentials](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** (application type: **Web application**).
3. Under **Authorized redirect URIs**, add exactly:

   `http://localhost:3000/auth/google/callback`

   (Must match `CALLBACK_URL` in `.env` and in `docker-compose.yml` defaults.)

4. Copy the **Client ID** and **Client secret** into `.env`.

## How to test multi-user behavior

- Open two **incognito/private** windows (or two browsers).
- Log in as **different Google accounts** in each.
- Grant location in both; you should see two markers and both users in the sidebar.
- Stopping location or closing the tab eventually triggers stale cleanup (no updates for 60s removes the marker from the map).

## Local development (without Docker)

Requires Node.js 20+, PostgreSQL 16+, Kafka reachable at `KAFKA_BROKERS`.

```bash
cd backend
cp ../.env.example ../.env   # or set env vars manually
npm install
export DATABASE_URL=postgres://locuser:locpass@localhost:5432/locationdb
export KAFKA_BROKERS=localhost:9092
# plus OAuth + JWT + session secrets
npm start
```

Serve the same origin as the API (the app resolves `../frontend` relative to `backend/src` when the Docker layout is not used).

## Project layout

- `docker-compose.yml` — Zookeeper, Kafka, Postgres, app
- `backend/` — Express, Socket.IO, Passport (Google), Kafka producers/consumers
- `frontend/` — Vanilla JS, Leaflet, Socket.IO client (JWT only in memory)

## Security notes

- JWT is delivered once via redirect query parameter; the SPA reads it, keeps it **only in memory**, and strips it from the URL.
- Change `JWT_SECRET` and `SESSION_SECRET` for any shared or production deployment.
- Use HTTPS and secure cookies in production.
