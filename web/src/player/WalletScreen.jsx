import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { dt, etb, txLabel, txSign } from '../format.js';
import { useToast } from '../components/Toast.jsx';

const TELEBIRR_STEPS = [
  '1የ Telebirr አካውንት',
  '2ከላይ ባለው የ Telebirr አካውንት ገንዘቡን ያስገቡ',
  '3ገንዘቡን ከላካችሁ በኋላ Telebirr የክፍያ ማረጋገጫ (receipt) ሊንክ ይደርሳችኋል',
  '4የደረሳችሁን የክፍያ ማረጋገጫ (receipt) ሊንክ ሙሉውን ኮፒ(copy) በማድረግ ከታች ባለው Verify Your Payment ማስገቢያ ላይ ፔስት(paste) በማድረግ Verify & add funds ይጫኑ',
];

const CBE_STEPS = [
  '1የ CBE አካውንት',
  '2ከላይ ባለው የ CBE አካውንት ገንዘቡን ያስገቡ',
  '3ገንዘቡን ከላካችሁ በኋላ CBE የክፍያ ማረጋገጫ (receipt) ሊንክ ይደርሳችኋል',
  '4የደረሳችሁን የክፍያ ማረጋገጫ (receipt) ሊንክ ሙሉውን ኮፒ(copy) በማድረግ ከታች ባለው Verify Your Payment ማስገቢያ ላይ ፔስት(paste) በማድረግ Verify & add funds ይጫኑ',
];

export default function WalletScreen({ me, token, refreshMe }) {
  const [method, setMethod] = useState(() => {
    const configured = me?.config?.depositAccounts;
    return configured?.telebirr ? 'telebirr' : configured?.cbe ? 'cbe' : 'telebirr';
  });
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const accounts = me?.config?.depositAccounts || {};
  const methods = [
    {
      id: 'telebirr',
      label: 'Telebirr',
      logo: 'T',
      tag: 'Better Transaction Fee',
      account: accounts.telebirr,
      steps: TELEBIRR_STEPS,
      placeholder: 'https://transactioninfo.ethiotelecom.et/receipt/…',
      receiptNote: 'Telebirr transaction numbers are also accepted.',
    },
    {
      id: 'cbe',
      label: 'CBE',
      logo: 'CBE',
      tag: 'Commercial Bank of Ethiopia',
      account: accounts.cbe,
      steps: CBE_STEPS,
      placeholder: 'https://mbreciept.cbe.com.et/…',
      receiptNote: 'CBE app receipt links are accepted; PDF receipts go to manual review.',
    },
  ];
  const active = methods.find((item) => item.id === method) || methods[0];
  const activeAccount = active.account;
  const copyAccount = useCallback(async () => {
    if (!activeAccount?.account) return;
    try {
      await navigator.clipboard.writeText(activeAccount.account);
      toast(active.label + ' account number copied.', 'info');
    } catch {
      toast('Could not copy the number — select it manually.', 'error');
    }
  }, [activeAccount?.account, active.label, toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tx, dep] = await Promise.all([
        api('/api/wallet/transactions', { token }),
        api('/api/wallet/deposits', { token }),
      ]);
      setTransactions(tx);
      setDeposits(dep);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function verify(event) {
    event.preventDefault();
    const value = link.trim();
    if (!value) {
      toast('Paste the transaction link from your receipt.', 'error');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await api('/api/wallet/deposit/verify-link', {
        token,
        method: 'POST',
        body: { link: value },
      });
      setMessage(result);
      if (result.status === 'verified') {
        toast(`${etb(result.amount)} ETB added to your balance.`);
        setLink('');
        await refreshMe();
        await load();
      } else {
        toast('Payment sent for manual review.', 'info');
        await load();
      }
    } catch (err) {
      toast(err.message, 'error');
      setMessage({ status: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  const steps = active.steps;

  const hasHistory = transactions.length > 0;

  return (
    <div className="wallet-screen">
      <section className="balance-hero">
        <p className="eyebrow">Available Balance</p>
        <div className="balance-value">
          {etb(me?.user?.balance)} <span>ETB</span>
        </div>
        <div className="balance-sub">
          <span>Ethio Bingo player account</span>
        </div>
        {Number(me?.user?.bonusBalance) > 0 && (
          <div className="balance-sub bonus-note">
            <span>
              Play-only bonus: {etb(me.user.bonusBalance)} ETB · can buy cards, cannot be withdrawn
            </span>
          </div>
        )}
        {me?.pendingDeposits > 0 && (
          <div className="notice">You have {me.pendingDeposits} deposit(s) waiting for manual review.</div>
        )}
      </section>

      <section className="panel" id="deposit">
        <div className="section-title">
          <h3>Deposit</h3>
          <span className="badge">Instant Verification</span>
        </div>

        <div className="method-cards">
          {methods.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`method-card ${method === item.id ? 'active' : ''}`}
              onClick={() => setMethod(item.id)}
            >
              <span className={`method-logo ${item.id}`}>{item.logo}</span>
              <span className="method-name">{item.label}</span>
              <span className="method-tag">{item.tag}</span>
            </button>
          ))}
        </div>

        <div className="instructions">
          <div className="instructions-head">
            <h4>{active.label} Payment Instructions</h4>
          </div>
          <div className="pay-to">
            <div>
              <span className="pay-to-label">Send to ({active.label})</span>
              <strong className="pay-to-account">{activeAccount ? activeAccount.account : 'Not configured'}</strong>
              {activeAccount?.name ? <span className="pay-to-name">{activeAccount.name}</span> : null}
            </div>
            {activeAccount ? (
              <button type="button" className="copy-btn" onClick={copyAccount}>
                Copy number
              </button>
            ) : null}
          </div>
          {steps.map((step) => (
            <p key={step} className="amharic-step">
              {step}
            </p>
          ))}
        </div>

        <form className="verify-card" onSubmit={verify}>
          <div className="section-title">
            <h4>Verify Your Payment</h4>
            <span className="badge gold">Receipt Link</span>
          </div>
          <p className="muted small">
            Paste the receipt link from your {active.label} SMS or app. We open the official receipt and credit the
            amount paid to the platform account.
          </p>
          <textarea
            value={link}
            onChange={(event) => setLink(event.target.value)}
            rows={3}
            placeholder={active.placeholder}
            spellCheck={false}
          />
          <div className="examples">
            <span>Examples:</span>
            <code>{active.placeholder}</code>
            <span className="muted">{active.receiptNote}</span>
          </div>
          <p className="fine-print">
            Verifies official {active.label} receipts against the platform account. If the amount is above the
            auto-verify limit, an admin reviews it.
          </p>
          <button type="submit" className="btn primary big" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify & add funds'}
          </button>
          {message && (
            <div className={`verify-result ${message.status}`}>
              {message.message}
              {message.txRef ? <span className="txref">Ref: {message.txRef}</span> : null}
            </div>
          )}
        </form>

        {deposits.filter((d) => d.status === 'PENDING_REVIEW').length > 0 && (
          <div className="pending-deposits">
            <h4>Pending review</h4>
            {deposits
              .filter((d) => d.status === 'PENDING_REVIEW')
              .map((d) => (
                <div className="pending-row" key={d.id}>
                  <span>{d.txRef}</span>
                  <span>{d.amount ? `${etb(d.amount)} ETB` : 'amount pending'}</span>
                  <span className="status-dot pending">PENDING</span>
                </div>
              ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-title">
          <h3>History</h3>
          <button type="button" className="link-btn" onClick={load}>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="skeleton-list">
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : hasHistory ? (
          <div className="tx-list">
            {transactions.map((tx) => (
              <div className="tx-row" key={tx.id}>
                <span className={`tx-icon ${tx.type}`}>
                  {tx.type === 'deposit' ? '↓' : tx.type === 'withdrawal' ? '↑' : tx.type === 'win' ? '🏆' : tx.type === 'bonus' ? '🎁' : tx.type === 'stake' ? '🎱' : '•'}
                </span>
                <div className="tx-main">
                  <strong>{txLabel[tx.type] || tx.type}</strong>
                  <span className="muted small">
                    {dt(tx.createdAt)} {tx.reference ? `· ${tx.reference}` : ''}
                  </span>
                </div>
                <div className="tx-amount">
                  <strong className={txSign(tx) === '+' ? 'positive' : 'negative'}>
                    {txSign(tx)}
                    {etb(Math.abs(tx.amount))} ETB
                  </strong>
                  <span className={`status-dot ${tx.status}`}>{tx.status}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">🧾</div>
            <h4>No Transactions Yet</h4>
            <p>Your transaction history will appear here</p>
            <a className="btn primary" href="#deposit">
              Make Your First Deposit
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
