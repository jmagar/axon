import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { appWindow } from "@/lib/invoke";
import { oauthStatus } from "@/lib/oauthClient";

const SIGNED_OUT_NOTICE = "You've been signed out of Axon — sign in again in Settings.";

/// App-wide "signed out" banner. A reactive 401 on any action path (ask/query/…)
/// clears a dead OAuth session in the Rust shell and emits
/// `palette://oauth-changed`. SettingsAuthBlock only re-syncs while Settings is
/// open, so this self-contained component listens for the same event app-wide:
/// when it fires, it re-checks `oauthStatus()` and surfaces a dismissible notice
/// if the session is no longer signed in (signed out, or a credential for a
/// different server). The browser-dev `appWindow.listen` is a no-op stub, so this
/// stays inert (and harmless) under `pnpm vite:dev` and in tests.
export function AuthNotice() {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unlisten = appWindow.listen("palette://oauth-changed", () => {
      void oauthStatus()
        .then((status) => {
          if (!active) return;
          if (!status.signedIn) setNotice(SIGNED_OUT_NOTICE);
        })
        .catch(() => {
          // A failed status read is not itself a sign-out signal; stay quiet.
        });
    });
    return () => {
      active = false;
      void unlisten.then((u) => u());
    };
  }, []);

  if (!notice) return null;

  return (
    <div className="palette-auth-notice" role="status" aria-live="polite">
      <span>{notice}</span>
      <button
        type="button"
        className="palette-auth-notice-dismiss"
        aria-label="Dismiss"
        onClick={() => setNotice(null)}
      >
        <X size={14} />
      </button>
    </div>
  );
}
