import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api";
import { ago, dateTime } from "../lib/format";
import { useDocumentTitle } from "../lib/hooks";
import { PageTitle, useSession, useSite } from "../components/Layout";
import { SetupSteps } from "../components/Setup";
import { Card, Facts, Modal } from "../components/ui";

export function SettingsPage() {
  const site = useSite();
  useDocumentTitle(`Setup - ${site.name}`);
  const { publicUrl } = useSession();
  const navigate = useNavigate();
  const [key, setKey] = useState<string | null>(null);
  const [keyHint, setKeyHint] = useState(site.keyHint);
  const [confirm, setConfirm] = useState<"rotate" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(site.name);
  const [url, setUrl] = useState(site.url);
  const [saved, setSaved] = useState<string | null>(null);

  const rotate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ key: string; site: { keyHint: string } }>(`/api/sites/${site.id}/rotate`, { method: "POST" });
      setKey(res.key);
      setKeyHint(res.site.keyHint);
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/sites/${site.id}`, { method: "DELETE" });
      navigate("/", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(null);
    setError(null);
    try {
      await api(`/api/sites/${site.id}`, { method: "PATCH", body: { name, url } });
      setSaved("Saved.");
      site.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <PageTitle description="Connect the WordPress site, manage its key, or remove it.">Setup</PageTitle>
      {error && confirm === null && (
        <p role="alert" className="mb-4 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Connect WordPress" className="lg:col-span-2">
          <div className="space-y-4 p-4">
            {key && (
              <p role="status" className="rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm">
                New key created. Copy it now: it cannot be shown again. The old key stopped working.
              </p>
            )}
            <SetupSteps appUrl={publicUrl} siteKey={key} />
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Status">
            <div className="p-4">
              <Facts
                items={[
                  ["Last data", ago(site.lastSeen)],
                  ["Site key", <code className="mono">{keyHint}</code>],
                  ["Created", dateTime(site.createdAt)],
                  ["PHP", site.phpVersion || "Unknown"],
                  ["WordPress", site.wpVersion || "Unknown"],
                  ["Agent", site.agentVersion || "Unknown"],
                ]}
              />
            </div>
          </Card>
          <Card title="Details">
            <form className="space-y-3 p-4" onSubmit={(e) => void save(e)}>
              <div>
                <label htmlFor="edit-name" className="label">
                  Name
                </label>
                <input id="edit-name" className="field" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="edit-url" className="label">
                  URL
                </label>
                <input id="edit-url" type="url" className="field" value={url} onChange={(e) => setUrl(e.target.value)} />
              </div>
              {saved && (
                <p role="status" className="text-sm text-ok">
                  {saved}
                </p>
              )}
              <button type="submit" className="btn">
                Save details
              </button>
            </form>
          </Card>
          <Card title="Key and removal">
            <div className="space-y-3 p-4 text-sm">
              <p className="text-muted">Rotating creates a new key and stops the old one right away. Update wp-config.php on the site afterwards.</p>
              <button type="button" className="btn" onClick={() => setConfirm("rotate")}>
                Rotate site key
              </button>
              <p className="text-muted">Removing hides the site and rejects its key. Stored data expires with the normal retention.</p>
              <button type="button" className="btn-danger" onClick={() => setConfirm("delete")}>
                Remove site
              </button>
            </div>
          </Card>
        </div>
      </div>
      <Modal
        open={confirm !== null}
        onClose={() => {
          setConfirm(null);
          setError(null);
        }}
        title={confirm === "delete" ? "Remove this site?" : "Rotate the site key?"}
      >
        <p className="text-sm">
          {confirm === "delete"
            ? `${site.name} will disappear from the dashboard and its agent will be rejected.`
            : "The current key stops working immediately. The site sends no data until wp-config.php has the new key."}
        </p>
        {error && (
          <p role="alert" className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setConfirm(null);
              setError(null);
            }}
          >
            Cancel
          </button>
          {confirm === "delete" ? (
            <button type="button" className="btn-danger" disabled={busy} onClick={() => void remove()}>
              Remove site
            </button>
          ) : (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void rotate()}>
              Rotate key
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
