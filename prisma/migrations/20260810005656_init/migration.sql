-- CreateTable
CREATE TABLE "DailyTelemetry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "overnightHrv" REAL,
    "sleepScore" REAL,
    "restingHr" REAL,
    "weeklyMileage" REAL,
    "lastRunSummary" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyTelemetry_date_key" ON "DailyTelemetry"("date");
