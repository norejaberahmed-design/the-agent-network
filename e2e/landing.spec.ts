import { expect, test, type Page } from "@playwright/test";

async function mockReadyPersonalAgent(page: Page) {
  const grant = {
    id: "grant-search-1",
    purpose: "Research public suppliers for the owner.",
    actionScope: ["SEARCH_PUBLIC_WEB"],
    targetScope: ["PUBLIC_WEB"],
    dataScope: ["PUBLIC_PROFILE"],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    maxUses: 10,
    uses: 0,
    status: "ACTIVE",
  };

  await page.route("**/api/v1/me/persona", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { displayName: "وكيل الاختبار", tone: "واضح ومباشر", goal: "البحث عن الموردين" } }),
  }));
  await page.route("**/api/v1/agents", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: [{ id: "agent-test-1", name: "وكيل الاختبار", status: "ACTIVE" }] }),
  }));
  await page.route("**/api/v1/agents/agent-test-1/grants", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: [grant] }),
  }));
}

test("Arabic personal agent workspace is available and retains member sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /مرحباً، ما الذي تريد/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "دخول الأعضاء" })).toHaveAttribute("href", "/sign-in");
  await expect(page.getByRole("button", { name: "ابدأ المهمة" })).toBeDisabled();
});

test("agent can create an initial ad draft from the workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /إعداد إعلان/ }).click();
  await page.getByPlaceholder(/اكتب تفاصيل المنتج أو الخدمة/).fill("كابل ألياف ضوئية جديد، متوفر للبيع بالجملة.");
  await page.getByRole("button", { name: /ابدأ المهمة/ }).click();
  await expect(page.getByRole("heading", { name: "أعددت مسودة أولية بناءً على وصفك." })).toBeVisible();
  await expect(page.getByRole("button", { name: "نسخ المسودة" })).toBeVisible();
});

test("personal workspace queues search through the persisted agent API after explicit consent", async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await mockReadyPersonalAgent(page);
  await page.route("**/api/v1/agents/agent-test-1/runs", async route => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: "run-test-1",
            task: "ابحث عن موزعي معدات الشبكات في السعودية",
            status: "QUEUED",
            createdAt: new Date().toISOString(),
          },
          executionEnabled: false,
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });

  await page.goto("/");
  const task = "ابحث عن موزعي معدات الشبكات في السعودية";
  await page.getByPlaceholder(/ابحث عن موزعي معدات الشبكات/).fill(task);
  await page.getByLabel(/أوافق على إرسال نص المهمة/).check();
  await page.getByRole("button", { name: /ابدأ المهمة/ }).click();

  await expect(page.getByText(/تم تسجيل المهمة في قائمة الوكيل/)).toBeVisible();
  await expect(page.getByText("QUEUED")).toBeVisible();
  expect(submitted).toMatchObject({
    task,
    purpose: "Research public suppliers for the owner.",
    target: "PUBLIC_WEB",
    grantId: "grant-search-1",
    providerConsent: true,
  });
});

test("personal workspace refuses provider submission without explicit consent", async ({ page }) => {
  let submitted = false;
  await mockReadyPersonalAgent(page);
  await page.route("**/api/v1/agents/agent-test-1/runs", async route => {
    if (route.request().method() === "POST") submitted = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });

  await page.goto("/");
  await page.getByPlaceholder(/ابحث عن موزعي معدات الشبكات/).fill("ابحث عن موزعي معدات الشبكات");
  await page.getByRole("button", { name: /ابدأ المهمة/ }).click();

  await expect(page.locator(".agent-error")).toContainText("وافق أولاً");
  expect(submitted).toBe(false);
});

test("personal workspace displays source-linked evidence without claiming independent verification", async ({ page }) => {
  await mockReadyPersonalAgent(page);
  await page.route("**/api/v1/agents/agent-test-1/runs", async route => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: "run-evidence-1",
            task: "ابحث عن المورد",
            status: "PLANNED",
            planSummary: "وجدت مصدراً عاماً للمراجعة.",
            planSources: [{
              url: "https://example.com/supplier",
              title: "Supplier public page",
              evidence: [{ claim: "The supplier lists a Riyadh office." }],
            }],
            steps: [],
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
          executionEnabled: false,
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });

  await page.goto("/");
  await page.getByPlaceholder(/ابحث عن موزعي معدات الشبكات/).fill("ابحث عن المورد");
  await page.getByLabel(/أوافق على إرسال نص المهمة/).check();
  await page.getByRole("button", { name: /ابدأ المهمة/ }).click();

  await expect(page.getByRole("heading", { name: "أعد الوكيل خطة بحث أولية" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Supplier public page" })).toHaveAttribute("href", "https://example.com/supplier");
  await expect(page.getByText("ادعاء مرتبط بالمصدر: The supplier lists a Riyadh office.")).toBeVisible();
  await expect(page.getByText(/لم تخضع بعد لفحص مستقل/)).toBeVisible();
});
