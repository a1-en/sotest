import { prisma, type PrismaSeat } from "./prisma";

export class BookingError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "BookingError";
  }
}

/**
 * Shared reservation logic used by both frontend API and partner API.
 * This is the ONLY path for creating reservations — ensuring consistent
 * business rules regardless of the request source.
 *
 * Concurrency guarantee: Uses PostgreSQL UNIQUE constraint on
 * ReservationSeat.seatId to prevent double-booking. When two concurrent
 * transactions try to reserve the same seat, one succeeds and the other
 * receives a unique constraint violation, triggering a rollback.
 */
export async function createReservation(
  userId: string,
  seatIds: string[]
): Promise<{
  reservationId: string;
  seatLabels: string[];
  createdAt: Date;
}> {
  if (!seatIds || seatIds.length === 0) {
    throw new BookingError("NO_SEATS", "At least one seat must be selected");
  }

  const seats: PrismaSeat[] = await prisma.seat.findMany({
    where: { id: { in: seatIds } },
  });

  if (seats.length !== seatIds.length) {
    const foundIds = new Set(seats.map((s: PrismaSeat) => s.id));
    const missing = seatIds.filter((id: string) => !foundIds.has(id));
    throw new BookingError(
      "INVALID_SEATS",
      `Invalid seat IDs: ${missing.join(", ")}`
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.create({
        data: { userId },
      });

      for (const seatId of seatIds) {
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
      seatLabels: seats.map((s: PrismaSeat) => s.seatLabel),
      createdAt: result.createdAt,
    };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      throw new BookingError(
        "SEATS_UNAVAILABLE",
        "One or more selected seats are no longer available",
        409
      );
    }
    throw error;
  }
}

interface SeatReservation {
  id: string;
  reservation: {
    id: string;
    createdAt: Date;
    user: { id: string; email: string; name: string } | null;
  } | null;
}

/**
 * Get all seats with their reservation status.
 */
export async function getAllSeats() {
  const seats = (await prisma.seat.findMany({
    orderBy: [{ rowChar: "asc" }, { seatNumber: "asc" }],
    include: {
      reservations: {
        take: 1,
        include: {
          reservation: {
            include: {
              user: {
                select: { id: true, email: true, name: true },
              },
            },
          },
        },
      },
    },
  })) as unknown as (PrismaSeat & { reservations: SeatReservation[] })[];

  return seats.map((seat: PrismaSeat & { reservations: SeatReservation[] }) => {
    const activeReservation = seat.reservations[0]?.reservation;
    return {
      id: seat.id,
      seatLabel: seat.seatLabel,
      rowChar: seat.rowChar,
      seatNumber: seat.seatNumber,
      isReserved: !!activeReservation,
      reservationId: activeReservation?.id,
      reservedBy: activeReservation?.user?.email,
      reservedAt: activeReservation?.createdAt,
    };
  });
}

/**
 * Get only available seats.
 */
export async function getAvailableSeats() {
  const allSeats = await getAllSeats();
  return allSeats.filter((seat) => !seat.isReserved);
}

/**
 * Get seat availability summary.
 */
export async function getSeatAvailability() {
  const allSeats = await getAllSeats();
  return {
    total: allSeats.length,
    available: allSeats.filter((s) => !s.isReserved).length,
    reserved: allSeats.filter((s) => s.isReserved).length,
    seats: allSeats,
  };
}
