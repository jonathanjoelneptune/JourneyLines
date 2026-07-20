import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/useAuth.js';

const MIN_PASSWORD_LENGTH = 8;

export default function AuthModal({ open, initialMode = 'signin', onClose }) {
  const auth = useAuth();
  const [mode, setMode] = useState(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setMessage('');
    setError('');
  }, [open, initialMode]);

  useEffect(() => {
    if (auth.authEvent === 'PASSWORD_RECOVERY') setMode('update-password');
  }, [auth.authEvent]);

  const title = useMemo(() => ({
    signin: 'Welcome back',
    signup: 'Create your GlobeHoppers account',
    reset: 'Reset your password',
    'update-password': 'Choose a new password'
  }[mode]), [mode]);

  if (!open) return null;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'signin') {
        const { error: authError } = await auth.signIn({ email, password });
        if (authError) throw authError;
        onClose();
      } else if (mode === 'signup') {
        if (!displayName.trim()) throw new Error('Enter the name you want GlobeHoppers to display.');
        if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
        if (password !== confirmPassword) throw new Error('The passwords do not match.');
        const { data, error: authError } = await auth.signUp({ displayName, email, password });
        if (authError) throw authError;
        if (data?.session) onClose();
        else setMessage('Check your email to confirm the account, then return here to sign in.');
      } else if (mode === 'reset') {
        const { error: authError } = await auth.requestPasswordReset(email);
        if (authError) throw authError;
        setMessage('Password reset instructions have been sent if that address belongs to an account.');
      } else if (mode === 'update-password') {
        if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
        if (password !== confirmPassword) throw new Error('The passwords do not match.');
        const { error: authError } = await auth.updatePassword(password);
        if (authError) throw authError;
        setMessage('Your password has been updated.');
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      }
    } catch (submitError) {
      setError(submitError?.message || 'The authentication request could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="auth-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="auth-modal glass" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button type="button" className="auth-modal__close" onClick={onClose} aria-label="Close sign-in window">×</button>
      <p className="eyebrow">GlobeHoppers Account</p>
      <h2 id="auth-title">{title}</h2>
      <p className="auth-modal__intro">Your public globe remains available while signed out. Sign in to test and later save private account data.</p>
      {!auth.configured && <div className="auth-message auth-message--error">Supabase environment variables are missing. See <code>.env.example</code>.</div>}
      <form onSubmit={submit}>
        {mode === 'signup' && <label>Display name<input autoComplete="name" value={displayName} onChange={event => setDisplayName(event.target.value)} required /></label>}
        {mode !== 'update-password' && <label>Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>}
        {mode !== 'reset' && <label>{mode === 'update-password' ? 'New password' : 'Password'}<input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} required /></label>}
        {(mode === 'signup' || mode === 'update-password') && <label>Confirm password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required /></label>}
        {error && <div className="auth-message auth-message--error">{error}</div>}
        {message && <div className="auth-message auth-message--success">{message}</div>}
        <button className="primary auth-submit" type="submit" disabled={busy || !auth.configured}>{busy ? 'Working…' : ({ signin: 'Sign In', signup: 'Create Account', reset: 'Send Reset Link', 'update-password': 'Update Password' }[mode])}</button>
      </form>
      <div className="auth-modal__links">
        {mode === 'signin' && <><button type="button" onClick={() => setMode('reset')}>Forgot password?</button><button type="button" onClick={() => setMode('signup')}>Create account</button></>}
        {mode === 'signup' && <button type="button" onClick={() => setMode('signin')}>Already have an account?</button>}
        {mode === 'reset' && <button type="button" onClick={() => setMode('signin')}>Return to sign in</button>}
        {mode === 'update-password' && <button type="button" onClick={() => { setMode('signin'); onClose(); }}>Close</button>}
      </div>
    </section>
  </div>;
}
