import { expect, test } from "@playwright/test";

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
