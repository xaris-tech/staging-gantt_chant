const { test, expect } = require('@playwright/test');

async function seedRunOfShow(request) {
  const created = await (await request.post('/api/productions', {
    data: {
      title: `Live Run of Show ${crypto.randomUUID()}`, productionDate: '2026-08-10', venue: 'Main Stage', timezone: 'Asia/Manila',
      plannedStart: '2026-08-10T08:00:00+08:00', plannedEnd: '2026-08-10T12:00:00+08:00',
    },
  })).json();
  const document = {
    ...created,
    segments: [
      { id: 'opening', label: 'Opening', color: '#6ee7b7', start: '2026-08-10T09:00:00+08:00', durationMinutes: 60, position: 0, notes: '' },
    ],
    lanes: [
      { id: 'performers', label: 'Performers', group: 'Program', color: '#38bdf8', position: 0 },
      { id: 'technical', label: 'Technical', group: 'Crew', color: '#a78bfa', position: 1 },
    ],
    activities: [
      { id: 'a-previous', segmentId: 'opening', laneId: 'technical', label: 'House to Half', type: 'setup', start: '2026-08-10T09:00:00+08:00', durationMinutes: 5, owner: 'Lights', status: 'completed', color: '#a78bfa', notes: '' },
      { id: 'b-current', segmentId: 'opening', laneId: 'performers', label: 'Choir Entrance', type: 'entrance', start: '2026-08-10T09:05:00+08:00', durationMinutes: 10, owner: 'Stage Manager', status: 'confirmed', color: '#fbbf24', notes: 'Enter stage left' },
      { id: 'c-next', segmentId: 'opening', laneId: 'performers', label: 'Welcome Song', type: 'performance', start: '2026-08-10T09:20:00+08:00', durationMinutes: 5, owner: 'Choir Lead', status: 'planned', color: '#fb7185', notes: '' },
      { id: 'd-next-same-time', segmentId: 'opening', laneId: 'technical', label: 'LED Welcome Visual', type: 'performance', start: '2026-08-10T09:20:00+08:00', durationMinutes: 5, owner: 'LED Op', status: 'planned', color: '#22d3ee', notes: '' },
    ],
  };
  const saved = await request.put(`/api/productions/${created.id}`, { data: document });
  expect(saved.ok()).toBe(true);
  return saved.json();
}

test('opens a sequence-first Run of Show by default on mobile without clock timing', async ({ page, request }) => {
  const production = await seedRunOfShow(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2026-08-10T01:07:00Z'));
  await page.goto(`/app/?production=${production.id}`);

  await expect(page.getByRole('heading', { name: 'Run of Show', exact: true })).toBeVisible();
  const rows = page.getByRole('list').getByRole('button');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('House to Half');
  await expect(rows.nth(1)).toContainText('Choir Entrance');
  await expect(rows.nth(2)).toContainText('Welcome Song');
  await expect(rows.nth(3)).toContainText('LED Welcome Visual');
  await expect(page.getByText('9:05 AM')).toHaveCount(0);
  await expect(page.getByText('Opening', { exact: true })).toHaveCount(1);
});

test('keeps the sequence independent from the current clock', async ({ page, request }) => {
  const production = await seedRunOfShow(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2026-08-10T00:50:00Z'));
  await page.goto(`/app/?production=${production.id}`);
  await expect(page.getByRole('button', { name: 'Edit House to Half' })).toBeVisible();

  await page.clock.setFixedTime(new Date('2026-08-10T02:00:00Z'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit Welcome Song' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit LED Welcome Visual' })).toBeVisible();
});

test('edits the same Activity from Run of Show and reflects it on Timeline', async ({ page, request }) => {
  const production = await seedRunOfShow(request);
  await page.goto(`/app/?production=${production.id}`);
  await page.getByRole('button', { name: 'Run of Show' }).click();
  await page.getByRole('button', { name: 'Edit Choir Entrance' }).click();
  await page.getByLabel('Activity name').fill('Choir Processional');
  await page.getByRole('button', { name: 'Save activity' }).click();
  await expect(page.getByRole('button', { name: 'Edit Choir Processional' })).toBeVisible();

  await page.getByRole('button', { name: 'Timeline' }).click();
  await expect(page.getByRole('button', { name: /Choir Processional, Performers, Opening/ })).toBeVisible();
});

test('drags an Activity to another Lane and persists the new placement', async ({ page, request }) => {
  const production = await seedRunOfShow(request);
  await page.goto(`/app/?production=${production.id}`);
  const activity = page.getByRole('button', { name: /Choir Entrance, Performers, Opening/ });
  const target = page.getByLabel('Technical, Opening drop zone');
  await activity.dragTo(target);
  await expect(page.getByRole('button', { name: /Choir Entrance, Technical, Opening/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Choir Entrance, Technical, Opening/ })).toBeVisible();
  const saved = await (await request.get(`/api/productions/${production.id}`)).json();
  expect(saved.activities.find(({ id }) => id === 'b-current')).toMatchObject({
    segmentId: 'opening', laneId: 'technical', start: '2026-08-10T09:05:00+08:00', durationMinutes: 10,
  });
});

test('lays Activities in the same Stage cell from left to right', async ({ page, request }) => {
  const production = await seedRunOfShow(request);
  await page.goto(`/app/?production=${production.id}`);
  const first = page.getByRole('button', { name: /Choir Entrance, Performers, Opening/ });
  const second = page.getByRole('button', { name: /Welcome Song, Performers, Opening/ });
  const [firstBox, secondBox] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(firstBox).not.toBeNull(); expect(secondBox).not.toBeNull();
  expect(Math.abs(firstBox.y - secondBox.y)).toBeLessThan(2);
  expect(secondBox.x).toBeGreaterThan(firstBox.x + firstBox.width - 2);
});

test('drag-reorders Activities left to right within one Lane and persists the order', async ({ page, request }) => {
  const production = await seedRunOfShow(request);
  await page.goto(`/app/?production=${production.id}`);
  const choir = page.getByRole('button', { name: /Choir Entrance, Performers, Opening/ });
  const welcome = page.getByRole('button', { name: /Welcome Song, Performers, Opening/ });
  await welcome.dragTo(choir);
  await expect.poll(async () => ({ choir: (await choir.boundingBox()).x, welcome: (await welcome.boundingBox()).x }))
    .toMatchObject({ choir: expect.any(Number), welcome: expect.any(Number) });
  expect((await welcome.boundingBox()).x).toBeLessThan((await choir.boundingBox()).x);
  await page.reload();
  expect((await welcome.boundingBox()).x).toBeLessThan((await choir.boundingBox()).x);
});

test('resizes an Activity by duration so it can span into the next Segment column', async ({ page, request }) => {
  const production = await seedRunOfShow(request);
  const current = await (await request.get(`/api/productions/${production.id}`)).json();
  const withNextSegment = await request.put(`/api/productions/${production.id}`, { data: { ...current, segments: [
    ...current.segments,
    { id: 'message', label: 'Message', color: '#6a9fd8', start: '2026-08-10T10:00:00+08:00', durationMinutes: 60, position: 1, notes: '' },
  ] } });
  expect(withNextSegment.ok()).toBe(true);
  await page.goto(`/app/?production=${production.id}`);
  const activity = page.getByRole('button', { name: /Choir Entrance, Performers, Opening/ });
  const handle = page.getByRole('button', { name: 'Resize Choir Entrance' });
  await handle.scrollIntoViewIfNeeded();
  const before = await activity.boundingBox(); const handleBox = await handle.boundingBox();
  expect(await handle.evaluate((element) => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return { same: hit === element, label: hit?.getAttribute('aria-label'), tag: hit?.tagName }; })).toEqual({ same: true, label: 'Resize Choir Entrance', tag: 'BUTTON' });
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down(); await page.mouse.move(handleBox.x + 520, handleBox.y + handleBox.height / 2, { steps: 8 }); await page.mouse.up();
  await expect(page.getByLabel('Save status')).toHaveText('Saved');
  const after = await activity.boundingBox(); const startCell = await page.getByLabel('Performers, Opening drop zone').boundingBox();
  expect(after.width).toBeGreaterThan(before.width);
  expect(after.x + after.width).toBeGreaterThan(startCell.x + startCell.width);
  const stored = await (await request.get(`/api/productions/${production.id}`)).json();
  expect(stored.activities.find(({ id }) => id === 'b-current').durationMinutes).toBeGreaterThan(10);
  await page.reload();
  expect((await activity.boundingBox()).width).toBeGreaterThan(before.width);
});

test('rolls back the resize preview when saving the new duration fails', async ({ page, request }) => {
  const production = await seedRunOfShow(request);
  await page.goto(`/app/?production=${production.id}`);
  const activity = page.getByRole('button', { name: /Choir Entrance, Performers, Opening/ });
  const handle = page.getByRole('button', { name: 'Resize Choir Entrance' });
  await handle.scrollIntoViewIfNeeded(); const before = await activity.boundingBox(); const handleBox = await handle.boundingBox();
  await page.route(`/api/productions/${production.id}`, async (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"conflict"}' }) : route.continue());
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2); await page.mouse.down(); await page.mouse.move(handleBox.x + 250, handleBox.y, { steps: 5 }); await page.mouse.up();
  await expect(page.getByRole('alert')).toContainText('conflict');
  await expect.poll(async () => (await activity.boundingBox()).width).toBeCloseTo(before.width, 0);
});
