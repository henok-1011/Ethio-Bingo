import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { api } from '../api.js';
import { haptic, tg } from '../telegram.js';
import { speakPhrase } from '../voice.js';
import { useToast } from '../components/Toast.jsx';
import TopBar from './TopBar.jsx';
import GameScreen from './GameScreen.jsx';
import WalletScreen from './WalletScreen.jsx';
import WithdrawScreen from './WithdrawScreen.jsx';
import Logo from '../components/Logo.jsx';

const TOKEN_KEY = 'bingo_player_token';

export default function PlayerApp() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [me, setMe] = useState(null);
  const [game, setGame] = useState(null);
  const [you, setYou] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoMarkBusy, setAutoMarkBusy] = useState(false);
  const [view, setView] = useState('game');
  const [authError, setAuthError] = useState('');
  const [voiceOn, setVoiceOn] = useState(() => localStorage.getItem('bingo_voice') !== 'off');
  const toast = useToast();
  const youRef = useRef(null);
  const gameRef = useRef(null);
  const voiceOnRef = useRef(null);
  const authStarted = useRef(false);
  const phoneAsked = useRef(false);

  youRef.current = you;
  gameRef.current = game;
  voiceOnRef.current = voiceOn;

  const refreshMe = useCallback(async () => {
    const tk = localStorage.getItem(TOKEN_KEY);
    if (!tk) return;
    try {
      const data = await api('/api/me', { token: tk });
      setMe(data);
    } catch (err) {
      if (err.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setAuthError('ክፍለ ጊዜዎ አልቋል። እባክዎ መተግበሪያውን ከቴሌግራም እንደገና ይክፈቱ።');
      }
    }
  }, []);

  useEffect(() => {
    if (authStarted.current) return;
    authStarted.current = true;

    let cancelled = false;

    async function authenticate() {
      const stored = localStorage.getItem(TOKEN_KEY);
      if (stored) {
        try {
          const data = await api('/api/me', { token: stored });
          if (!cancelled) {
            setToken(stored);
            setMe(data);
          }
          return;
        } catch {
          localStorage.removeItem(TOKEN_KEY);
        }
      }

      try {
        const initData = tg?.initData || '';
        const startParam =
          new URLSearchParams(window.location.search).get('start') ||
          tg?.initDataUnsafe?.start_param ||
          undefined;
        let devTelegramId = localStorage.getItem('bingo_dev_id');
        if (!devTelegramId) {
          devTelegramId = `dev-${Math.random().toString(36).slice(2, 10)}`;
          localStorage.setItem('bingo_dev_id', devTelegramId);
        }
        const result = await api('/api/auth/telegram', {
          method: 'POST',
          body: {
            initData,
            startParam,
            devTelegramId: initData ? undefined : devTelegramId,
            devFirstName: initData ? undefined : 'Dev Player',
          },
        });
        localStorage.setItem(TOKEN_KEY, result.token);
        if (!cancelled) {
          setToken(result.token);
          if (result.user?.isBanned) {
            setAuthError('ይህ መለያ ታግዷል።');
            return;
          }
          setMe(await api('/api/me', { token: result.token }));
        }
      } catch (err) {
        if (!cancelled) setAuthError(err.message || 'መግባት አልተቻለም።');
      }
    }

    authenticate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Ask for the phone number once. Telegram delivers the contact to the bot,
  // which stores it against this player's account.
  useEffect(() => {
    if (!me || me.user?.phone || phoneAsked.current) return;
    if (!tg?.requestContact) return;
    if (localStorage.getItem('bingo_phone_asked') === '1') return;
    phoneAsked.current = true;
    localStorage.setItem('bingo_phone_asked', '1');
    try {
      tg.requestContact((shared) => {
        if (shared) {
          setTimeout(() => refreshMe(), 1800);
        }
      });
    } catch {
      /* older Telegram clients */
    }
  }, [me, refreshMe]);

  useEffect(() => {
    if (!token) return undefined;
    api('/api/game/state', { token })
      .then((state) => {
        setGame(state);
        setYou(state.you || null);
      })
      .catch(() => {});

    const socket = io('/', { auth: { token }, transports: ['websocket', 'polling'] });
    socket.on('state', (state) => {
      setGame(state);
      if (state.you) setYou(state.you);
      else {
        setYou((prev) => (prev && prev.roundId !== state.id ? null : prev));
      }
    });
    socket.on('you', (payload) => setYou(payload));
    socket.on('announcement', (payload) => {
      setMe((prev) => (prev ? { ...prev, announcement: payload } : prev));
    });
    socket.on('balance', () => refreshMe());
    socket.on('game:started', () => {
      toast('ቁጥሮች እየተጠሩ ነው። መልካም እድል!');
      if (voiceOnRef.current && me?.config?.voiceEnabled !== false) speakPhrase('ጨዋታው ተጀመረ');
    });
    socket.on('game:ended', (payload) => {
      const mine = youRef.current?.playerId;
      if (mine && payload.winnerIds?.includes(mine)) {
        haptic('success');
        toast('🎉 ቢንጎ! በዚህ ዙር አሸንፈዋል!');
        if (voiceOnRef.current && me?.config?.voiceEnabled !== false) speakPhrase('ቢንጎ');
      } else {
        toast('ዙሩ አልቋል። ቀጣዩ ዙር እየተጀመረ ነው…');
      }
      // The server normally sends a balance event first, but refresh here too
      // so a lost socket event cannot leave the wallet showing the old amount.
      refreshMe();
      api('/api/game/state', { token }).then((state) => setYou(state.you || null)).catch(() => {});
    });
    return () => socket.disconnect();
  }, [token, refreshMe, toast, me?.config?.voiceEnabled]);

  const navigate = (next) => {
    setView(next);
    if (next === 'wallet' || next === 'withdraw') refreshMe();
    haptic('light');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    localStorage.setItem('bingo_voice', next ? 'on' : 'off');
    haptic('light');
  };

  async function toggleAutoMark(next) {
    if (!token || autoMarkBusy) return;
    setAutoMarkBusy(true);
    try {
      const result = await api('/api/game/auto-mark', {
        token,
        method: 'POST',
        body: { enabled: Boolean(next) },
      });
      setMe((prev) =>
        prev ? { ...prev, user: { ...prev.user, autoMark: result.autoMark !== false } } : prev,
      );
      if (result.you) setYou(result.you);
      haptic('light');
    } catch (err) {
      toast(err.message || 'Auto Marking መቀየር አልተቻለም።', 'error');
      haptic('error');
    } finally {
      setAutoMarkBusy(false);
    }
  }

  async function markNumber(cardIndex, number) {
    if (!token) return;
    try {
      const result = await api('/api/game/mark', {
        token,
        method: 'POST',
        body: { cardIndex, number },
      });
      if (result.you) setYou(result.you);
      haptic('light');
    } catch (err) {
      toast(err.message || 'ቁጥሩን ምልክት ማድረግ አልተቻለም።', 'error');
      haptic('error');
      throw err;
    }
  }

  const refreshGame = useCallback(async () => {
    if (!token || refreshing) return;
    setRefreshing(true);
    try {
      const state = await api('/api/game/state', { token });
      setGame(state);
      setYou(state.you || null);
      await refreshMe();
      haptic('light');
      toast('ጨዋታው ተመስተካክሏል።');
    } catch (err) {
      toast(err.message || 'ማደስ አልተቻለም።', 'error');
    } finally {
      setRefreshing(false);
    }
  }, [token, refreshing, refreshMe, toast]);

  async function pickCard(slot) {
    if (busy) return false;
    setBusy(true);
    try {
      const result = await api('/api/game/join', {
        token,
        method: 'POST',
        body: { cards: [slot] },
      });
      if (result.you) setYou(result.you);
      if (result.prizePool !== undefined) {
        setGame((prev) => (prev ? { ...prev, prizePool: result.prizePool } : prev));
      }
      haptic('success');
      await refreshMe();
      return true;
    } catch (err) {
      toast(err.message, 'error');
      haptic('error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function deselectCard(slot) {
    if (busy) return false;
    setBusy(true);
    try {
      const result = await api('/api/game/deselect', {
        token,
        method: 'POST',
        body: { card: slot },
      });
      setYou(result.you || null);
      if (result.prizePool !== undefined) {
        setGame((prev) => (prev ? { ...prev, prizePool: result.prizePool } : prev));
      }
      haptic('light');
      await refreshMe();
      return true;
    } catch (err) {
      toast(err.message, 'error');
      haptic('error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    setBusy(true);
    try {
      await api('/api/game/claim', { token, method: 'POST' });
      haptic('success');
    } catch (err) {
      toast(err.message, 'error');
      haptic('error');
    } finally {
      setBusy(false);
      api('/api/game/state', { token })
        .then((state) => {
          setGame(state);
          setYou(state.you || null);
        })
        .catch(() => {});
      refreshMe();
    }
  }

  if (authError) {
    return (
      <div className="center-screen">
        <div className="fatal-card">
          <Logo size={64} />
          <h1>Ethio Bingo</h1>
          <p>{authError}</p>
          <p className="muted small amharic">
            ይህን መተግበሪያ ከቴሌግራም ቦት ይክፈቱ፣ ወይም ለአሳሽ ሙከራ DEV_MODE ያብሩ።
          </p>
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>
            እንደገና ይሞክሩ
          </button>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="center-screen">
        <div className="loader branded-loader">
          <Logo size={84} />
          <strong className="loader-name">ETHIO BINGO</strong>
          <p className="amharic">ኢትዮ ቢንጎ በመጫን ላይ…</p>
          <span className="loader-bar"><span /></span>
        </div>
      </div>
    );
  }

  return (
    <div className="player-shell with-nav">
      {view !== 'game' && (
        <TopBar
          me={me}
          game={game}
          you={you}
          onRefresh={refreshGame}
          refreshing={refreshing}
          view={view}
          onNavigate={navigate}
        />
      )}

      {me.user?.isBanned && (
        <div className="banned-banner amharic">ይህ መለያ ታግዷል። እባክዎ በቴሌግራም ድጋፍን ያግኙ።</div>
      )}

      {view !== 'game' && me.announcement?.text ? (
        <section className="announcement-banner" aria-label="ማስታወቂያ">
          {me.announcement.imageUrl ? (
            <img className="announcement-image" src={me.announcement.imageUrl} alt="" />
          ) : (
            <span className="announcement-icon" aria-hidden="true">📣</span>
          )}
          <div className="announcement-copy">
            <strong>ማስታወቂያ</strong>
            <p>{me.announcement.text}</p>
          </div>
        </section>
      ) : null}

      <main className="player-main">
        {view !== 'game' && (
          <button type="button" className="back-btn amharic" onClick={() => navigate('game')}>
            ← ጨዋታው ይመለሱ
          </button>
        )}
        {view === 'game' && (
          <GameScreen
            game={game}
            you={you}
            me={me}
            stake={me.config?.stake}
            onPick={pickCard}
            onDeselect={deselectCard}
            onClaim={claim}
            busy={busy}
            voiceOn={voiceOn}
            onToggleVoice={toggleVoice}
            voiceAvailable={me?.config?.voiceEnabled !== false}
            maxCards={me?.config?.maxCards || 432}
            onRefresh={refreshGame}
            refreshing={refreshing}
            announcement={me.announcement}
            onMark={markNumber}
            onToggleAutoMark={toggleAutoMark}
            autoMarkBusy={autoMarkBusy}
          />
        )}
        {view === 'wallet' && <WalletScreen me={me} token={token} refreshMe={refreshMe} />}
        {view === 'withdraw' && <WithdrawScreen me={me} token={token} refreshMe={refreshMe} />}
      </main>

      <nav className="bottom-nav">
        <button type="button" className={view === 'game' ? 'active' : ''} onClick={() => navigate('game')}>
          <span>🎱</span>ጨዋታ
        </button>
        <button type="button" className={view === 'wallet' ? 'active' : ''} onClick={() => navigate('wallet')}>
          <span>💳</span>አስገባ
        </button>
        <button type="button" className={view === 'withdraw' ? 'active' : ''} onClick={() => navigate('withdraw')}>
          <span>📤</span>ወጪ
        </button>
        {me.agent && (
          <Link to="/agent" className="nav-link">
            <span>🤝</span>ወኪል
          </Link>
        )}
      </nav>
    </div>
  );
}
