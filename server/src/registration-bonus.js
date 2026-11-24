import { prisma } from './db.js';
import { getSettings } from './settings.js';

/** Welcome bonus in santim, or 0 when the feature is off. */
export function registrationBonusSantim(settings = getSettings()) {
  if (String(settings?.registrationBonusEnabled ?? '1') === '0') return 0;
  const amount = Number(settings?.registrationBonus ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount);
}

/** Split a card purchase between play-only bonus money and withdrawable cash. */
export function splitBonusStake(totalSantim, cashBalanceSantim, bonusBalanceSantim) {
  const total = Math.max(0, Math.round(Number(totalSantim) || 0));
  const bonusAvailable = Math.max(0, Math.floor(Number(bonusBalanceSantim) || 0));
  const cashAvailable = Math.max(0, Math.floor(Number(cashBalanceSantim) || 0));
  const bonusUsed = Math.min(total, bonusAvailable);
  const cashUsed = total - bonusUsed;
  return { total, bonusUsed, cashUsed, enough: cashAvailable >= cashUsed };
}

/** Refund bonus-funded stake back to bonus before returning cash. */
export function splitBonusRefund(refundSantim, bonusStakeSantim) {
  const refund = Math.max(0, Math.round(Number(refundSantim) || 0));
  const bonusStake = Math.max(0, Math.floor(Number(bonusStakeSantim) || 0));
  const bonusRefund = Math.min(refund, bonusStake);
  return { bonusRefund, cashRefund: refund - bonusRefund };
}

function cleanBonusName(name) {
  return (
    String(name || 'Player')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 40) || 'Player'
  );
}

function formatBonusAmount(amountSantim) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
    Number(amountSantim || 0) / 100,
  );
}

/** Personalized Telegram promo sent once, right after a new account is created. */
export function registrationBonusText(name, amountSantim) {
  const safeName = cleanBonusName(name);
  const amount = formatBonusAmount(amountSantim);
  return (
    `ሰላም ${safeName}! 🎉\n\n` +
    `እንኳን ደህና መጡ ወደ Ethio Bingo! ጨዋታውን ለመሞከር ${amount} ብር የመጫወቻ ቦናስ ሰጥተናል። ` +
    `ይህ ቦናስ ለጨዋታ ብቻ ነው፤ ከሂሳብ ማውጣት አይቻልም። አመሰግናለሁ፣ መልካም ጨዋታ! 🎱\n\n` +
    `Selam ${safeName}! We rewarded you a ${amount} birr play-only bonus to try the game. ` +
    `Use it to buy cards; it cannot be withdrawn. Thank you, and good game! 🎉`
  );
}

/** Personalized promo for a manual admin grant. */
export function playBonusText(name, amountSantim) {
  const safeName = cleanBonusName(name);
  const amount = formatBonusAmount(amountSantim);
  return (
    `ሰላም ${safeName}! 🎁\n\n` +
    `${amount} ብር የመጫወቻ ቦናስ ተጨምሯል። ይህን ቦናስ ለካርድ መግዛት ብቻ ይጠቀሙበት፤ ከሂሳብ ማውጣት አይቻልም። ` +
    `አመሰግናለሁ፣ መልካም ጨዋታ! 🎱\n\n` +
    `Selam ${safeName}! A ${amount} birr play-only bonus was added to your account. ` +
    `Use it to buy cards; it cannot be withdrawn. Thank you, and good game! 🎉`
  );
}

/**
 * Creates a player and credits the welcome bonus to the play-only balance in
 * one database write. Callers must only use this when the Telegram ID does not
 * already exist, so a player cannot receive the bonus twice.
 */
export async function createRegisteredUser({ telegramId, firstName, username = null, phone = null }) {
  const bonus = registrationBonusSantim();
  const user = await prisma.user.create({
    data: {
      telegramId,
      firstName: firstName || 'Player',
      username: username || null,
      ...(phone ? { phone } : {}),
      ...(bonus > 0
        ? {
            bonusBalance: bonus,
            transactions: {
              create: {
                type: 'bonus',
                amount: bonus,
                status: 'completed',
                reference: 'registration_bonus',
                meta: 'new player welcome bonus (play-only)',
              },
            },
          }
        : {}),
    },
  });
  return { user, bonus };
}
