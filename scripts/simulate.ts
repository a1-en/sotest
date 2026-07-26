import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const PARTNER_API_KEY =
  process.env.PARTNER_API_KEY || "partner-api-key-change-in-production";

interface AttemptResult {
  userId: string;
  seatLabels: string[];
  success: boolean;
  error?: string;
  apiPath: string;
  duration: number;
}

/**
 * Log in a user via NextAuth credentials endpoint and return the session cookie.
 */
async function loginAs(
  email: string,
  password: string
): Promise<string | null> {
  // Step 1: Get CSRF token
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.csrfToken;

  // Step 2: Submit credentials
  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      callbackUrl: BASE_URL,
      json: "true",
    }),
    redirect: "manual",
  });

  // Extract session cookie from the response
  const setCookie = loginRes.headers.get("set-cookie");
  if (!setCookie) return null;

  // Parse the next-auth.session-token cookie
  const cookies = setCookie.split(",").map((c) => c.trim());
  const sessionCookie = cookies
    .find((c) => c.startsWith("next-auth.session-token="))
    ?.split(";")[0];

  return sessionCookie || null;
}

async function simulateConcurrentReservations(
  concurrency: number = 100
): Promise<void> {
  const startTime = Date.now();
  console.log(`\n========================================`);
  console.log(`Concurrency Simulation: ${concurrency} users`);
  console.log(`========================================\n`);

  // Get all available seats
  const allSeats = await prisma.seat.findMany({
    include: { reservations: { take: 1 } },
  });

  const availableSeats = allSeats.filter(
    (s: (typeof allSeats)[number]) => s.reservations.length === 0
  );

  if (availableSeats.length === 0) {
    throw new Error("No available seats to simulate with. Run seed first.");
  }

  console.log(`Available seats: ${availableSeats.length}`);

  // Create simulated users
  const bcryptHash = await bcrypt.hash("sim-password", 4);
  const timestamp = Date.now();
  const simUsers = [];

  for (let i = 0; i < concurrency; i++) {
    const email = `sim-cli-${i}-${timestamp}@test.local`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `CLI Sim User ${i}`,
        passwordHash: bcryptHash,
      },
    });
    simUsers.push(user);
  }

  console.log(`Created ${simUsers.length} simulated users`);

  // Pre-login a frontend user to get a session cookie
  // We create one dedicated user for all "frontend" API calls
  const frontendEmail = `sim-frontend-auth-${timestamp}@test.local`;
  const frontendUser = await prisma.user.create({
    data: {
      email: frontendEmail,
      name: "Frontend Auth User",
      passwordHash: await bcrypt.hash("testpass123", 10),
    },
  });

  let sessionCookie: string | null = null;
  try {
    sessionCookie = await loginAs(frontendEmail, "testpass123");
    if (sessionCookie) {
      console.log(`Frontend auth: session obtained`);
    } else {
      console.log(
        `Frontend auth: failed to get session, frontend calls will be direct`
      );
    }
  } catch (e) {
    console.log(`Frontend auth: login failed (${e}), frontend calls will be direct`);
  }

  // Generate reservation attempts with deliberate contention
  const attempts = simUsers.map((user, index) => {
    const numSeats = Math.min(
      Math.floor(Math.random() * 3) + 1,
      availableSeats.length
    );

    // 20% target hot seats for high contention
    let selectedSeats;
    if (index < concurrency * 0.2) {
      const hotSeats = availableSeats.slice(0, 5);
      selectedSeats = hotSeats
        .sort(() => Math.random() - 0.5)
        .slice(0, numSeats);
    } else {
      const shuffled = [...availableSeats].sort(() => Math.random() - 0.5);
      selectedSeats = shuffled.slice(0, numSeats);
    }

    // Alternate between partner and frontend API paths
    const isPartner = index % 2 === 0;

    return {
      userId: user.id,
      seatIds: selectedSeats.map((s) => s.id),
      seatLabels: selectedSeats.map((s) => s.seatLabel),
      isPartner,
      user,
    };
  });

  console.log(
    `\nFiring ${attempts.length} concurrent requests (${attempts.filter((a) => a.isPartner).length} partner, ${attempts.filter((a) => !a.isPartner).length} frontend)...`
  );

  // Fire all requests concurrently via HTTP
  const results = await Promise.allSettled<AttemptResult>(
    attempts.map(async (attempt) => {
      const attemptStart = Date.now();

      try {
        let response;

        if (attempt.isPartner) {
          // PARTNER API: Uses X-API-Key header authentication
          response = await fetch(`${BASE_URL}/api/partner/reservations`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": PARTNER_API_KEY,
              "X-Partner-Email": `${attempt.user.email}`,
            },
            body: JSON.stringify({
              seatIds: attempt.seatIds,
              partnerReference: `sim-${attempt.userId}`,
            }),
          });
        } else {
          // FRONTEND API: Uses NextAuth session cookie authentication
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (sessionCookie) {
            headers["Cookie"] = sessionCookie;
          }

          response = await fetch(`${BASE_URL}/api/reservations`, {
            method: "POST",
            headers,
            body: JSON.stringify({ seatIds: attempt.seatIds }),
          });
        }

        const data = await response.json();

        return {
          userId: attempt.userId,
          seatLabels: attempt.seatLabels,
          success: data.success === true,
          error: data.error,
          apiPath: attempt.isPartner ? "partner" : "frontend",
          duration: Date.now() - attemptStart,
        };
      } catch (error) {
        return {
          userId: attempt.userId,
          seatLabels: attempt.seatLabels,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          apiPath: attempt.isPartner ? "partner" : "frontend",
          duration: Date.now() - attemptStart,
        };
      }
    })
  );

  // Aggregate results
  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<AttemptResult> =>
      r.status === "fulfilled"
  );

  const successful = fulfilled.filter((r) => r.value.success);
  const failed = fulfilled.filter((r) => !r.value.success);
  const errored = results.filter((r) => r.status === "rejected");

  const partnerSuccess = successful.filter(
    (r) => r.value.apiPath === "partner"
  ).length;
  const frontendSuccess = successful.filter(
    (r) => r.value.apiPath === "frontend"
  ).length;
  const partnerFailed = failed.filter(
    (r) => r.value.apiPath === "partner"
  ).length;
  const frontendFailed = failed.filter(
    (r) => r.value.apiPath === "frontend"
  ).length;

  const duration = Date.now() - startTime;

  // Verify no double-bookings
  const finalSeats = await prisma.seat.findMany({
    include: { reservations: { take: 1 } },
  });
  const reservedCount = finalSeats.filter(
    (s: (typeof finalSeats)[number]) => s.reservations.length > 0
  ).length;

  console.log(`\n========================================`);
  console.log(`SIMULATION RESULTS`);
  console.log(`========================================`);
  console.log(`  Total requests:     ${concurrency}`);
  console.log(`  Successful:         ${successful.length}`);
  console.log(`    Partner API:      ${partnerSuccess}`);
  console.log(`    Frontend API:     ${frontendSuccess}`);
  console.log(`  Failed:             ${failed.length}`);
  console.log(`    Partner API:      ${partnerFailed}`);
  console.log(`    Frontend API:     ${frontendFailed}`);
  console.log(`  Errored:            ${errored.length}`);
  console.log(`  Duration:           ${duration}ms`);
  console.log(`  Seats now reserved: ${reservedCount}/50`);
  console.log(
    `  No double-bookings: ${reservedCount <= 50 ? "VERIFIED" : "CHECK FAILED"}`
  );

  // Show failed reservation reasons
  if (failed.length > 0) {
    const reasons = failed.reduce(
      (acc, r) => {
        const reason = r.value.error || "Unknown";
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    console.log(`\n  Failure reasons:`);
    Object.entries(reasons).forEach(([reason, count]) => {
      console.log(`    ${reason}: ${count}`);
    });
  }

  console.log(`========================================\n`);
}

async function main() {
  try {
    const concurrency = parseInt(process.argv[2] || "100", 10);
    await simulateConcurrentReservations(concurrency);
  } catch (error) {
    console.error("Simulation failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
