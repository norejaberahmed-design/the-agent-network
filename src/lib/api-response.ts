import { randomUUID } from "node:crypto";

const messages: Record<string, string> = {
  UNAUTHENTICATED: "Authentication is required.",
  FORBIDDEN: "This operation is not permitted.",
  INVALID_JSON: "The request body must be valid JSON.",
  VALIDATION_FAILED: "The request did not satisfy the required schema.",
  INVALID_ORIGIN: "The request origin is not allowed.",
};

export function apiError(
  code: string,
  status: number,
  details?: unknown,
) {
  return Response.json(
    {
      error: {
        code,
        message: messages[code] ?? "The request could not be completed.",
        correlationId: randomUUID(),
        ...(details === undefined ? {} : { details }),
      },
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
