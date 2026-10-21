import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { RANGES, RANGE_LABELS, type RangeKey } from "../../shared/range";
import type { SiteInfo } from "../../shared/types";
import { api, onUnauthorized } from "../lib/api";
import { ago } from "../lib/format";
import { useApi, useRange } from "../lib/hooks";
import { RefreshProvider, useRefresh } from "../lib/refresh";
import { getThemeChoice, setThemeChoice, watchSystemTheme, type ThemeChoice } from "../lib/theme";
import { ErrorBox, Loading } from "./ui";

interface Session {
  email: string;
  publicUrl: string;
}
const SessionContext = createContext<Session>({ email: "", publicUrl: "" });
export const useSession = () => useContext(SessionContext);

export function RequireAuth() {
  const [state, setState] = useState<{ status: "loading" | "in" | "out"; session?: Session }>({ status: "loading" });
  const location = useLocation();
  useEffect(() => {
    api<Session>("/api/auth/me")
      .then((s) => setState({ status: "in", session: s }))
      .catch(() => setState({ status: "out" }));
    return onUnauthorized(() => setState({ status: "out" }));
  }, []);
  useEffect(() => watchSystemTheme(), []);
  if (state.status === "loading") return <Loading label="Checking session" />;
  if (state.status === "out") {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return (
    <SessionContext.Provider value={state.session!}>
      <RefreshProvider>
        <Shell>
          <Outlet />
        </Shell>
      </RefreshProvider>
    </SessionContext.Provider>
  );
}

export function ThemeSelect({ id = "theme" }: { id?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>(getThemeChoice());
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-muted">
        Theme
      </label>
      <select
        id={id}
        className="field w-auto"
        value={choice}
        onChange={(e) => {
          const v = e.target.value as ThemeChoice;
          setChoice(v);
          setThemeChoice(v);
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  );
}

function Logo() {
  return (
    <Link to="/" className="inline-flex min-h-10 items-center gap-2 rounded font-semibold">
      <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="var(--accent)" />
        <path d="M7 21h4l3-9 4 13 3-8h4" fill="none" stroke="var(--accent-fg)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      PressTrace
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { email } = useSession();
  useEffect(() => setOpen(false), [location.pathname]);

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => null);
    navigate("/login", { replace: true });
  };

  const navLinks = (
    <>
      <NavLink
        to="/"
        end
        className={({ isActive }) => `inline-flex min-h-10 items-center rounded px-2 text-sm font-medium ${isActive ? "text-accent" : "text-fg hover:text-accent"}`}
      >
        Sites
      </NavLink>
    </>
  );

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2">
          <div className="flex items-center gap-4">
            <Logo />
            <nav aria-label="Main" className="hidden md:block">
              {navLinks}
            </nav>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <ThemeSelect id="theme-desktop" />
            <span className="text-sm text-muted">{email}</span>
            <button type="button" className="btn" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
          <button
            type="button"
            className="btn md:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((o) => !o)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
              {open ? <path d="M3 3l10 10M13 3 3 13" /> : <path d="M2 4h12M2 8h12M2 12h12" />}
            </svg>
            Menu
          </button>
        </div>
        {open && (
          <div id="mobile-menu" className="border-t border-line px-4 py-3 md:hidden">
            <nav aria-label="Main" className="flex flex-col">
              {navLinks}
            </nav>
            <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
              <ThemeSelect id="theme-mobile" />
              <span className="text-sm text-muted break-all">Signed in as {email}</span>
              <button type="button" className="btn" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </div>
        )}
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-5">
        {children}
      </main>
    </div>
  );
}

export function RangeControls() {
  const [range, setRange] = useRange();
  const refresh = useRefresh();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="range" className="sr-only">
          Time range
        </label>
        <select id="range" className="field w-auto" value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
          {RANGES.map((r) => (
            <option key={r} value={r}>
              {RANGE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="btn" onClick={refresh}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
        </svg>
        Refresh
      </button>
    </div>
  );
}

const TABS = [
  { to: "transactions", label: "Transactions" },
  { to: "wordpress", label: "WordPress" },
  { to: "database", label: "Database" },
  { to: "external", label: "External" },
  { to: "errors", label: "Errors" },
  { to: "issues", label: "Issues" },
  { to: "settings", label: "Setup" },
] as const;

type SiteContextValue = SiteInfo & { reload: () => void };
const SiteContext = createContext<SiteContextValue | null>(null);
export const useSite = () => useContext(SiteContext)!;

/** Keeps the range query string when moving between site pages. */
export function useRangeSearch(): string {
  const [range] = useRange();
  return `?range=${range}`;
}

export function SiteLayout() {
  const { siteId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const search = useRangeSearch();
  const site = useApi<SiteInfo>(`/api/sites/${siteId}`);
  const current = TABS.find((t) => location.pathname.startsWith(`/sites/${siteId}/${t.to}`))?.to ?? "";

  if (site.error) return <ErrorBox message={site.error} onRetry={site.reload} />;
  if (!site.data) return <Loading label="Loading site" />;
  const s = site.data;

  return (
    <SiteContext.Provider value={{ ...s, reload: site.reload }}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm">
            <Link to={`/${search}`} className="link">
              Sites
            </Link>
          </p>
          <h1 className="text-2xl font-semibold break-words">{s.name}</h1>
          <p className="text-sm text-muted break-all">
            {s.url} <span aria-hidden="true">·</span> Last data {ago(s.lastSeen)}
          </p>
        </div>
        <RangeControls />
      </div>

      <div className="mb-5 md:hidden">
        <label htmlFor="site-section" className="label">
          Section
        </label>
        <select
          id="site-section"
          className="field"
          value={current}
          onChange={(e) => navigate(`/sites/${siteId}/${e.target.value}${search}`)}
        >
          {current === "" && (
            <option value="" disabled>
              {location.pathname.includes("/traces/") ? "Trace" : "Choose a section"}
            </option>
          )}
          {TABS.map((t) => (
            <option key={t.to} value={t.to}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <nav aria-label="Site sections" className="mb-5 hidden border-b border-line md:block">
        <ul className="-mb-px flex flex-wrap gap-1">
          {TABS.map((t) => (
            <li key={t.to}>
              <NavLink
                to={`/sites/${siteId}/${t.to}${search}`}
                className={({ isActive }) =>
                  `inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-medium ${
                    isActive ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"
                  }`
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </SiteContext.Provider>
  );
}

export function PageTitle({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-semibold">{children}</h2>
      {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
    </div>
  );
}
