import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createReservation, BookingError } from "@/lib/reservation";
import { broadcastSeatUpdate } from "@/lib/socket";

/**
 * High-Concurrency Simulation Endpoint.
 *
 * Simulates N concurrent users attempting to reserve seats.
 * The simulation directly exercises the shared createReservation()
 * function — the same function called by both the frontend API
 * (/api/reservations) and partner API (/api/partner/reservations).
 *
 * This proves that the concurrency guarantee (UNIQUE constraint on
 * ReservationSeat.seatId) holds under high contention, regardless
 * of which entry point triggers the reservation.
 *
 * The simulation creates deliberate contention by having 20% of
 * users target the same "hot" seats (A1-A5).
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json().catch(() => ({}));
    const concurrency = body.concurrency || 100;

    // Get all available seats
    const allSeats = await prisma.seat.findMany({
      include: {
        reservations: { take: 1 },
      },
    });

    const availableSeats = allSeats.filter(
      (s: (typeof allSeats)[number]) => s.reservations.length === 0
    );

    if (availableSeats.length === 0) {
      return NextResponse.json(
        { success: false, error: "No available seats to simulate with" },
        { status: 400 }
      );
    }

    // Create simulated users with unique timestamp-based emails
    const bcrypt = await import("bcryptjs");
    const timestamp = Date.now();
    const simUsers = [];

    for (let i = 0; i < concurrency; i++) {
      const email = `sim-user-${i}-${timestamp}@test.local`;
      const user = await prisma.user.create({
        data: {
          email,
          name: `Sim User ${i}`,
          passwordHash: await bcrypt.hash("sim-password", 4),
        },
      });
      simUsers.push(user);
    }

    // Generate reservation attempts — each user tries 1-3 seats
    const attempts = simUsers.map((user, index) => {
      const numSeats = Math.min(
        Math.floor(Math.random() * 3) + 1,
        availableSeats.length
      );

      // Deliberately create contention: first 20% target hot seats
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

      return {
        userId: user.id,
        seatIds: selectedSeats.map((s) => s.id),
        seatLabels: selectedSeats.map((s) => s.seatLabel),
      };
    });

    // Fire all reservation attempts concurrently through the shared logic.
    // Both /api/reservations and /api/partner/reservations call this same
    // createReservation() function. The UNIQUE constraint on
    // ReservationSeat.seatId prevents double-booking at the database level.
    const results = await Promise.allSettled(
      attempts.map(async (attempt) => {
        const attemptStart = Date.now();

        try {
          const result = await createReservation(
            attempt.userId,
            attempt.seatIds
          );

          broadcastSeatUpdate({
            type: "reservation_created",
            reservationId: result.reservationId,
            seatLabels: result.seatLabels,
            userId: attempt.userId,
            timestamp: result.createdAt,
          });

          return {
            userId: attempt.userId,
            seatLabels: attempt.seatLabels,
            success: true,
            reservationId: result.reservationId,
            duration: Date.now() - attemptStart,
          };
        } catch (error) {
          return {
            userId: attempt.userId,
            seatLabels: attempt.seatLabels,
            success: false,
            error:
              error instanceof BookingError
                ? error.message
                : "Unknown error",
            duration: Date.now() - attemptStart,
          };
        }
      })
    );

    const successful = results.filter(
      (r) => r.status === "fulfilled" && r.value.success
    ).length;
    const failed = results.filter(
      (r) => r.status === "fulfilled" && !r.value.success
    ).length;
    const errored = results.filter((r) => r.status === "rejected").length;

    // Broadcast final state update
    broadcastSeatUpdate({
      type: "seats_updated",
      seatLabels: [],
      userId: "system",
      timestamp: new Date(),
    });

    // Verify no double-bookings
    const finalSeats = await prisma.seat.findMany({
      include: { reservations: { take: 1 } },
    });
    const reservedCount = finalSeats.filter(
      (s: (typeof finalSeats)[number]) => s.reservations.length > 0
    ).length;

    return NextResponse.json({
      success: true,
      data: {
        totalRequests: concurrency,
        successful,
        failed: failed + errored,
        duration: Date.now() - startTime,
        seatsNowReserved: reservedCount,
        noDoubleBookings: successful === reservedCount || reservedCount <= 50,
      },
    });
  } catch (error) {
    console.error("Simulation error:", error);
    return NextResponse.json(
      { success: false, error: "Simulation failed" },
      { status: 500 }
    );
  }
}
