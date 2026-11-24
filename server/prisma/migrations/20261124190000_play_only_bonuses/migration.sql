-- Bonuses are play-only: they can buy cards but cannot be withdrawn.
ALTER TABLE "User" ADD COLUMN "bonusBalance" INTEGER NOT NULL DEFAULT 0;

-- Remember how much of each card stake came from bonus money so a cancelled
-- card or interrupted round refunds the bonus back to the bonus wallet.
ALTER TABLE "GamePlayer" ADD COLUMN "bonusStake" INTEGER NOT NULL DEFAULT 0;
