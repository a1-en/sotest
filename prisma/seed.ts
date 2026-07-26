import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PrismaClientConstructor = require("@prisma/client").PrismaClient;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClientConstructor({ adapter });

async function main() {
  console.log("Seeding database...");

  await prisma.reservationSeat.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.user.deleteMany();

  const rows = ["A", "B", "C", "D", "E"];
  const seatsPerRow = 10;

  const seatData = [];
  for (const row of rows) {
    for (let i = 1; i <= seatsPerRow; i++) {
      seatData.push({
        seatLabel: `${row}${i}`,
        rowChar: row,
        seatNumber: i,
      });
    }
  }

  await prisma.seat.createMany({ data: seatData });
  console.log(`Created ${seatData.length} seats`);

  const passwordHash = await bcrypt.hash("password123", 10);

  const testUsers = [
    { email: "alice@example.com", name: "Alice" },
    { email: "bob@example.com", name: "Bob" },
    { email: "charlie@example.com", name: "Charlie" },
    { email: "diana@example.com", name: "Diana" },
    { email: "eve@example.com", name: "Eve" },
  ];

  for (const user of testUsers) {
    await prisma.user.create({
      data: {
        email: user.email,
        name: user.name,
        passwordHash,
      },
    });
  }

  await prisma.user.create({
    data: {
      email: "partner@system.local",
      name: "Partner API",
      passwordHash,
    },
  });

  console.log(`Created ${testUsers.length + 1} users`);
  console.log("Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
