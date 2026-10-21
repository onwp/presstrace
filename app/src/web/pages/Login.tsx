import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../lib/api";
import { safeNext } from "../lib/redirect";
import { useDocumentTitle } from "../lib/hooks";
import { ThemeSelect } from "../components/Layout";

export function LoginPage() {
  useDocumentTitle("Sign in");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      navigate(safeNext(params.get("next"), window.location.origin), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="var(--accent)" />
            <path d="M7 21h4l3-9 4 13 3-8h4" fill="none" stroke="var(--accent-fg)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-lg font-semibold">PressTrace</span>
        </div>
        <form onSubmit={(e) => void submit(e)} className="card space-y-4 p-5" noValidate>
          <h1 className="text-xl font-semibold">Sign in</h1>
          {error && (
            <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input id="email" type="email" autoComplete="username" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
          <p className="text-xs text-muted">The admin account is set with ADMIN_EMAIL and ADMIN_PASSWORD in the server .env file.</p>
        </form>
        <div className="mt-4 flex justify-end">
          <ThemeSelect id="theme-login" />
        </div>
      </div>
    </main>
  );
}
