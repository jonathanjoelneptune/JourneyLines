import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/useAuth.js';

export default function AccountControl({ profile, bootstrapState, onSignIn, onOpenSecurityTest, securityTestEnabled = false }) {
  const { user, loading, signOut, configured } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  if (loading) return <div className="account-control"><button className="topbar-pill account-button" disabled>Checking account…</button></div>;
  if (!configured) return <div className="account-control"><button className="topbar-pill account-button" onClick={onSignIn}>Configure Login</button></div>;
  if (!user) return <div className="account-control"><button className="topbar-pill account-button" onClick={onSignIn}>Sign In</button></div>;

  const displayName = profile?.display_name || user.user_metadata?.display_name || user.email?.split('@')[0] || 'Account';
  return <div className="account-control" ref={rootRef}>
    <button className="topbar-pill account-button" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      <span className="account-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
      <span className="account-name">{displayName}</span>
      <span aria-hidden="true">▾</span>
    </button>
    {open && <div className="account-menu glass">
      <div className="account-menu__identity"><strong>{displayName}</strong><small>{user.email}</small></div>
      {securityTestEnabled && <button type="button" onClick={() => { setOpen(false); onOpenSecurityTest(); }}>Security Test</button>}
      <button type="button" onClick={async () => { setOpen(false); await signOut(); }}>Sign Out</button>
      {bootstrapState === 'error' && <small className="account-menu__warning">Account data did not finish loading.</small>}
    </div>}
  </div>;
}
