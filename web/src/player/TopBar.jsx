import React from 'react';
import { etb } from '../format.js';
import Logo from '../components/Logo.jsx';

export default function TopBar({ me, game, you, onRefresh, refreshing, view = 'game', onNavigate }) {
  const uniquePlayers = new Set((game?.players || []).map((entry) => entry.playerId)).size;
  const players = Number(game?.playerCount ?? uniquePlayers);
  const stakeSantim = Number(game?.stake || me?.config?.stake || 0);
  // The server pot includes both real card seats and bot seats. After a bot
  // win the payout pool is zero, so keep showing the pot that was at stake.
  const derash = Number(game?.offeredPrizePool ?? game?.prizePool ?? 0);
  const calledCount = game?.drawNumber ?? game?.calledNumbers?.length ?? 0;

  return (
    <header className="topbar">
      <div className="brand-row">
        <div className="brand-lockup">
          <Logo size={38} />
          <div>
            <strong className="brand-title">Ethio Bingo</strong>
            <span className="brand-sub">የጨዋታ መለያ #{game?.id ?? '—'}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className={`wallet-btn deposit ${view === 'wallet' ? 'active' : ''}`}
            onClick={() => onNavigate?.('wallet')}
          >
            <span aria-hidden="true">＋</span>አስገባ
          </button>
          <button
            type="button"
            className={`wallet-btn withdraw ${view === 'withdraw' ? 'active' : ''}`}
            onClick={() => onNavigate?.('withdraw')}
          >
            <span aria-hidden="true">↑</span>ወጪ
          </button>
          <button
            type="button"
            className="refresh-btn"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="አድስ"
            title="አድስ"
          >
            {refreshing ? '…' : '↻'}
          </button>
        </div>
      </div>

      <div className="topbar-row">
        <div className="stat balance-stat">
          <span>ቀሪ ሂሳብ</span>
          <strong>
            {etb(me?.user?.balance)} <small>ETB</small>
          </strong>
        </div>
        <div className="stat bonus-stat" title="Play-only bonus — cannot be withdrawn">
          <span>ቦናስ</span>
          <strong>
            {etb(me?.user?.bonusBalance)} <small>ETB</small>
          </strong>
        </div>
        <div className="stat derash-stat">
          <span>ደራሽ</span>
          <strong>
            {etb(derash)} <small>ETB</small>
          </strong>
        </div>
        <div className="stat">
          <span>ተጫዋቾች</span>
          <strong>{players}</strong>
        </div>
        <div className="stat">
          <span>መግቢያ ክፍያ</span>
          <strong>
            {etb(stakeSantim)} <small>ETB</small>
          </strong>
        </div>
        <div className="stat call-stat">
          <span>ጥሪ</span>
          <strong>{calledCount}/75</strong>
        </div>
      </div>
    </header>
  );
}
