import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Severity, SpanKind } from "../../shared/types";
import { component as parseComponent } from "../lib/format";

export function Card({ title, description, actions, children, className = "" }: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card min-w-0 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-muted">{hint}</dd>}
    </div>
  );
}

const SEV_STYLE: Record<Severity, string> = {
  high: "bg-[var(--sev-high-bg)] text-[var(--sev-high-fg)]",
  medium: "bg-[var(--sev-medium-bg)] text-[var(--sev-medium-fg)]",
  low: "bg-[var(--sev-low-bg)] text-[var(--sev-low-fg)]",
};
const SEV_LABEL: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };

export function SeverityBadge({ severity, count }: { severity: Severity; count?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${SEV_STYLE[severity]}`}>
      {count !== undefined ? (
        <>
          <span className="tabular-nums">{count}</span>
          <span>{SEV_LABEL[severity].toLowerCase()}</span>
        </>
      ) : (
        SEV_LABEL[severity]
      )}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-prose text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <p role="status" className="px-4 py-8 text-center text-sm text-muted">
      {label}...
    </p>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? "Copied" : label}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}

export function CodeBlock({ code, label, copy = true }: { code: string; label?: string; copy?: boolean }) {
  return (
    <div className="min-w-0">
      {(label || copy) && (
        <div className={`mb-1 flex items-center gap-2 ${label ? "justify-between" : "justify-end"}`}>
          {label && <span className="text-sm font-medium">{label}</span>}
          {copy && <CopyButton text={code} />}
        </div>
      )}
      <pre className="mono overflow-x-auto rounded-md border border-line bg-surface-2 p-3 whitespace-pre-wrap break-words">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function ComponentName({ value }: { value: string }) {
  const c = parseComponent(value);
  return (
    <span className="inline-flex min-w-0 flex-col">
      <span className="truncate font-medium">{c.name}</span>
      <span className="text-xs text-muted">{c.kind}</span>
    </span>
  );
}

export const KIND_LABEL: Record<SpanKind, string> = {
  db: "Database query",
  http: "External request",
  callback: "Hook callback",
  plugin_load: "Plugin load",
  theme_load: "Theme load",
};

/** Small inline icons, one shape per span kind, so kinds are not told apart by color only. */
export function KindIcon({ kind, className = "" }: { kind: SpanKind; className?: string }) {
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, "aria-hidden": true } as const;
  switch (kind) {
    case "db":
      return (
        <svg {...common} className={`text-db ${className}`}>
          <ellipse cx="8" cy="3.5" rx="5" ry="2" />
          <path d="M3 3.5v9c0 1.1 2.2 2 5 2s5-.9 5-2v-9M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
        </svg>
      );
    case "http":
      return (
        <svg {...common} className={`text-http ${className}`}>
          <circle cx="8" cy="8" r="6" />
          <path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" />
        </svg>
      );
    case "callback":
      return (
        <svg {...common} className={`text-php ${className}`}>
          <path d="M5 3 2 8l3 5M11 3l3 5-3 5M9.5 2.5l-3 11" />
        </svg>
      );
    case "plugin_load":
      return (
        <svg {...common} className={`text-other ${className}`}>
          <path d="M6 2v3M10 2v3M4 5h8v3a4 4 0 0 1-8 0V5ZM8 12v2" />
        </svg>
      );
    case "theme_load":
      return (
        <svg {...common} className={`text-other ${className}`}>
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M2 6h12M5 9h4" />
        </svg>
      );
  }
}

/** Accessible modal built on the native dialog element (focus trap and Escape for free). */
export function Modal({ open, onClose, title, children, wide = false, side = false }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  side?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const position = side
    ? "m-0 ml-auto h-dvh max-h-dvh w-full max-w-2xl rounded-none"
    : `mx-auto my-4 sm:my-12 max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-6rem)] w-[calc(100%-1rem)] ${wide ? "max-w-4xl" : "max-w-lg"} rounded-lg`;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`${position} border border-line bg-surface p-0 text-fg`}
    >
      {open && (
        <div className="flex max-h-[inherit] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <h2 id={titleId} className="min-w-0 text-lg font-semibold break-words">
              {title}
            </h2>
            <button type="button" className="btn shrink-0" onClick={onClose}>
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
