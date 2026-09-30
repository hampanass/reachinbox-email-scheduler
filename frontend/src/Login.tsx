import { useState, type FormEvent } from "react";
import { API_BASE, api, type SessionUser } from "./api";
import { Icon } from "./Icon";

type Props = { onAuthenticated: (user: SessionUser) => void };

export function Login({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (mode === "register" && password.length < 8) {
      setError("Your password must be at least 8 characters.");
      return;
    }
    if (!password || password.length > 72) {
      setError("Enter a password of no more than 72 characters.");
      return;
    }

    setBusy(true);
    try {
      const result = mode === "register"
        ? await api.register(normalizedEmail, password, name.trim() || undefined)
        : await api.login(normalizedEmail, password);
      onAuthenticated(result.user);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Sign-in could not be completed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand-mark"><Icon name="mail" size={22} /></div>
        <p className="overline">REACHINBOX</p>
        <h1>{mode === "login" ? <>Every conversation,<br />moving forward.</> : <>Make room for<br />better outreach.</>}</h1>
        <p className="login-copy">{mode === "login" ? "Sign in to plan your outreach, schedule campaigns, and keep every message on track." : "Create your ReachInbox account and start scheduling thoughtful outreach."}</p>
        <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
          {mode === "register" && <label>Your name<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name (optional)" maxLength={120} /></label>}
          <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label>
          <label>Password<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "register" ? "At least 8 characters" : "Your password"} maxLength={72} required /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy && <span className="button-spinner" />}{busy ? (mode === "login" ? "Signing in…" : "Creating account…") : (mode === "login" ? "Sign in" : "Create account")}</button>
        </form>
        <div className="auth-switch">{mode === "login" ? "New to ReachInbox?" : "Already have an account?"}<button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Create account" : "Sign in"}</button></div>
        <div className="auth-divider"><span />or<span /></div>
        <button className="google-button" onClick={() => window.location.assign(`${API_BASE}/auth/google`)}>
          <span className="google-g" aria-hidden="true">G</span>Continue with Google<Icon name="arrow" size={16} />
        </button>
        <div className="login-footnote"><span className="secure-dot" /> Your workspace is private and secure</div>
      </section>
      <div className="login-aside" aria-hidden="true">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" />
        <div className="aside-card">
          <div className="aside-card-top"><span className="aside-live"><span /> Scheduled campaign</span><span>•••</span></div>
          <div className="aside-bars"><i /><i /><i /><i /></div>
          <div className="aside-card-bottom"><span>Outreach in motion</span><b>On track <Icon name="check" size={14} /></b></div>
        </div>
        <p>Thoughtful outreach.<br /><strong>At the right moment.</strong></p>
      </div>
    </main>
  );
}
