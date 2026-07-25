const { test, expect } = require('@playwright/test');

const validProduction = {
  schemaVersion: 1,
  id: 'default',
  title: 'Sunday Revival',
  productionDate: '2026-07-26',
  venue: 'New Life Center',
  floorDirectors: [],
  timezone: 'Asia/Manila',
  plannedStart: '2026-07-26T08:00:00+08:00',
  plannedEnd: '2026-07-26T12:00:00+08:00',
  revision: 0,
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
  segments: [],
  lanes: [],
  activities: [],
};

test('serves a runtime-validated, versioned seed through the Production API', async ({ request }) => {
  const response = await request.get('/api/productions/default');

  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual(validProduction);
});

test('opens a persisted Production in the new application shell', async ({ page }) => {
  await page.goto('/app/?production=default', { waitUntil: 'domcontentloaded', timeout: 15_000 });

  await expect(page.getByRole('heading', { name: 'Sunday Revival' })).toBeVisible();
  await expect(page.getByText('New Life Center', { exact: true })).toBeVisible();
  await expect(page.getByText('July 26, 2026', { exact: true })).toBeVisible();
  await expect(page.getByText('8:00 AM–12:00 PM')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Stage Sequence Board' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Build the run of show' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open legacy Gantt chart' })).toHaveAttribute(
    'href',
    '/staging_gantt-chart.html',
  );
});

test('rejects invalid Production data without crashing the application', async ({ page }) => {
  await page.route('**/api/productions/default', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...validProduction, timezone: 'Definitely/Not-A-Timezone' }),
    }),
  );

  await page.goto('/app/?production=default', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: "We couldn't load this timeline." })).toBeVisible();
  await expect(page.getByText('The Production data is invalid.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open legacy Gantt chart' }).last()).toHaveAttribute(
    'href',
    '/staging_gantt-chart.html',
  );
});

test('explains an unavailable service and can retry successfully', async ({ page }) => {
  let requestCount = 0;
  await page.route('**/api/productions/default', async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline"}' });
      return;
    }
    await route.continue();
  });

  await page.goto('/app/?production=default', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: "We couldn't load this timeline." })).toBeVisible();
  await expect(page.getByText('Check your connection and try again.')).toBeVisible();

  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Sunday Revival' })).toBeVisible();
  expect(requestCount).toBe(2);
});

test('recovers from a stale Production URL by returning to Production Home', async ({ page }) => {
  await page.goto('/app/?production=missing-production', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Production not found' })).toBeVisible();
  await expect(page.getByText('This Production may have been deleted or opened from an old link.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to productions' }).click();

  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.getByRole('heading', { name: 'Productions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sunday Revival' })).toBeVisible();
});

test('explains when Production Home is served without its API', async ({ page }) => {
  await page.route('**/api/productions', (route) => route.fulfill({ status: 404, body: 'Not Found' }));
  await page.goto('/app/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Production API unavailable' })).toBeVisible();
  await expect(page.getByText('Start this app with npm run dev from the staging-gantt_chant folder.')).toBeVisible();
  await expect(page.getByText('Request failed with 404.')).toHaveCount(0);
});

test('keeps the new shell and legacy fallback usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/?production=default', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Sunday Revival' })).toBeVisible();
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to production' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  const legacyLink = page.getByRole('link', { name: 'Open legacy Gantt chart' });
  await expect(legacyLink).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await legacyLink.click();
  await expect(page).toHaveTitle(/Staging Gantt Chart/);
});

test('rejects legacy chart identifiers that could escape the data directory', async ({ request }) => {
  const response = await request.get('/api/data?chart=..%2Foutside');
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid chart identifier.' });

  const writeResponse = await request.put('/api/data?chart=..%2Foutside', { data: { unsafe: true } });
  expect(writeResponse.status()).toBe(400);
});

test('does not expose source files or stored production data as static assets', async ({ request }) => {
  await expect((await request.get('/package.json')).status()).toBe(404);
  await expect((await request.get('/server.js')).status()).toBe(404);
  await expect((await request.get('/data/production-default.json')).status()).toBe(404);
});
