import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

// Import the shared booking logic directly
// We need to mock the prisma import in reservation.ts
// Since it uses a singleton, we'll test via direct DB operations

let testUserId: string;
let seatIds: string[];

beforeAll(async () => {
  // Clean up any previous test data
  await prisma.reservationSeat.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.user.deleteMany();

  // Create test seats (A1-A5 only, for focused testing)
  const seatData = [];
  for (let i = 1; i <= 5; i++) {
    seatData.push({
      seatLabel: `T${i}`,
      rowChar: "T",
      seatNumber: i,
    });
  }
  await prisma.seat.createMany({ data: seatData });

  const seats = await prisma.seat.findMany({ orderBy: { seatNumber: "asc" } });
  seatIds = seats.map((s) => s.id);

  // Create test users
  const passwordHash = await bcrypt.hash("testpass", 10);
  const users = [];
  for (let i = 0; i < 20; i++) {
    const user = await prisma.user.create({
      data: {
        email: `test-user-${i}@test.local`,
        name: `Test User ${i}`,
        passwordHash,
      },
    });
    users.push(user);
  }
  testUserId = users[0].id;
});

afterAll(async () => {
  await prisma.reservationSeat.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

/**
 * Direct reservation function that mirrors lib/reservation.ts createReservation()
 * but uses the test prisma instance. This tests the core concurrency logic.
 */
async function reserveSeats(userId: string, seatIdsToReserve: string[]) {
  if (!seatIdsToReserve || seatIdsToReserve.length === 0) {
    throw new Error("No seats selected");
  }

  const seats = await prisma.seat.findMany({
    where: { id: { in: seatIdsToReserve } },
  });

  if (seats.length !== seatIdsToReserve.length) {
    throw new Error("Invalid seat IDs");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.create({
        data: { userId },
      });

      for (const seatId of seatIdsToReserve) {
        await tx.reservationSeat.create({
          data: {
            reservationId: reservation.id,
            seatId,
          },
        });
      }

      return reservation;
    });

    return {
      reservationId: result.id,
      seatLabels: seats.map((s) => s.seatLabel),
      createdAt: result.createdAt,
    };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      throw new Error("SEATS_UNAVAILABLE");
    }
    throw error;
  }
}

describe("Concurrency Control", () => {
  it("should successfully reserve a single seat", async () => {
    const result = await reserveSeats(testUserId, [seatIds[0]]);
    expect(result).toBeDefined();
    expect(result.reservationId).toBeDefined();
    expect(result.seatLabels).toEqual(["T1"]);
  });

  it("should successfully reserve multiple seats in one reservation", async () => {
    const result = await reserveSeats(testUserId, [seatIds[1], seatIds[2]]);
    expect(result).toBeDefined();
    expect(result.seatLabels).toEqual(["T2", "T3"]);
  });

  it("should fail when trying to reserve an already-reserved seat", async () => {
    // seatIds[0] was reserved in the first test
    await expect(reserveSeats(testUserId, [seatIds[0]])).rejects.toThrow(
      "SEATS_UNAVAILABLE"
    );
  });

  it("should fail when ONE of multiple seats is already reserved", async () => {
    // seatIds[1] was reserved in the second test, seatIds[3] is free
    await expect(reserveSeats(testUserId, [seatIds[1], seatIds[3]])).rejects.toThrow(
      "SEATS_UNAVAILABLE"
    );
  });

  it("should handle invalid seat IDs", async () => {
    await expect(
      reserveSeats(testUserId, ["nonexistent-seat-id"])
    ).rejects.toThrow("Invalid seat IDs");
  });

  it("should handle empty seat array", async () => {
    await expect(reserveSeats(testUserId, [])).rejects.toThrow(
      "No seats selected"
    );
  });

  it("PREVENTS DOUBLE-BOOKING: concurrent reservations for the same seat", async () => {
    // Reset: clear all reservations
    await prisma.reservationSeat.deleteMany();
    await prisma.reservation.deleteMany();

    // Create 10 users
    const passwordHash = await bcrypt.hash("testpass", 10);
    const users = [];
    for (let i = 0; i < 10; i++) {
      const user = await prisma.user.create({
        data: {
          email: `concurrent-user-${i}@test.local`,
          name: `Concurrent User ${i}`,
          passwordHash,
        },
      });
      users.push(user);
    }

    // All 10 users try to reserve the SAME seat (seatIds[0]) simultaneously
    const results = await Promise.allSettled(
      users.map((user) => reserveSeats(user.id, [seatIds[0]]))
    );

    const successful = results.filter(
      (r) => r.status === "fulfilled"
    ).length;
    const failed = results.filter(
      (r) => r.status === "rejected"
    ).length;

    // CRITICAL: Only ONE reservation should succeed
    expect(successful).toBe(1);
    // The rest should fail with SEATS_UNAVAILABLE
    expect(failed).toBe(9);

    // Verify the seat is reserved exactly once
    const reservationSeats = await prisma.reservationSeat.findMany({
      where: { seatId: seatIds[0] },
    });
    expect(reservationSeats.length).toBe(1);
  });

  it("PREVENTS DOUBLE-BOOKING: concurrent reservations from different API paths", async () => {
    // Reset
    await prisma.reservationSeat.deleteMany();
    await prisma.reservation.deleteMany();

    const passwordHash = await bcrypt.hash("testpass", 10);

    // Create users for "frontend" and "partner" paths
    const frontendUsers = [];
    const partnerUsers = [];
    for (let i = 0; i < 5; i++) {
      const fu = await prisma.user.create({
        data: {
          email: `frontend-user-${i}@test.local`,
          name: `Frontend User ${i}`,
          passwordHash,
        },
      });
      const pu = await prisma.user.create({
        data: {
          email: `partner-user-${i}@test.local`,
          name: `Partner User ${i}`,
          passwordHash,
        },
      });
      frontendUsers.push(fu);
      partnerUsers.push(pu);
    }

    // Mix of frontend and partner users trying to reserve seats[0] and seats[1]
    const allAttempts = [
      ...frontendUsers.map((u) => ({ userId: u.id, seatId: seatIds[0] })),
      ...partnerUsers.map((u) => ({ userId: u.id, seatId: seatIds[0] })),
      ...frontendUsers.map((u) => ({ userId: u.id, seatId: seatIds[1] })),
      ...partnerUsers.map((u) => ({ userId: u.id, seatId: seatIds[1] })),
    ];

    const results = await Promise.allSettled(
      allAttempts.map((a) => reserveSeats(a.userId, [a.seatId]))
    );

    const successful = results.filter(
      (r) => r.status === "fulfilled"
    ).length;

    // Only 2 seats available, so max 2 successful reservations
    expect(successful).toBe(2);

    // Verify no double bookings
    const seat0Reservations = await prisma.reservationSeat.findMany({
      where: { seatId: seatIds[0] },
    });
    const seat1Reservations = await prisma.reservationSeat.findMany({
      where: { seatId: seatIds[1] },
    });

    expect(seat0Reservations.length).toBe(1);
    expect(seat1Reservations.length).toBe(1);
  });

  it("STRESS TEST: 20 concurrent users competing for 3 seats", async () => {
    // Reset
    await prisma.reservationSeat.deleteMany();
    await prisma.reservation.deleteMany();

    const passwordHash = await bcrypt.hash("testpass", 10);
    const users = [];
    for (let i = 0; i < 20; i++) {
      const user = await prisma.user.create({
        data: {
          email: `stress-user-${i}@test.local`,
          name: `Stress User ${i}`,
          passwordHash,
        },
      });
      users.push(user);
    }

    // Only 3 seats available (seats 0, 1, 2)
    const availableSeatIds = seatIds.slice(0, 3);

    // All 20 users try to reserve 1-2 seats from the same pool
    const results = await Promise.allSettled(
      users.map((user) => {
        const numSeats = Math.floor(Math.random() * 2) + 1;
        const selected = availableSeatIds.slice(0, numSeats);
        return reserveSeats(user.id, selected);
      })
    );

    const successful = results.filter(
      (r) => r.status === "fulfilled"
    ).length;

    // At most 3 seats available, so at most 3 successful (if each reserves 1)
    // If someone reserves 2, it could be fewer
    expect(successful).toBeLessThanOrEqual(3);
    expect(successful).toBeGreaterThanOrEqual(1);

    // Verify total reserved seats <= 3
    const totalReserved = await prisma.reservationSeat.count();
    expect(totalReserved).toBeLessThanOrEqual(3);
  });
});

describe("Database Schema Constraints", () => {
  it("ReservationSeat.seatId has UNIQUE constraint", async () => {
    // This test verifies that the UNIQUE constraint is enforced at DB level
    await prisma.reservationSeat.deleteMany();
    await prisma.reservation.deleteMany();

    // Create a reservation
    const reservation = await prisma.reservation.create({
      data: { userId: testUserId },
    });

    // First insert should succeed
    await prisma.reservationSeat.create({
      data: {
        reservationId: reservation.id,
        seatId: seatIds[0],
      },
    });

    // Second insert with the same seatId should fail (UNIQUE violation)
    const reservation2 = await prisma.reservation.create({
      data: { userId: testUserId },
    });

    await expect(
      prisma.reservationSeat.create({
        data: {
          reservationId: reservation2.id,
          seatId: seatIds[0], // Same seatId — must fail
        },
      })
    ).rejects.toThrow();
  });
});
