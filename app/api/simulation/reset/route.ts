import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * DELETE: Clear all reservations (keeps users and seats).
 */
export async function DELETE() {
  try {
    await prisma.reservationSeat.deleteMany();
    await prisma.reservation.deleteMany();

    // Also clean up simulation/test users (emails ending in @test.local or @example.com)
    const deletedUsers = await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { endsWith: "@test.local" } },
          { email: { endsWith: "@test.local" } },
        ],
      },
    });

    return NextResponse.json({
      success: true,
      message: "Reservations cleared and simulation users cleaned up",
      cleanedUsers: deletedUsers.count,
    });
  } catch (error) {
    console.error("Reset error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to reset reservations" },
      { status: 500 }
    );
  }
}

/**
 * POST: Full database reset and re-seed.
 */
export async function POST() {
  try {
    await prisma.reservationSeat.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.seat.deleteMany();
    await prisma.user.deleteMany();

    const bcrypt = await import("bcryptjs");
    const rows = ["A", "B", "C", "D", "E"];
    const seatsPerRow = 10;

    const seatData = [];
    for (const row of rows) {
      for (let i = 1; i <= seatsPerRow; i++) {
        seatData.push({
          seatLabel: `${row}${i}`,
          rowChar: row,
          seatNumber: i,
        });
      }
    }

    await prisma.seat.createMany({ data: seatData });

    const testUsers = [
      { email: "alice@example.com", name: "Alice" },
      { email: "bob@example.com", name: "Bob" },
      { email: "charlie@example.com", name: "Charlie" },
      { email: "diana@example.com", name: "Diana" },
      { email: "eve@example.com", name: "Eve" },
    ];

    const passwordHash = await bcrypt.hash("password123", 10);

    for (const user of testUsers) {
      await prisma.user.create({
        data: {
          email: user.email,
          name: user.name,
          passwordHash,
        },
      });
    }

    await prisma.user.create({
      data: {
        email: "partner@system.local",
        name: "Partner API",
        passwordHash,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Database re-seeded successfully",
      data: {
        seats: seatData.length,
        users: testUsers.length + 1,
      },
    });
  } catch (error) {
    console.error("Re-seed error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to re-seed database" },
      { status: 500 }
    );
  }
}
