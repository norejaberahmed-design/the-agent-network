export function isTrustedMutationRequest(request: Request): boolean {
  const expectedOrigin = new URL(
    process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  ).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (!origin || origin !== expectedOrigin) return false;
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return false;
  }
  if (Number.isFinite(contentLength) && contentLength > 32_768) return false;
  return true;
}
