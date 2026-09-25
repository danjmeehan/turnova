import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type SeedRow = {
  date: string;
  overnight_hrv?: number | null;
  sleep_score?: number | null;
  resting_hr?: number | null;
  weekly_mileage?: number | null;
  last_run_summary?: {
    distance?: number | null;
    pace?: string | null;
    cardiac_drift_pct?: number | null;
  } | null;
};

async function main() {
  const seedPath = join(process.cwd(), "data", "seed_telemetry.json");
  const rows = JSON.parse(readFileSync(seedPath, "utf8")) as SeedRow[];

  for (const row of rows) {
    const date = new Date(`${row.date.slice(0, 10)}T00:00:00.000Z`);
    const existing = await prisma.dailyTelemetry.findUnique({ where: { date } });
    await prisma.dailyTelemetry.upsert({
      where: { date },
      create: {
        date,
        overnightHrv: row.overnight_hrv ?? null,
        sleepScore: row.sleep_score ?? null,
        restingHr: row.resting_hr ?? null,
        source: "seed",
        weeklyMileage: row.weekly_mileage ?? null,
        lastRunSummary: row.last_run_summary ?? undefined,
      },
      update:
        existing?.source === "garmin"
          ? {}
          : {
              overnightHrv: row.overnight_hrv ?? null,
              sleepScore: row.sleep_score ?? null,
              restingHr: row.resting_hr ?? null,
              source: "seed",
              weeklyMileage: row.weekly_mileage ?? null,
              lastRunSummary: row.last_run_summary ?? undefined,
            },
    });
  }

  console.log(`Seeded ${rows.length} daily_telemetry rows.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
