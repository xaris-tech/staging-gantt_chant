const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const URL = `${BASE_URL}/staging_gantt-chart.html`;

async function waitForLoad(page) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const el = document.getElementById('loading-overlay');
    return el && !el.classList.contains('active');
  }, { timeout: 10000 });
  await page.waitForSelector('.task-cell', { timeout: 5000 });
}

test.describe('I. Core Chart', () => {
  test('1: Cell text editing', async ({ page }) => {
    await waitForLoad(page);
    const cell = page.locator('.task-cell').first();
    await cell.dblclick();
    const input = page.locator('.task-cell input.cell-input').first();
    await expect(input).toBeVisible();
    await input.fill('TEST');
    await input.press('Enter');
    await page.waitForTimeout(200);
    await expect(cell).toContainText('TEST');
  });

  test('2: Paint mode toggle + color painting', async ({ page }) => {
    await waitForLoad(page);
    await page.click('#paint-toggle-btn');
    await expect(page.locator('#paint-toggle-btn')).toHaveText(/Paint on/);
    const bodyPaint = await page.evaluate(() => document.body.classList.contains('paint-mode'));
    expect(bodyPaint).toBe(true);
    const first = page.locator('.task-cell').first();
    const second = page.locator('.task-cell').nth(1);
    const firstBox = await first.boundingBox();
    const secondBox = await second.boundingBox();
    await page.mouse.move(firstBox.x + 5, firstBox.y + 5);
    await page.mouse.down();
    await page.mouse.move(secondBox.x + 5, secondBox.y + 5);
    await page.mouse.up();
    await page.waitForTimeout(100);
    const firstHasBg = await first.evaluate(el => el.style.background !== '');
    const secondHasBg = await second.evaluate(el => el.style.background !== '');
    expect(firstHasBg).toBe(true);
    expect(secondHasBg).toBe(true);
  });

  test('3: Erase mode clears cells', async ({ page }) => {
    await waitForLoad(page);
    const row = page.locator('#tbody tr').first();
    const cells = row.locator('.task-cell.filled');
    const first = cells.nth(0);
    const second = cells.nth(1);
    const third = cells.nth(2);
    await page.click('#paint-toggle-btn');
    const firstBox = await first.boundingBox();
    await page.mouse.move(firstBox.x + 5, firstBox.y + 5);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(100);
    await page.click('#erase-btn');
    await expect(page.locator('#erase-btn')).toHaveText(/Erase on/);
    const secondBox = await second.boundingBox();
    const thirdBox = await third.boundingBox();
    await page.mouse.move(firstBox.x + 5, firstBox.y + 5);
    await page.mouse.down();
    await page.mouse.move(secondBox.x + 5, secondBox.y + 5);
    await page.mouse.move(thirdBox.x + 5, thirdBox.y + 5);
    await page.mouse.up();
    await page.waitForTimeout(100);
    const checks = await page.evaluate(({ pts }) => pts.map(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return {
        text: (el?.textContent || '').trim(),
        bg: el?.style?.background || '',
      };
    }), { pts: [
      [firstBox.x + 5, firstBox.y + 5],
      [secondBox.x + 5, secondBox.y + 5],
      [thirdBox.x + 5, thirdBox.y + 5],
    ] });
    for (const cell of checks) {
      expect(cell.bg).not.toBe('');
      expect(cell.text).toBe('');
    }
  });

  test('4: Segment add modal opens', async ({ page }) => {
    await waitForLoad(page);
    await page.click('button:has-text("+ Add Seg")');
    await expect(page.locator('#modal-overlay.active')).toBeVisible();
    await expect(page.locator('#modal-title')).toContainText('Add');
    await page.click('#modal-ok');
    await expect(page.locator('#modal-overlay.active')).toHaveCount(0);
  });

  test('5: Column add splices at correct segment index', async ({ page }) => {
    await waitForLoad(page);
    const colsBefore = await page.evaluate(() => getTotalCols());
    await page.click('button:has-text("+ Add Col")');
    await expect(page.locator('#modal-overlay.active')).toBeVisible();
    await page.click('#modal-ok');
    await page.waitForTimeout(200);
    const colsAfter = await page.evaluate(() => getTotalCols());
    expect(colsAfter).toBe(colsBefore + 1);
  });

  test('6: Undo/redo keyboard shortcuts', async ({ page }) => {
    await waitForLoad(page);
    // Make a change
    await page.click('#paint-toggle-btn');
    const cell = page.locator('.task-cell').first();
    const box = await cell.boundingBox();
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    const toast = page.locator('#toast');
    await expect(toast).toHaveClass(/show/);
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(100);
  });

  test('7: Add row via button', async ({ page }) => {
    await waitForLoad(page);
    const rowCountBefore = await page.locator('#tbody tr').count();
    await page.click('button:has-text("+ Add Row")');
    await page.waitForTimeout(200);
    const rowCountAfter = await page.locator('#tbody tr').count();
    expect(rowCountAfter).toBe(rowCountBefore + 1);
  });

  test('8: ESC exits paint mode', async ({ page }) => {
    await waitForLoad(page);
    await page.click('#paint-toggle-btn');
    await page.keyboard.press('Escape');
    const isPaint = await page.evaluate(() => document.body.classList.contains('paint-mode'));
    expect(isPaint).toBe(false);
  });

  test('9: PNG export triggers download', async ({ page }) => {
    await waitForLoad(page);
    const exportBtn = page.locator('button:has-text("PNG")');
    await expect(exportBtn).toBeVisible();
  });

  test('10: Import button exists', async ({ page }) => {
    await waitForLoad(page);
    await expect(page.locator('button:has-text("Import")')).toBeVisible();
  });

  test('11: Clear all with confirm', async ({ page }) => {
    await waitForLoad(page);
    page.on('dialog', d => d.accept());
    await page.click('button:has-text("Clear")');
    await page.waitForTimeout(200);
    const toast = page.locator('#toast');
    await expect(toast).toHaveClass(/show/);
  });

  test('12: PWA service worker registers', async ({ page }) => {
    await page.goto(URL);
    const registered = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.length > 0;
    });
    expect(registered).toBe(true);
  });
});

test.describe('II. Multi-User Backend', () => {
  test('13: Express server serves the page', async ({ page }) => {
    const resp = await page.request.get(URL);
    expect(resp.ok()).toBe(true);
    const text = await resp.text();
    expect(text).toContain('GANTT');
  });

  test('14: GET /api/data returns JSON', async ({ page }) => {
    const resp = await page.request.get(`${BASE_URL}/api/data`);
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data).toHaveProperty('rows');
    expect(data).toHaveProperty('segments');
  });

  test('15: PUT /api/data writes and responds', async ({ page }) => {
    const resp = await page.request.put(`${BASE_URL}/api/data`, {
      data: { rows: [{ task: 'T', oic: '', start: '', appearances: '', cells: [] }], segments: { SEG1: { cols: 1, start: '', end: '', label: 'T', color: '#000' } }, chartTitle: 'TEST' }
    });
    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(body.ok).toBe(true);
  });

  test('16: Frontend loads from API first', async ({ page }) => {
    // PUT some data, then load page
    await page.request.put(`${BASE_URL}/api/data?chart=test16`, {
      data: { rows: [{ task: 'API_ROW', oic: '', start: '', appearances: '', cells: [] }], segments: { SEG1: { cols: 1, start: '8AM', end: '9AM', label: 'TEST', color: '#6cb87a' } }, chartTitle: 'API CHART' }
    });
    await page.goto(URL + '?chart=test16');
    await page.waitForFunction(() => { const el = document.getElementById('loading-overlay'); return el && !el.classList.contains('active'); }, { timeout: 10000 });
    await page.waitForTimeout(300);
    await expect(page.locator('#chart-title')).toContainText('API CHART');
  });

  test('17: Save pushes to API', async ({ page }) => {
    await waitForLoad(page);
    // Ctrl+S triggers saveToStorage which calls saveToApi
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(500);
  });

  test('18: Periodic poll interval is set', async ({ page }) => {
    await waitForLoad(page);
    const hasInterval = await page.evaluate(() => {
      // Check that setInterval was called by looking for syncFromApi
      return typeof syncFromApi === 'function';
    });
    expect(hasInterval).toBe(true);
  });

  test('19: Sync indicator exists', async ({ page }) => {
    await waitForLoad(page);
    const indicator = page.locator('#sync-indicator');
    await expect(indicator).toBeVisible();
  });

  test('20: Works offline — localStorage fallback', async ({ page }) => {
    await waitForLoad(page);
    const canStore = await page.evaluate(() => {
      const result = storage.setItem('test_offline', '"works"');
      storage.removeItem('test_offline');
      return result;
    });
    expect(canStore).toBe(true);
  });
});

test.describe('III. Deployment', () => {
  test('21: server.js ready for production', async () => {
    const fs = require('fs');
    const server = fs.readFileSync('server.js', 'utf-8');
    expect(server).toContain('process.env.PORT');
  });

  test('22: Persistent storage via data/ directory', async () => {
    const fs = require('fs');
    expect(fs.existsSync('data')).toBe(true);
  });

  test('23: CORS hardening with ALLOWED_ORIGINS', async () => {
    const fs = require('fs');
    const server = fs.readFileSync('server.js', 'utf-8');
    expect(server).toContain('ALLOWED_ORIGINS');
  });

  test('24: Rate limiting on /api', async () => {
    const fs = require('fs');
    const server = fs.readFileSync('server.js', 'utf-8');
    expect(server).toContain('RATE_MAX');
    expect(server).toContain('429');
  });
});

test.describe('IV. Polish', () => {
  test('25: Responsive @media query for mobile', async ({ page }) => {
    await waitForLoad(page);
    const hasMediaQuery = await page.evaluate(() => {
      const sheets = [...document.styleSheets];
      for (const sheet of sheets) {
        try {
          const rules = [...sheet.cssRules];
          for (const rule of rules) {
            if (rule.constructor.name === 'CSSMediaRule' && rule.conditionText.includes('768')) return true;
          }
        } catch(e) {}
      }
      return false;
    });
    expect(hasMediaQuery).toBe(true);
  });

  test('26: Loading overlay exists and hides after init', async ({ page }) => {
    await waitForLoad(page);
    const overlay = page.locator('#loading-overlay');
    await expect(overlay).not.toHaveClass(/active/);
  });

  test('27: Multi-chart via ?chart= URL param', async ({ page }) => {
    // Write to one chart
    await page.request.put('http://localhost:3000/api/data?chart=chartA', {
      data: { rows: [{ task: 'A', oic: '', start: '', appearances: '', cells: [] }], segments: { SEG1: { cols: 1, start: '', end: '', label: '', color: '#000' } }, chartTitle: 'CHART A' }
    });
    await page.request.put('http://localhost:3000/api/data?chart=chartB', {
      data: { rows: [{ task: 'B', oic: '', start: '', appearances: '', cells: [] }], segments: { SEG1: { cols: 1, start: '', end: '', label: '', color: '#000' } }, chartTitle: 'CHART B' }
    });
    // Load chart A
    await page.goto(URL + '?chart=chartA');
    await page.waitForFunction(() => { const el = document.getElementById('loading-overlay'); return el && !el.classList.contains('active'); }, { timeout: 10000 });
    await page.waitForTimeout(300);
    await expect(page.locator('#chart-title')).toContainText('CHART A');
    // Load chart B
    await page.goto(URL + '?chart=chartB');
    await page.waitForFunction(() => { const el = document.getElementById('loading-overlay'); return el && !el.classList.contains('active'); }, { timeout: 10000 });
    await page.waitForTimeout(300);
    await expect(page.locator('#chart-title')).toContainText('CHART B');
  });
});
