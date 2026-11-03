import { expect, test } from "@playwright/test";

test("liveness endpoint reports the process is alive", async ({ request }) => {
  const response = await request.get("/api/health/live");
  expect(response.status()).toBe(200);
  await expect(response).toBeOK();
  const body = await response.json();
  expect(body.status).toBe("alive");
  expect(body.service).toBe("the-agent-network");
});
