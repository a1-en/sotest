"use client";

import { useEffect, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

interface SeatUpdate {
  type: "reservation_created" | "seats_updated";
  reservationId?: string;
  seatLabels: string[];
  userId: string;
  timestamp: Date;
}

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<SeatUpdate | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const s = io(window.location.origin, {
      path: "/api/socketio",
      transports: ["websocket", "polling"],
      autoConnect: true,
    });

    setSocket(s);

    s.on("connect", () => {
      setIsConnected(true);
      console.log("Socket connected:", s.id);
    });

    s.on("disconnect", () => {
      setIsConnected(false);
      console.log("Socket disconnected");
    });

    s.on("seatUpdate", (data: SeatUpdate) => {
      setLastUpdate(data);
    });

    return () => {
      s.disconnect();
    };
  }, []);

  const forceRefresh = useCallback(() => {
    if (socket) {
      socket.emit("requestRefresh");
    }
  }, [socket]);

  return {
    isConnected,
    lastUpdate,
    forceRefresh,
    socket,
  };
}
