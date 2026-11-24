import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { etb } from '../format.js';
import { BarChart, LineChart, PieChart } from '../components/Charts.jsx';

const money = (santim) =>
  `${Number(etb(santim)).toLocaleString('en-US', { maximumFractionDigits: 2 })} ETB`;

function Stat({ label, value, hint, tone = '' }) {
  return (
    <div className={`stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export default function Overview({ token, onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setData(await api('/api/admin/overview', { token }));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!data) return <div className="panel">{error ? <div className="form-error">{error}</div> : 'Loading analytics…'}</div>;

  const t = data.totals;
  const r = data.reconciliation;
  const pie = data.pie.map((item) => ({
    label: item.label.charAt(0).toUpperCase() + item.label.slice(1),
    value: item.value,
  }));

  return (
    <div className="overview">
      {error && <div className="form-error">{error}</div>}

      <div className="stat-grid">
        <Stat label="Total deposits" value={money(t.deposits)} hint="Verified player deposits" tone="gold" />
        <Stat label="Total withdrawals" value={money(t.withdrawals)} hint="Approved payouts" />
        <Stat
          label="Platform revenue"
          value={money(t.platformFees)}
          hint="Fees net of bot-funded prize top-ups, plus stakes kept when no real winner"
          tone="green"
        />
        <Stat label="Agent commissions" value={money(t.agentCommissions)} hint="0.50 ETB per referred card purchase" />
        <Stat label="Agent payouts" value={money(t.agentPayouts)} hint="Commissions, bonuses and adjustments" />
        <Stat label="Net revenue" value={money(t.netRevenue)} hint="Revenue − agent payouts" tone="green" />
        <Stat label="Prize payouts" value={money(t.winPayouts)} hint="Paid to players" />
        <Stat label="Players" value={t.players.toLocaleString()} hint={`+${t.newUsersWeek} this week`} />
        <Stat
          label="Missing phone numbers"
          value={t.missingPhones.toLocaleString()}
          hint="Players who have not registered a phone"
        />
        <Stat label="Active players" value={`${data.active.daily} / ${data.active.weekly} / ${data.active.monthly}`} hint="Daily / weekly / monthly" />
        <Stat label="Rounds played" value={data.gameStats.rounds.toLocaleString()} hint={`Avg stake ${etb(data.gameStats.avgStake)} ETB`} />
        <Stat label="Biggest win" value={money(data.gameStats.biggestWin)} hint={`Avg players/round ${data.gameStats.avgPlayers.toFixed(1)}`} />
        <Stat label="GMV (stakes)" value={money(t.gmv)} hint="All-time stakes" />
        <Stat label="Avg prize pool" value={money(data.gameStats.avgPrize)} hint="Per finished round" />
      </div>

      <section className="panel recon-panel">
        <div className="section-title">
          <h3>Cash &amp; reconciliation</h3>
          <span className="muted small">All time · verified deposits vs approved withdrawals</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Verified deposits</th>
                <th>Player withdrawals</th>
                <th>Agent withdrawals</th>
                <th>Cash position</th>
              </tr>
            </thead>
            <tbody>
              {r.channels.map((channel) => (
                <tr key={channel.id}>
                  <td>
                    <strong>{channel.label}</strong>
                  </td>
                  <td>{money(channel.deposits)}</td>
                  <td>{money(channel.playerWithdrawals)}</td>
                  <td>{money(channel.agentWithdrawals)}</td>
                  <td>
                    <strong>{money(channel.balance)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  <strong>Total cash on hand</strong>
                </td>
                <td>
                  <strong>{money(r.totals.deposits)}</strong>
                </td>
                <td>
                  <strong>{money(r.totals.playerWithdrawals)}</strong>
                </td>
                <td>
                  <strong>{money(r.totals.agentWithdrawals)}</strong>
                </td>
                <td>
                  <strong>{money(r.totals.balance)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="stat-grid recon-summary">
          <Stat
            label="Owed to players"
            value={money(r.liabilities.playerBalances)}
            hint="Wallet balances not yet withdrawn"
          />
          <Stat
            label="Owed to agents"
            value={money(r.liabilities.agentBalances)}
            hint="Commission balances not yet withdrawn"
          />
          <Stat
            label="Pending withdrawals"
            value={money(r.liabilities.pendingPlayerWithdrawals + r.liabilities.pendingAgentWithdrawals)}
            hint="Reserved from balances, not paid yet"
          />
          <Stat
            label="Net after liabilities"
            value={money(r.net)}
            hint="Cash on hand − player, agent and pending balances"
            tone={r.net < 0 ? 'gold' : 'green'}
          />
        </div>

        <p className="muted small recon-note">
          Per-channel figures are best-effort: deposits without a verified Telebirr/CBE provider and
          withdrawals to other banks are grouped as unassigned, so the total still matches money in
          minus money out. Pending withdrawals have already been deducted from player and agent
          balances.
        </p>
      </section>

      <div className="pending-row-cards">
        <button type="button" className="pending-card" onClick={() => onNavigate('withdrawals')}>
          <span>Pending player withdrawals</span>
          <strong>{data.pending.withdrawals}</strong>
        </button>
        <button type="button" className="pending-card" onClick={() => onNavigate('withdrawals')}>
          <span>Pending agent withdrawals</span>
          <strong>{data.pending.agentWithdrawals}</strong>
        </button>
        <button type="button" className="pending-card" onClick={() => onNavigate('withdrawals')}>
          <span>Deposits needing review</span>
          <strong>{data.pending.deposits}</strong>
        </button>
      </div>

      <div className="chart-grid">
        <section className="panel wide">
          <div className="section-title">
            <h3>Deposits vs withdrawals</h3>
            <span className="muted small">Last 14 days (ETB)</span>
          </div>
          <LineChart
            data={data.series}
            series={[
              { key: 'deposits', label: 'Deposits', color: '#f5c542' },
              { key: 'withdrawals', label: 'Withdrawals', color: '#60a5fa' },
              { key: 'winPayouts', label: 'Win payouts', color: '#4ade80' },
            ]}
          />
        </section>

        <section className="panel">
          <div className="section-title">
            <h3>Rounds per day</h3>
            <span className="muted small">Last 14 days</span>
          </div>
          <BarChart data={data.series} valueKey="rounds" />
        </section>

        <section className="panel">
          <div className="section-title">
            <h3>Money flow</h3>
            <span className="muted small">Completed transactions · last 14 days</span>
          </div>
          <PieChart data={pie} />
        </section>
      </div>

      <p className="muted small">
        All amounts are in ETB. Net revenue deducts agent payouts from platform revenue.
      </p>
    </div>
  );
}
