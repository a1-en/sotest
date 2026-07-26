import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

export interface ReservationData {
  id: string;
  userId: string;
  seatIds: string[];
  seatLabels: string[];
  createdAt: Date;
}

export interface SeatData {
  id: string;
  seatLabel: string;
  rowChar: string;
  seatNumber: number;
  isReserved: boolean;
  reservationId?: string;
  reservedBy?: string;
  reservedAt?: Date;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface SimulationResult {
  totalRequests: number;
  successful: number;
  failed: number;
  duration: number;
  results: Array<{
    userId: string;
    seatLabels: string[];
    success: boolean;
    error?: string;
    duration: number;
  }>;
}
