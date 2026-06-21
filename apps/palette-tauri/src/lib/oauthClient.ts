// OAuth login client. Wraps the Rust Tauri commands through the shared invoke
// seam so the browser-dev path keeps working (never import @tauri-apps/* here).
import { invoke } from "./invoke";

export interface OauthStatus {
  signedIn: boolean;
  scope: string | null;
  expiresAtUnix: number | null;
  serverUrl: string | null;
}

export function oauthStatus(): Promise<OauthStatus> {
  return invoke<OauthStatus>("axon_oauth_status");
}

export function oauthLogin(): Promise<OauthStatus> {
  return invoke<OauthStatus>("axon_oauth_login");
}

export function oauthLogout(): Promise<OauthStatus> {
  return invoke<OauthStatus>("axon_oauth_logout");
}

type Tone = "neutral" | "success" | "error";

export function describeOauthStatus(
  status: OauthStatus,
  nowUnix: number = Math.floor(Date.now() / 1000),
): { label: string; detail: string; tone: Tone } {
  if (status.signedIn) {
    const host = hostOf(status.serverUrl);
    if (status.expiresAtUnix != null && status.expiresAtUnix <= nowUnix) {
      return { tone: "error", label: "Session expired", detail: `Your ${host} session expired — sign in again.` };
    }
    return {
      tone: "success",
      label: "Signed in",
      detail: `Authorized to ${host}${status.scope ? ` (${status.scope})` : ""}.`,
    };
  }
  // Not signed in. If a credential exists for another server, explain it.
  if (status.serverUrl) {
    return {
      tone: "error",
      label: "Different server",
      detail: `Signed in to ${hostOf(status.serverUrl)}, not the current server — sign in again.`,
    };
  }
  return {
    tone: "neutral",
    label: "Not signed in",
    detail: "Sign in with Google to authorize this server via OAuth.",
  };
}

function hostOf(serverUrl: string | null): string {
  if (!serverUrl) return "the server";
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}
