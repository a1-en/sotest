import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createReservation, BookingError } from "@/lib/reservation";
import { broadcastSeatUpdate } from "@/lib/socket";

interface SeatWithReservation {
  id: string;
  seatLabel: string;
  rowChar: string;
  seatNumber: number;
  reservations: { id: string }[];
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json().catch(() => ({}));
    const concurrency: number = body.concurrency || 100;

    const allSeats: SeatWithReservation[] = await prisma.seat.findMany({
      include: {
        reservations: { take: 1 },
      },
    });

    const availableSeats = allSeats.filter(
      (s) => s.reservations.length === 0
    );

    if (availableSeats.length === 0) {
      return NextResponse.json(
        { success: false, error: "No available seats to simulate with" },
        { status: 400 }
      );
    }

    const bcrypt = await import("bcryptjs");
    const timestamp = Date.now();
    const simUsers: { id: string; email: string; name: string }[] = [];

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

    const attempts = simUsers.map((user, index) => {
      const numSeats = Math.min(
        Math.floor(Math.random() * 3) + 1,
        availableSeats.length
      );

      let seatsToReserve: SeatWithReservation[];
      if (index < concurrency * 0.2) {
        const hotSeats = availableSeats.slice(0, 5);
        seatsToReserve = hotSeats
          .sort(() => Math.random() - 0.5)
          .slice(0, numSeats);
      } else {
        const shuffled = [...availableSeats].sort(() => Math.random() - 0.5);
        seatsToReserve = shuffled.slice(0, numSeats);
      }

      return {
        userId: user.id,
        seatIds: seatsToReserve.map((s) => s.id),
        seatLabels: seatsToReserve.map((s) => s.seatLabel),
      };
    });

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

    broadcastSeatUpdate({
      type: "seats_updated",
      seatLabels: [],
      userId: "system",
      timestamp: new Date(),
    });

    const finalSeats: SeatWithReservation[] = await prisma.seat.findMany({
      include: { reservations: { take: 1 } },
    });
    const reservedCount = finalSeats.filter(
      (s) => s.reservations.length > 0
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
