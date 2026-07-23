import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 2048, height: 1152 } });

test("keeps reference and result navigation visible inside their panes", async ({ page }) => {
  await page.goto("http://127.0.0.1:6981/tests/fixtures/action-fission-image-viewer.html");

  await expect(page.getByRole("dialog", { name: "Action fission result viewer" })).toBeVisible();

  const panes = page.locator(".rf-reference-comparison-viewer-pane");
  await expect(panes).toHaveCount(2);

  const referenceNavigation = page.locator(".rf-reference-comparison-viewer-reference-nav");
  await expect(referenceNavigation).toBeVisible();
  await expect(referenceNavigation).toContainText("1 / 1");
  await expect(referenceNavigation.getByRole("button")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Previous reference" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next reference" })).toBeDisabled();

  const leftPaneBounds = await panes.first().boundingBox();
  const referenceNavigationBounds = await referenceNavigation.boundingBox();
  expect(leftPaneBounds).not.toBeNull();
  expect(referenceNavigationBounds).not.toBeNull();
  expect(referenceNavigationBounds!.y).toBeGreaterThanOrEqual(leftPaneBounds!.y);
  expect(referenceNavigationBounds!.y + referenceNavigationBounds!.height).toBeLessThanOrEqual(leftPaneBounds!.y + leftPaneBounds!.height);
  const referenceNavigationTopmost = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return {
      isNavigation: Boolean(element?.closest(".rf-reference-comparison-viewer-reference-nav")),
      tagName: element?.tagName,
      className: element?.getAttribute("class"),
    };
  }, {
    x: referenceNavigationBounds!.x + referenceNavigationBounds!.width / 2,
    y: referenceNavigationBounds!.y + referenceNavigationBounds!.height / 2,
  });
  expect(referenceNavigationTopmost).toEqual(expect.objectContaining({ isNavigation: true }));

  const resultNavigation = page.locator(".rf-reference-comparison-viewer-result-nav");
  await expect(resultNavigation).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Previous result" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next result" })).toBeVisible();

  const rightPaneBounds = await panes.nth(1).boundingBox();
  const previousBounds = await page.getByRole("button", { name: "Previous result" }).boundingBox();
  const nextBounds = await page.getByRole("button", { name: "Next result" }).boundingBox();
  expect(rightPaneBounds).not.toBeNull();
  expect(previousBounds).not.toBeNull();
  expect(nextBounds).not.toBeNull();
  expect(previousBounds!.x).toBeGreaterThanOrEqual(rightPaneBounds!.x);
  expect(nextBounds!.x + nextBounds!.width).toBeLessThanOrEqual(rightPaneBounds!.x + rightPaneBounds!.width);

  await page.getByRole("button", { name: "Next result" }).click();
  await expect(page.locator(".model-image-viewer-counter")).toHaveText("2 / 6");

  const separator = page.locator('[data-slot="resizable-handle"]');
  const beforeDrag = await panes.first().boundingBox();
  const separatorBounds = await separator.boundingBox();
  expect(beforeDrag).not.toBeNull();
  expect(separatorBounds).not.toBeNull();
  await page.mouse.move(separatorBounds!.x + separatorBounds!.width / 2, separatorBounds!.y + separatorBounds!.height / 2);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)!).cursor)).toMatch(/col-resize|ew-resize/);
  await page.mouse.move(beforeDrag!.x + 120, beforeDrag!.y + 120);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.elementFromPoint(196, 196)!).cursor)).not.toMatch(/col-resize|ew-resize/);

  const viewerImages = page.locator(".model-image-viewer");
  await expect(viewerImages).toHaveCount(2);
  const leftImageBounds = await viewerImages.first().boundingBox();
  const rightImageBounds = await viewerImages.nth(1).boundingBox();
  expect(leftImageBounds).not.toBeNull();
  expect(rightImageBounds).not.toBeNull();
  const defaultTransforms = await viewerImages.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).style.transform));
  await page.mouse.move(leftImageBounds!.x + leftImageBounds!.width / 2, leftImageBounds!.y + leftImageBounds!.height / 2);
  await page.mouse.wheel(0, -240);
  await expect.poll(() => viewerImages.first().evaluate((element) => (element as HTMLElement).style.transform)).not.toBe(defaultTransforms[0]);
  await page.mouse.move(rightImageBounds!.x + rightImageBounds!.width / 2, rightImageBounds!.y + rightImageBounds!.height / 2);
  await page.mouse.wheel(0, -240);
  await expect.poll(() => viewerImages.nth(1).evaluate((element) => (element as HTMLElement).style.transform)).not.toBe(defaultTransforms[1]);
  const transformsBeforeDrag = await viewerImages.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).style.transform));

  await page.mouse.move(separatorBounds!.x + separatorBounds!.width / 2, separatorBounds!.y + separatorBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(separatorBounds!.x + 160, separatorBounds!.y + separatorBounds!.height / 2, { steps: 8 });
  await page.mouse.up();
  const afterDrag = await panes.first().boundingBox();
  expect(afterDrag!.width).toBeGreaterThan(beforeDrag!.width + 100);
  await expect.poll(() => viewerImages.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).style.transform))).toEqual(transformsBeforeDrag);
  await page.mouse.move(afterDrag!.x + 120, afterDrag!.y + 120);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.elementFromPoint(196, 196)!).cursor)).not.toMatch(/col-resize|ew-resize/);

  await page.screenshot({ path: "test-results/playwright/action-fission-image-viewer-verified.png", fullPage: true });
});
