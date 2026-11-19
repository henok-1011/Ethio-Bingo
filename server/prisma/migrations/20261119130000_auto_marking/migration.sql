-- Per-player Auto Marking preference. Live-round marks stay in engine memory,
-- because an interrupted round is ended and refunded rather than resumed.
ALTER TABLE "User" ADD COLUMN "autoMark" BOOLEAN NOT NULL DEFAULT true;
