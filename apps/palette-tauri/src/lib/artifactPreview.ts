import { invoke } from "./invoke";

type ArtifactHttpResult = {
  ok: boolean;
  status: number;
  contentType: string;
  bodyBase64: string;
};

export async function loadArtifactObjectUrl(relativePath: string): Promise<string> {
  const result = await invoke<ArtifactHttpResult>("axon_artifact_request", {
    relativePath,
  });
  if (!result.ok) throw new Error(`artifact fetch failed with ${result.status}`);
  const binary = Uint8Array.from(atob(result.bodyBase64), (char) => char.charCodeAt(0));
  const blob = new Blob([binary], { type: result.contentType || "application/octet-stream" });
  return URL.createObjectURL(blob);
}
