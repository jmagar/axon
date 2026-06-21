import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/aurora/button";
import { appWindow } from "@/lib/invoke";
import { describeOauthStatus, oauthLogin, oauthLogout, oauthStatus, type OauthStatus } from "@/lib/oauthClient";

/// OAuth authentication panel for the Settings connection tab. Owns its own
/// sign-in status and re-fetches it both on mount and whenever the Rust shell
/// emits `palette://oauth-changed` (e.g. a reactive 401 refresh cleared a dead
/// session), so the UI stays in sync without a manual reload.
export function SettingsAuthBlock() {
  const [status, setStatus] = useState<OauthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      oauthStatus()
        .then((next) => {
          if (active) setStatus(next);
        })
        .catch((err) => {
          if (!active) return;
          setStatus({ signedIn: false, scope: null, expiresAtUnix: null, serverUrl: null });
          setError(err instanceof Error ? err.message : "Could not read sign-in status.");
        });
    load();
    const unlisten = appWindow.listen("palette://oauth-changed", () => load());
    return () => {
      active = false;
      void unlisten.then((u) => u());
    };
  }, []);

  const view = status
    ? describeOauthStatus(status)
    : { label: "Checking…", detail: "Reading saved credentials…", tone: "neutral" as const };

  const run = async (action: () => Promise<OauthStatus>) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : "OAuth request failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-stack">
      <span className="settings-section-label">Authentication</span>
      <div className="settings-auth-status" data-tone={view.tone} aria-live="polite">
        <strong>{view.label}</strong>
        <span>{view.detail}</span>
        {error && <span className="settings-error">{error}</span>}
      </div>
      {view.tone === "success" ? (
        <Button size="sm" variant="neutral" disabled={busy} onClick={() => void run(oauthLogout)}>
          <KeyRound size={14} />
          {busy ? "Working…" : "Sign out"}
        </Button>
      ) : (
        <Button size="sm" variant="aurora" disabled={busy} onClick={() => void run(oauthLogin)}>
          <KeyRound size={14} />
          {busy ? "Opening browser…" : "Sign in with Google"}
        </Button>
      )}
    </div>
  );
}
