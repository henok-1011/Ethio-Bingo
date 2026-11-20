import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { callLabel } from '../bingo.js';
import { etb, seconds } from '../format.js';
import { useToast } from '../components/Toast.jsx';

const CARD_COLUMNS = ['B', 'I', 'N', 'G', 'O'];

function toForm(settings) {
  return {
    stake: Number(settings.stake) / 100,
    botCount: Number(settings.botCount),
    botAuto: settings.botAuto !== '0',
    waitSeconds: Number(settings.waitSeconds),
    callIntervalMs: Number(settings.callIntervalMs),
    roundEndDelayMs: Number(settings.roundEndDelayMs),
    platformFeeRate: Number(settings.platformFeeRate) * 100,
    autoStart: settings.autoStart !== '0',
    voiceEnabled: settings.voiceEnabled !== '0',
    minWithdraw: Number(settings.minWithdraw) / 100,
    maxAutoVerify: Number(settings.maxAutoVerify) / 100,
    agentMinWithdraw: Number(settings.agentMinWithdraw) / 100,
  };
}

function toPayload(form) {
  return {
    ...form,
    platformFeeRate: Number(form.platformFeeRate) / 100,
  };
}

export default function GameControl({ token }) {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [game, setGame] = useState(null);
  const [broadcast, setBroadcast] = useState('');
  const [broadcastImage, setBroadcastImage] = useState('');
  const [broadcastResult, setBroadcastResult] = useState(null);
  const [editingBroadcast, setEditingBroadcast] = useState(false);
  const [winnerType, setWinnerType] = useState('none');
  const [winnerUserId, setWinnerUserId] = useState('');
  const [botName, setBotName] = useState('Lucky Bot');
  const [userSearch, setUserSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function loadSettings() {
    try {
      const data = await api('/api/admin/settings', { token });
      setSettings(data);
      setForm(toForm(data));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  useEffect(() => {
    loadSettings();
    const loadGame = () =>
      api('/api/admin/game/state', { token })
        .then(setGame)
        .catch(() => {});
    loadGame();
    const interval = setInterval(loadGame, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!userSearch.trim()) {
      setUsers([]);
      return;
    }
    const timer = setTimeout(() => {
      api(`/api/admin/users?search=${encodeURIComponent(userSearch)}`, { token })
        .then((rows) => setUsers(rows.slice(0, 20)))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSearch, token]);

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setBotAuto = (event) => {
    const botAuto = event.target.checked;
    setForm((prev) => ({
      ...prev,
      botAuto,
      // Auto mode has a hard ceiling of 50; manual mode keeps the exact value.
      botCount: botAuto ? Math.min(50, Math.max(0, Number(prev.botCount) || 0)) : prev.botCount,
    }));
  };

  async function saveSettings(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await api('/api/admin/settings', {
        token,
        method: 'PUT',
        body: toPayload(form),
      });
      setSettings(updated);
      setForm(toForm(updated));
      toast('Settings saved.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function applyWinner(event) {
    event.preventDefault();
    try {
      const body = { type: winnerType };
      if (winnerType === 'user') {
        if (!winnerUserId) throw new Error('Choose a player first.');
        body.userId = Number(winnerUserId);
      }
      if (winnerType === 'bot') body.name = botName;
      const result = await api('/api/admin/game/next-winner', { token, method: 'POST', body });
      const where = result.scope === 'next'
        ? 'the next round'
        : result.scope === 'waiting'
          ? 'the current waiting round'
          : 'the current calling round';
      toast(
        result.nextWinner
          ? `Winner override set for ${where}: ${result.nextWinner.name || result.nextWinner.type}.`
          : 'Winner override cleared.',
      );
      await loadSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function clearWinner() {
    try {
      await api('/api/admin/game/next-winner', { token, method: 'POST', body: { type: 'none' } });
      toast('Winner override cleared.');
      await loadSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function startBroadcastEdit() {
    setBroadcast(settings?.announcementText || '');
    setBroadcastImage(settings?.announcementImage || '');
    setEditingBroadcast(true);
    setBroadcastResult(null);
  }

  function cancelBroadcastEdit() {
    setEditingBroadcast(false);
    setBroadcast('');
    setBroadcastImage('');
    setBroadcastResult(null);
  }

  async function deleteBroadcast() {
    if (!window.confirm('Delete the active in-app ad? Telegram messages that were already sent cannot be recalled.')) return;
    try {
      await api('/api/admin/broadcast', { token, method: 'DELETE' });
      setSettings((prev) => prev
        ? { ...prev, announcementText: '', announcementImage: '', announcementAt: '' }
        : prev);
      setEditingBroadcast(false);
      setBroadcast('');
      setBroadcastImage('');
      setBroadcastResult({ deleted: true });
      toast('Active ad deleted.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function sendBroadcast(event) {
    event.preventDefault();
    const editing = editingBroadcast;
    try {
      const result = await api('/api/admin/broadcast', {
        token,
        method: editing ? 'PUT' : 'POST',
        body: { text: broadcast, imageUrl: broadcastImage || undefined },
      });
      setSettings((prev) => prev
        ? {
            ...prev,
            announcementText: result.announcement?.text || '',
            announcementImage: result.announcement?.imageUrl || '',
            announcementAt: result.announcement?.at || '',
          }
        : prev);
      setBroadcastResult(result);
      setBroadcast('');
      setBroadcastImage('');
      setEditingBroadcast(false);
      toast(
        editing
          ? 'Active ad updated.'
          : result.simulated
            ? 'Broadcast simulated (no bot token configured).'
            : `Sent to ${result.sent} users.`,
      );
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function startNow() {
    try {
      await api('/api/admin/game/start', { token, method: 'POST' });
      toast('Round started.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (!form) return <div className="panel">Loading settings…</div>;

  const queuedOverride = (() => {
    try {
      return settings?.nextWinner && settings.nextWinner !== 'none' ? JSON.parse(settings.nextWinner) : null;
    } catch {
      return null;
    }
  })();
  const override = game?.forcedWinner || queuedOverride;
  const overrideIsLive = Boolean(game?.forcedWinner);

  const calledSet = new Set(game?.calledNumbers || []);
  const upcoming = game?.upcomingNumbers || [];
  const upcomingPreview = upcoming.slice(0, 12);
  const upcomingSet = new Set(upcomingPreview);

  return (
    <div className="game-control">
      <section className="panel">
        <div className="section-title">
          <h3>Live round</h3>
          <div className="head-actions">
            <button type="button" className="btn ghost small" onClick={startNow}>
              Start round now
            </button>
          </div>
        </div>
        {game ? (
          <>
            <div className="mini-grid">
              <div>
                <span className="muted small">Status</span>
                <strong className={`status-dot ${game.status?.toLowerCase()}`}>{game.status}</strong>
              </div>
              <div>
                <span className="muted small">Round</span>
                <strong>#{game.id}</strong>
              </div>
              <div>
                <span className="muted small">Players</span>
                <strong>
                  {game.playersCount} cards · {game.realCount} real
                </strong>
              </div>
              <div>
                <span className="muted small">Numbers called</span>
                <strong>{game.calledNumbers?.length || 0} / 75</strong>
              </div>
              <div>
                <span className="muted small">Prize pool</span>
                <strong>{etb(game.prizePool)} ETB</strong>
              </div>
              <div>
                <span className="muted small">Last call</span>
                <strong>{game.lastCalled || '—'}</strong>
              </div>
              <div>
                <span className="muted small">Timer</span>
                <strong>
                  {game.status === 'WAITING'
                    ? `${seconds(game.startsInMs)}s to start`
                    : game.status === 'CALLING'
                      ? `${seconds(game.nextCallInMs)}s to next call`
                      : `${seconds(game.nextRoundInMs)}s to next round`}
                </strong>
              </div>
              <div>
                <span className="muted small">Forced winner</span>
                <strong>
                  {game.forcedWinner
                    ? `${game.forcedWinner.name} (${game.forcedWinner.type})`
                    : 'none — RNG decides'}
                </strong>
              </div>
            </div>
            <div className="real-players">
              {game.realPlayers?.length ? (
                game.realPlayers.map((player) => (
                  <span key={player.id} className={`player-chip ${player.bingo ? 'bingo' : ''}`}>
                    {player.name}
                    {player.bingo ? ' • BINGO' : ''}
                  </span>
                ))
              ) : (
                <span className="muted small">No real players in this round.</span>
              )}
            </div>

            <div className="upcoming-calls">
              <div className="section-title">
                <h4>Upcoming calls</h4>
                <span className="muted small">Admin only · next call first</span>
              </div>
              <div className="upcoming-call-list">
                {upcomingPreview.length ? (
                  upcomingPreview.map((number, index) => (
                    <span key={number} className={`upcoming-call ${index === 0 ? 'next' : ''}`}>
                      {callLabel(number)}
                    </span>
                  ))
                ) : (
                  <span className="muted small">Deck finished</span>
                )}
              </div>
            </div>

            {game.realPlayers?.length ? (
              <div className="admin-player-cards">
                <div className="section-title">
                  <h4>Player cards</h4>
                  <span className="muted small">Called = gold · next calls = blue</span>
                </div>
                {game.realPlayers.map((player) => (
                  <details className="admin-player-card" key={player.id}>
                    <summary>
                      {player.name} · {player.cardCount || 0} card(s)
                      {player.bingo ? ' · BINGO' : ''}
                    </summary>
                    <div className="admin-card-list">
                      {(player.cards || []).map((card, cardIndex) => (
                        <div className="admin-card" key={`${player.id}-${cardIndex}`}>
                          <div className="admin-card-head">
                            {CARD_COLUMNS.map((letter) => (
                              <span key={letter}>{letter}</span>
                            ))}
                          </div>
                          {Array.from({ length: 5 }, (_, row) => (
                            <div className="admin-card-row" key={row}>
                              {CARD_COLUMNS.map((_, col) => {
                                const number = card[col]?.[row];
                                const marked = number === 0 || calledSet.has(number);
                                const coming = number !== 0 && upcomingSet.has(number);
                                return (
                                  <span
                                    key={col}
                                    className={`admin-card-cell ${marked ? 'called' : ''} ${coming ? 'coming' : ''} ${number === 0 ? 'free' : ''}`}
                                  >
                                    {number === 0 ? 'F' : number}
                                  </span>
                                );
                              })}
                            </div>
                          ))}
                          <div className="admin-card-foot">
                            Card #{player.numbers?.[cardIndex] ?? cardIndex + 1}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">No active round.</p>
        )}
      </section>

      <div className="two-col">
        <section className="panel">
          <div className="section-title">
            <h3>Game settings</h3>
            <span className="badge gold">Applies to next round</span>
          </div>
          <form className="settings-form" onSubmit={saveSettings}>
            <div className="field-row">
              <label className="field">
                <span>Stake (ETB)</span>
                <input type="number" min="1" value={form.stake} onChange={set('stake')} />
              </label>
              <label className="field">
                <span>{form.botAuto ? 'Auto table baseline (0 = no bots)' : 'Exact bot count (manual)'}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  max={form.botAuto ? 50 : undefined}
                  value={form.botCount}
                  onChange={set('botCount')}
                />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={form.botAuto} onChange={setBotAuto} />
              Auto-adjust bot count (maximum 50)
            </label>
            <p className="fine-print">
              {form.botAuto
                ? 'Auto mode varies the baseline each round and keeps the table at or below 50 bots.'
                : 'Manual mode adds exactly the number entered, with no 50-bot cap. Real players join in addition to the bots.'}
            </p>
            <div className="field-row">
              <label className="field">
                <span>Waiting time (seconds)</span>
                <input type="number" min="5" value={form.waitSeconds} onChange={set('waitSeconds')} />
              </label>
              <label className="field">
                <span>Call interval (ms)</span>
                <input type="number" min="1000" step="500" value={form.callIntervalMs} onChange={set('callIntervalMs')} />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Round end delay (ms)</span>
                <input
                  type="number"
                  min="2000"
                  step="1000"
                  value={form.roundEndDelayMs}
                  onChange={set('roundEndDelayMs')}
                />
              </label>
              <label className="field">
                <span>Platform fee (%)</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  step="1"
                  value={form.platformFeeRate}
                  onChange={set('platformFeeRate')}
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Min player withdrawal (ETB)</span>
                <input type="number" min="1" value={form.minWithdraw} onChange={set('minWithdraw')} />
              </label>
              <label className="field">
                <span>Auto-verify up to (ETB)</span>
                <input type="number" min="1" value={form.maxAutoVerify} onChange={set('maxAutoVerify')} />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={form.autoStart} onChange={set('autoStart')} />
              Auto-start rounds continuously
            </label>
            <label className="check">
              <input type="checkbox" checked={form.voiceEnabled} onChange={set('voiceEnabled')} />
              Voice announcements enabled globally
            </label>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save game settings'}
            </button>
            <p className="fine-print">
              {form.botAuto
                ? 'Table size changes every round. Real cards replace bots one-for-one while players are buying.'
                : 'Manual table size is fixed for the round; buying a card does not remove a bot.'}
            </p>
          </form>
        </section>

        <section className="panel">
          <div className="section-title">
            <h3>Agent commission settings</h3>
          </div>
          <form className="settings-form" onSubmit={saveSettings}>
            <div className="notice">
              Fixed commission: <strong>0.50 ETB</strong> for every successful card purchase by a referred player.
              No deposit, activity, or gameplay commission is paid. Deselecting or refunding a card reverses its
              0.50 ETB commission.
            </div>
            <label className="field">
              <span>Min agent withdrawal (ETB)</span>
              <input type="number" min="1" value={form.agentMinWithdraw} onChange={set('agentMinWithdraw')} />
            </label>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save commission settings'}
            </button>
          </form>
        </section>
      </div>

      <div className="two-col">
        <section className="panel">
          <div className="section-title">
            <h3>Next winner override</h3>
            <span className="badge danger">Audited</span>
          </div>
          <p className="muted small">
            Applies to the current waiting round. If the round is already calling, the player must already hold a card
            in it; otherwise the override waits for the next round. Bots are held back while a human winner is forced.
            Every override is written to the audit log.
          </p>
          <div className="current-override">
            Current: <strong>{override ? `${override.name} (${override.type})` : 'none'}</strong>
            {override && (
              <>
                <span className="muted small">
                  {overrideIsLive ? ' · current round' : ' · queued for the next available round'}
                </span>
                <button type="button" className="link-btn" onClick={clearWinner}>
                  clear
                </button>
              </>
            )}
          </div>
          <form className="winner-form" onSubmit={applyWinner}>
            <label className="field">
              <span>Winner type</span>
              <select
                value={winnerType}
                onChange={(event) => {
                  setWinnerType(event.target.value);
                  setWinnerUserId('');
                }}
              >
                <option value="none">No override</option>
                <option value="user">Specific player</option>
                <option value="bot">A bot</option>
              </select>
            </label>
            {winnerType === 'user' && (
              <>
                <label className="field">
                  <span>Find player</span>
                  <input
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Telegram ID, username or name"
                  />
                </label>
                <label className="field">
                  <span>Player</span>
                  <select value={winnerUserId} onChange={(event) => setWinnerUserId(event.target.value)}>
                    <option value="">Select a player…</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.firstName || user.username} (@{user.username || user.telegramId}) · {etb(user.balance)} ETB
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {winnerType === 'bot' && (
              <label className="field">
                <span>Bot display name</span>
                <input value={botName} onChange={(event) => setBotName(event.target.value)} maxLength={40} />
              </label>
            )}
            <button type="submit" className="btn primary" disabled={winnerType === 'none'}>
              Set next winner
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="section-title">
            <h3>Broadcast ads</h3>
            <span className="badge">Telegram bot</span>
          </div>
          {settings?.announcementText ? (
            <div className="active-broadcast">
              <div className="active-broadcast-head">
                <strong>Active in-app ad</strong>
                {settings.announcementAt ? (
                  <span>{new Date(settings.announcementAt).toLocaleString()}</span>
                ) : null}
              </div>
              {settings.announcementImage ? (
                <img className="broadcast-preview" src={settings.announcementImage} alt="Active ad preview" />
              ) : null}
              <p>{settings.announcementText}</p>
              <div className="active-broadcast-actions">
                <button type="button" className="btn small" onClick={startBroadcastEdit}>
                  Edit
                </button>
                <button type="button" className="btn small danger" onClick={deleteBroadcast}>
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <p className="fine-print">No active in-app ad.</p>
          )}
          <form onSubmit={sendBroadcast}>
            <textarea
              rows={4}
              value={broadcast}
              onChange={(event) => setBroadcast(event.target.value)}
              placeholder="Write an announcement or promo for all players…"
            />
            <label className="field">
              <span>Image URL (optional)</span>
              <input
                value={broadcastImage}
                onChange={(event) => setBroadcastImage(event.target.value)}
                placeholder="https://…/banner.jpg"
              />
            </label>
            {broadcastImage ? (
              <img className="broadcast-preview" src={broadcastImage} alt="Broadcast preview" />
            ) : null}
            <div className="broadcast-actions">
              <button type="submit" className="btn primary" disabled={!broadcast.trim()}>
                {editingBroadcast ? 'Save changes' : 'Send broadcast'}
              </button>
              {editingBroadcast ? (
                <button type="button" className="btn ghost" onClick={cancelBroadcastEdit}>
                  Cancel
                </button>
              ) : null}
            </div>
            {editingBroadcast ? (
              <p className="fine-print">
                This updates the in-app ad only. Telegram messages already sent are not changed.
              </p>
            ) : null}
            {broadcastResult && (
              <p className="fine-print">
                {broadcastResult.deleted
                  ? 'Active in-app ad deleted. Telegram messages already sent cannot be recalled.'
                  : broadcastResult.edited
                    ? 'Active in-app ad updated. Telegram messages already sent were not changed.'
                    : broadcastResult.simulated
                      ? `Simulated Broadcast — ${broadcastResult.total} users would receive it. Set TELEGRAM_BOT_TOKEN to send for real.`
                      : `Delivered: ${broadcastResult.sent} · Failed: ${broadcastResult.failed} · Total: ${broadcastResult.total}`}
              </p>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}
