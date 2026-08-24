import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('@reference capture the live RetailFlow visual source', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'rf.auth',
      JSON.stringify({
        id: 'visual-reference-owner',
        email: 'owner@example.test',
        name: 'Gideon Lyomu',
        businessId: 'visual-reference-business',
        role: 'Owner',
        branchIds: [],
        canAccessAllBranches: true,
        expiresAt: '2099-01-01T00:00:00.000Z',
        onboardingComplete: true,
        platformAccess: { allowed: true, status: 'active' },
      }),
    );
  });
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto('http://127.0.0.1:8080/dashboard', {
    waitUntil: 'domcontentloaded',
    timeout: 20_000,
  });
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
  const projectRoot = path.resolve(process.cwd(), '..', '..');
  const referencePath = path.join(
    projectRoot,
    'visual-baselines',
    'reference',
    'retailflow-live.png',
  );
  const currentPath = path.join(
    process.cwd(),
    'e2e',
    '__screenshots__',
    'desktop',
    'dashboard.png',
  );
  const comparisonPath = path.join(
    projectRoot,
    'visual-baselines',
    'dashboard-desktop-comparison.png',
  );

  await page.screenshot({ path: referencePath, fullPage: true });

  const comparison = await page.context().newPage();
  await comparison.setViewportSize({ width: 2880, height: 1048 });
  await comparison.setContent(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          html, body { margin: 0; background: #0a1f3f; font-family: Arial, sans-serif; }
          main { display: grid; grid-template-columns: 1440px 1440px; }
          figure { margin: 0; background: white; }
          figcaption { height: 48px; padding: 14px 20px; color: white; background: #0a1f3f; font-size: 16px; font-weight: 700; }
          img { display: block; width: 1440px; height: 1000px; object-fit: cover; object-position: top; }
        </style>
      </head>
      <body>
        <main>
          <figure>
            <figcaption>RetailFlow reference</figcaption>
            <img alt="RetailFlow reference" src="data:image/png;base64,${fs.readFileSync(referencePath).toString('base64')}" />
          </figure>
          <figure>
            <figcaption>RetailBooks implementation</figcaption>
            <img alt="RetailBooks implementation" src="data:image/png;base64,${fs.readFileSync(currentPath).toString('base64')}" />
          </figure>
        </main>
      </body>
    </html>
  `);
  await comparison.screenshot({ path: comparisonPath, fullPage: true });
  await comparison.close();
  console.log(`RetailFlow reference URL: ${page.url()}`);
});
