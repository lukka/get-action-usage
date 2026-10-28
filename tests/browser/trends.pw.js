const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const actions = ['get-cmake', 'run-cmake', 'run-vcpkg'];

function snapshot(date, counts) {
  return {
    date,
    commit: null,
    skippedRepositories: 0,
    skippedUsages: 0,
    actions: actions.map((action, index) => ({
      action,
      projects: counts[index][0],
      occurrences: counts[index][1],
    })),
  };
}

function history() {
  return {
    version: 1,
    snapshots: [
      snapshot('2022-06-06T05:40:39.000Z', [[2, 3], [1, 1], [0, 0]]),
      snapshot('2022-06-13T05:40:39.000Z', [[5, 10], [3, 3], [0, 0]]),
      snapshot('2026-10-24T03:39:31.000Z', [[4, 9], [8, 24], [0, 0]]),
    ],
  };
}

function database() {
  return {
    acme: {
      alpha: [
        { actionName: 'get-cmake', version: 'v3', line: 10 },
        { stars: 100, repo_orig: {} },
      ],
      beta: [
        { actionName: 'run-cmake', version: 'v3', line: 10 },
        { stars: 500, repo_orig: {} },
      ],
    },
  };
}

async function mockHistory(context, payload = history()) {
  await context.route('**/usage-history.json', route =>
    route.fulfill({ json: payload })
  );
}

async function openTrends(page, query = '?view=trends') {
  await page.goto(`/graph/graph.html${query}`);
  await expect(page.locator('#history-state')).toBeHidden();
  await expect(page.locator('.trend-card')).toHaveCount(3);
}

function card(page, action = 'get-cmake') {
  return page.locator(`.trend-card[data-action="${action}"]`);
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  ));
}

test.describe('usage trends SPA', () => {
  test.beforeEach(async ({ context }) => {
    await context.route('**/action-usage-db.json', route =>
      route.fulfill({ json: database() })
    );
  });

  test('shows only one view, pauses the hidden map, and preserves filters, pin and camera', async ({ page, context }) => {
    await mockHistory(context);
    await context.addInitScript(() => {
      window.mapPaints = 0;
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function(...args) {
        if (this.canvas.id.startsWith('graph-')) window.mapPaints++;
        return clear.apply(this, args);
      };
    });
    const historyRequests = [];
    page.on('request', request => {
      if (request.url().endsWith('/usage-history.json')) historyRequests.push(request.url());
    });
    await page.goto('/graph/graph.html?q=alpha');
    await expect(page.locator('#result-count')).toHaveText('1');
    await expect(page.locator('#repository-list')).toHaveAttribute('aria-busy', 'false');
    expect(historyRequests).toHaveLength(0);
    await page.locator('.repo-row').click();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await settle(page);
    const before = await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL());
    await page.getByRole('tab', { name: 'Usage trends' }).click();
    await expect(page.locator('.trend-card')).toHaveCount(3);
    await expect(page.locator('#map-view')).toBeHidden();
    await expect(page.locator('#project-search')).toBeHidden();
    await expect(page.locator('#project-inspector')).toBeHidden();
    await expect(page.locator('#trends-view')).toBeVisible();
    expect(historyRequests).toHaveLength(1);
    const paints = await page.evaluate(() => window.mapPaints);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.mapPaints)).toBe(paints);
    await page.getByRole('tab', { name: 'Repository map' }).click();
    await expect(page.locator('#trends-view')).toBeHidden();
    await expect(page.locator('#repository-list')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#project-search')).toHaveValue('alpha');
    await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
    await expect(page.locator('.repo-row')).toHaveAttribute('aria-pressed', 'true');
    await settle(page);
    expect(await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL())).toBe(before);
    await page.getByRole('tab', { name: 'Usage trends' }).click();
    expect(historyRequests).toHaveLength(1);
  });

  test('restores and copies direct trend URLs without downloading the repository database', async ({ page, context }) => {
    await mockHistory(context);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const databaseRequests = [];
    page.on('request', request => {
      if (request.url().endsWith('/action-usage-db.json')) databaseRequests.push(request.url());
    });
    const query = '?q=alpha&repo=acme%2Falpha&view=trends&metric=occurrences';
    await openTrends(page, query);
    expect(databaseRequests).toHaveLength(0);
    await expect(page.locator('#trend-metric')).toHaveValue('occurrences');
    await expect(card(page).locator('.trend-total strong')).toHaveText('9');
    await expect(page.getByRole('tab', { name: 'Usage trends' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Copy view link' }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(copied).searchParams.get('view')).toBe('trends');
    expect(new URL(copied).searchParams.get('metric')).toBe('occurrences');
    expect(new URL(copied).searchParams.get('q')).toBe('alpha');
    await page.reload();
    await expect(page.locator('.trend-card')).toHaveCount(3);
    expect(databaseRequests).toHaveLength(0);
    await page.getByRole('tab', { name: 'Repository map' }).click();
    await expect(page.locator('#result-count')).toHaveText('1');
    await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
    expect(databaseRequests).toHaveLength(1);
    await page.goBack();
    await expect(page.locator('#trends-view')).toBeVisible();
    await expect(page.locator('#trend-metric')).toHaveValue('occurrences');
    await page.goForward();
    await expect(page.locator('#map-view')).toBeVisible();
    await expect(page.locator('#project-search')).toHaveValue('alpha');
  });

  test('charts actual dates, switches metrics, and exposes exact keyboard and tabular values', async ({ page, context }) => {
    await mockHistory(context);
    await openTrends(page);
    await expect(page.locator('.trend-card h3')).toHaveText(actions);
    await expect(page.locator('.trend-total strong')).toHaveText(['4', '8', '0']);
    const getCmake = card(page);
    const plot = getCmake.getByRole('slider', { name: /get-cmake/ });
    await expect(plot).toHaveAttribute('aria-valuemin', '1');
    await expect(plot).toHaveAttribute('aria-valuemax', '3');
    await expect(plot).toHaveAttribute('aria-valuenow', '3');
    await expect(plot).toHaveAttribute(
      'aria-valuetext',
      /Oct 24, 2026.*4 repositories/
    );
    await expect(plot).toHaveAttribute('aria-describedby', /trend-help/);
    await expect(page.locator('#trend-help')).toContainText('Left/Right');
    await expect(page.locator('#trend-help')).toContainText('Home/End');
    const original = await getCmake.locator('.trend-line').getAttribute('d');
    const coordinates = [...original.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(match =>
      [Number(match[1]), Number(match[2])]
    );
    expect(coordinates).toHaveLength(3);
    expect(coordinates[0][0]).toBe(58);
    expect(coordinates[1][0]).toBeLessThan(65);
    expect(coordinates[2][0]).toBe(495);
    await plot.focus();
    await page.keyboard.press('Home');
    await expect(getCmake.locator('.trend-reading strong')).toHaveText('2 repositories');
    await expect(getCmake.locator('.trend-reading time')).toHaveAttribute('datetime', history().snapshots[0].date);
    await page.keyboard.press('ArrowRight');
    await expect(getCmake.locator('.trend-reading strong')).toHaveText('5 repositories');
    await page.keyboard.press('ArrowDown');
    await expect(getCmake.locator('.trend-reading strong')).toHaveText('2 repositories');
    await page.keyboard.press('ArrowUp');
    await expect(getCmake.locator('.trend-reading strong')).toHaveText('5 repositories');
    await page.keyboard.press('End');
    await expect(getCmake.locator('.trend-reading strong')).toHaveText('4 repositories');
    await expect(plot).toHaveAttribute('aria-valuenow', '3');
    await expect(plot).toHaveAttribute(
      'aria-valuetext',
      /Oct 24, 2026.*4 repositories/
    );
    await expect(getCmake.locator('table')).toHaveCount(0);
    await getCmake.locator('summary').click();
    await expect(getCmake.locator('tbody tr')).toHaveCount(3);
    await expect(getCmake.locator('tbody tr').nth(1).locator('td')).toHaveText(['5', '10', '0', '0']);
    const scales = await page.locator('.trend-plot').evaluateAll(plots =>
      plots.map(plot => [...plot.querySelectorAll('text')].slice(0, 5).map(text => text.textContent))
    );
    expect(scales[0]).toEqual(scales[1]);
    expect(scales[1]).toEqual(scales[2]);
    await page.locator('#trend-metric').selectOption('occurrences');
    await expect(page.locator('.trend-total strong')).toHaveText(['9', '24', '0']);
    expect(await card(page).locator('.trend-line').getAttribute('d')).not.toBe(original);
    await expect(page).toHaveURL(/metric=occurrences/);
    await card(page).locator('svg').focus();
    await page.keyboard.press('Home');
    await expect(card(page).locator('.trend-reading strong')).toHaveText('3 workflow usages');
  });

  test('maps pointer selection to plot coordinates on narrow and tablet layouts', async ({ page, context }) => {
    await mockHistory(context);
    await openTrends(page);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth
      )).toBe(true);
      const plot = card(page).locator('svg');
      const bounds = await plot.boundingBox();
      await plot.hover({ position: { x: bounds.width * 58 / 520, y: bounds.height / 2 } });
      await expect(card(page).locator('.trend-reading time')).toHaveAttribute('datetime', history().snapshots[0].date);
      await plot.hover({ position: { x: bounds.width * 495 / 520, y: bounds.height / 2 } });
      await expect(card(page).locator('.trend-reading time')).toHaveAttribute('datetime', history().snapshots[2].date);
      await plot.dispatchEvent('pointerdown', {
        clientX: bounds.x + bounds.width * 58 / 520,
        clientY: bounds.y + bounds.height / 2,
        pointerType: 'touch',
      });
      await expect(card(page).locator('.trend-reading time')).toHaveAttribute('datetime', history().snapshots[0].date);
      await expect(page.locator('#map-view')).toBeHidden();
    }
  });

  test('uses compact shared axes for four-tick chart scales', async ({ page, context }) => {
    const payload = history();
    payload.snapshots[2].actions[0].occurrences = 1063;
    await mockHistory(context, payload);
    await openTrends(page);
    await page.locator('#trend-metric').selectOption('occurrences');
    const ticks = await card(page).locator('.trend-plot text').evaluateAll(nodes =>
      nodes.slice(0, 5).map(node => node.textContent)
    );
    expect(ticks).toEqual(['0', '300', '600', '900', '1,200']);
  });

  test('supports roving tab keyboard navigation and browser history', async ({ page, context }) => {
    await mockHistory(context);
    await page.goto('/graph/graph.html');
    await page.getByRole('tab', { name: 'Repository map' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Usage trends' })).toBeFocused();
    await expect(page.locator('.trend-card')).toHaveCount(3);
    await expect(page.getByRole('tab', { name: 'Repository map' })).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Repository map' })).toBeFocused();
    await expect(page.locator('#trends-view')).toBeHidden();
    await page.goBack();
    await expect(page.locator('#trends-view')).toBeVisible();
    await page.goForward();
    await expect(page.locator('#map-view')).toBeVisible();
  });

  test('preserves the trends history entry when map activation resizes the hidden graph', async ({ page, context }) => {
    await mockHistory(context);
    await page.goto('/graph/graph.html');
    await expect(page.locator('#repository-list')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('tab', { name: 'Usage trends' }).click();
    await expect(page.locator('.trend-card')).toHaveCount(3);
    await page.setViewportSize({ width: 900, height: 900 });
    await page.getByRole('tab', { name: 'Repository map' }).click();
    await expect(page.locator('#map-view')).toBeVisible();
    await expect(page.locator('#repository-list')).toHaveAttribute('aria-busy', 'false');
    await page.waitForTimeout(150);
    await page.goBack();
    await expect(page.locator('#trends-view')).toBeVisible();
  });

  test('reports missing observations without inventing a trend', async ({ page, context }) => {
    await mockHistory(context, { version: 1, snapshots: [] });
    await page.goto('/graph/graph.html?view=trends');
    await expect(page.locator('#history-state-title')).toHaveText('No usage history yet');
    await expect(page.locator('.trend-card')).toHaveCount(0);
    await page.locator('#skip-content').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#trends-view')).toBeFocused();
    await page.getByRole('tab', { name: 'Repository map' }).click();
    await expect(page.locator('#result-count')).toHaveText('2');
  });

  test('preserves a mobile pin without leaking its details sheet into trends', async ({ page, context }) => {
    await mockHistory(context);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/graph/graph.html?q=alpha');
    await expect(page.locator('#result-count')).toHaveText('1');
    await page.locator('.repo-row').click();
    await expect(page.locator('#project-inspector')).toHaveClass(/is-pinned/);
    await page.getByRole('tab', { name: 'Usage trends' }).click();
    await expect(page.locator('.trend-card')).toHaveCount(3);
    await expect(page.locator('#project-inspector')).toBeHidden();
    await expect(page.locator('#map-view')).toBeHidden();
    await page.getByRole('tab', { name: 'Repository map' }).click();
    await expect(page.locator('#trends-view')).toBeHidden();
    await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
    await expect(page.locator('#project-inspector')).toBeVisible();
    await expect(page.locator('#project-search')).toHaveValue('alpha');
  });

  test('keeps the pinned inspector available on short landscape screens', async ({ page, context }) => {
    await mockHistory(context);
    await page.setViewportSize({ width: 568, height: 320 });
    await page.goto('/graph/graph.html?q=alpha');
    await expect(page.locator('#result-count')).toHaveText('1');
    await page.locator('.repo-row').click();
    const inspector = page.locator('#project-inspector');
    await expect(inspector).toHaveClass(/is-pinned/);
    expect(await inspector.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Clear project selection' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unpin project' })).toBeVisible();
  });

  test('plots a single snapshot as one point and retains genuine zero counts', async ({ page, context }) => {
    await mockHistory(context, { version: 1, snapshots: [history().snapshots[0]] });
    await openTrends(page);
    await expect(page.locator('.trend-change')).toHaveText([
      'One snapshot so far; a trend needs more observations.',
      'One snapshot so far; a trend needs more observations.',
      'One snapshot so far; a trend needs more observations.',
    ]);
    for (const action of actions) {
      expect(await card(page, action).locator('.trend-line').getAttribute('d')).not.toContain('L');
      await expect(card(page, action).locator('.trend-point')).toHaveAttribute('cx', '276.5');
    }
    await expect(card(page, 'run-vcpkg').locator('.trend-total strong')).toHaveText('0');
    await expect(card(page, 'run-vcpkg').locator('.trend-point')).toHaveAttribute('cy', '232');
  });

  test('reports history HTTP errors and retries without breaking the map', async ({ page, context }) => {
    let requests = 0;
    await context.route('**/usage-history.json', route =>
      ++requests === 1
        ? route.fulfill({ status: 503, body: 'Unavailable' })
        : route.fulfill({ json: history() })
    );
    await page.goto('/graph/graph.html?view=trends');
    await expect(page.locator('#history-state-title')).toHaveText('Unable to load usage history');
    await expect(page.locator('#history-state-description')).toContainText('HTTP 503');
    await expect(page.locator('.trend-card')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry history' }).click();
    await expect(page.locator('.trend-card')).toHaveCount(3);
    await expect(page.locator('#history-state')).toBeHidden();
    await page.getByRole('tab', { name: 'Repository map' }).click();
    await expect(page.locator('#result-count')).toHaveText('2');
  });

  test('rejects malformed history rather than treating missing action data as zero', async ({ page, context }) => {
    const payload = history();
    payload.snapshots[0].actions.pop();
    await mockHistory(context, payload);
    await page.goto('/graph/graph.html?view=trends');
    await expect(page.locator('#history-state-title')).toHaveText('Unable to load usage history');
    await expect(page.locator('#history-state-description')).toContainText('Invalid usage history snapshot');
    await expect(page.locator('.trend-card')).toHaveCount(0);
  });

  test('reports incomplete snapshots with exact dataset-wide omissions', async ({ page, context }) => {
    const payload = history();
    payload.snapshots[2].skippedRepositories = 2;
    payload.snapshots[2].skippedUsages = 3;
    await mockHistory(context, payload);
    await openTrends(page);
    await expect(page.locator('#history-warning')).toBeVisible();
    await expect(card(page).locator('.trend-reading')).toContainText('Dataset-wide omissions: 2 projects, 3 usages.');
    await card(page).locator('summary').click();
    await expect(card(page).locator('tbody tr').last().locator('td')).toHaveText(['4', '9', '2', '3']);
  });

  test('a late history response cannot switch back from the active map', async ({ page, context }) => {
    let release;
    let requested;
    const gate = new Promise(resolve => { release = resolve; });
    const seen = new Promise(resolve => { requested = resolve; });
    await context.route('**/usage-history.json', async route => {
      requested();
      await gate;
      await route.fulfill({ json: history() });
    });
    await page.goto('/graph/graph.html');
    await expect(page.locator('#result-count')).toHaveText('2');
    await page.getByRole('tab', { name: 'Usage trends' }).click();
    await seen;
    await page.getByRole('tab', { name: 'Repository map' }).click();
    const response = page.waitForResponse('**/usage-history.json');
    release();
    await response;
    await expect(page.locator('.trend-card')).toHaveCount(3);
    await expect(page.locator('#trends-view')).toBeHidden();
    await expect(page.locator('#map-view')).toBeVisible();
    await expect(page.locator('#page-heading')).toHaveText('Projects using run-cmake, get-cmake and run-vcpkg');
  });
});

test('loads real historical counts locally without external requests or runtime errors', async ({ page }) => {
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:4173/')) external.push(request.url());
  });
  const payload = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../graph/usage-history.json'), 'utf8'
  ));
  const latest = payload.snapshots[payload.snapshots.length - 1];
  await openTrends(page);
  for (const count of latest.actions) {
    await expect(card(page, count.action).locator('.trend-total strong')).toHaveText(
      new Intl.NumberFormat('en').format(count.projects)
    );
  }
  await expect(page.locator('#history-summary')).toContainText(`${payload.snapshots.length} saved snapshots`);
  expect(payload.snapshots[0].date.startsWith('2022-06')).toBe(true);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
