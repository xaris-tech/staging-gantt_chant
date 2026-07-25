const { test, expect } = require('@playwright/test');

async function createProduction(request) {
  const response = await request.post('/api/productions', {
    data: {
      title: `Activity Test Show ${crypto.randomUUID()}`, productionDate: '2026-08-10', venue: 'Main Stage', timezone: 'Asia/Manila',
      plannedStart: '2026-08-10T08:00:00+08:00', plannedEnd: '2026-08-10T12:00:00+08:00',
    },
  });
  return response.json();
}

test('adds an Activity immediately on an empty Production by creating starter placement', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  const addActivity = page.getByRole('button', { name: 'Add activity' });
  await expect(addActivity).toBeEnabled();
  await addActivity.click();
  await page.getByLabel('Activity name').fill('Opening Cue');
  await page.getByRole('button', { name: 'Save activity' }).click();
  await expect(page.getByRole('button', { name: /Opening Cue, General, Show/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Opening Cue, General, Show/ })).toBeVisible();
});

async function addSegment(page) {
  await page.getByRole('button', { name: 'Add segment' }).click();
  await page.getByText('Optional timing').click();
  await page.getByLabel('Segment name').fill('Choir Production');
  await page.getByLabel('Segment start').fill('09:00');
  await page.getByLabel('Duration in minutes').fill('60');
  await page.getByRole('button', { name: 'Save segment' }).click();
}

async function addLane(page) {
  await page.getByRole('button', { name: 'Add lane' }).click();
  await page.getByLabel('Lane name').fill('Performers');
  await page.getByLabel('Lane group').fill('Program');
  await page.getByRole('button', { name: 'Save lane' }).click();
}

test('adds a Lane and timed Activity, edits it in the Inspector, and reloads it', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await addSegment(page);
  await addLane(page);

  await page.getByRole('button', { name: 'Add activity' }).click();
  await page.getByText('Optional timing').click();
  await page.getByLabel('Activity name').fill('Choir Entrance');
  await page.getByLabel('Activity start').fill('09:05');
  await page.getByLabel('Duration in minutes').fill('5');
  await page.getByLabel('Activity type').selectOption('entrance');
  await page.getByLabel('Activity status').selectOption('confirmed');
  await page.getByLabel('Owner').fill('Stage Manager');
  await page.getByLabel('Activity notes').fill('Enter from stage left');
  await page.getByRole('button', { name: 'Save activity' }).click();

  const block = page.getByRole('button', { name: /Choir Entrance, Performers, Choir Production, confirmed/ });
  await expect(block).toBeVisible();
  await block.click();
  await expect(page.getByRole('heading', { name: 'Activity inspector' })).toBeVisible();
  await page.getByText('Optional timing').click();
  await expect(page.getByText('Calculated end:')).toContainText('9:10 AM');
  await page.getByLabel('Activity name').fill('Choir Grand Entrance');
  await page.getByLabel('Duration in minutes').fill('8');
  await page.getByRole('button', { name: 'Save activity' }).click();

  await page.reload();
  await expect(page.getByRole('button', { name: /Choir Grand Entrance, Performers, Choir Production, confirmed/ })).toBeVisible();
});

test('adds an Activity from a hovered board cell with its Lane and Segment preselected', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await addSegment(page); await addLane(page);
  const cell = page.getByLabel('Performers, Choir Production drop zone');
  const contextualAdd = page.getByRole('button', { name: 'Create activity in Performers, Choir Production' });
  await expect(contextualAdd).toHaveCSS('opacity', '0');
  await cell.hover(); await expect(contextualAdd).toHaveCSS('opacity', '1');
  await contextualAdd.click();
  await expect(page.getByLabel('Segment')).toHaveValue(/.+/);
  await expect(page.getByLabel('Segment').locator('option:checked')).toHaveText('Choir Production');
  await expect(page.getByLabel('Lane').locator('option:checked')).toHaveText('Performers');
  await page.getByLabel('Activity name').fill('Cell Cue');
  await page.getByRole('button', { name: 'Save activity' }).click();
  await expect(page.getByRole('button', { name: /Cell Cue, Performers, Choir Production/ })).toBeVisible();
});

test('adds a new Lane row directly below the hovered Lane', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await addSegment(page); await addLane(page);
  const laneHeader = page.locator('[data-testid^="lane-row-header-"]').filter({ hasText: 'Performers' });
  const addRow = page.getByRole('button', { name: 'Create row after Performers' });
  await expect(addRow).toHaveCSS('opacity', '0');
  await laneHeader.hover(); await expect(addRow).toHaveCSS('opacity', '1');
  const laneBox = await laneHeader.boundingBox(); const addRowBox = await addRow.boundingBox();
  expect(Math.abs((addRowBox.x + addRowBox.width / 2) - (laneBox.x + laneBox.width / 2))).toBeLessThan(3);
  expect(addRowBox.y + addRowBox.height / 2).toBeGreaterThan(laneBox.y + laneBox.height - 4);
  await addRow.click();
  await page.getByLabel('Lane name').fill('Technical');
  await page.getByLabel('Lane group').fill('Crew');
  await page.getByRole('button', { name: 'Save lane' }).click();
  const performersY = (await page.getByText('Performers', { exact: true }).boundingBox()).y;
  const technicalY = (await page.getByText('Technical', { exact: true }).boundingBox()).y;
  expect(technicalY).toBeGreaterThan(performersY);
  await laneHeader.hover();
  expect(await addRow.evaluate((button) => { const box = button.getBoundingClientRect(); return document.elementFromPoint(box.left + box.width / 2, box.bottom - 2)?.closest('button') === button; })).toBe(true);
  await page.reload();
  expect((await page.getByText('Technical', { exact: true }).boundingBox()).y).toBeGreaterThan((await page.getByText('Performers', { exact: true }).boundingBox()).y);
});

test('allows an Activity to cross its starting Segment boundary', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await addSegment(page);
  await addLane(page);
  await page.getByRole('button', { name: 'Add activity' }).click();
  await page.getByText('Optional timing').click();
  await page.getByLabel('Activity name').fill('Overlong Performance');
  await page.getByLabel('Activity start').fill('09:50');
  await page.getByLabel('Duration in minutes').fill('20');
  await page.getByRole('button', { name: 'Save activity' }).click();
  await expect(page.getByRole('button', { name: /Overlong Performance, Performers, Choir Production/ })).toBeVisible();
});

test('deletes an Activity and confirms Lane deletion impact', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await addSegment(page);
  await addLane(page);
  await page.getByRole('button', { name: 'Add activity' }).click();
  await page.getByText('Optional timing').click();
  await page.getByLabel('Activity name').fill('Temporary Cue');
  await page.getByLabel('Activity start').fill('09:10');
  await page.getByRole('button', { name: 'Save activity' }).click();
  await page.getByRole('button', { name: /Temporary Cue,/ }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete activity' }).click();
  await expect(page.getByRole('button', { name: /Temporary Cue,/ })).toHaveCount(0);

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('0 assigned Activities');
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Delete lane Performers' }).click();
  await expect(page.getByText('Performers', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Performers', { exact: true })).toHaveCount(0);
});

test('rejects orphaned Activity references at the API boundary', async ({ request }) => {
  const production = await createProduction(request);
  const response = await request.put(`/api/productions/${production.id}`, { data: {
    ...production,
    activities: [{ id: 'orphan', segmentId: 'missing', laneId: 'missing', label: 'Orphan', type: 'custom', start: '2026-08-10T09:00:00+08:00', durationMinutes: 5, owner: '', status: 'planned', color: '#ffffff', notes: '' }],
  } });
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('existing Segment and Lane') });
});

test('keeps the Activity inspector open and explains a failed deletion', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await addSegment(page);
  await addLane(page);
  await page.getByRole('button', { name: 'Add activity' }).click();
  await page.getByText('Optional timing').click();
  await page.getByLabel('Activity name').fill('Choir Entrance');
  await page.getByLabel('Activity start').fill('09:00');
  await page.getByRole('button', { name: 'Save activity' }).click();
  await page.getByRole('button', { name: /Choir Entrance,/ }).click();
  await page.route(`/api/productions/${production.id}`, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'A newer Production revision exists. Reload before deleting.' }) });
    } else {
      await route.continue();
    }
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete activity' }).click();
  await expect(page.getByRole('dialog', { name: 'Activity inspector' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('A newer Production revision exists. Reload before deleting.');
});

test('keeps a Lane visible and explains a failed deletion', async ({ page, request }) => {
  const production = await createProduction(request);
  await page.goto(`/app/?production=${production.id}`);
  await addSegment(page);
  await addLane(page);
  await page.route(`/api/productions/${production.id}`, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'A newer Production revision exists. Reload before deleting.' }) });
    } else {
      await route.continue();
    }
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete lane Performers' }).click();
  await expect(page.getByRole('button', { name: 'Delete lane Performers' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('A newer Production revision exists. Reload before deleting.');
});
