# Cinema Seat Reservation System

A real-time cinema seat reservation system that solves a realistic engineering problem involving **concurrency control, consistency guarantees, real-time communication, distributed system design, and API architecture**.

The primary goal is not a beautiful UI, but a system that remains correct under high concurrency — guaranteeing that a seat can never be reserved by more than one user, even when many users attempt to reserve the same seats simultaneously across multiple server instances.

---

## Table of Contents

1. [The Engineering Problem](#the-engineering-problem)
2. [System Architecture](#system-architecture)
3. [Concurrency Control Strategy](#concurrency-control-strategy)
4. [Consistency Model](#consistency-model)
5. [Real-Time Communication](#real-time-communication)
6. [Horizontal Scalability & Distributed Design](#horizontal-scalability--distributed-design)
7. [API Architecture](#api-architecture)
8. [Database Schema](#database-schema)
9. [Setup & Running](#setup--running)
10. [Concurrency Simulation](#concurrency-simulation)
11. [Trade-offs & Design Decisions](#trade-offs--design-decisions)
12. [Project Structure](#project-structure)

---

## The Engineering Problem

Building a cinema seat reservation system where 50 seats are available for a single movie showing. The hard constraints are:

- **No double-booking**: A seat can never be reserved by more than one user, period.
- **Real-time updates**: When one user reserves a seat, every connected user immediately sees the change.
- **High concurrency**: 100+ users may attempt to reserve the same seats simultaneously.
- **Multiple API sources**: Reservations come from both a frontend UI and a third-party partner API.
- **Horizontal scaling**: The backend runs on multiple server instances behind a load balancer.

This is a classic distributed systems problem that touches on:
- **Race conditions** — concurrent writes to the same resource
- **Distributed coordination** — multiple server instances sharing state
- **Event propagation** — real-time notifications across all clients
- **API design** — shared business logic across multiple entry points
- **Database correctness** — transactional integrity under load

---

## System Architecture

```
                           ┌─────────────────┐
                           │   Load Balancer  │
                           │   (nginx/HAProxy)│
                           └────────┬────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
            ┌───────▼──────┐ ┌─────▼───────┐ ┌─────▼───────┐
            │  Instance 1  │ │  Instance 2 │ │  Instance 3 │
            │              │ │             │ │             │
            │  Next.js API │ │  Next.js API│ │  Next.js API│
            │  + Socket.IO │ │  + Socket.IO│ │  + Socket.IO│
            └───────┬──────┘ └─────┬───────┘ └─────┬───────┘
                    │              │               │
                    └──────┬───────┴───────┬───────┘
                           │               │
                    ┌──────▼──────┐ ┌──────▼──────┐
                    │  PostgreSQL  │ │   Redis     │
                    │  (Neon)     │ │ (optional)  │
                    │             │ │ Socket.IO   │
                    │ UNIQUE      │ │ adapter     │
                    │ constraint  │ │             │
                    │ = source    │ │ cross-node  │
                    │ of truth    │ │ broadcast   │
                    └─────────────┘ └─────────────┘
```

**Key principle**: PostgreSQL is the single source of truth. All server instances share the same database. Concurrency control happens at the database level, not the application level.

---

## Concurrency Control Strategy

### The Problem

When two users click "Reserve" on seat A5 at the exact same millisecond:
1. User A's request hits Instance 1
2. User B's request hits Instance 2
3. Both instances check if A5 is available — it is (neither has committed yet)
4. Both try to reserve it — who wins?

### The Solution: Database-Level Unique Constraint

Instead of application-level locks, distributed locks, or optimistic versioning, this system uses PostgreSQL's `UNIQUE` constraint on the `seatId` column in the `ReservationSeat` table.

```sql
CREATE TABLE "ReservationSeat" (
  id TEXT PRIMARY KEY,
  "reservationId" TEXT REFERENCES "Reservation"(id),
  "seatId" TEXT UNIQUE NOT NULL,  -- This is the concurrency guard
  "createdAt" TIMESTAMP DEFAULT NOW()
);
```

### Why This Works

```
Timeline:
  T1: User A's request → Instance 1 → BEGIN TRANSACTION
  T2: User B's request → Instance 2 → BEGIN TRANSACTION
  T3: Instance 1 checks A5 → available ✓
  T4: Instance 2 checks A5 → available ✓ (uncommitted data invisible)
  T5: Instance 1 INSERTs ReservationSeat for A5 → SUCCESS
  T6: Instance 1 COMMITs → A5 is now permanently reserved
  T7: Instance 2 INSERTs ReservationSeat for A5 → FAILS (UNIQUE violation)
  T8: Instance 2 ROLLBACKs → Transaction is discarded
  T9: Instance 2 returns "Seat A5 is no longer available"
```

### Why This Is Superior to Alternatives

| Approach | Problem |
|----------|---------|
| `SELECT ... FOR UPDATE` | Requires row-level locking, deadlock risk, doesn't work across instances without careful isolation |
| Redis distributed lock | Adds operational complexity, lock expiry edge cases, single point of failure |
| Optimistic locking (version column) | Requires retry logic, wasted work on conflict |
| Application-level mutex | Doesn't work across server instances |
| **UNIQUE constraint** | **Zero coordination, zero deadlocks, works across N instances, enforced by the database itself** |

The UNIQUE constraint approach is **embarrassingly simple** — it delegates the hard problem to the one system designed to handle it: the database engine. PostgreSQL serializes the conflicting INSERTs, one wins, one fails, and both application instances see the correct result.

### Proof from the Simulation

When the concurrency simulation runs 100 users against the same seats:
```
prisma:error
Unique constraint failed on the fields: (`"seatId"`)
prisma:query ROLLBACK
```

This is the **expected and correct** behavior. The ROLLBACK means the system prevented a double-booking. The simulation confirms:
- Successful reservations are valid (seat was available)
- Failed reservations return appropriate errors (seat was taken)
- Database remains consistent (no duplicate seat assignments)
- No seat is ever reserved twice

---

## Consistency Model

This system provides **strong consistency** (linearizability) for reservations, not eventual consistency.

### Guarantees

1. **Atomicity**: A reservation is all-or-nothing. Either all requested seats are reserved, or none are. If any seat fails, the entire transaction rolls back.

2. **Isolation**: PostgreSQL's default `READ COMMITTED` isolation level ensures that uncommitted reservations from other transactions are invisible. Two concurrent requests cannot both see a seat as available.

3. **Durability**: Once a reservation is committed, it survives crashes. PostgreSQL's WAL (Write-Ahead Log) guarantees this.

4. **Consistency**: The UNIQUE constraint is an invariant that cannot be violated by any sequence of operations. The database rejects any INSERT that would create a duplicate.

### How Consistency is Maintained Across Instances

```
Instance 1                          Instance 2
    │                                   │
    ├─ BEGIN                           ├─ BEGIN
    ├─ INSERT Seat A5 ✓                ├─ INSERT Seat A5 ✗ (UNIQUE violation)
    ├─ COMMIT ✓                        ├─ ROLLBACK ✓
    │                                   │
    └─ Return success                  └─ Return "unavailable"
```

Both instances talk to the same PostgreSQL database. The database is the arbiter of truth. No instance has "local" state that could diverge.

---

## Real-Time Communication

### Technology: Socket.IO (WebSocket with fallback)

Socket.IO is chosen over raw WebSockets for:
- Automatic reconnection on network drops
- Fallback to HTTP long-polling when WebSocket is blocked
- Room/event-based message routing
- Battle-tested library with millions of users

### How It Works

```
┌──────────────┐     Seat Reserved      ┌──────────────┐
│   API Route   │ ──────────────────►   │  Socket.IO   │
│              │   broadcastSeatUpdate()│   Server      │
└──────────────┘                        └──────┬───────┘
                                               │
                                    io.emit("seatUpdate", data)
                                               │
                              ┌─────────────────┼─────────────────┐
                              │                 │                 │
                        ┌─────▼─────┐     ┌────▼─────┐     ┌─────▼─────┐
                        │  Client 1 │     │ Client 2 │     │ Client 3 │
                        │  (sees A5 │     │  (sees   │     │  (sees   │
                        │  reserved)│     │  update) │     │  update) │
                        └───────────┘     └──────────┘     └──────────┘
```

### Flow

1. User A reserves seat A5 via POST `/api/reservations`
2. API route calls `createReservation()` — succeeds
3. API route calls `broadcastSeatUpdate()`:
   ```typescript
   broadcastSeatUpdate({
     type: "reservation_created",
     seatLabels: ["A5"],
     userId: "user-abc",
     timestamp: new Date(),
   });
   ```
4. Socket.IO server emits `seatUpdate` event to all connected clients
5. Every client's `useSocket` hook receives the event
6. Clients call `refreshSeats()` to fetch the latest seat data from the API
7. Seat map re-renders with A5 shown as reserved

### Cross-Instance Broadcasting (Horizontal Scaling)

For multi-instance deployments, Socket.IO supports the **Redis adapter**:

```typescript
// In server.ts (uncomment for production)
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";

const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();
await Promise.all([pubClient.connect(), subClient.connect()]);
io.adapter(createAdapter(pubClient, subClient));
```

This means:
- When Instance 1 broadcasts a seat update, it publishes to Redis
- Instance 2 and Instance 3 receive the event via Redis subscription
- All connected clients across all instances receive the update

---

## Horizontal Scalability & Distributed Design

### Stateless Application Servers

Each server instance is **completely stateful only in its Socket.IO connections**. All business logic is stateless:

- No in-memory reservation cache
- No local seat availability state
- No instance-specific data that affects correctness

### What's Shared vs. What's Local

| Resource | Scope | Purpose |
|----------|-------|---------|
| PostgreSQL database | Shared (all instances) | Source of truth for seats and reservations |
| Redis (optional) | Shared (all instances) | Cross-instance Socket.IO broadcast |
| Socket.IO connections | Local (per instance) | WebSocket connections to clients |
| Next.js build cache | Local (per instance) | Compiled application code |

### Deployment Topology

```
Production:
  ┌─────────────┐
  │  nginx      │  ← Load balancer (round-robin or least-connections)
  │  (L7)       │
  └──────┬──────┘
         │
    ┌────┼────┐
    │    │    │
  ┌─▼─┐┌─▼─┐┌─▼─┐
  │ 1 ││ 2 ││ 3 │  ← Next.js + Socket.IO (stateless)
  └─┬─┘└─┬─┘└─┬─┘
    │    │    │
    └────┼────┘
         │
    ┌────▼────┐     ┌──────────┐
    │ PostgreSQL│     │  Redis   │  ← Optional: cross-instance Socket.IO
    │ (Neon)   │     │          │
    └─────────┘     └──────────┘
```

### Why This Scales

- **Adding instances**: Just point them at the same PostgreSQL and Redis. No configuration changes needed.
- **Removing instances**: Clients disconnect, reconnect to surviving instances. No data loss.
- **Database bottleneck**: PostgreSQL can handle thousands of concurrent transactions. The UNIQUE constraint is checked at the index level (B-tree), which is O(log n).
- **No coordination overhead**: Unlike distributed locks, there's no "acquire lock → do work → release lock" round trip. The database handles contention natively.

---

## API Architecture

### Design Principle: Single Source of Business Logic

The most critical architectural decision is that **all reservation paths share the same function**:

```typescript
// lib/reservation.ts — THE single booking function
export async function createReservation(userId: string, seatIds: string[]) {
  // 1. Validate seats exist
  // 2. BEGIN transaction
  // 3. INSERT ReservationSeat for each seatId
  //    → UNIQUE constraint prevents double-booking
  // 4. COMMIT (or ROLLBACK on failure)
  // 5. Return result
}
```

### API Endpoints

#### Frontend APIs (require NextAuth session)

```
GET  /api/seats              → All seats with reservation status
GET  /api/seats/availability → Summary (total/available/reserved)
POST /api/reservations       → Reserve seats (authenticated)
POST /api/auth/register      → Register new user
POST /api/auth/callback/credentials → NextAuth login
GET  /api/auth/csrf          → CSRF token for NextAuth
GET  /api/auth/session       → Current session info
```

#### Partner API (requires API key)

```
POST /api/partner/reservations → Reserve seats (API key auth)
```

**Partner request:**
```json
{
  "seatIds": ["seat-id-1", "seat-id-2"],
  "partnerReference": "optional-external-ref"
}
```

**Headers:**
```
X-API-Key: partner-api-key-change-in-production
X-Partner-Email: partner@example.com
```

#### Simulation API

```
POST   /api/simulation       → Run N concurrent reservation attempts
DELETE /api/simulation/reset → Clear all reservations
POST   /api/simulation/reset → Full database reset and re-seed
```

### Why Both APIs Share Logic

The partner API (`app/api/partner/reservations/route.ts`) and frontend API (`app/api/reservations/route.ts`) both call `createReservation()`. The only difference is authentication:

```typescript
// Frontend API: authenticated via session
const session = await getServerSession(authOptions);
const result = await createReservation(session.user.id, seatIds);

// Partner API: authenticated via API key
const apiKey = request.headers.get("X-API-Key");
if (apiKey !== process.env.PARTNER_API_KEY) return 401;
const result = await createReservation(partnerUser.id, seatIds);
```

This guarantees:
- Same concurrency guarantees regardless of source
- Same business rules (seat validation, error messages)
- No "partner bypasses the rules" scenario
- Single code path to maintain and test

---

## Database Schema

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│    User      │     │    Seat     │     │  Reservation    │
├─────────────┤     ├─────────────┤     ├─────────────────┤
│ id (PK)     │     │ id (PK)     │     │ id (PK)         │
│ email       │     │ seatLabel   │     │ userId (FK)     │
│ name        │     │ rowChar     │     │ createdAt       │
│ passwordHash│     │ seatNumber  │     └────────┬────────┘
│ createdAt   │     │ createdAt   │              │
│ updatedAt   │     └─────────────┘              │
└─────────────┘                                  │
                                            ┌────▼──────────┐
                                            │ReservationSeat│
                                            ├───────────────┤
                                            │ id (PK)       │
                                            │reservationId  │
                                            │ seatId (UNIQUE)│ ← CONCURRENCY GUARD
                                            │ createdAt     │
                                            └───────────────┘
```

The `ReservationSeat.seatId` column has a `UNIQUE` constraint. This is the **only mechanism** needed for concurrency control. No triggers, no locks, no stored procedures.

### Seat Layout

50 seats in 5 rows of 10:

```
        Screen
  ┌────────────────────┐
  │ A1 A2 A3 A4 A5 ... │  Row A (10 seats)
  │ B1 B2 B3 B4 B5 ... │  Row B (10 seats)
  │ C1 C2 C3 C4 C5 ... │  Row C (10 seats)
  │ D1 D2 D3 D4 D5 ... │  Row D (10 seats)
  │ E1 E2 E3 E4 E5 ... │  Row E (10 seats)
  └────────────────────┘
```

---

## Setup & Running

### Prerequisites

- Node.js 18+
- A PostgreSQL database (Neon, Supabase, Railway, or local)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Edit `.env`:
```env
DATABASE_URL="postgresql://user:password@host:port/dbname?sslmode=require"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-here"
PARTNER_API_KEY="your-partner-api-key"
```

**Important**: Remove `channel_binding=require` from the DATABASE_URL if present — Prisma's PostgreSQL driver does not support channel binding.

### 3. Push Database Schema

```bash
npx prisma db push
```

### 4. Seed Database

```bash
npx tsx prisma/seed.ts
```

This creates:
- 50 seats (A1-A10 through E1-E10)
- 5 test users (alice, bob, charlie, diana, eve) with password `password123`
- 1 partner API user

### 5. Start the Server

```bash
npm run dev
```

The application runs at `http://localhost:3000`.

### Test Accounts

| Email | Password |
|-------|----------|
| alice@example.com | password123 |
| bob@example.com | password123 |
| charlie@example.com | password123 |
| diana@example.com | password123 |
| eve@example.com | password123 |

---

## Concurrency Simulation

The system includes a built-in high-concurrency simulation that demonstrates correctness under load.

### Running the Simulation

**Via UI**: Click "Run 100 User Simulation" or "Run 200 User Simulation" in the Simulation Panel.

**Via API**:
```bash
# 100 concurrent users
Invoke-RestMethod -Uri "http://localhost:3000/api/simulation" -Method POST -ContentType "application/json" -Body '{"concurrency": 100}'

# Or via curl
curl -X POST http://localhost:3000/api/simulation \
  -H "Content-Type: application/json" \
  -d '{"concurrency": 100}'
```

**Via CLI script**:
```bash
npm run simulate
# or with custom concurrency:
npx tsx scripts/simulate.ts 200
```

### What Happens During Simulation

1. **User creation**: 100 simulated users are created in the database
2. **Seat selection**: Each user attempts to reserve 1-3 seats from the same pool
3. **Deliberate contention**: 20% of users target the first 5 seats (A1-A5) to maximize contention
4. **Dual API paths**: Requests alternate between frontend API and partner API
5. **Concurrent execution**: All 100 requests fire simultaneously using `Promise.allSettled()`
6. **Result collection**: Each request's success/failure and duration is recorded

### Expected Results

```
Total requests: 100
Successful:     ~5-25 (depending on seat contention)
Failed:         ~75-95 (expected — seats already taken)
Duration:       ~20-30 seconds
No double-bookings: VERIFIED
```

**The high failure rate is correct behavior** — it proves the system is preventing double-bookings. If all 100 requests succeeded, that would indicate a serious bug.

### What "Correctness" Means Here

- Every successful reservation is valid (seat was genuinely available)
- Every failed reservation gets a proper error message
- No seat appears in two different reservations
- The database's `ReservationSeat` table has no duplicate `seatId` values
- Connected clients receive real-time updates reflecting the actual state

---

## Testing Strategy

### Running Tests

```bash
npm test            # Run all tests
npm run test:watch  # Run tests in watch mode
```

### Test Coverage

The test suite (`__tests__/reservation.test.ts`) verifies the core concurrency guarantees:

| Test | What It Proves |
|------|---------------|
| Reserve single seat | Basic reservation works |
| Reserve multiple seats | Multi-seat atomic transaction works |
| Reserve already-reserved seat | Fails with proper error |
| One seat reserved, one free | Partial conflict causes full rollback |
| **10 users → 1 seat** | **Concurrent double-booking prevented** |
| **Mixed API paths → 2 seats** | **Both paths enforce same rules** |
| **20 users → 3 seats** | **Stress test: no overbooking** |
| UNIQUE constraint enforced | Database-level guarantee verified |

### Key Concurrency Test

The most critical test fires 10 concurrent `reserveSeats()` calls for the **same seat**:

```
Users:    10
Seat:     T1 (only 1 copy)
Expected: 1 success, 9 failures
Result:   ✅ 1 success, 9 failures
```

This proves that the PostgreSQL UNIQUE constraint on `ReservationSeat.seatId` correctly prevents double-booking under concurrent load, which is the same mechanism used in production.

---

## Trade-offs & Design Decisions

### Concurrency Control

| Approach | Chosen? | Why |
|----------|---------|-----|
| UNIQUE constraint | **Yes** | Simplest, most reliable, works across instances |
| SELECT FOR UPDATE | No | Requires careful lock ordering, deadlock risk |
| Redis distributed lock | No | Adds complexity, single point of failure |
| Optimistic locking | No | Requires retry logic, confusing UX |

### Real-Time Communication

| Approach | Chosen? | Why |
|----------|---------|-----|
| Socket.IO | **Yes** | Auto-reconnect, fallback transport, rooms, mature ecosystem |
| Raw WebSockets | No | No fallback, manual reconnection, no rooms |
| Server-Sent Events | No | One-directional only, no client-to-server |
| Polling | No | Wasteful, not truly real-time |

### Authentication

| Approach | Chosen? | Why |
|----------|---------|-----|
| NextAuth (frontend) | **Yes** | Standard, secure, session management built-in |
| API key (partner) | **Yes** | Stateless, simple, standard for machine-to-machine |
| JWT everywhere | No | Token refresh complexity, less secure |

### Database

| Approach | Chosen? | Why |
|----------|---------|-----|
| Neon PostgreSQL | **Yes** | Serverless, scales to zero, compatible with Prisma |
| Supabase | No | Similar but different ORM integration |
| MySQL | No | No UNIQUE constraint semantics differences, but PostgreSQL is more standard for this use case |

### What Was Sacrificed

1. **No reservation expiry**: Seats remain reserved indefinitely. A production system would add TTL and cleanup jobs.

2. **No waitlist**: When seats are unavailable, users get an error. A production system might offer a waitlist.

3. **No payment integration**: This is a reservation system, not a booking system.

4. **No seat selection UI polish**: The UI is functional but not designed for production use.

5. **No rate limiting**: The simulation endpoint has no rate limiting. A production system would throttle it.

---

## Project Structure

```
├── __tests__/
│   └── reservation.test.ts              # Concurrency and constraint tests
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── [...nextauth]/route.ts   # NextAuth endpoints (login/logout/session)
│   │   │   └── register/route.ts        # User registration
│   │   ├── seats/
│   │   │   ├── route.ts                 # GET all seats with reservation status
│   │   │   └── availability/route.ts    # GET availability summary
│   │   ├── reservations/route.ts        # POST reserve seats (frontend, requires auth)
│   │   ├── partner/
│   │   │   └── reservations/route.ts    # POST reserve seats (partner, requires API key)
│   │   └── simulation/
│   │       ├── route.ts                 # POST run N-user concurrency simulation
│   │       └── reset/route.ts           # DELETE clear reservations / POST full reset
│   ├── layout.tsx                       # Root layout with fonts
│   └── page.tsx                         # Main application UI
├── components/
│   ├── AuthForm.tsx                     # Login/register form with quick-login buttons
│   ├── SeatMap.tsx                      # 50-seat grid with selection and status
│   └── SimulationPanel.tsx              # Concurrency simulation controls and results
├── hooks/
│   ├── useAuth.ts                       # Authentication state and actions
│   ├── useSeats.ts                      # Seat data fetching and state
│   └── useSocket.ts                     # Socket.IO connection and real-time events
├── lib/
│   ├── auth.ts                          # NextAuth configuration (credentials provider)
│   ├── prisma.ts                        # Prisma client singleton with driver adapter
│   ├── reservation.ts                   # SHARED booking logic (createReservation, getAllSeats)
│   ├── seed.ts                          # Database seeding helper
│   └── socket.ts                        # Socket.IO broadcast helper
├── prisma/
│   ├── schema.prisma                    # Database schema (User, Seat, Reservation, ReservationSeat)
│   └── seed.ts                          # Standalone seed script
├── scripts/
│   └── simulate.ts                      # CLI concurrency simulation script
├── types/
│   └── index.ts                         # TypeScript interfaces
├── server.ts                            # Custom server (Next.js + Socket.IO on same port)
├── .env                                 # Environment variables (DATABASE_URL, NEXTAUTH_SECRET)
├── package.json
└── README.md                            # This file
```

---

## Key Files Explained

### `lib/reservation.ts` — The Heart of the System

This file contains `createReservation()`, the **single function** that both the frontend and partner APIs call. It:
1. Validates that all requested seat IDs exist
2. Opens a database transaction
3. Inserts a `ReservationSeat` for each seat
4. If any INSERT fails (UNIQUE violation), the entire transaction rolls back
5. Returns the reservation details on success

### `lib/prisma.ts` — Database Connection

Prisma 7 requires a driver adapter (`@prisma/adapter-pg`). This module creates a singleton Prisma client with the PostgreSQL adapter, ensuring connection pooling works correctly across the application.

### `server.ts` — Custom Server

Wraps Next.js with a Socket.IO server on the same port. The Socket.IO server:
- Accepts WebSocket connections from clients
- Broadcasts `seatUpdate` events when reservations are made
- Stores itself on `global.socketIO` so API routes can access it for broadcasting

### `app/api/simulation/route.ts` — The Stress Test

Creates N concurrent users, generates reservation attempts with deliberate contention, fires them all simultaneously, and returns a report. This is the core of the concurrency demonstration.

---

## Assumptions

1. **Single movie showing**: One cinema, one movie, 50 seats. No multi-screen complexity.
2. **Authenticated reservations**: Frontend users must log in. Partner API uses API keys.
3. **No payment**: Reservations are free. No payment flow.
4. **No expiry**: Seats stay reserved until manually cleared or the simulation resets.
5. **Real-time is best-effort**: Clients refresh data on events, not on every possible state change.

---

*This system demonstrates that complex concurrency problems can sometimes be solved with the simplest possible tool — a database constraint — rather than elaborate distributed locking mechanisms.*
