import React, { useEffect, useMemo, useRef, useState } from 'react';
import { etb, seconds } from '../format.js';
import { COLUMNS, RANGES, callLabel, completedPatternCells, winningPatternCells } from '../bingo.js';
import { playCallClip, preloadCallClips, stopCallAudio } from '../voice.js';


function countdown(ms) {
  const total = seconds(ms);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const COLUMN_CLASSES = ['b', 'i', 'n', 'g', 'o'];

function joColumnClass(number) {
  const n = Number(number);
  if (!Number.isFinite(n) || n < 1 || n > 75) return '';
  return `jo-col-${COLUMN_CLASSES[Math.floor((n - 1) / 15)]}`;
}

function firstName(value) {
  const parts = String(value || 'Player').trim().split(/\s+/);
  const first = parts[0] || 'Player';
  // Bot names can end with an emoji; keep it when shortening a display name.
  return parts[1] && !/^[A-Za-z]/.test(parts[1]) ? `${first} ${parts[1]}` : first;
}

function maskedPhone(winner) {
  const last4 = String(winner.phone4 || winner.phoneMasked || '').replace(/\D/g, '').slice(-4);
  return last4 ? `+251***${last4}` : '';
}

function winnerBadge(winner) {
  const phone = maskedPhone(winner);
  return `${winner.name || 'Player'}${phone ? ` · ${phone}` : ''}`;
}

function useRemainingSeconds(ms) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil(Number(ms || 0) / 1000)));

  useEffect(() => {
    setRemaining(Math.max(0, Math.ceil(Number(ms || 0) / 1000)));
  }, [ms]);

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return remaining;
}

function WinnerOverlay({ game, you }) {
  const winners = game?.winners || [];
  const secondsLeft = useRemainingSeconds(winners.length ? game?.nextRoundInMs : 0);
  if (!winners.length) return null;

  const called = new Set(game?.calledNumbers || []);
  const totalSeconds = Math.max(1, Math.ceil(Number(game?.roundEndDelayMs || 8000) / 1000));
  const progress = Math.max(0, Math.min(100, (secondsLeft / totalSeconds) * 100));
  const first = winners[0];
  const offeredPot = Number(game?.offeredPrizePool ?? game?.prizePool ?? 0);

  return (
    <div className="winner-overlay" role="dialog" aria-modal="true" aria-label="የቢንጎ አሸናፊዎች">
      <div className="winner-modal">
        <div className="winner-modal-content">
          <header className="winner-head">
            <h2>BINGO!</h2>
            <div className="winner-info">
              {winners.length === 1 ? (
                <>
                  <span className="winner-badge">{winnerBadge(first)}</span>
                  <span>has won the game</span>
                </>
              ) : (
                <span className="winner-count-line">{winners.length} አሸናፊዎች በዚህ ዙር</span>
              )}
            </div>
            <div className="winner-pot">Total prize pot: {etb(offeredPot)} ETB</div>
          </header>

          <div className="winner-cards">
            {winners.map((winner, index) => {
              const markedList = Array.isArray(winner.marked) ? winner.marked : null;
              const markedNumbers = new Set(markedList || called);
              // Recompute the completed patterns for the shown card so every
              // winning row, diagonal or corner is red and nothing else is.
              const conditionCells =
                markedList && winner.card ? completedPatternCells(winner.card, markedNumbers) : null;
              const lineSet = new Set((conditionCells || winner.line || []).map(([col, row]) => `${col}-${row}`));
              const phone = maskedPhone(winner);
              return (
                <article
                  className="winner-card-shell"
                  key={`${winner.name}-${winner.phoneMasked || winner.phone4}-${index}`}
                >
                  <div className="winner-card-inner">
                    <div className="winner-card-owner">
                      <span className="winner-owner-tag">አሸናፊ {index + 1}</span>
                      <strong className="winner-owner-name">{firstName(winner.name)}</strong>
                      {phone ? <span className="winner-owner-phone">{phone}</span> : null}
                    </div>

                    <div className="winner-letters">
                      {COLUMNS.map((letter) => (
                        <span key={letter} className={`winner-letter lb-${letter.toLowerCase()}`}>
                          {letter}
                        </span>
                      ))}
                    </div>

                    <div className="winner-grid">
                      {Array.from({ length: 5 }, (_, row) =>
                        COLUMNS.map((_, col) => {
                          const n = winner.card?.[col]?.[row] ?? 0;
                          const marked = n === 0 || markedNumbers.has(n);
                          const selected = lineSet.has(`${col}-${row}`);
                          return (
                            <div
                              key={`${col}-${row}`}
                              className={`winner-cell ${marked ? 'marked' : ''} ${selected ? 'selected' : ''} ${n === 0 ? 'free' : ''}`}
                            >
                              {n === 0 ? 'F' : n}
                            </div>
                          );
                        }),
                      )}
                    </div>

                    <div className="winner-card-foot">
                      <span className="winner-prize">
                        {winner.amount > 0
                          ? `Winner's prize: ${etb(winner.amount)} ETB`
                          : 'No cash prize'}
                      </span>
                      <span className="winner-card-no">Card# {winner.cardNumber}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {you?.isWinner && <div className="winner-you">አሸንፈዋል {etb(you.winAmount)} ETB</div>}

          <div className="winner-countdown" aria-live="polite">
            <div className="winner-countdown-text">
              <span>{secondsLeft}</span>s
            </div>
            <div className="winner-progress">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GameScreen({
  game,
  you,
  me,
  stake,
  onPick,
  onDeselect,
  onClaim,
  busy,
  voiceOn,
  onToggleVoice,
  voiceAvailable,
  maxCards: maxCardsProp,
  onRefresh,
  refreshing,
  announcement,
  onMark,
  onToggleAutoMark,
  autoMarkBusy,
}) {
  const maxCards = Math.max(1, Math.min(432, Math.floor(Number(maxCardsProp) || 432)));
  const lastPlayed = useRef(null);
  // Numbers show blue the instant they are tapped, before the server confirms
  // the change; the entry is dropped again if the request fails.
  const [pendingPicks, setPendingPicks] = useState(() => new Set());
  const [pendingMarks, setPendingMarks] = useState({});
  const [slotNotice, setSlotNotice] = useState(null);
  const noticeTimer = useRef(null);

  const called = useMemo(() => new Set(game?.calledNumbers || []), [game?.calledNumbers]);
  const callHistory = useMemo(
    () => [...(game?.calledNumbers || [])].slice(-4).reverse(),
    [game?.calledNumbers],
  );

  // Only the recorded caller clips are used. If one fails, playCallClip
  // retries the same clip instead of switching to a different voice.
  const playCall = (number) => {
    if (!number) return;
    playCallClip(number);
  };

  useEffect(() => {
    if (!voiceOn || !voiceAvailable || !game?.lastCalled) return;
    if (lastPlayed.current === `${game.id}:${game.lastCalled}`) return;
    lastPlayed.current = `${game.id}:${game.lastCalled}`;
    playCall(game.lastCalled);
  }, [game?.lastCalled, game?.id, voiceOn, voiceAvailable]);

  // Start warming the recorded clips immediately; the gesture handler below
  // re-runs this after mobile autoplay has been unlocked. Do not spend mobile
  // data on audio when voice is off or globally disabled.
  useEffect(() => {
    if (!voiceOn || !voiceAvailable) return undefined;
    preloadCallClips();
    const unlock = () => preloadCallClips();
    document.addEventListener('pointerdown', unlock, { once: true });
    return () => document.removeEventListener('pointerdown', unlock);
  }, [voiceOn, voiceAvailable]);

  useEffect(() => {
    if (voiceOn) return;
    stopCallAudio();
  }, [voiceOn]);

  useEffect(
    () => () => {
      stopCallAudio();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const isWaiting = game?.status === 'WAITING';
  const isCalling = game?.status === 'CALLING';
  const ended = game?.status === 'ENDED';
  const selectionMs = game?.selectionEndsInMs ?? game?.startsInMs ?? 0;
  const windowOpen = isWaiting && selectionMs > 0;
  const selectionPage = isWaiting && windowOpen;
  const showCards = Boolean(you?.cards?.length) && !windowOpen;
  const mySlots = you?.slots || [];
  const mySlotSet = new Set(mySlots);
  const autoMarkOn = you ? you.autoMark !== false : me?.user?.autoMark !== false;
  const hasPendingMarks = Object.keys(pendingMarks).length > 0;

  const toggleSlot = async (slot) => {
    if (pendingPicks.has(slot) || busy) return;
    const mine = mySlotSet.has(slot);
    setPendingPicks((prev) => new Set(prev).add(slot));
    try {
      const changed = mine ? await onDeselect?.(slot) : await onPick?.(slot);
      if (changed) {
        setSlotNotice({ slot, action: mine ? 'removed' : 'picked' });
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setSlotNotice(null), 1600);
      }
    } finally {
      setPendingPicks((prev) => {
        const next = new Set(prev);
        next.delete(slot);
        return next;
      });
    }
  };
  const markCell = async (cardIndex, number) => {
    if (!onMark) return;
    const key = `${cardIndex}:${number}`;
    if (pendingMarks[key]) return;
    setPendingMarks((prev) => ({ ...prev, [key]: true }));
    try {
      await onMark(cardIndex, number);
    } catch {
      /* PlayerApp shows the server error toast. */
    } finally {
      setPendingMarks((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const takenSet = useMemo(() => new Set(game?.takenCards || []), [game?.takenCards]);
  const perCard = game?.stake || stake || 0;
  const spent = you?.spent || 0;
  const cashBalance = Number(me?.user?.balance || 0);
  const bonusBalance = Number(me?.user?.bonusBalance || 0);
  const playableBalance = cashBalance + bonusBalance;
  // Bots are counted as players in the prize calculation. They can win a
  // round, but never receive cash. The server is the source of truth here.
  const poolDisplay = Number(game?.offeredPrizePool ?? game?.prizePool ?? 0);
  const stakeSantim = game?.stake || stake || 0;
  const uniquePlayers = new Set((game?.players || []).map((entry) => entry.playerId)).size;
  const players = Number(game?.playerCount ?? uniquePlayers);
  const cardsInPlay = Number(game?.cardsCount ?? game?.playersCount ?? 0);
  const derash = poolDisplay;
  const calledCount = game?.drawNumber ?? game?.calledNumbers?.length ?? 0;
  const boardNumbers = Array.from({ length: 15 }, (_, row) =>
    COLUMNS.map((_, col) => RANGES[col][0] + row),
  ).flat();
  const recentSlots = [0, 1, 2].map((index) => callHistory.filter((n) => n !== game?.lastCalled)[index] || null);
  const timerMs = windowOpen
    ? selectionMs
    : isCalling
      ? game?.nextCallInMs
      : ended
        ? game?.nextRoundInMs
        : 0;
  const timerLabel = timerMs > 0 ? countdown(timerMs) : '--:--';
  const statusText = isWaiting
    ? windowOpen
      ? `ካርድ ይምረጡ · ${mySlots.length} ተመርጧል · ${etb(spent)} ETB`
      : 'የመምረጫ ጊዜው አልቋል · ጥሪው ይጀምራል'
    : isCalling
      ? `ጥሪ ${calledCount}/75 · ሽልማት ${etb(poolDisplay)} ETB`
      : ended
        ? 'ዙሩ ተጠናቅቋል · ቀጣዩ ዙር'
        : 'መልካም እድል';
  const gameMessage = you?.hasBingo
    ? '2 ዝግ ሙሉ ነው። አሁን ቢንጎ ይጠይቁ።'
    : isWaiting
      ? `ካርድ ይምረጡ · ${mySlots.length} ተመርጧል · ${etb(spent)} ETB`
      : isCalling && you
        ? `ካርድ ${mySlots.length} · የወጣ ${etb(spent)} ETB · ጠቅላላ ሽልማት ${etb(poolDisplay)} ETB`
        : isCalling
          ? 'ይህን ዙር እየተመለከቱ ነው።'
          : ended
            ? 'ዙሩ ተጠናቅቋል። ቀጣዩን ይጠብቁ።'
            : 'መልካም እድል!';

  const claimButton = isCalling && you ? (
    <button
      type="button"
      className={`jo-cta jo-claim-under ${you.hasBingo ? 'ready' : ''}`}
      disabled={busy || hasPendingMarks || autoMarkBusy}
      onClick={onClaim}
    >
      {you.hasBingo ? 'BINGO! አሁን ይጠይቁ' : 'BINGO!'}
    </button>
  ) : null;

  const cardsSection = showCards ? (
    <section className="my-cards jo-cards">
      <div className="section-title">
        <h3>የእኔ {you.cards.length > 1 ? 'ካርዶች' : 'ካርድ'}</h3>
        <span className="muted amharic">
          {you.hasBingo
            ? '2 ዝግ ተሞልቷል!'
            : autoMarkOn
              ? 'ራስ-ሰር ምልክት'
              : 'በእጅ ምልክት'}
        </span>
      </div>
      <div className="card-scroll">
        {you.cards.map((card, index) => {
          const markedNumbers = new Set(you.marked?.[index] || []);
          for (const key of Object.keys(pendingMarks)) {
            const [pendingCard, pendingNumber] = key.split(':').map(Number);
            if (pendingCard === index) markedNumbers.add(pendingNumber);
          }
          const winLine = winningPatternCells(card, markedNumbers);
          const winSet = new Set((winLine || []).map(([col, row]) => `${col}-${row}`));
          return (
            <div className={`bingo-card ${winLine ? 'winning' : ''}`} key={index}>
              <div className="bingo-card-head">
                {COLUMNS.map((letter) => (
                  <span key={letter} className={`jo-col-${letter.toLowerCase()}`}>
                    {letter}
                  </span>
                ))}
              </div>
              {Array.from({ length: 5 }, (_, row) => (
                <div className="bingo-card-row" key={row}>
                  {COLUMNS.map((_, col) => {
                    const n = card[col][row];
                    const marked = n === 0 || markedNumbers.has(n);
                    const selected = winSet.has(`${col}-${row}`);
                    const canToggle = !autoMarkOn && isCalling && n > 0 && called.has(n);
                    return (
                      <button
                        key={col}
                        type="button"
                        className={`bingo-cell jo-col-${COLUMNS[col].toLowerCase()} ${marked ? 'marked' : ''} ${selected ? 'selected' : ''} ${n === 0 ? 'free' : ''}`}
                        disabled={!canToggle}
                        onClick={() => markCell(index, n)}
                        aria-pressed={marked}
                        aria-label={
                          n === 0
                            ? 'ነጻ ማዕከል'
                            : canToggle
                              ? marked
                                ? `ቁጥር ${n} ምልክቱን ያንሱ`
                                : `ቁጥር ${n} ምልክት ያድርጉ`
                              : `ቁጥር ${n}`
                        }
                      >
                        {n === 0 ? 'F' : n}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className="bingo-card-foot">
                <span>ካርድ #{you.slots?.[index] ?? index + 1}</span>
                <span className="card-win">ጠቅላላ ሽልማት {etb(poolDisplay)} ETB</span>
              </div>
            </div>
          );
        })}
      </div>
      {claimButton}
      {!autoMarkOn && isCalling ? (
        <p className="jo-manual-note amharic">
          Auto Marking OFF — የተጠራውን ቁጥር በካርድዎ ላይ ይንኩ።
        </p>
      ) : null}
    </section>
  ) : null;

  return (
    <div className={`game-screen jo-game ${selectionPage ? 'selecting' : ''}`}>
      <div className="jo-app">
        <header className="jo-header">
          <div className="jo-title">Ethio Bingo</div>
          <div className="jo-header-icons">
            <button
              type="button"
              className={`jo-icon ${voiceOn ? 'on' : ''}`}
              onClick={onToggleVoice}
              disabled={!voiceAvailable}
              title="የድምጽ ማስታወቂያ"
              aria-label="የድምጽ ማስታወቂያ"
            >
              {voiceOn ? '🔊' : '🔇'}
            </button>
            <button
              type="button"
              className="jo-icon"
              onClick={onRefresh}
              disabled={refreshing}
              title="አድስ"
              aria-label="አድስ"
            >
              {refreshing ? '…' : '↻'}
            </button>
          </div>
        </header>

        {announcement?.text ? (
          <section className="jo-announcement amharic" aria-label="ማስታወቂያ">
            {announcement.imageUrl ? (
              <img className="jo-announcement-image" src={announcement.imageUrl} alt="" />
            ) : null}
            <div>
              <strong>ማስታወቂያ</strong>
              <p>{announcement.text}</p>
            </div>
          </section>
        ) : null}

        <div className="jo-stats">
          <div className="jo-stat">
            <span className="jo-stat-label">ደራሽ</span>
            <strong className="jo-stat-value">
              {etb(derash)}
              <br />
              <small>ETB</small>
            </strong>
          </div>
          <div className="jo-stat">
            <span className="jo-stat-label">ተጫዋቾች</span>
            <strong className="jo-stat-value">{players}</strong>
          </div>
          <div className="jo-stat">
            <span className="jo-stat-label">መግቢያ</span>
            <strong className="jo-stat-value">
              {etb(stakeSantim)}
              <br />
              <small>ETB</small>
            </strong>
          </div>
          <div className="jo-stat">
            <span className="jo-stat-label">ጥሪ</span>
            <strong className="jo-stat-value">{calledCount}/75</strong>
          </div>
        </div>

        <div className={`jo-live ${showCards ? 'has-cards' : ''}`}>
          <div className="jo-call-column">
            <div className="jo-main">
          <section className="jo-card" aria-label="የቢንጎ ሰሌዳ">
            <div className="jo-headers">
              {COLUMNS.map((letter) => (
                <div key={letter} className={`jo-head ${letter.toLowerCase()}`}>
                  {letter}
                </div>
              ))}
            </div>
            <div className="jo-grid">
              {boardNumbers.map((n) => {
                const isCalled = called.has(n);
                const isCurrent = game?.lastCalled === n;
                return (
                  <div
                    key={n}
                    className={`jo-cell ${joColumnClass(n)} ${isCalled ? 'called' : ''} ${isCurrent ? 'current' : ''}`}
                  >
                    {n}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="jo-game-area">
            <div className="jo-recent" aria-label="የቅርብ ጥሪዎች">
              {recentSlots.map((n, index) => (
                <div
                  key={`${n || 'empty'}-${index}`}
                  className={`jo-ball ${n ? joColumnClass(n) : 'empty'}`}
                >
                  {n ? callLabel(n) : '--'}
                </div>
              ))}
            </div>

            <div className="jo-current-wrap">
              <div className={`jo-current ${joColumnClass(game?.lastCalled)} ${game?.lastCalled ? '' : 'idle'}`}>
                {game?.lastCalled ? callLabel(game.lastCalled) : '--'}
              </div>
            </div>

            <div className="jo-auto">
              <span className="jo-auto-label">AUTO MARK</span>
              <button
                type="button"
                className={`jo-switch ${autoMarkOn ? 'on' : ''}`}
                onClick={() => onToggleAutoMark?.(!autoMarkOn)}
                disabled={Boolean(autoMarkBusy) || !onToggleAutoMark}
                aria-label="Auto Marking"
                aria-pressed={autoMarkOn}
                title={autoMarkOn ? 'Auto Marking ON' : 'Auto Marking OFF'}
              >
                <span />
              </button>
            </div>

            <div className="jo-text amharic">{gameMessage}</div>
          </section>
            </div>

            <button
              type="button"
              className="jo-refresh-under"
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? '…' : '↻ REFRESH'}
            </button>
          </div>

          {cardsSection}
        </div>

        {selectionPage && (
          <section className="jo-select" aria-label="የካርድ መምረጫ">
            <div className="jo-select-top">
              <button
                type="button"
                className="jo-select-refresh"
                onClick={onRefresh}
                disabled={refreshing}
              >
                {refreshing ? '…' : 'REFRESH'}
              </button>
              <div className="jo-select-balance">
                <span>BALANCE</span>
                <strong>{etb(playableBalance)} ETB</strong>
                {bonusBalance > 0 && <small>includes {etb(bonusBalance)} bonus</small>}
              </div>
              <div className="jo-select-ad" aria-hidden="true">
                <span>🔥 JACKPOT! 🔥</span>
              </div>
            </div>

            <div className="jo-select-bar">
              <span className="jo-select-connected">
                <i /> CONNECTED
              </span>
              <span className="jo-select-timer">⏱ {seconds(selectionMs)}s</span>
              <span className="jo-select-stake">
                Stake: <b>{etb(perCard)} ETB</b>
              </span>
            </div>

            <div className="jo-select-win" aria-live="polite">
              Live prize pot: {etb(poolDisplay)} ETB
            </div>

            <div className="jo-select-head">
              <div>
                <h4>SELECT YOUR CARD</h4>
                <span>
                  {mySlots.length} picked · {etb(spent)} ETB
                </span>
              </div>
              <span className="jo-select-count">{cardsInPlay} cards in play</span>
            </div>

            <div className="jo-select-grid" role="group" aria-label="የካርድ ቁጥሮች 1 እስከ 432">
              {Array.from({ length: maxCards }, (_, i) => i + 1).map((slot) => {
                const mine = mySlotSet.has(slot) || pendingPicks.has(slot);
                const taken = takenSet.has(slot) && !mine;
                return (
                  <button
                    key={slot}
                    type="button"
                    className={`pick-cell ${mine ? 'mine' : ''} ${taken ? 'taken' : ''}`}
                    disabled={taken || busy}
                    onClick={() => toggleSlot(slot)}
                    aria-pressed={mine}
                    title={
                      mine
                        ? `ካርድ ${slot} — ለመሰረዝ ይንኩ`
                        : taken
                          ? `ካርድ ${slot} በሌላ ተጫዋች ተመርጧል`
                          : `ካርድ ${slot} ይምረጡ`
                    }
                    aria-label={
                      mine
                        ? `ካርድ ${slot} ተመርጧል። ለመሰረዝ ይንኩ`
                        : taken
                          ? `ካርድ ${slot} በሌላ ተጫዋች ተመርጧል`
                          : `ካርድ ${slot} ይምረጡ`
                    }
                  >
                    {slot}
                  </button>
                );
              })}
            </div>

            <div className="jo-select-legend" aria-hidden="true">
              <span>
                <i className="yours" /> የእርስዎ
              </span>
              <span>
                <i className="locked" /> የተያዘ
              </span>
              <span>
                <i className="open" /> ነጻ
              </span>
            </div>

            <div className="jo-select-note amharic">
              {you
                ? 'ተቀላቅለዋል። ተጨማሪ ካርድ መምረጥ ወይም መሰረዝ ይችላሉ — ጨዋታው እስኪጀመር።'
                : 'ካርድ ለመምረጥ ቁጥር ይንኩ። እንደገና በመንካት መሰረዝ ይችላሉ።'}
            </div>
          </section>
        )}

        {isWaiting && !selectionPage && (
          <section className="jo-panel">
            <div className="jo-panel-head">
              <h4>
                {windowOpen
                  ? `የመምረጫ ጊዜ በ ${countdown(selectionMs)}`
                  : 'የመምረጫ ጊዜው አልቋል'}
              </h4>
              <span>{cardsInPlay} ካርድ</span>
            </div>

            <div className="picks-summary">
              <div>
                <span>የመረጡት</span>
                <strong>{mySlots.length}</strong>
              </div>
              <div>
                <span>የወጣ</span>
                <strong>{etb(spent)} ETB</strong>
              </div>
              <div className="win">
                <span>የሽልማት ገንዘብ</span>
                <strong>{etb(poolDisplay)} ETB</strong>
              </div>
            </div>

            {game?.players?.length ? (
              <div className="table-players">
                <div className="picker-head">
                  <h4>በዚህ ዙር የሚጫወቱ</h4>
                  <span>{cardsInPlay} ካርድ</span>
                </div>
                <div className="table-player-list" role="list">
                  {game.players.map((entry) => {
                    const mine = entry.playerId === you?.playerId;
                    return (
                      <span
                        key={`${entry.playerId}-${entry.cardNumber}`}
                        role="listitem"
                        className={`table-player ${mine ? 'mine' : ''}`}
                      >
                        <b>#{entry.cardNumber}</b> {entry.name}
                        {mine ? ' · እርስዎ' : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {windowOpen ? (
              <div className="card-picker-wrap">
                <div className="picker-head">
                  <h4>የካርድ ቁጥር ይምረጡ</h4>
                  {mySlots.length ? <span>{mySlots.length} ተመርጠዋል</span> : null}
                </div>
                <div className="card-picker" role="group" aria-label="የካርድ ቁጥሮች 1 እስከ 432">
                  {Array.from({ length: maxCards }, (_, i) => i + 1).map((slot) => {
                    const mine = mySlotSet.has(slot) || pendingPicks.has(slot);
                    const taken = takenSet.has(slot) && !mine;
                    return (
                      <button
                        key={slot}
                        type="button"
                        className={`pick-cell ${mine ? 'mine' : ''} ${taken ? 'taken' : ''}`}
                        disabled={taken || busy}
                        onClick={() => toggleSlot(slot)}
                        aria-pressed={mine}
                        aria-label={
                          mine
                            ? `ካርድ ${slot} ተመርጧል። ለመሰረዝ ይንኩ`
                            : taken
                              ? `ካርድ ${slot} በሌላ ተጫዋች ተመርጧል`
                              : `ካርድ ${slot} ይምረጡ`
                        }
                      >
                        {slot}
                      </button>
                    );
                  })}
                </div>
                {you && (
                  <div className="waiting-note amharic">
                    <span className="pulse-dot" /> ተቀላቅለዋል። ተጨማሪ ካርድ መምረጥ
                    ወይም መሰረዝ ይችላሉ — ጨዋታው እስኪጀመር።
                  </div>
                )}
              </div>
            ) : (
              <div className="waiting-note amharic">
                <span className="pulse-dot" /> የመምረጫ ጊዜው አልቋል። ካርዶችዎ በቀኝ
                በኩል ይታያሉ — ጥሪው ይጀምራል።
              </div>
            )}
          </section>
        )}

        {!you && isCalling && (
          <div className="jo-spectator amharic">
            ይህን ዙር እየተመለከቱ ነው። ቀጣዩ ዙር በራሱ ይከፈታል።
          </div>
        )}

        <div className="jo-bottom">
          <div className="jo-timer">{timerLabel}</div>
          <div className="jo-status">{statusText}</div>
        </div>

        <div className="jo-footer">Ethio Bingo · መልካም እድል</div>

        {slotNotice ? (
          <div className={`slot-pop ${slotNotice.action}`} role="status">
            <b>#{slotNotice.slot}</b>{' '}
            {slotNotice.action === 'picked' ? 'ተመርጧል' : 'ተሰርዟል'}
          </div>
        ) : null}
      </div>

      {ended && <WinnerOverlay game={game} you={you} />}
    </div>
  );
}
