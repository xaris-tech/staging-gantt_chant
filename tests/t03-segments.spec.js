const { test, expect } = require('@playwright/test');

async function createProduction(request) {
  const response = await request.post('/api/productions', {
    data: {
      title: `Segment Test Show ${crypto.randomUUID()}`,
      productionDate: '2026-08-09',
      venue: 'Studio A',
      timezone: 'Asia/Manila',
      plannedStart: '2026-08-09T08:00:00+08:00',
      plannedEnd: '2026-08-09T12:00:00+08:00',
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

async function addSegment(page, { name, start, duration, color }) {
  await page.getByRole('button', { name: 'Add segment' }).click();
  await page.getByText('Optional timing').click();
  await page.getByLabel('Segment name').fill(name);
  await page.getByLabel('Segment start').fill(start);
  await page.getByLabel('Duration in minutes').fill(String(duration));
  await page.getByLabel('Segment color').fill(color);
  await page.getByRole('button', { name: 'Save segment' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('creates colorful draggable Segments, edits, reorders, collapses, and reloads them', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);

  await addSegment(page, { name: 'Opening', start: '08:00', duration: 30, color: '#6ee7b7' });
  await addSegment(page, { name: 'Worship', start: '08:30', duration: 60, color: '#fbbf24' });

  const opening = page.getByRole('button', { name: 'Opening', exact: true });
  const worship = page.getByRole('button', { name: 'Worship', exact: true });
  await expect(opening).toBeVisible();
  await expect(worship).toBeVisible();
  await expect(opening.locator('..')).toHaveAttribute('draggable', 'true');
  await expect(worship.locator('..')).toHaveCSS('background-color', 'rgb(251, 191, 36)');
  await expect(page.getByText('8:30 AM')).toHaveCount(0);
  await worship.locator('..').dragTo(opening.locator('..'));
  await expect.poll(async () => page.locator('[data-testid="segment-header"] button[data-segment-name]').allTextContents()).toEqual(['Worship', 'Opening']);
  await worship.locator('..').dragTo(opening.locator('..'));
  await expect.poll(async () => page.locator('[data-testid="segment-header"] button[data-segment-name]').allTextContents()).toEqual(['Opening', 'Worship']);

  await opening.click();
  await page.getByLabel('Segment name').fill('Welcome Opening');
  await page.getByRole('button', { name: 'Save segment' }).click();
  await expect(page.getByRole('button', { name: 'Welcome Opening', exact: true })).toBeVisible();

  const segmentNames = await page.locator('[data-testid="segment-header"] button[data-segment-name]').allTextContents();
  expect(segmentNames).toEqual(['Welcome Opening', 'Worship']);

  await page.getByRole('button', { name: 'Collapse Worship' }).click();
  await expect(page.getByRole('button', { name: 'Expand Worship' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Welcome Opening', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Worship', exact: true })).toBeVisible();
});

test('uses a light canvas with accessible destructive-action contrast', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await addSegment(page, { name: 'Opening', start: '08:00', duration: 30, color: '#6cb87a' });
  await page.getByRole('button', { name: 'Opening', exact: true }).click();
  const result = await page.getByRole('button', { name: 'Delete segment' }).evaluate((element) => {
    const parse = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = (rgb) => rgb.map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const style = getComputedStyle(element); const foreground = luminance(parse(style.color)); const background = luminance(parse(style.backgroundColor));
    return { scheme: getComputedStyle(document.documentElement).colorScheme, ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) };
  });
  expect(result.scheme).toContain('light');
  expect(result.ratio).toBeGreaterThanOrEqual(4.5);
});

test('offers hover plus controls on the board for adding Lanes and Segment columns', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  const boardHeader = page.getByTestId('board-add-controls');
  const boardButtons = page.getByTestId('board-add-buttons');
  const addLane = page.getByRole('button', { name: 'Create board lane' });
  const addSegment = page.getByRole('button', { name: 'Create board column' });
  await expect(boardButtons).toHaveCSS('opacity', '0');
  await boardHeader.hover();
  await expect(boardButtons).toHaveCSS('opacity', '1');
  await addLane.click(); await expect(page.getByRole('heading', { name: 'Add lane' })).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await boardHeader.hover(); await addSegment.click();
  await expect(page.getByRole('heading', { name: 'Add segment' })).toBeVisible();
});

test('adds a Segment column directly after the hovered Segment', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await addSegment(page, { name: 'Opening', start: '08:00', duration: 30, color: '#6cb87a' });
  const openingHeader = page.locator('[data-testid^="segment-column-header-"]').filter({ hasText: 'Opening' });
  const addColumn = page.getByRole('button', { name: 'Create column after Opening' });
  await expect(addColumn).toHaveCSS('opacity', '0');
  await openingHeader.hover(); await expect(addColumn).toHaveCSS('opacity', '1');
  const headerBox = await openingHeader.boundingBox(); const addBox = await addColumn.boundingBox();
  expect(addBox.x + addBox.width / 2).toBeGreaterThan(headerBox.x + headerBox.width - 4);
  await addColumn.click();
  await page.getByLabel('Segment name').fill('Message');
  await page.getByRole('button', { name: 'Save segment' }).click();
  const openingX = (await page.getByRole('button', { name: 'Opening', exact: true }).boundingBox()).x;
  const messageX = (await page.getByRole('button', { name: 'Message', exact: true }).boundingBox()).x;
  expect(messageX).toBeGreaterThan(openingX);
  await page.reload();
  expect((await page.getByRole('button', { name: 'Message', exact: true }).boundingBox()).x).toBeGreaterThan((await page.getByRole('button', { name: 'Opening', exact: true }).boundingBox()).x);
});

test('rejects a Segment outside the Production planned run', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await page.getByRole('button', { name: 'Add segment' }).click();
  await page.getByText('Optional timing').click();
  await page.getByLabel('Segment name').fill('Too Late');
  await page.getByLabel('Segment start').fill('11:45');
  await page.getByLabel('Duration in minutes').fill('30');
  await page.getByRole('button', { name: 'Save segment' }).click();
  await expect(page.getByRole('alert')).toContainText('within the Production');
});

test('allows optional Segment timing to overlap in the sequence-first board', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await addSegment(page, { name: 'Opening', start: '08:00', duration: 60, color: '#6ee7b7' });
  await page.getByRole('button', { name: 'Add segment' }).click();
  await page.getByText('Optional timing').click();
  await page.getByLabel('Segment name').fill('Overlap');
  await page.getByLabel('Segment start').fill('08:30');
  await page.getByLabel('Duration in minutes').fill('60');
  await page.getByRole('button', { name: 'Save segment' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Overlap', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Overlap', exact: true })).toBeVisible();
});

test('deletes a Segment with confirmation and removes its assigned Activities after reload', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await addSegment(page, { name: 'Opening', start: '08:00', duration: 30, color: '#6ee7b7' });

  await page.getByRole('button', { name: 'Add lane' }).click();
  await page.getByLabel('Lane name').fill('Stage Team');
  await page.getByRole('button', { name: 'Save lane' }).click();
  await page.getByRole('button', { name: 'Add activity' }).click();
  await page.getByText('Optional timing').click();
  await page.getByLabel('Activity name').fill('House Open');
  await page.getByLabel('Activity start').fill('08:00');
  await page.getByLabel('Duration in minutes').fill('10');
  await page.getByRole('button', { name: 'Save activity' }).click();

  await page.getByRole('button', { name: 'Opening', exact: true }).click();
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Delete Opening? This will also delete 1 assigned Activity.');
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Delete segment' }).click();

  await expect(page.getByRole('button', { name: 'Opening', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /House Open,/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete lane Stage Team' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Opening', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /House Open,/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete lane Stage Team' })).toBeVisible();
});

test('reorders Segments without closing schedule gaps or retiming Activities', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await addSegment(page, { name: 'Opening', start: '08:00', duration: 30, color: '#6ee7b7' });
  await addSegment(page, { name: 'Message', start: '10:00', duration: 60, color: '#fbbf24' });

  await page.getByRole('button', { name: 'Add lane' }).click();
  await page.getByLabel('Lane name').fill('Speaker');
  await page.getByRole('button', { name: 'Save lane' }).click();
  await page.getByRole('button', { name: 'Add activity' }).click();
  await page.getByText('Optional timing').click();
  await page.getByLabel('Activity name').fill('Main Message');
  await page.getByLabel('Segment').selectOption({ label: 'Message' });
  await page.getByLabel('Activity start').fill('10:00');
  await page.getByLabel('Duration in minutes').fill('10');
  await page.getByRole('button', { name: 'Save activity' }).click();

  await page.getByRole('button', { name: 'Move Message earlier' }).click();
  const saved = await (await request.get(`/api/productions/${production.id}`)).json();
  expect(saved.segments.find((segment) => segment.label === 'Opening').start).toBe('2026-08-09T00:00:00.000Z');
  expect(saved.segments.find((segment) => segment.label === 'Message').start).toBe('2026-08-09T02:00:00.000Z');
  expect(saved.activities.find((activity) => activity.label === 'Main Message').start).toBe('2026-08-09T02:00:00.000Z');
});

test('keeps the Segment inspector open and explains a failed deletion', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await addSegment(page, { name: 'Opening', start: '08:00', duration: 30, color: '#6ee7b7' });
  await page.getByRole('button', { name: 'Opening', exact: true }).click();
  await page.route(`/api/productions/${production.id}`, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'A newer Production revision exists. Reload before deleting.' }) });
    } else {
      await route.continue();
    }
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete segment' }).click();

  await expect(page.getByRole('dialog', { name: 'Edit segment' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('A newer Production revision exists. Reload before deleting.');
  await expect(page.getByRole('button', { name: 'Delete segment' })).toBeEnabled();
});

test('keeps Segment order unchanged and explains a failed reorder', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await addSegment(page, { name: 'Opening', start: '08:00', duration: 30, color: '#6ee7b7' });
  await addSegment(page, { name: 'Message', start: '10:00', duration: 60, color: '#fbbf24' });
  await page.route(`/api/productions/${production.id}`, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'A newer Production revision exists. Reload before reordering.' }) });
    } else {
      await route.continue();
    }
  });
  await page.getByRole('button', { name: 'Move Message earlier' }).click();
  await expect(page.getByRole('alert')).toHaveText('A newer Production revision exists. Reload before reordering.');
  const segmentNames = await page.locator('[data-testid="segment-header"] button[data-segment-name]').allTextContents();
  expect(segmentNames).toEqual(['Opening', 'Message']);
});
