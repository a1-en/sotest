import { NextResponse } from "next/server";
import { getSeatAvailability } from "@/lib/reservation";

export async function GET() {
  try {
    const availability = await getSeatAvailability();
    return NextResponse.json({ success: true, data: availability });
  } catch (error) {
    console.error("Failed to fetch availability:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch availability" },
      { status: 500 }
    );
  }
}
