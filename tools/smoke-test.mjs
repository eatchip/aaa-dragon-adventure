import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "/Users/songhuiyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.argv[2] || `file://${path.join(root, "index.html")}`;
const width = Number(process.argv[3]) || 1440;
const height = Number(process.argv[4]) || 900;
const holdMs = Number(process.argv[5]) || 800;
const output = path.join(root, "smoke-preview.png");

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 1,
});

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(url, { waitUntil: "networkidle" });
await page.locator("#demoButton").click();
await page.keyboard.down("Space");
await page.waitForTimeout(holdMs);
await page.keyboard.up("Space");
await page.waitForTimeout(400);

const title = await page.textContent("h1").catch(() => null);
const isPlaying = await page.locator("#hud.is-active").count();
const resultVisible = await page.locator("#resultScreen.is-active").count();
const distance = await page.textContent("#distanceText").catch(() => null);
const emptyLives = await page.locator("#lifeHearts .is-empty").count().catch(() => null);
const resultTitle = await page.textContent("#resultTitle").catch(() => null);
const canvasPixels = await page.evaluate(() => {
  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let nonBlank = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] || data[i + 1] || data[i + 2] || data[i + 3]) nonBlank += 1;
  }
  return nonBlank;
});

await page.screenshot({ path: output, fullPage: true });
await browser.close();

console.log(
  JSON.stringify(
    {
      url,
      output,
      title,
      isPlaying: Boolean(isPlaying),
      resultVisible: Boolean(resultVisible),
      distance,
      livesRemaining: emptyLives === null ? null : 3 - emptyLives,
      resultTitle,
      canvasPixels,
      errors,
    },
    null,
    2
  )
);
