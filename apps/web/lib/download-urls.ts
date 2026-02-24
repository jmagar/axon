export function packMdUrl(jobId: string): string {
  return `/download/${jobId}/pack.md`
}

export function packXmlUrl(jobId: string): string {
  return `/download/${jobId}/pack.xml`
}

export function archiveZipUrl(jobId: string): string {
  return `/download/${jobId}/archive.zip`
}

export function fileDownloadUrl(jobId: string, relPath: string): string {
  return `/download/${jobId}/file/${relPath}`
}
