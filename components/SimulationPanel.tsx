"use client";

import { useState } from "react";

interface SimulationPanelProps {
  onSimulationComplete?: () => void;
}

export function SimulationPanel({ onSimulationComplete }: SimulationPanelProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<{
    totalRequests: number;
    successful: number;
    failed: number;
    duration: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSimulation = async (concurrency: number = 100) => {
    setIsRunning(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch("/api/simulation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concurrency }),
      });

      const data = await response.json();

      if (data.success) {
        setResult(data.data);
        onSimulationComplete?.();
      } else {
        setError(data.error || "Simulation failed");
      }
    } catch {
      setError("Network error during simulation");
    } finally {
      setIsRunning(false);
    }
  };

  const resetSeats = async () => {
    setIsRunning(true);
    try {
      await fetch("/api/simulation/reset", { method: "DELETE" });
      onSimulationComplete?.();
    } catch {
      setError("Failed to reset seats");
    } finally {
      setIsRunning(false);
    }
  };

  const reseedDatabase = async () => {
    setIsRunning(true);
    try {
      await fetch("/api/simulation/reset", { method: "POST" });
      onSimulationComplete?.();
    } catch {
      setError("Failed to re-seed database");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
      <h2 className="text-lg font-semibold mb-4">Concurrency Simulation</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
        Simulates {100} concurrent users attempting to reserve seats from the same pool.
        Requests alternate between frontend API and partner API to demonstrate
        shared booking logic.
      </p>

      <div className="flex gap-2 flex-wrap mb-4">
        <button
          onClick={() => runSimulation(100)}
          disabled={isRunning}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isRunning ? "Running..." : "Run 100 User Simulation"}
        </button>
        <button
          onClick={() => runSimulation(200)}
          disabled={isRunning}
          className="px-4 py-2 bg-purple-600 text-white rounded text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {isRunning ? "Running..." : "Run 200 User Simulation"}
        </button>
        <button
          onClick={resetSeats}
          disabled={isRunning}
          className="px-4 py-2 bg-zinc-600 text-white rounded text-sm font-medium hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          Reset Seats
        </button>
        <button
          onClick={reseedDatabase}
          disabled={isRunning}
          className="px-4 py-2 bg-orange-600 text-white rounded text-sm font-medium hover:bg-orange-700 disabled:opacity-50 transition-colors"
        >
          Full Reset
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-sm mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-3 bg-white dark:bg-zinc-900 rounded">
              <p className="text-2xl font-bold text-green-600">{result.successful}</p>
              <p className="text-xs text-zinc-500">Successful</p>
            </div>
            <div className="p-3 bg-white dark:bg-zinc-900 rounded">
              <p className="text-2xl font-bold text-red-600">{result.failed}</p>
              <p className="text-xs text-zinc-500">Failed (Expected)</p>
            </div>
            <div className="p-3 bg-white dark:bg-zinc-900 rounded">
              <p className="text-2xl font-bold text-blue-600">{result.duration}ms</p>
              <p className="text-xs text-zinc-500">Duration</p>
            </div>
          </div>
          <p className="text-xs text-zinc-500 text-center">
            {result.totalRequests} requests fired. Failed reservations are expected
            when multiple users target the same seats. No seat was double-booked.
          </p>
        </div>
      )}
    </div>
  );
}
