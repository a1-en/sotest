import { Server as SocketIOServer } from "socket.io";

/**
 * Get the Socket.IO server instance from the global scope.
 * The server.ts custom server attaches it to `global.socketIO`.
 */
function getSocketIO(): SocketIOServer | null {
  return (global as Record<string, unknown>).socketIO as SocketIOServer | null;
}

/**
 * Broadcast seat update to all connected clients.
 * Called after a successful reservation to notify all clients.
 */
export function broadcastSeatUpdate(data: {
  type: "reservation_created" | "seats_updated";
  reservationId?: string;
  seatLabels: string[];
  userId: string;
  timestamp: Date;
}) {
  const io = getSocketIO();
  if (io) {
    io.emit("seatUpdate", data);
  }
}
