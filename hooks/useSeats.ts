"use client";

import { useState, useEffect, useCallback } from "react";
import { SeatData, ApiResponse } from "@/types";

export function useSeats() {
  const [seats, setSeats] = useState<SeatData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSeats = useCallback(async () => {
    try {
      const response = await fetch("/api/seats");
      const result: ApiResponse<SeatData[]> = await response.json();

      if (result.success && result.data) {
        setSeats(result.data);
        setError(null);
      } else {
        setError(result.error || "Failed to fetch seats");
      }
    } catch {
      setError("Network error while fetching seats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/seats");
        const result: ApiResponse<SeatData[]> = await response.json();
        if (!cancelled) {
          if (result.success && result.data) {
            setSeats(result.data);
            setError(null);
          } else {
            setError(result.error || "Failed to fetch seats");
          }
        }
      } catch {
        if (!cancelled) {
          setError("Network error while fetching seats");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const refreshSeats = useCallback(() => {
    setLoading(true);
    fetchSeats();
  }, [fetchSeats]);

  return {
    seats,
    loading,
    error,
    refreshSeats,
  };
}
