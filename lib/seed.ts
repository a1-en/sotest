import { prisma } from "./prisma";

export async function seedDatabase() {
  const existingSeats = await prisma.seat.count();
  if (existingSeats > 0) {
    return { message: "Database already seeded" };
  }

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

  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.hash("password123", 10);

  const testUsers = [
    { email: "alice@example.com", name: "Alice" },
    { email: "bob@example.com", name: "Bob" },
    { email: "charlie@example.com", name: "Charlie" },
    { email: "diana@example.com", name: "Diana" },
    { email: "eve@example.com", name: "Eve" },
  ];

  for (const user of testUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: {
        email: user.email,
        name: user.name,
        passwordHash,
      },
    });
  }

  await prisma.user.upsert({
    where: { email: "partner@system.local" },
    update: {},
    create: {
      email: "partner@system.local",
      name: "Partner API",
      passwordHash,
    },
  });

  return {
    message: "Database seeded successfully",
    seats: seatData.length,
    users: testUsers.length + 1,
  };
}
