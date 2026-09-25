-- AlterTable
ALTER TABLE "DailyTelemetry" ADD COLUMN "stress" REAL;
ALTER TABLE "DailyTelemetry" ADD COLUMN "sleepHours" REAL;
ALTER TABLE "DailyTelemetry" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'seed';

-- CreateTable
CREATE TABLE "GarminToken" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "oauth1Json" JSONB NOT NULL,
    "oauth2Json" JSONB NOT NULL,
    "displayName" TEXT,
    "pendingMfaJson" JSONB,
    "lastSyncedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
