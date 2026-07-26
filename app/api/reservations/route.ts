import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createReservation, BookingError } from "@/lib/reservation";
import { broadcastSeatUpdate } from "@/lib/socket";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { seatIds } = body;

    if (!Array.isArray(seatIds) || seatIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "seatIds must be a non-empty array" },
        { status: 400 }
      );
    }

    const result = await createReservation(session.user.id, seatIds);

    // Broadcast real-time update to all connected clients
    broadcastSeatUpdate({
      type: "reservation_created",
      reservationId: result.reservationId,
      seatLabels: result.seatLabels,
      userId: session.user.id,
      timestamp: result.createdAt,
    });

    return NextResponse.json({
      success: true,
      data: {
        reservationId: result.reservationId,
        seatLabels: result.seatLabels,
        createdAt: result.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof BookingError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    console.error("Reservation error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
