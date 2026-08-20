import { expect, test } from "@playwright/test";

test("uses the localized quality label in the closed size picker", async ({ page }) => {
  await page.goto("http://127.0.0.1:6981/tests/fixtures/size-preset-picker.html");

  const trigger = page.getByRole("button", { name: "分辨率 / 比例" });
  await expect(trigger).toContainText("1K • 中 • 1:1");
  await trigger.click();
  await expect(page.getByRole("radiogroup", { name: "画质" }).getByRole("radio", { name: "中" })).toBeChecked();
});
