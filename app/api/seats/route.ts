import { NextResponse } from "next/server";
import { getAllSeats } from "@/lib/reservation";
import { seedDatabase } from "@/lib/seed";

export async function GET() {
  try {
    // Auto-seed on first request
    await seedDatabase();
    const seats = await getAllSeats();
    return NextResponse.json({ success: true, data: seats });
  } catch (error) {
    console.error("Failed to fetch seats:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch seats" },
      { status: 500 }
    );
  }
}
