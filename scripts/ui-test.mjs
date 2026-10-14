import { randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
const suffix = Date.now();
const code = `UI-${suffix}`;
const name = `浏览器测试样品 ${suffix}`;
const png = await sharp({
  create: {
    width: 160,
    height: 100,
    channels: 3,
    background: { r: suffix % 255, g: 131, b: 70 },
  },
})
  .composite([
    {
      input: randomBytes(300),
      raw: { width: 10, height: 10, channels: 3 },
      left: 0,
      top: 0,
    },
  ])
  .png()
  .toBuffer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const screenshotDir = process.env.SCREENSHOT_DIR || "/tmp/fabric-sample-ui";
await mkdir(screenshotDir, { recursive: true });
let sampleId;
try {
  await page.goto("http://127.0.0.1:5173");
  await page
    .getByRole("button", { name: /创建样品/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("样品编号").fill(code);
  await dialog.getByLabel("样品名称").fill(name);
  await dialog
    .locator("input[type=file]")
    .setInputFiles({ name: "sample.png", mimeType: "image/png", buffer: png });
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/samples") && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "确 定" }).click();
  const response = await created;
  assert.equal(response.status(), 201);
  sampleId = (await response.json()).id;
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name }).waitFor();
  await page.screenshot({
    path: `${screenshotDir}/samples.png`,
    fullPage: true,
  });
  await page.getByRole("heading", { name }).click();
  await page.getByRole("heading", { name, exact: true }).last().waitFor();
  await page.locator(".ant-drawer-close").click();
  await page.getByRole("link", { name: "以图搜样品" }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "query.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "查找相似样品" }).click();
  await page.getByRole("cell", { name: "100.0%", exact: true }).waitFor();
  await page.getByRole("button", { name, exact: true }).waitFor();
  await page.screenshot({
    path: `${screenshotDir}/search.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "字段设置" }).click();
  await page.getByRole("heading", { name: "字段设置" }).waitFor();
  await page.getByRole("button", { name: /添加字段/ }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "样品管理" }).click();
  await page.getByRole("heading", { name: "样品管理" }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    ),
    "mobile page should not overflow horizontally",
  );
  await page.screenshot({
    path: `${screenshotDir}/mobile.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: browser create/upload, sample detail, image search with exact match, field settings, mobile layout, no page errors.",
  );
} finally {
  if (sampleId)
    await fetch(`http://127.0.0.1:3001/api/samples/${sampleId}`, {
      method: "DELETE",
    });
  await browser.close();
}
