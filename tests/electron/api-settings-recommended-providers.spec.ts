import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test("adds recommended providers on demand from an initially empty list", async ({ page }) => {
  await page.goto("http://127.0.0.1:6981/tests/fixtures/api-settings-recommended-providers.html");

  const recommendedButton = page.getByRole("button", { name: /推荐平台|Recommended providers/ });
  await expect(recommendedButton).toBeVisible();
  await expect(page.locator(".settings-api-provider-card")).toHaveCount(0);

  await recommendedButton.click();
  const recommendedCards = page.locator("[data-recommended-provider-id]");
  await expect(recommendedCards).toHaveCount(3);
  const firstCardBounds = await recommendedCards.nth(0).boundingBox();
  const secondCardBounds = await recommendedCards.nth(1).boundingBox();
  expect(firstCardBounds).not.toBeNull();
  expect(secondCardBounds).not.toBeNull();
  expect(Math.abs(firstCardBounds!.y - secondCardBounds!.y)).toBeLessThanOrEqual(2);

  const apimartCard = page.locator('[data-recommended-provider-id="apimart"]');
  await apimartCard.getByRole("button", { name: /打开 APIMart 官网|Open the APIMart website/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-opened-provider-website", "apimart");
  await apimartCard.getByRole("button", { name: /添加|Add/ }).click();
  await expect(page.locator('[data-sidebar-item-id="apimart"]')).toBeVisible();
  await expect(apimartCard.getByRole("button", { name: /已添加|Added/ })).toBeDisabled();

  const libtvCard = page.locator('[data-recommended-provider-id="libtv"]');
  await libtvCard.getByRole("button", { name: /打开 LibTV 官网|Open the LibTV website/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-opened-provider-website", "libtv");
  await libtvCard.getByRole("button", { name: /添加|Add/ }).click();
  await expect(page.locator('[data-sidebar-item-id="libtv"]')).toBeVisible();
  await expect(libtvCard.getByRole("button", { name: /已添加|Added/ })).toBeDisabled();
  const tudouCard = page.locator('[data-recommended-provider-id="tudou-api"]');
  await tudouCard.getByRole("button", { name: /打开 土豆API 官网|Open the Tudou API website/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-opened-provider-website", "tudou-api");
  await tudouCard.getByRole("button", { name: /添加|Add/ }).click();
  await expect(page.locator('[data-sidebar-item-id="tudou-api"]')).toBeVisible();
  await expect(page.locator('[data-sidebar-item-id="tudou-api"]')).toContainText("Potato");
  await expect(tudouCard.getByRole("button", { name: /已添加|Added/ })).toBeDisabled();
  await expect(page.locator("html")).toHaveAttribute("data-provider-order", "apimart,libtv,tudou-api");

  await page.locator('[data-sidebar-item-id="tudou-api"]').click();
  const tudouModelRows = page.locator(".settings-api-model-row--catalog");
  const tudouModelToggles = tudouModelRows.locator('[data-slot="checkbox"]');
  await expect(tudouModelRows).toHaveCount(8);
  await expect(tudouModelToggles).toHaveCount(8);
  for (let index = 0; index < 8; index += 1) {
    await expect(tudouModelToggles.nth(index)).toHaveAttribute("data-state", "unchecked");
  }
  await tudouModelToggles.first().click();
  await expect(tudouModelToggles.first()).toHaveAttribute("data-state", "checked");

  await page.locator('[data-sidebar-item-id="apimart"]').click();
  await page.getByRole("button", { name: /移除|Remove/ }).click();
  await page.getByRole("button", { name: /确认移除|Confirm removal/ }).click();
  await expect(page.locator('[data-sidebar-item-id="apimart"]')).toHaveCount(0);
  await expect(apimartCard.getByRole("button", { name: /添加|Add/ })).toBeEnabled();

  await page.locator('[data-sidebar-item-id="tudou-api"]').click();
  await page.getByRole("button", { name: /移除|Remove/ }).click();
  await page.getByRole("button", { name: /确认移除|Confirm removal/ }).click();
  await expect(page.locator('[data-sidebar-item-id="tudou-api"]')).toHaveCount(0);
  await expect(tudouCard.getByRole("button", { name: /添加|Add/ })).toBeEnabled();

  await page.locator('[data-sidebar-item-id="libtv"]').click();
  await expect(page.locator('[data-libtv-status-loading="install"]')).toBeVisible();
  await expect(page.locator(".settings-libtv-install-control [data-slot=button]")).toHaveCount(0);
  await expect(page.locator('[data-libtv-status-loading="install"]')).toHaveCount(0);
  await expect(page.locator(".settings-api-test-actions").getByRole("button", { name: /移除|Remove/ })).toBeVisible();
  await page.locator(".settings-libtv-machine-id input").fill("machineKeep123");
  await page.getByRole("button", { name: /移除|Remove/ }).click();
  await page.getByRole("button", { name: /确认移除|Confirm removal/ }).click();
  await expect(page.locator('[data-sidebar-item-id="libtv"]')).toHaveCount(0);
  await expect(libtvCard.getByRole("button", { name: /添加|Add/ })).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("data-provider-order", "");

  await libtvCard.getByRole("button", { name: /添加|Add/ }).click();
  await page.locator('[data-sidebar-item-id="libtv"]').click();
  await expect(page.locator(".settings-libtv-machine-id input")).toHaveValue("machineKeep123");
});
