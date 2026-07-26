"use client";

import { useState, useEffect, useCallback } from "react";
import { SessionProvider } from "next-auth/react";
import { AuthForm } from "@/components/AuthForm";
import { SeatMap } from "@/components/SeatMap";
import { SimulationPanel } from "@/components/SimulationPanel";
import { useSeats } from "@/hooks/useSeats";
import { useSocket } from "@/hooks/useSocket";
import { useAuth } from "@/hooks/useAuth";

function CinemaApp() {
  const { user, isAuthenticated } = useAuth();
  const { seats, loading, error, refreshSeats } = useSeats();
  const { isConnected, lastUpdate } = useSocket();
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [reserving, setReserving] = useState(false);
  const [reservationResult, setReservationResult] = useState<{
    success: boolean;
    message: string;
    reservationId?: string;
  } | null>(null);

  // Refresh seats when real-time update is received
  useEffect(() => {
    if (lastUpdate) {
      refreshSeats();
    }
  }, [lastUpdate, refreshSeats]);

  const handleSeatToggle = useCallback((seatId: string) => {
    setSelectedSeats((prev) =>
      prev.includes(seatId)
        ? prev.filter((id) => id !== seatId)
        : [...prev, seatId]
    );
    setReservationResult(null);
  }, []);

  const handleReserve = async () => {
    if (!isAuthenticated || selectedSeats.length === 0) return;

    setReserving(true);
    setReservationResult(null);

    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatIds: selectedSeats }),
      });

      const result = await response.json();

      if (result.success) {
        setReservationResult({
          success: true,
          message: `Successfully reserved ${result.data.seatLabels.join(", ")}`,
          reservationId: result.data.reservationId,
        });
        setSelectedSeats([]);
        refreshSeats();
      } else {
        setReservationResult({
          success: false,
          message: result.error || "Reservation failed",
        });
      }
    } catch {
      setReservationResult({
        success: false,
        message: "Network error during reservation",
      });
    } finally {
      setReserving(false);
    }
  };

  const selectedSeatLabels = seats
    .filter((s) => selectedSeats.includes(s.id))
    .map((s) => s.seatLabel)
    .join(", ");

  const stats = {
    total: seats.length,
    available: seats.filter((s) => !s.isReserved).length,
    reserved: seats.filter((s) => s.isReserved).length,
  };

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Cinema Seat Reservation</h1>
          <div className="flex items-center gap-3">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-500" : "bg-red-500"
              }`}
              title={isConnected ? "Connected" : "Disconnected"}
            />
            <span className="text-xs text-zinc-500">
              {isConnected ? "Real-time connected" : "Connecting..."}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left column: Auth + Stats + Actions */}
          <div className="space-y-6">
            <AuthForm />

            {/* Stats */}
            <div className="p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
              <h3 className="text-sm font-medium text-zinc-500 mb-2">
                Seat Availability
              </h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-zinc-500">Total</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">
                    {stats.available}
                  </p>
                  <p className="text-xs text-zinc-500">Available</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-600">
                    {stats.reserved}
                  </p>
                  <p className="text-xs text-zinc-500">Reserved</p>
                </div>
              </div>
            </div>

            {/* Selection + Reserve */}
            {isAuthenticated && (
              <div className="p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                <h3 className="text-sm font-medium text-zinc-500 mb-2">
                  Your Selection
                </h3>
                {selectedSeats.length === 0 ? (
                  <p className="text-sm text-zinc-400">
                    Click on seats to select them
                  </p>
                ) : (
                  <>
                    <p className="text-sm mb-3">
                      {selectedSeats.length} seat(s): {selectedSeatLabels}
                    </p>
                    <button
                      onClick={handleReserve}
                      disabled={reserving}
                      className="w-full py-2 bg-green-600 text-white rounded font-medium text-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      {reserving ? "Reserving..." : "Reserve Seats"}
                    </button>
                  </>
                )}

                {reservationResult && (
                  <div
                    className={`mt-3 p-3 rounded text-sm ${
                      reservationResult.success
                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                        : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                    }`}
                  >
                    {reservationResult.message}
                  </div>
                )}
              </div>
            )}

            {/* Real-time notification */}
            {lastUpdate && lastUpdate.type === "reservation_created" && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-sm text-blue-700 dark:text-blue-300">
                <p className="font-medium">New Reservation</p>
                <p className="text-xs">
                  Seats {lastUpdate.seatLabels.join(", ")} were just reserved
                  {lastUpdate.userId !== user?.id && " by another user"}.
                </p>
              </div>
            )}
          </div>

          {/* Right column: Seat Map */}
          <div className="lg:col-span-2">
            {loading ? (
              <div className="flex items-center justify-center h-64 text-zinc-500">
                Loading seats...
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-64 text-red-500">
                {error}
              </div>
            ) : (
              <SeatMap
                seats={seats}
                selectedSeats={selectedSeats}
                onSeatToggle={handleSeatToggle}
                disabled={!isAuthenticated || reserving}
              />
            )}
          </div>
        </div>

        {/* Simulation Panel */}
        <div className="mt-8">
          <SimulationPanel onSimulationComplete={refreshSeats} />
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <SessionProvider>
      <CinemaApp />
    </SessionProvider>
  );
}
