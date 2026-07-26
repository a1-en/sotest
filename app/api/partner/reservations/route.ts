import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createReservation, BookingError } from "@/lib/reservation";
import { broadcastSeatUpdate } from "@/lib/socket";

/**
 * Third-Party Partner Booking API.
 *
 * This endpoint shares the exact same `createReservation` logic as the
 * frontend API. Both paths converge on the same function, ensuring
 * identical business rules and concurrency guarantees.
 *
 * Authentication: Uses X-API-Key header for partner identification.
 * The partner is mapped to a system user in the database.
 */
export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get("X-API-Key");
    const partnerEmail = request.headers.get("X-Partner-Email") || "partner@system.local";

    if (!apiKey || apiKey !== process.env.PARTNER_API_KEY) {
      return NextResponse.json(
        { success: false, error: "Invalid or missing API key" },
        { status: 401 }
      );
    }

    // Find or create the partner user
    let partnerUser = await prisma.user.findUnique({
      where: { email: partnerEmail },
    });

    if (!partnerUser) {
      // For partner API, we can auto-create users
      const bcrypt = await import("bcryptjs");
      partnerUser = await prisma.user.create({
        data: {
          email: partnerEmail,
          name: partnerEmail.split("@")[0],
          passwordHash: await bcrypt.hash("partner-auto-" + Date.now(), 10),
        },
      });
    }

    const body = await request.json();
    const { seatIds, partnerReference } = body;

    if (!Array.isArray(seatIds) || seatIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "seatIds must be a non-empty array" },
        { status: 400 }
      );
    }

    // SAME booking logic as frontend — no separate implementation
    const result = await createReservation(partnerUser.id, seatIds);

    // Broadcast real-time update to all connected clients
    broadcastSeatUpdate({
      type: "reservation_created",
      reservationId: result.reservationId,
      seatLabels: result.seatLabels,
      userId: partnerUser.id,
      timestamp: result.createdAt,
    });

    return NextResponse.json({
      success: true,
      data: {
        reservationId: result.reservationId,
        seatLabels: result.seatLabels,
        createdAt: result.createdAt,
        partnerReference: partnerReference || null,
      },
    });
  } catch (error) {
    if (error instanceof BookingError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    console.error("Partner reservation error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
