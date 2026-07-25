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

test('offers an explicit Save now action in addition to autosave', async ({ page, request }) => {
  const created = await (await request.post('/api/productions', { data: {
    title: `Manual Save ${crypto.randomUUID()}`, productionDate: '2026-08-22', venue: 'Stage', timezone: 'Asia/Manila',
    plannedStart: '2026-08-22T08:00:00+08:00', plannedEnd: '2026-08-22T12:00:00+08:00',
  } })).json();
  await page.goto(`/app/?production=${created.id}`);
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByLabel('Save status')).toHaveText('Saved');
  const stored = await (await request.get(`/api/productions/${created.id}`)).json();
  expect(stored.revision).toBe(created.revision + 1);
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
