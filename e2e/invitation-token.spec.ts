import { expect, test } from "@playwright/test";

test("one-time invitation token is removed from the address bar after it is read", async ({ page }) => {
  await page.goto("/accept-invitation#token=one-time-secret-for-e2e");

  await expect(page).toHaveURL(/\/accept-invitation$/);
  await expect(
    page.getByRole("button", { name: "قبول الدعوة وإنشاء الحساب" }),
  ).toBeEnabled();
});
