import { expect, test } from "@playwright/test";

test("Arabic landing page explains the network and links to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /شبكة عالمية/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "دخول الأعضاء" })).toHaveAttribute("href", "/sign-in");
});
