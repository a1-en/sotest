import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 with @prisma/adapter-pg: the generated client re-export chain
// (@prisma/client -> .prisma/client/default -> .prisma/client/index) doesn't
// resolve with moduleResolution: "bundler" on Vercel CI. We use require()
// for the runtime (which works) and manually type the critical methods.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PrismaClientConstructor = require("@prisma/client").PrismaClient;

export interface PrismaSeat {
  id: string;
  seatLabel: string;
  rowChar: string;
  seatNumber: number;
  createdAt: Date;
}

export interface PrismaSeatWithRelations extends PrismaSeat {
  reservations: {
    id: string;
    reservation: {
      id: string;
      userId: string;
      createdAt: Date;
      user: { id: string; email: string; name: string } | null;
    } | null;
  }[];
}

export interface PrismaUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaReservation {
  id: string;
  userId: string;
  createdAt: Date;
}

export interface PrismaReservationSeat {
  id: string;
  reservationId: string;
  seatId: string;
  createdAt: Date;
}

export interface PrismaClient {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T>;

  seat: {
    findMany(args?: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, unknown> | Record<string, unknown>[];
      include?: Record<string, unknown>;
      take?: number;
    }): Promise<PrismaSeatWithRelations[]>;
    findUnique(args: { where: Record<string, unknown> }): Promise<PrismaSeat | null>;
    create(args: { data: Record<string, unknown> }): Promise<PrismaSeat>;
    createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
    count(): Promise<number>;
    deleteMany(): Promise<{ count: number }>;
  };

  user: {
    findMany(args?: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      select?: Record<string, unknown>;
    }): Promise<PrismaUser[]>;
    findUnique(args: { where: Record<string, unknown> }): Promise<PrismaUser | null>;
    create(args: { data: Record<string, unknown> }): Promise<PrismaUser>;
    upsert(args: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<PrismaUser>;
    deleteMany(args?: { where?: Record<string, unknown> }): Promise<{ count: number }>;
  };

  reservation: {
    findMany(args?: {
      where?: Record<string, unknown>;
      include?: Record<string, unknown>;
    }): Promise<PrismaReservation[]>;
    create(args: { data: Record<string, unknown> }): Promise<PrismaReservation>;
    deleteMany(): Promise<{ count: number }>;
  };

  reservationSeat: {
    findMany(args?: {
      where?: Record<string, unknown>;
      include?: Record<string, unknown>;
    }): Promise<PrismaReservationSeat[]>;
    findUnique(args: { where: Record<string, unknown> }): Promise<PrismaReservationSeat | null>;
    create(args: { data: Record<string, unknown> }): Promise<PrismaReservationSeat>;
    deleteMany(args?: { where?: Record<string, unknown> }): Promise<{ count: number }>;
    count(): Promise<number>;
  };
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });

  return new PrismaClientConstructor({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
