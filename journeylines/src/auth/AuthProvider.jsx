import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

export const AuthContext = createContext(null);

function friendlyAuthError(error, fallback) {
  const message = String(error?.message || '').trim();
  if (!message) return fallback;
  if (/invalid login credentials/i.test(message)) return 'The email address or password was not accepted.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email address before signing in.';
  if (/user already registered/i.test(message)) return 'An account already exists for this email address.';
  return message;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [authEvent, setAuthEvent] = useState(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) console.error('Unable to restore Supabase session.', error);
      setSession(data?.session || null);
      setUser(data?.session?.user || null);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setAuthEvent(event);
      setSession(nextSession || null);
      setUser(nextSession?.user || null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription?.subscription?.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async ({ email, password }) => {
    if (!supabase) return { error: new Error('Supabase is not configured.') };
    const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (result.error) result.error.message = friendlyAuthError(result.error, 'Unable to sign in.');
    return result;
  }, []);

  const signUp = useCallback(async ({ displayName, email, password }) => {
    if (!supabase) return { error: new Error('Supabase is not configured.') };
    const emailRedirectTo = `${window.location.origin}${window.location.pathname}`;
    const result = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo,
        data: { display_name: displayName.trim() }
      }
    });
    if (result.error) result.error.message = friendlyAuthError(result.error, 'Unable to create the account.');
    return result;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return { error: null };
    return supabase.auth.signOut();
  }, []);

  const requestPasswordReset = useCallback(async (email) => {
    if (!supabase) return { error: new Error('Supabase is not configured.') };
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    return supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  }, []);

  const updatePassword = useCallback(async (password) => {
    if (!supabase) return { error: new Error('Supabase is not configured.') };
    return supabase.auth.updateUser({ password });
  }, []);

  const value = useMemo(() => ({
    configured: isSupabaseConfigured,
    session,
    user,
    loading,
    authEvent,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
    updatePassword
  }), [session, user, loading, authEvent, signIn, signUp, signOut, requestPasswordReset, updatePassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
