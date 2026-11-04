import { timingSafeEqual } from "node:crypto";

export function isAuthorizedAgentWorker(request: Request): boolean {
  const expected = process.env.AGENT_WORKER_TOKEN;
  if (!expected || expected.length < 32) return false;
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  const supplied = authorization.slice(7);
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  if (expectedBytes.length !== suppliedBytes.length) return false;
  return timingSafeEqual(expectedBytes, suppliedBytes);
}
