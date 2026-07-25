const { test, expect } = require('@playwright/test');

test('creates a Production and reopens its persisted metadata from home', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New production' }).click();

  await page.getByLabel('Production title').fill('Youth Night Live');
  await page.getByLabel('Production date').fill('2026-08-08');
  await page.getByLabel('Venue').fill('Main Auditorium');
  await page.getByLabel('Floor Directors').fill('Mia Santos, Joel Cruz');
  await expect(page.getByLabel('Planned start')).not.toBeVisible();
  await page.getByText('Optional timing').click();
  await page.getByLabel('Timezone').selectOption('Asia/Manila');
  await page.getByLabel('Planned start').fill('18:00');
  await page.getByLabel('Planned end').fill('21:30');
  await page.getByRole('button', { name: 'Create production' }).click();

  await expect(page.getByRole('heading', { name: 'Youth Night Live' })).toBeVisible();
  await expect(page.getByLabel('Save status')).toHaveText('Saved');
  await expect(page.getByText('Main Auditorium', { exact: true })).toBeVisible();
  await expect(page.getByText('Mia Santos, Joel Cruz', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'All productions' }).click();
  await page.getByRole('link', { name: /Youth Night Live/ }).click();
  await expect(page.getByRole('heading', { name: 'Youth Night Live' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Main Auditorium', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Floor Directors' }).click();
  await page.getByLabel('Floor Director names').fill('Mia Santos, Joel Cruz, Ana Reyes');
  await page.getByRole('button', { name: 'Save Floor Directors' }).click();
  await expect(page.getByText('Mia Santos, Joel Cruz, Ana Reyes', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Mia Santos, Joel Cruz, Ana Reyes', { exact: true })).toBeVisible();
});

test('rejects a Production whose planned end is not after its start', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New production' }).click();
  await page.getByLabel('Production title').fill('Invalid Run');
  await page.getByLabel('Production date').fill('2026-08-08');
  await page.getByLabel('Venue').fill('Main Auditorium');
  await page.getByText('Optional timing').click();
  await page.getByLabel('Planned start').fill('21:00');
  await page.getByLabel('Planned end').fill('20:00');
  await page.getByRole('button', { name: 'Create production' }).click();

  await expect(page.getByRole('alert')).toContainText('end must be after');
  await expect(page).toHaveURL(/\/app\/$/);
});

test('stores UTC wall-clock times correctly and makes duplicate submissions idempotent', async ({ request }) => {
  const metadata = {
    title: 'UTC Broadcast', productionDate: '2026-08-11', venue: 'Remote Studio', timezone: 'UTC',
    plannedStart: '2026-08-11T18:00:00Z', plannedEnd: '2026-08-11T21:30:00Z',
  };
  const first = await request.post('/api/productions', { data: metadata });
  const second = await request.post('/api/productions', { data: metadata });
  const firstBody = await first.json();
  const secondBody = await second.json();
  expect(secondBody.id).toBe(firstBody.id);
  expect(firstBody.createdAt).toMatch(/^2026-|^2027-/);
  expect(firstBody.updatedAt).toBe(firstBody.createdAt);
});

test('rejects a stale Production revision instead of overwriting newer data', async ({ request }) => {
  const created = await (await request.post('/api/productions', { data: {
    title: 'Revision Test', productionDate: '2026-08-12', venue: 'Studio', timezone: 'Asia/Manila',
    plannedStart: '2026-08-12T08:00:00+08:00', plannedEnd: '2026-08-12T09:00:00+08:00',
  } })).json();
  const firstSave = await request.put(`/api/productions/${created.id}`, { data: { ...created, venue: 'Studio B' } });
  expect(firstSave.ok()).toBe(true);
  const staleSave = await request.put(`/api/productions/${created.id}`, { data: { ...created, venue: 'Studio C' } });
  expect(staleSave.status()).toBe(409);
});

test('exports the complete Stage Sequence Board as a shareable PNG image', async ({ page, request }) => {
  const created = await (await request.post('/api/productions', { data: {
    title: `Manual Save ${crypto.randomUUID()}`, productionDate: '2026-08-22', venue: 'Stage', timezone: 'Asia/Manila',
    plannedStart: '2026-08-22T08:00:00+08:00', plannedEnd: '2026-08-22T12:00:00+08:00',
  } })).json();
  const segments = Array.from({ length: 7 }, (_, position) => ({ id: `segment-${position}`, label: `Segment ${position + 1}`, color: '#6cb87a', start: `2026-08-22T${String(8 + Math.floor(position / 2)).padStart(2, '0')}:${position % 2 ? '30' : '00'}:00+08:00`, durationMinutes: 30, position, notes: '' }));
  const seeded = await request.put(`/api/productions/${created.id}`, { data: { ...created, segments, lanes: [{ id: 'stage', label: 'Stage', group: 'Program', color: '#6a9fd8', position: 0 }] } });
  expect(seeded.ok()).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/?production=${created.id}`);
  await expect(page.getByRole('button', { name: 'Run of Show' })).toHaveAttribute('aria-pressed', 'true');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export image' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^manual-save-.*\.png$/);
  const chunks = []; const stream = await download.createReadStream();
  for await (const chunk of stream) chunks.push(chunk);
  const png = Buffer.concat(chunks);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.readUInt32BE(16)).toBeGreaterThan(2_000);
  expect(png.readUInt32BE(20)).toBeGreaterThan(100);
  await expect(page.getByRole('button', { name: 'Run of Show' })).toHaveAttribute('aria-pressed', 'true');
});

test('Express creation identity includes Floor Directors and timezone', async ({ request }) => {
  const base = {
    title: `Express Director Identity ${crypto.randomUUID()}`, productionDate: '2026-08-21', venue: 'Studio',
    timezone: 'Asia/Manila', plannedStart: '2026-08-21T08:00:00+08:00', plannedEnd: '2026-08-21T09:00:00+08:00',
  };
  const first = await (await request.post('/api/productions', { data: { ...base, floorDirectors: ['Mia Santos'] } })).json();
  const second = await (await request.post('/api/productions', { data: { ...base, floorDirectors: ['Joel Cruz'] } })).json();
  const third = await (await request.post('/api/productions', { data: { ...base, timezone: 'UTC', floorDirectors: ['Mia Santos'] } })).json();
  expect(new Set([first.id, second.id, third.id]).size).toBe(3);
});

test('traps keyboard focus in an editor panel, closes with Escape, and restores focus', async ({ page }) => {
  await page.goto('/app/');
  const trigger = page.getByRole('button', { name: 'New production' });
  await trigger.click();
  await expect(page.getByRole('button', { name: 'Close panel' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Create production' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('converts IANA wall-clock input to canonical instants without changing displayed time', async ({ page, request }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New production' }).click();
  await page.getByLabel('Production title').fill('New York Show');
  await page.getByLabel('Production date').fill('2026-01-15');
  await page.getByLabel('Venue').fill('NY Studio');
  await page.getByText('Optional timing').click();
  await page.getByLabel('Timezone').selectOption('America/New_York');
  await page.getByLabel('Planned start').fill('18:00');
  await page.getByLabel('Planned end').fill('20:00');
  await page.getByRole('button', { name: 'Create production' }).click();
  await expect(page.getByRole('heading', { name: 'New York Show' })).toBeVisible();

  const id = new URL(page.url()).searchParams.get('production');
  expect(id).toBeTruthy();
  const storedResponse = await request.get(`/api/productions/${id}`);
  const storedText = await storedResponse.text();
  expect(storedResponse.status(), storedText).toBe(200);
  const stored = JSON.parse(storedText);
  expect(stored.plannedStart).toBe('2026-01-15T23:00:00.000Z');
  expect(stored.plannedEnd).toBe('2026-01-16T01:00:00.000Z');
});

test('rejects nonexistent DST times and chooses the earlier instant for ambiguous times', async ({ page, request }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New production' }).click();
  await page.getByLabel('Production title').fill('DST Gap');
  await page.getByLabel('Production date').fill('2026-03-08');
  await page.getByLabel('Venue').fill('NY Studio');
  await page.getByText('Optional timing').click();
  await page.getByLabel('Timezone').selectOption('America/New_York');
  await page.getByLabel('Planned start').fill('02:30');
  await page.getByLabel('Planned end').fill('03:30');
  await page.getByRole('button', { name: 'Create production' }).click();
  await expect(page.getByRole('alert')).toContainText('does not exist');
  await page.getByRole('button', { name: 'Close panel' }).click();

  await page.getByRole('button', { name: 'New production' }).click();
  await page.getByLabel('Production title').fill('DST Fold');
  await page.getByLabel('Production date').fill('2026-11-01');
  await page.getByLabel('Venue').fill('NY Studio');
  await page.getByText('Optional timing').click();
  await page.getByLabel('Timezone').selectOption('America/New_York');
  await page.getByLabel('Planned start').fill('01:30');
  await page.getByLabel('Planned end').fill('02:30');
  await page.getByRole('button', { name: 'Create production' }).click();
  await expect(page).toHaveURL(/production=/);
  const id = new URL(page.url()).searchParams.get('production');
  expect(id).toBeTruthy();
  const storedResponse = await request.get(`/api/productions/${id}`);
  const storedText = await storedResponse.text();
  expect(storedResponse.status(), storedText).toBe(200);
  const stored = JSON.parse(storedText);
  expect(stored.plannedStart).toBe('2026-11-01T05:30:00.000Z');
});
