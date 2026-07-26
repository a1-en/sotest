"use client";

import { useMemo } from "react";
import { SeatData } from "@/types";

interface SeatMapProps {
  seats: SeatData[];
  selectedSeats: string[];
  onSeatToggle: (seatId: string) => void;
  disabled?: boolean;
}

export function SeatMap({
  seats,
  selectedSeats,
  onSeatToggle,
  disabled = false,
}: SeatMapProps) {
  // Group seats by row
  const seatsByRow = useMemo(() => {
    const grouped: Record<string, SeatData[]> = {};
    seats.forEach((seat) => {
      if (!grouped[seat.rowChar]) {
        grouped[seat.rowChar] = [];
      }
      grouped[seat.rowChar].push(seat);
    });

    // Sort within each row by seat number
    Object.keys(grouped).forEach((row) => {
      grouped[row].sort((a, b) => a.seatNumber - b.seatNumber);
    });

    return grouped;
  }, [seats]);

  const rows = Object.keys(seatsByRow).sort();

  return (
    <div className="w-full">
      {/* Screen indicator */}
      <div className="mb-8 text-center">
        <div className="mx-auto w-48 h-2 bg-zinc-300 dark:bg-zinc-600 rounded-full mb-2" />
        <p className="text-xs text-zinc-500 uppercase tracking-wider">Screen</p>
      </div>

      {/* Seat grid */}
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row} className="flex items-center gap-2">
            <span className="w-6 text-center text-sm font-medium text-zinc-500">
              {row}
            </span>
            <div className="flex gap-1 flex-1 justify-center">
              {seatsByRow[row].map((seat) => {
                const isSelected = selectedSeats.includes(seat.id);
                const isReserved = seat.isReserved;

                let seatClass =
                  "w-8 h-8 rounded-t-lg text-xs font-medium transition-all duration-150 ";

                if (isReserved) {
                  seatClass += "bg-red-200 dark:bg-red-900/50 text-red-600 dark:text-red-400 cursor-not-allowed ";
                } else if (isSelected) {
                  seatClass += "bg-green-500 dark:bg-green-600 text-white scale-110 shadow-lg ";
                } else {
                  seatClass += "bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600 cursor-pointer ";
                }

                if (disabled) {
                  seatClass += "opacity-50 cursor-not-allowed ";
                }

                return (
                  <button
                    key={seat.id}
                    onClick={() => {
                      if (!isReserved && !disabled) {
                        onSeatToggle(seat.id);
                      }
                    }}
                    disabled={isReserved || disabled}
                    className={seatClass}
                    title={
                      isReserved
                        ? `Reserved by ${seat.reservedBy || "another user"}`
                        : `Seat ${seat.seatLabel}`
                    }
                  >
                    {seat.seatLabel}
                  </button>
                );
              })}
            </div>
            <span className="w-6 text-center text-sm font-medium text-zinc-500">
              {row}
            </span>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-6 flex justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-zinc-200 dark:bg-zinc-700" />
          <span>Available</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-green-500" />
          <span>Selected</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-red-200 dark:bg-red-900/50" />
          <span>Reserved</span>
        </div>
      </div>
    </div>
  );
}
