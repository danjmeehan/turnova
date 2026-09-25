-- CreateTable
CREATE TABLE "StravaToken" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "athleteId" INTEGER NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "scope" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StravaGear" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nickname" TEXT,
    "gearType" TEXT NOT NULL,
    "brandName" TEXT,
    "modelName" TEXT,
    "description" TEXT,
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "retired" BOOLEAN NOT NULL DEFAULT false,
    "distanceMeters" REAL NOT NULL DEFAULT 0,
    "raw" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StravaActivity" (
    "id" BIGINT NOT NULL PRIMARY KEY,
    "athleteId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sportType" TEXT NOT NULL,
    "type" TEXT,
    "workoutType" INTEGER,
    "isRace" BOOLEAN NOT NULL DEFAULT false,
    "isTrainer" BOOLEAN NOT NULL DEFAULT false,
    "isCommute" BOOLEAN NOT NULL DEFAULT false,
    "startDate" DATETIME NOT NULL,
    "timezone" TEXT,
    "distanceMeters" REAL,
    "movingTimeSec" INTEGER,
    "elapsedTimeSec" INTEGER,
    "totalElevationGain" REAL,
    "averageSpeedMps" REAL,
    "maxSpeedMps" REAL,
    "averageHeartrate" REAL,
    "maxHeartrate" REAL,
    "averageCadence" REAL,
    "kilojoules" REAL,
    "sufferScore" REAL,
    "calories" REAL,
    "description" TEXT,
    "gearId" TEXT,
    "mapSummaryPolyline" TEXT,
    "rawSummary" JSONB,
    "rawDetail" JSONB,
    "detailFetchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StravaActivity_gearId_fkey" FOREIGN KEY ("gearId") REFERENCES "StravaGear" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StravaSyncState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "backfillComplete" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityStart" DATETIME,
    "lastSyncedAt" DATETIME,
    "activitiesSynced" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "StravaActivity_startDate_idx" ON "StravaActivity"("startDate");

-- CreateIndex
CREATE INDEX "StravaActivity_sportType_idx" ON "StravaActivity"("sportType");

-- CreateIndex
CREATE INDEX "StravaActivity_gearId_idx" ON "StravaActivity"("gearId");
