import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 900, height: 720 } });

test("paginates and virtualizes tasks without loading original images for previews", async ({ page }) => {
  let originalRequests = 0;
  await page.route("**/task-original-*.png", async (route) => {
    originalRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    });
  });

  await page.goto("http://127.0.0.1:6981/tests/fixtures/generation-task-center.html");
  await expect(page.locator(".generation-task-center__pagination span")).toContainText(/1\s*\/\s*3/);
  expect(await page.locator(".generation-task-center__virtual-item").count()).toBeLessThan(30);
  expect(originalRequests).toBe(0);

  await page.locator(".generation-task-center__preview--image").first().click();
  await expect.poll(() => originalRequests).toBeGreaterThan(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /下一页任务|Next task page/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-task-offset", "30");
  await expect(page.locator(".generation-task-center__pagination span")).toContainText(/2\s*\/\s*3/);
});
