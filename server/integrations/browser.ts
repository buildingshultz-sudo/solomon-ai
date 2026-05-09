/**
 * Solomon's Forge — Playwright browser automation.
 *
 * High-level helpers used by the `browser` tool in the tools registry.
 * Every browser session registers an AbortController with the kill switch,
 * so the red kill button closes any open browser pages.
 *
 * Supports: navigate, click, fill, screenshot (returns data URL), extract
 * (HTML or text), and a generic `evaluate` for advanced cases.
 *
 * Headless by default; pass `headed: true` to see the browser window.
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { registerOperation } from "../solomon/killSwitch";

let chromium: any = null;
async function getChromium() {
  if (chromium) return chromium;
  try {
    const mod = await import("playwright");
    chromium = (mod as any).chromium;
    return chromium;
  } catch {
    throw new Error(
      "Playwright is not installed. After upgrading run `pnpm install && npx playwright install chromium` from the install dir."
    );
  }
}

export type BrowserStep =
  | { action: "goto"; url: string; waitUntil?: "load" | "domcontentloaded" | "networkidle" }
  | { action: "click"; selector: string }
  | { action: "fill"; selector: string; value: string }
  | { action: "press"; selector: string; key: string }
  | { action: "wait"; ms?: number; selector?: string }
  | { action: "screenshot"; path?: string; fullPage?: boolean }
  | { action: "extract"; selector?: string; mode?: "text" | "html" }
  | { action: "evaluate"; script: string };

export type BrowserRunInput = {
  steps: BrowserStep[];
  headed?: boolean;
  /** Optional persistent profile dir (lets you stay logged into sites across runs). */
  profile?: string;
};

export type BrowserRunResult = {
  ok: boolean;
  results: Array<{ action: string; ok: boolean; data?: any; error?: string }>;
  screenshots: string[];
};

export async function runBrowser(input: BrowserRunInput): Promise<BrowserRunResult> {
  const browserType = await getChromium();

  const ac = new AbortController();
  const handle = registerOperation({
    label: `Browser session (${input.steps.length} steps)`,
    kind: "tool",
    controller: ac,
  });

  const dataDir =
    input.profile ||
    path.join(process.env.SOLOMON_DATA_DIR || path.join(os.homedir(), ".solomon-data"), "browser");
  await fs.mkdir(dataDir, { recursive: true });

  const ctx = await browserType.launchPersistentContext(dataDir, {
    headless: !input.headed,
    viewport: { width: 1280, height: 800 },
  });

  const onAbort = () => {
    ctx.close().catch(() => {});
  };
  ac.signal.addEventListener("abort", onAbort);

  const page = ctx.pages()[0] || (await ctx.newPage());
  const results: BrowserRunResult["results"] = [];
  const screenshots: string[] = [];

  try {
    for (const step of input.steps) {
      try {
        switch (step.action) {
          case "goto": {
            await page.goto(step.url, { waitUntil: step.waitUntil ?? "domcontentloaded" });
            results.push({ action: "goto", ok: true, data: { url: page.url() } });
            break;
          }
          case "click": {
            await page.click(step.selector);
            results.push({ action: "click", ok: true });
            break;
          }
          case "fill": {
            await page.fill(step.selector, step.value);
            results.push({ action: "fill", ok: true });
            break;
          }
          case "press": {
            await page.press(step.selector, step.key);
            results.push({ action: "press", ok: true });
            break;
          }
          case "wait": {
            if (step.selector) await page.waitForSelector(step.selector);
            else await page.waitForTimeout(step.ms ?? 500);
            results.push({ action: "wait", ok: true });
            break;
          }
          case "screenshot": {
            const out =
              step.path ||
              path.join(
                dataDir,
                `shot-${Date.now()}.png`,
              );
            await page.screenshot({ path: out, fullPage: !!step.fullPage });
            screenshots.push(out);
            results.push({ action: "screenshot", ok: true, data: { path: out } });
            break;
          }
          case "extract": {
            const sel = step.selector || "body";
            const data =
              step.mode === "html"
                ? await page.locator(sel).innerHTML()
                : await page.locator(sel).innerText();
            results.push({ action: "extract", ok: true, data });
            break;
          }
          case "evaluate": {
            const data = await page.evaluate(step.script);
            results.push({ action: "evaluate", ok: true, data });
            break;
          }
        }
      } catch (err: any) {
        results.push({ action: step.action, ok: false, error: err?.message ?? String(err) });
      }
    }
    return { ok: results.every((r) => r.ok), results, screenshots };
  } finally {
    ac.signal.removeEventListener("abort", onAbort);
    await ctx.close().catch(() => {});
    handle.complete();
  }
}
