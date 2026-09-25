-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StravaSyncState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "backfillComplete" BOOLEAN NOT NULL DEFAULT false,
    "backfillBeforeEpoch" INTEGER,
    "autoBackfillEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityStart" DATETIME,
    "lastSyncedAt" DATETIME,
    "activitiesSynced" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "rateLimitJson" JSONB,
    "rateLimitedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_StravaSyncState" ("activitiesSynced", "backfillComplete", "createdAt", "id", "lastActivityStart", "lastError", "lastSyncedAt", "updatedAt") SELECT "activitiesSynced", "backfillComplete", "createdAt", "id", "lastActivityStart", "lastError", "lastSyncedAt", "updatedAt" FROM "StravaSyncState";
DROP TABLE "StravaSyncState";
ALTER TABLE "new_StravaSyncState" RENAME TO "StravaSyncState";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
