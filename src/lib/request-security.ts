const MAX_MUTATION_BODY_BYTES = 32_768;

export async function isTrustedMutationRequest(request: Request): Promise<boolean> {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(
      process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    ).origin;
  } catch {
    return false;
  }

  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || origin !== expectedOrigin) return false;
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return false;
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_MUTATION_BODY_BYTES) {
      return false;
    }
  }

  // Content-Length is optional for streamed/chunked requests. Enforce the
  // limit against bytes actually received, and fail closed on stream errors.
  const body = request.clone().body;
  if (!body) return true;

  const reader = body.getReader();
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return true;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_MUTATION_BODY_BYTES) {
        // Cancel both tee branches together so cancellation cannot wait on
        // the untouched original request stream.
        await Promise.all([reader.cancel(), request.body?.cancel()]);
        return false;
      }
    }
  } catch {
    return false;
  } finally {
    reader.releaseLock();
  }
}
