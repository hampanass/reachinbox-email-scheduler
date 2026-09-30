import { useCallback, useEffect, useState } from "react";
import { api, type SessionUser } from "./api";
import { Dashboard } from "./Dashboard";
import { Icon } from "./Icon";
import { Login } from "./Login";

function AuthLoading() {
  return <main className="auth-loading"><span className="loading-brand"><Icon name="mail" size={19} /></span><span className="auth-spinner" /><p>Opening your workspace…</p></main>;
}

function AuthError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <main className="auth-error"><span className="error-symbol">!</span><h1>We couldn’t reach your workspace</h1><p>{message}</p><button className="primary-button" onClick={onRetry}><Icon name="refresh" size={16} /> Try again</button></main>;
}

function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [authAttempt, setAuthAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setAuthError("");
    api.me().then((result) => {
      if (!cancelled) setUser(result.authenticated ? result.user : null);
    }).catch((error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : "Authentication could not be checked.";
      if (message.includes("session has expired")) setUser(null);
      else setAuthError(message);
    }).finally(() => {
      if (!cancelled) setChecking(false);
    });
    return () => { cancelled = true; };
  }, [authAttempt]);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  if (checking) return <AuthLoading />;
  if (authError) return <AuthError message={authError} onRetry={() => setAuthAttempt((value) => value + 1)} />;
  if (!user) return <Login onAuthenticated={setUser} />;
  return <Dashboard user={user} onLogout={logout} />;
}

export default App;