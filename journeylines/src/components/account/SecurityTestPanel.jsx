import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/useAuth.js';
import { attemptDirectHopperRead, attemptDirectHopperUpdate, createSecurityTestHopper, deleteSecurityTestHopper, listSecurityTestHoppers } from '../../services/accountBootstrap.js';

export default function SecurityTestPanel({ open, account, onClose }) {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [targetId, setTargetId] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!account?.selectedMap?.id) return;
    setRecords(await listSecurityTestHoppers(account.selectedMap.id));
  }

  useEffect(() => {
    if (!open) return;
    refresh().catch(error => setResult(`Load failed: ${error.message}`));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.selectedMap?.id]);

  if (!open) return null;

  async function run(action) {
    setBusy(true);
    setResult('');
    try {
      const value = await action();
      setResult(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
      await refresh();
    } catch (error) {
      setResult(`Request rejected: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return <div className="security-test-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="security-test-panel glass" role="dialog" aria-modal="true" aria-label="Account separation test">
      <button className="auth-modal__close" type="button" onClick={onClose}>×</button>
      <p className="eyebrow">Development Security Tool</p>
      <h2>Account Separation Test</h2>
      <div className="security-test-grid">
        <span>Signed-in email</span><code>{user?.email || 'None'}</code>
        <span>User ID</span><code>{user?.id || 'None'}</code>
        <span>Profile ID</span><code>{account?.profile?.id || 'Not loaded'}</code>
        <span>Default map ID</span><code>{account?.selectedMap?.id || 'Not loaded'}</code>
      </div>
      <div className="security-test-actions">
        <button type="button" className="primary" disabled={busy || !account?.selectedMap} onClick={() => run(async () => { const record = await createSecurityTestHopper(account.selectedMap.id, user?.email || 'user'); return `Created ${record.id}`; })}>Create Test Hopper</button>
        <button type="button" disabled={busy} onClick={() => run(async () => { await refresh(); return 'Refreshed records visible to this account.'; })}>Refresh</button>
      </div>
      <div className="security-test-records">
        {records.length === 0 ? <p>No RLS test Hoppers are visible to this account.</p> : records.map(record => <div key={record.id}><code>{record.id}</code><span>{record.name}</span><button type="button" onClick={() => { navigator.clipboard?.writeText(record.id); setTargetId(record.id); }}>Use ID</button><button type="button" onClick={() => run(async () => { await deleteSecurityTestHopper(record.id); return `Deleted ${record.id}`; })}>Delete</button></div>)}
      </div>
      <label>Record ID from the other test account<input value={targetId} onChange={event => setTargetId(event.target.value.trim())} placeholder="Paste User A or User B Hopper UUID" /></label>
      <div className="security-test-actions">
        <button type="button" disabled={busy || !targetId} onClick={() => run(async () => { const row = await attemptDirectHopperRead(targetId); return row ? `Unexpectedly readable:\n${JSON.stringify(row, null, 2)}` : 'PASS: No record was returned. RLS hid the row.'; })}>Attempt Direct Read</button>
        <button type="button" disabled={busy || !targetId} onClick={() => run(async () => { const rows = await attemptDirectHopperUpdate(targetId); return rows.length ? `Unexpectedly updated:\n${JSON.stringify(rows, null, 2)}` : 'PASS: Zero rows were updated. RLS blocked the write.'; })}>Attempt Direct Update</button>
      </div>
      {result && <pre className="security-test-result">{result}</pre>}
      <p className="security-test-note">This panel uses the normal publishable key and the current browser session. The Supabase dashboard can still display all rows because it has administrative access.</p>
    </section>
  </div>;
}
