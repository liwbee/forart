import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 720 } });

test("keeps tab dragging horizontal and exposes canvas management actions", async ({ page }) => {
  await page.goto("http://127.0.0.1:6981/tests/fixtures/canvas-document-tabs.html");

  const firstTab = page.locator(".rf-workspace-tab").first();
  await firstTab.click({ button: "right" });
  const menu = page.locator('[data-slot="context-menu-content"]');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText(/重命名|Rename/);
  await expect(menu).toContainText(/创建副本|Create copy/);
  await expect(menu).toContainText(/移动到|Move to/);
  await expect(menu).toContainText(/上传到共享画布|Upload to shared/);
  await expect(menu).toContainText(/导出画布|Export canvas/);
  await expect(menu).toContainText(/删除|Delete/);
  await page.keyboard.press("Escape");

  const addButton = page.getByRole("button", { name: /新建画布|New canvas/ });
  const addButtonBounds = await addButton.boundingBox();
  const lastTabBounds = await page.locator(".rf-workspace-tab").last().boundingBox();
  expect(addButtonBounds).not.toBeNull();
  expect(lastTabBounds).not.toBeNull();
  expect(addButtonBounds!.x - lastTabBounds!.x - lastTabBounds!.width).toBeGreaterThanOrEqual(0);
  expect(addButtonBounds!.x - lastTabBounds!.x - lastTabBounds!.width).toBeLessThanOrEqual(4);

  await addButton.click();
  await page.getByRole("menuitem", { name: /项目二|Project 2/ }).click();
  await expect(page.getByTestId("created-project")).toHaveText("project-2");

  const initialBounds = await firstTab.boundingBox();
  expect(initialBounds).not.toBeNull();
  await page.mouse.move(
    initialBounds!.x + initialBounds!.width / 2,
    initialBounds!.y + initialBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    initialBounds!.x + initialBounds!.width / 2 + 120,
    initialBounds!.y + initialBounds!.height / 2 + 140,
    { steps: 10 },
  );

  const overlay = page.locator(".rf-workspace-tab--overlay");
  await expect(overlay).toBeVisible();
  const overlayBounds = await overlay.boundingBox();
  expect(overlayBounds).not.toBeNull();
  expect(Math.abs(overlayBounds!.y - initialBounds!.y)).toBeLessThanOrEqual(2);
  await page.mouse.up();
});

test("compresses canvas tabs instead of creating a horizontal scroll list", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 720 });
  await page.goto("http://127.0.0.1:6981/tests/fixtures/canvas-document-tabs.html");

  const tabStripMetrics = await page.locator(".rf-workspace-tabs-scroll").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(tabStripMetrics.scrollWidth).toBeLessThanOrEqual(tabStripMetrics.clientWidth);

  const firstTabBounds = await page.locator(".rf-workspace-tab").first().boundingBox();
  expect(firstTabBounds).not.toBeNull();
  expect(firstTabBounds!.width).toBeLessThan(132);

  const lastTabBounds = await page.locator(".rf-workspace-tab").last().boundingBox();
  const addButtonBounds = await page.getByRole("button", { name: /新建画布|New canvas/ }).boundingBox();
  expect(lastTabBounds).not.toBeNull();
  expect(addButtonBounds).not.toBeNull();
  expect(addButtonBounds!.x - lastTabBounds!.x - lastTabBounds!.width).toBeGreaterThanOrEqual(0);
  expect(addButtonBounds!.x - lastTabBounds!.x - lastTabBounds!.width).toBeLessThanOrEqual(4);

  await page.mouse.move(
    firstTabBounds!.x + firstTabBounds!.width / 2,
    firstTabBounds!.y + firstTabBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    firstTabBounds!.x + firstTabBounds!.width / 2 + 60,
    firstTabBounds!.y + firstTabBounds!.height / 2,
    { steps: 8 },
  );
  const overlayBounds = await page.locator(".rf-workspace-tab--overlay").boundingBox();
  expect(overlayBounds).not.toBeNull();
  expect(Math.abs(overlayBounds!.width - firstTabBounds!.width)).toBeLessThanOrEqual(2);
  await page.mouse.up();
});
