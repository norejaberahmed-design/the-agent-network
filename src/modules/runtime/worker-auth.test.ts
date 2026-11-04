import { afterEach, describe, expect, it } from "vitest";
import { isAuthorizedAgentWorker, readBoundedWorkerJson } from "@/lib/worker-auth";

const previousToken = process.env.AGENT_WORKER_TOKEN;
afterEach(() => {
  if (previousToken === undefined) delete process.env.AGENT_WORKER_TOKEN;
  else process.env.AGENT_WORKER_TOKEN = previousToken;
});

describe("internal worker authentication", () => {
  it("accepts only the configured bearer token", () => {
    process.env.AGENT_WORKER_TOKEN = "a".repeat(40);
    expect(isAuthorizedAgentWorker(new Request("http://localhost", {
      headers: { Authorization: `Bearer ${"a".repeat(40)}` },
    }))).toBe(true);
    expect(isAuthorizedAgentWorker(new Request("http://localhost", {
      headers: { Authorization: `Bearer ${"b".repeat(40)}` },
    }))).toBe(false);
  });

  it("fails closed when the secret is absent or too short", () => {
    delete process.env.AGENT_WORKER_TOKEN;
    expect(isAuthorizedAgentWorker(new Request("http://localhost"))).toBe(false);
    process.env.AGENT_WORKER_TOKEN = "short";
    expect(isAuthorizedAgentWorker(new Request("http://localhost", {
      headers: { Authorization: "Bearer short" },
    }))).toBe(false);
  });

  it("parses bounded JSON and rejects oversized bodies", async () => {
    const valid = await readBoundedWorkerJson(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ workerId: "worker-001" }),
    }));
    expect(valid).toEqual({ ok: true, value: { workerId: "worker-001" } });

    const oversized = await readBoundedWorkerJson(new Request("http://localhost", {
      method: "POST",
      body: "x".repeat(100),
    }), 32);
    expect(oversized).toEqual({ ok: false });
  });
});
