export function artifactUrl(artifactId: string): string {
  return `zeta-artifact://library/${encodeURIComponent(artifactId)}`;
}
