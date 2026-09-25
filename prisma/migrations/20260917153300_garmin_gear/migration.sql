-- AlterTable
ALTER TABLE "GarminToken" ADD COLUMN "userProfilePk" INTEGER;

-- CreateTable
CREATE TABLE "GarminGear" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "customMakeModel" TEXT,
    "gearTypeName" TEXT,
    "dateBegin" DATETIME,
    "dateEnd" DATETIME,
    "retired" BOOLEAN NOT NULL DEFAULT false,
    "distanceMeters" REAL NOT NULL DEFAULT 0,
    "raw" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
