import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/runtime/worker", () => ({
  runAgentWorkerOnce: vi.fn(),
}));
vi.mock("@/modules/runtime/retention", () => ({
  purgeExpiredAgentRuns: vi.fn(async () => ({ deleted: 0, cancelled: 0 })),
}));

import { runAgentWorkerOnce } from "@/modules/runtime/worker";
import { POST } from "@/app/api/internal/agent-worker/route";

const previous = {
  secret: process.env.AGENT_WORKER_SECRET,
  key: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_AGENT_MODEL,
};

afterEach(() => {
  if (previous.secret === undefined) delete process.env.AGENT_WORKER_SECRET;
  else process.env.AGENT_WORKER_SECRET = previous.secret;
  if (previous.key === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previous.key;
  if (previous.model === undefined) delete process.env.OPENAI_AGENT_MODEL;
  else process.env.OPENAI_AGENT_MODEL = previous.model;
  vi.mocked(runAgentWorkerOnce).mockReset();
});

describe("internal agent worker endpoint", () => {
  it("rejects requests without a valid worker secret", async () => {
    process.env.AGENT_WORKER_SECRET = "a-long-test-secret-value-0123456789abcdef";
    const response = await POST(new Request("http://localhost/api/internal/agent-worker", {
      method: "POST",
    }));
    expect(response.status).toBe(401);
    expect(runAgentWorkerOnce).not.toHaveBeenCalled();
  });

  it("keeps the worker disabled until provider configuration is present", async () => {
    process.env.AGENT_WORKER_SECRET = "a-long-test-secret-value-0123456789abcdef";
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_AGENT_MODEL;
    const response = await POST(new Request("http://localhost/api/internal/agent-worker", {
      method: "POST",
      headers: { Authorization: "Bearer a-long-test-secret-value-0123456789abcdef" },
    }));
    expect(response.status).toBe(503);
    expect(runAgentWorkerOnce).not.toHaveBeenCalled();
  });

  it("invokes exactly one worker iteration only after secret and provider configuration", async () => {
    process.env.AGENT_WORKER_SECRET = "a-long-test-secret-value-0123456789abcdef";
    process.env.OPENAI_API_KEY = "test-only-not-a-real-key";
    process.env.OPENAI_AGENT_MODEL = "test-model";
    vi.mocked(runAgentWorkerOnce).mockResolvedValue({
      status: "PLANNED",
      runId: "run-1",
      stepCount: 1,
      sourceCount: 0,
    });

    const response = await POST(new Request("http://localhost/api/internal/agent-worker", {
      method: "POST",
      headers: { Authorization: "Bearer a-long-test-secret-value-0123456789abcdef" },
    }));
    expect(response.status).toBe(200);
    expect(runAgentWorkerOnce).toHaveBeenCalledOnce();
    const body = await response.json();
    expect(body.data).toMatchObject({ status: "PLANNED", runId: "run-1" });
  });
});
