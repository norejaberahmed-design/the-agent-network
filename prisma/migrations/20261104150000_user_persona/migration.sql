CREATE TABLE "UserPersona" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "displayName" VARCHAR(60) NOT NULL,
  "tone" VARCHAR(40) NOT NULL,
  "goal" VARCHAR(240) NOT NULL,
  "memoryContextEnabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserPersona_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserPersona_userId_key" ON "UserPersona"("userId");

ALTER TABLE "UserPersona"
  ADD CONSTRAINT "UserPersona_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
