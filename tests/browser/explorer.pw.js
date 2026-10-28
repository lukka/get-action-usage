const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const actions = ['get-cmake', 'run-cmake', 'run-vcpkg'];

function usage(project, actionName, version, line = 10) {
  return {
    actionName,
    version,
    line,
    url: `https://github.com/acme/${project}/blob/main/.github/workflows/build.yml#L${line}`,
  };
}

function project(stars, usages, description = 'A C++ project') {
  return [...usages, { stars, repo_orig: { description, language: 'C++' } }];
}

function fixture() {
  return {
    acme: {
      alpha: project(100, [
        usage('alpha', 'get-cmake', 'v3'),
        usage('alpha', 'get-cmake', 'v3', 20),
        usage('alpha', 'run-vcpkg', 'v11', 30),
      ], 'A graphics toolkit'),
      beta: project(500, [usage('beta', 'run-cmake', 'v3')]),
      gamma: project(1500, [
        usage('gamma', 'get-cmake', 'v4'),
        usage('gamma', 'run-cmake', 'v3', 20),
        usage('gamma', 'run-vcpkg', 'v11', 30),
      ]),
      delta: project(0, [usage('delta', 'get-cmake', 'latest')]),
    },
    LastStartTimeName: '2025-01-01',
  };
}

async function mockDatabase(context, database = fixture()) {
  await context.route('**/action-usage-db.json', route =>
    route.fulfill({ json: database })
  );
}

async function mockRepositorySearch(context) {
  // A local redirect lets Chromium initialize openerless background tabs.
  await context.route('https://github.com/search?**', route =>
    route.fulfill({
      status: 302,
      headers: { location: 'http://127.0.0.1:4173/repository-search-result' },
    })
  );
  await context.route('**/repository-search-result', route =>
    route.fulfill({ contentType: 'text/html', body: '<title>Repository search</title>' })
  );
}

async function open(page, query = '') {
  await page.goto(`/graph/graph.html${query}`);
  await expect(page.locator('#graph-state')).toBeHidden();
  await expect(page.locator('#repository-list')).toHaveAttribute('aria-busy', 'false');
}

async function results(page, count) {
  await expect(page.locator('#result-count')).toHaveText(String(count));
  await expect(page.locator('#repository-list')).toHaveAttribute('aria-busy', 'false');
}

async function settleCanvas(page) {
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  ));
}

async function settleMapLayout(page) {
  // Let ResizeObserver request the new layout before checking worker completion.
  await settleCanvas(page);
  await expect(page.locator('#repository-list')).toHaveAttribute('aria-busy', 'false');
  await settleCanvas(page);
}

async function trackCanvas(context) {
  await context.addInitScript(() => {
    window.canvasDrawing = {};
    window.canvasPaints = {};
    window.canvasFrames = [];
    window.recordCanvasFrames = false;
    const paths = new WeakMap();
    const originalBegin = CanvasRenderingContext2D.prototype.beginPath;
    const originalClear = CanvasRenderingContext2D.prototype.clearRect;
    const originalArc = CanvasRenderingContext2D.prototype.arc;
    const originalFill = CanvasRenderingContext2D.prototype.fill;
    const originalStroke = CanvasRenderingContext2D.prototype.stroke;
    const originalText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.beginPath = function(...args) {
      paths.set(this, []);
      return originalBegin.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.clearRect = function(...args) {
      const frame = { canvas: this.canvas.id, time: performance.now(), circles: [], texts: [] };
      window.canvasDrawing[this.canvas.id] = frame;
      window.canvasPaints[this.canvas.id] = (window.canvasPaints[this.canvas.id] || 0) + 1;
      if (window.recordCanvasFrames) window.canvasFrames.push(frame);
      return originalClear.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.arc = function(x, y, radius, ...args) {
      const circle = { x, y, radius };
      window.canvasDrawing[this.canvas.id]?.circles.push(circle);
      paths.get(this)?.push(circle);
      return originalArc.call(this, x, y, radius, ...args);
    };
    CanvasRenderingContext2D.prototype.fill = function(...args) {
      for (const circle of paths.get(this) || []) {
        circle.color = this.fillStyle;
        circle.alpha = this.globalAlpha;
      }
      return originalFill.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.stroke = function(...args) {
      for (const circle of paths.get(this) || []) {
        circle.stroke = this.strokeStyle;
        circle.lineWidth = this.lineWidth;
      }
      return originalStroke.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...args) {
      const metrics = this.measureText(text);
      window.canvasDrawing[this.canvas.id]?.texts.push({
        text, x, y, color: this.fillStyle, font: this.font,
        width: metrics.width,
        left: x - metrics.actualBoundingBoxLeft,
        right: x + metrics.actualBoundingBoxRight,
        top: y - metrics.actualBoundingBoxAscent,
        bottom: y + metrics.actualBoundingBoxDescent,
      });
      return originalText.call(this, text, x, y, ...args);
    };
  });
}

async function repositoryCircles(page, canvas = 'graph-base') {
  return page.evaluate(canvas => {
    const colors = ['#91a4bf', '#e7aa7b', '#d8e3f3', '#ffd166'];
    const circles = window.canvasDrawing[canvas].circles.filter(circle => colors.includes(circle.color));
    return Array.from(new Map(circles.map(circle => [
      `${circle.x},${circle.y},${circle.radius},${circle.color}`, circle,
    ])).values());
  }, canvas);
}

function repositoryNameLink(page, id) {
  return page.getByRole('link', {
    name: `Search actions in ${id} (opens in a new tab)`,
    exact: true,
  });
}

async function expectPaintedNameLink(page, id) {
  const link = repositoryNameLink(page, id);
  await expect(link).toBeVisible();
  const { label, bounds } = await link.evaluate((anchor, id) => {
    const name = id.slice(id.indexOf('/') + 1);
    const label = ['graph-overlay', 'graph-base'].flatMap(canvas =>
      window.canvasDrawing[canvas].texts
    ).find(text => /^(bold|700) /.test(text.font) && text.color === '#101b30' &&
      (text.text === name || (text.text.endsWith('\u2026') && name.startsWith(text.text.slice(0, -1)))));
    const canvas = document.getElementById('graph-overlay').getBoundingClientRect();
    const rectangle = anchor.getBoundingClientRect();
    return {
      label,
      bounds: {
        left: rectangle.left - canvas.left,
        right: rectangle.right - canvas.left,
        top: rectangle.top - canvas.top,
        bottom: rectangle.bottom - canvas.top,
      },
    };
  }, id);
  expect(label).toBeDefined();
  // DOM box dimensions are quantized to browser layout units (1/64 px).
  for (const [actual, expected] of [
    [bounds.left, label.left - 2],
    [bounds.right, label.right + 2],
    [bounds.top, label.top - 2],
    [bounds.bottom, label.bottom + 2],
  ]) {
    expect(Math.abs(actual - expected)).toBeLessThan(1 / 32);
  }
  return { label, bounds };
}

async function openRepositorySearch(page, activate) {
  await page.bringToFront();
  const [popup, request] = await Promise.all([
    page.context().waitForEvent('page'),
    page.context().waitForEvent('request', {
      predicate: request => request.isNavigationRequest() &&
        request.url().startsWith('https://github.com/search?'),
    }),
    activate(),
  ]);
  await popup.waitForURL('**/repository-search-result', { waitUntil: 'domcontentloaded' });
  const url = new URL(request.url());
  await popup.close();
  return url;
}

async function hubPosition(page, action) {
  const bounds = await page.locator('#graph-overlay').boundingBox();
  const circle = await page.evaluate(action => {
    const drawing = window.canvasDrawing['graph-base'];
    const labels = drawing.texts.filter(entry => entry.text === action);
    return drawing.circles.find(circle =>
      circle.color === '#16223a' &&
      labels.some(label => Math.abs(circle.x - label.x) < 0.01 &&
        Math.abs(Math.abs(circle.y - label.y) - circle.radius - 14) < 0.01)
    );
  }, action);
  return { ...circle, clientX: bounds.x + circle.x, clientY: bounds.y + circle.y };
}

async function unobscuredPreview(page) {
  const circle = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1);
  expect(circle).toBeDefined();
  for (const action of actions) {
    const hub = await hubPosition(page, action);
    expect(Math.hypot(circle.x - hub.x, circle.y - hub.y)).toBeGreaterThanOrEqual(circle.radius + hub.radius + 3);
  }
  const labels = await page.evaluate(actions => {
    const context = document.getElementById('graph-overlay').getContext('2d');
    return window.canvasDrawing['graph-overlay'].texts.filter(entry => actions.includes(entry.text)).map(label => {
      context.save();
      context.font = label.font;
      const width = context.measureText(label.text).width;
      context.restore();
      return { ...label, width, height: Number(label.font.match(/([\d.]+)px/)[1]) };
    });
  }, actions);
  for (const label of labels) {
    const distance = Math.hypot(
      Math.max(Math.abs(circle.x - label.x) - label.width / 2, 0),
      Math.max(Math.abs(circle.y - label.y) - label.height / 2, 0)
    );
    expect(distance).toBeGreaterThanOrEqual(circle.radius + 3);
  }
}

function bucketFixture() {
  return { acme: {
    bronze: project(25, [usage('bronze', 'get-cmake', 'v3')]),
    silver: project(100, [usage('silver', 'get-cmake', 'v3')]),
    gold: project(1000, [
      usage('gold', 'get-cmake', 'v3'),
      usage('gold', 'get-cmake', 'v4', 20),
    ]),
  } };
}

function motionFixture(count = 30) {
  const projects = {
    gold: project(1000, [usage('gold', 'get-cmake', 'v3')]),
    silver: project(100, [usage('silver', 'run-cmake', 'v3')]),
  };
  for (let index = 0; index < count; index++) {
    const name = `bronze-${index}`;
    projects[name] = project(25, [usage(name, 'run-vcpkg', 'v11')]);
  }
  return { acme: projects };
}

function uniformMotionFixture() {
  const projects = {};
  for (let index = 0; index < 5; index++) {
    const name = `p${String(index).padStart(2, '0')}`;
    projects[name] = project(1000, [usage(name, 'get-cmake', 'v3')]);
  }
  return { acme: projects };
}

function scaleFixture() {
  const projects = {};
  for (let index = 0; index < 10000; index++) {
    const name = `project-${String(index).padStart(5, '0')}`;
    const mask = index % 7 + 1;
    projects[name] = project(index, actions.filter((_, action) => mask & (1 << action)).map(action => usage(name, action, 'v3')));
  }
  return { acme: projects };
}

async function openMotion(page, context, database = motionFixture()) {
  await mockDatabase(context, database);
  await trackCanvas(context);
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await open(page);
  await settleCanvas(page);
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await page.evaluate(() => { window.recordCanvasFrames = true; });
  return page.locator('#graph-overlay').boundingBox();
}

async function motionCircle(page, color = '#ffd166') {
  return (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.color === color);
}

async function repositoryGeometry(page) {
  return (await repositoryCircles(page, 'graph-overlay')).sort((a, b) => a.x - b.x || a.y - b.y);
}

async function clickCircleBody(page, bounds, circle) {
  await page.mouse.click(
    bounds.x + circle.x,
    bounds.y + circle.y + circle.radius * 0.75
  );
}

async function nextCue(page) {
  return page.evaluate(() => window.canvasDrawing['graph-overlay'].circles.find(circle =>
    circle.stroke === '#b9f4ff'
  ) || null);
}

async function moveNearNeighbor(page, bounds, active, neighbor, settle = 208) {
  const distance = Math.hypot(neighbor.x - active.x, neighbor.y - active.y);
  const direction = { x: (neighbor.x - active.x) / distance, y: (neighbor.y - active.y) / distance };
  await page.mouse.move(bounds.x + active.x, bounds.y + active.y);
  await page.clock.runFor(16);
  await page.mouse.move(
    bounds.x + active.x + direction.x * active.radius * 0.55,
    bounds.y + active.y + direction.y * active.radius * 0.55
  );
  await page.clock.runFor(settle);
  return direction;
}

async function zoomMotionOut(page, steps = 4) {
  for (let index = 0; index < steps; index++) {
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await page.clock.runFor(16);
  }
}

test.describe('compact proximity browsing', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('keeps neighbor positions, sizes, and membership fixed during pointer orbits and reversals', async ({ page, context }) => {
    const bounds = await openMotion(page, context, motionFixture(360));
    const native = (await repositoryCircles(page)).find(circle => circle.color === '#ffd166');
    await clickCircleBody(page, bounds, native);
    await page.clock.runFor(320);
    const initial = await repositoryGeometry(page);
    const active = initial.find(circle => circle.alpha === 1);
    expect(initial.filter(circle => circle.alpha === 0.95 && circle.radius >= 26).length).toBeGreaterThanOrEqual(3);
    const basePaints = await page.evaluate(() => window.canvasPaints['graph-base']);
    for (let step = 0; step < 48; step++) {
      const angle = (step < 24 ? step : 48 - step) / 24 * Math.PI * 2;
      await page.mouse.move(
        bounds.x + active.x + Math.cos(angle) * active.radius * 0.65,
        bounds.y + active.y + Math.sin(angle) * active.radius * 0.65
      );
      await page.clock.runFor(32);
      expect(await repositoryGeometry(page)).toEqual(initial);
      await expect(page.getByRole('tooltip')).toContainText('acme/gold');
    }
    expect(await page.evaluate(() => window.canvasPaints['graph-base'])).toBe(basePaints);
  });

  test('selects by painted edge distance regardless of travel direction and ignores hidden or off-screen circles', async ({ page, context }) => {
    await mockDatabase(context);
    await open(page);
    const selections = await page.evaluate(async () => {
      const { CanvasGraph } = await import('/graph/canvas-graph.js');
      const active = { id: 'active', x: 100, y: 200, radius: 40, opacity: 1, emphasis: 1 };
      const circle = (id, x, y, radius = 10, opacity = 0.95) =>
        ({ id, x, y, radius, opacity, emphasis: 0 });
      const graph = Object.assign(Object.create(CanvasGraph.prototype), {
        selected: active.id,
        hovered: { kind: 'repository', repository: { id: active.id } },
        hoverPoint: { x: 110, y: 200 },
        navigationCue: null,
        proximityCandidate: null,
        pointers: new Map(),
        pinching: false,
        width: 800,
        height: 600,
        layout: { width: 800, height: 600, hubs: [] },
      });
      const acquisition = [];
      const nearest = (...circles) => {
        graph.navigationCue = null;
        graph.proximityCandidate = null;
        graph.displayed = { circles: new Map([active, ...circles].map(circle => [circle.id, circle])) };
        graph.tooltipCircles = [active, ...circles.filter(circle => circle.radius >= 26 && circle.opacity > 0.001)];
        acquisition.push(graph.nextRepository(0)?.id || null);
        acquisition.push(graph.nextRepository(179)?.id || null);
        return graph.nextRepository(180)?.id || null;
      };
      const edge = nearest(
        circle('behind', 10, 200),
        circle('hidden', 151, 200, 1, 0),
        circle('near-center', 175, 150),
        circle('near-edge', 240, 240, 80),
        circle('off-screen', 900, 200)
      );
      const stationary = nearest(circle('nearest', 180, 220), circle('farther', 250, 200));
      const tie = nearest(circle('b', 180, 180), circle('a', 180, 220));
      const invisible = nearest(circle('hidden', 170, 200, 10, 0), circle('off-screen', 900, 200));
      graph.pointers.set(1, graph.hoverPoint);
      const dragging = nearest(circle('nearest', 180, 220));
      graph.pointers.clear();
      graph.hoverPoint = null;
      const list = nearest(circle('nearest', 180, 220));
      return { edge, stationary, tie, invisible, dragging, list, acquisition };
    });
    expect(selections).toMatchObject({
      edge: 'near-edge', stationary: 'nearest', tie: 'a', invisible: null, dragging: null, list: null,
    });
    expect(new Set(selections.acquisition)).toEqual(new Set([null]));
  });

  test('low-pass filters target changes in elapsed time and rejects close-neighbor jitter', async ({ page, context }) => {
    await mockDatabase(context);
    await open(page);
    const filtered = await page.evaluate(async () => {
      const { CanvasGraph } = await import('/graph/canvas-graph.js');
      const a = { id: 'a', x: 160, y: 165, radius: 15, opacity: 0.95, emphasis: 0 };
      const b = { ...a, id: 'b', y: 235 };
      const active = { ...a, id: 'active', x: 100, y: 200, radius: 40, opacity: 1, emphasis: 1 };
      const run = interval => {
        const graph = Object.assign(Object.create(CanvasGraph.prototype), {
          selected: active.id,
          hovered: { kind: 'repository', repository: { id: active.id } },
          hoverPoint: { x: 120, y: 210 },
          navigationCue: { id: a.id, started: -1000 },
          proximityCandidate: null,
          pointers: new Map(),
          pinching: false,
          width: 800, height: 600,
          layout: { width: 800, height: 600, hubs: [] },
          displayed: { circles: new Map([active, a, b].map(circle => [circle.id, circle])) },
          tooltipCircles: [active, a, b],
        });
        const before = [];
        for (let time = 0; time < 180; time += interval)
          before.push(graph.nextRepository(time)?.id);
        const switched = graph.nextRepository(180)?.id;
        const pulseStarted = graph.navigationCue?.started;
        const jitter = [];
        for (let time = 200; time <= 1000; time += 20) {
          graph.hoverPoint = { x: 120, y: time % 40 ? 201 : 199 };
          jitter.push(graph.nextRepository(time)?.id);
        }
        const afterJitter = graph.navigationCue?.started;
        graph.hoverPoint = { x: 120, y: 185 };
        const pending = graph.nextRepository(1020)?.id;
        const held = graph.nextRepository(1199)?.id;
        const committed = graph.nextRepository(1200)?.id;
        graph.hoverPoint = { x: 120, y: 215 };
        graph.nextRepository(1220);
        graph.hoverPoint = { x: 120, y: 185 };
        const canceled = graph.nextRepository(1300)?.id;
        graph.hoverPoint = { x: 120, y: 215 };
        const restarted = graph.nextRepository(1500)?.id;
        const delayed = graph.nextRepository(1679)?.id;
        const settled = graph.nextRepository(1680)?.id;
        b.opacity = 0;
        const invalidated = graph.nextRepository(1700)?.id || null;
        b.opacity = 0.95;
        return { before, switched, pulseStarted, afterJitter, jitter, pending, held, committed, canceled, restarted, delayed, settled, invalidated };
      };
      return [run(8), run(30), run(90)];
    });
    for (const result of filtered) {
      expect(new Set(result.before)).toEqual(new Set(['a']));
      expect(result.switched).toBe('b');
      expect(result.pulseStarted).toBe(180);
      expect(result.afterJitter).toBe(180);
      expect(new Set(result.jitter)).toEqual(new Set(['b']));
      expect(result).toMatchObject({
        pending: 'b', held: 'b', committed: 'a', canceled: 'a',
        restarted: 'a', delayed: 'a', settled: 'b', invalidated: null,
      });
    }
  });

  test('brightens and pulses the stable proximity target but expands it only after a click', async ({ page, context }) => {
    const bounds = await openMotion(page, context, motionFixture(6));
    await zoomMotionOut(page);
    const base = await repositoryCircles(page);
    const native = base.find(circle => circle.color === '#ffd166');
    await clickCircleBody(page, bounds, native);
    await page.clock.runFor(320);
    const active = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1);
    const initial = await repositoryGeometry(page);
    const peer = initial.find(circle => circle.color === '#d8e3f3' && circle.alpha === 0.95);
    const direction = await moveNearNeighbor(page, bounds, active, peer);
    const first = await nextCue(page);
    expect(first).toMatchObject({ x: peer.x, y: peer.y, lineWidth: 2.5 });
    const bright = await page.evaluate(() => window.canvasDrawing['graph-overlay'].circles.filter(circle =>
      circle.color === 'rgba(255, 255, 255, 0.28)'
    ));
    expect(bright).toHaveLength(1);
    expect(bright[0]).toMatchObject({ x: peer.x, y: peer.y, radius: peer.radius });
    await page.clock.runFor(160);
    const pulse = await page.evaluate(peer => window.canvasFrames
      .filter(frame => frame.canvas === 'graph-overlay')
      .flatMap(frame => frame.circles.filter(circle => circle.stroke === '#b9f4ff' &&
        circle.x === peer.x && circle.y === peer.y).map(circle => circle.radius)), peer);
    expect(new Set(pulse).size).toBeGreaterThanOrEqual(4);
    expect(Math.min(...pulse)).toBeLessThan(peer.radius + 1);
    expect(await repositoryGeometry(page)).toEqual(initial);
    await expect(page.getByRole('tooltip')).toContainText('acme/gold');
    await page.clock.runFor(800);
    expect((await nextCue(page)).radius).toBeCloseTo(peer.radius + 2, 8);
    const paints = await page.evaluate(() => ({ ...window.canvasPaints }));
    await page.clock.runFor(1000);
    expect(await page.evaluate(() => window.canvasPaints)).toEqual(paints);
    for (const padding of [2.25, 1.75]) {
      await page.mouse.move(
        bounds.x + peer.x - direction.x * (peer.radius + padding),
        bounds.y + peer.y - direction.y * (peer.radius + padding)
      );
      await page.clock.runFor(16);
      if (padding > 2) await expect(page.getByRole('tooltip')).toBeHidden();
      else await expect(page.getByRole('tooltip')).toContainText('acme/silver');
      expect(await repositoryGeometry(page)).toEqual(initial);
    }
    await page.clock.runFor(320);
    expect(await repositoryGeometry(page)).toEqual(initial);
    await expect(page.locator('.project-title')).toContainText('gold');
    await clickCircleBody(page, bounds, peer);
    await page.clock.runFor(320);
    expect((await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1))
      .toMatchObject({ x: peer.x, y: peer.y, color: peer.color });
  });

  test('keeps the closest cue when travel reverses and changes it only after sustained proximity', async ({ page, context }) => {
    const bounds = await openMotion(page, context, uniformMotionFixture());
    await zoomMotionOut(page);
    const native = (await repositoryCircles(page))[0];
    await clickCircleBody(page, bounds, native);
    await page.clock.runFor(320);
    const active = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1);
    const initial = await repositoryGeometry(page);
    const peers = initial.filter(circle => circle.alpha === 0.95 && circle.radius >= 26);
    expect(peers.length).toBeGreaterThanOrEqual(3);
    const direction = await moveNearNeighbor(page, bounds, active, peers[0]);
    expect(await nextCue(page)).toMatchObject({ x: peers[0].x, y: peers[0].y });
    await page.mouse.move(
      bounds.x + active.x + direction.x * (active.radius * 0.55 - 4),
      bounds.y + active.y + direction.y * (active.radius * 0.55 - 4)
    );
    await page.clock.runFor(320);
    expect(await nextCue(page)).toMatchObject({ x: peers[0].x, y: peers[0].y });
    await moveNearNeighbor(page, bounds, active, peers[1], 16);
    expect(await nextCue(page)).toMatchObject({ x: peers[0].x, y: peers[0].y });
    await page.clock.runFor(208);
    expect(await nextCue(page)).toMatchObject({ x: peers[1].x, y: peers[1].y });
    expect(await repositoryGeometry(page)).toEqual(initial);
    await expect(page.getByRole('tooltip')).toContainText('acme/p00');
  });

  test('keeps proximity filtering but disables the diameter pulse under live reduced-motion preferences', async ({ page, context }) => {
    const bounds = await openMotion(page, context, motionFixture(6));
    await zoomMotionOut(page);
    const base = await repositoryCircles(page);
    const native = base.find(circle => circle.color === '#ffd166');
    await clickCircleBody(page, bounds, native);
    await page.clock.runFor(320);
    const active = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1);
    const initial = await repositoryGeometry(page);
    const peers = initial.filter(circle => circle.alpha === 0.95 && circle.radius >= 26);
    await moveNearNeighbor(page, bounds, active, peers[0]);
    await page.clock.runFor(160);
    expect((await nextCue(page)).radius).toBeLessThan(peers[0].radius + 2);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.runFor(32);
    expect((await nextCue(page)).radius).toBeCloseTo(peers[0].radius + 2, 8);
    await moveNearNeighbor(page, bounds, active, peers[1], 16);
    expect(await nextCue(page)).toMatchObject({ x: peers[0].x, y: peers[0].y });
    await page.clock.runFor(208);
    expect(await nextCue(page)).toMatchObject({ x: peers[1].x, y: peers[1].y, radius: peers[1].radius + 2 });
    expect(await repositoryGeometry(page)).toEqual(initial);
    const paints = await page.evaluate(() => ({ ...window.canvasPaints }));
    await page.clock.runFor(1000);
    expect(await page.evaluate(() => window.canvasPaints)).toEqual(paints);
  });

  test('cancels accepted and pending proximity cues on list preview, pointer exit, action hover, and camera changes', async ({ page, context }) => {
    const bounds = await openMotion(page, context, motionFixture(6));
    const activate = async () => {
      await page.keyboard.press('Escape');
      await page.mouse.move(1, 1);
      await page.clock.runFor(320);
      const native = (await repositoryCircles(page)).find(circle => circle.color === '#ffd166');
      await clickCircleBody(page, bounds, native);
      await page.clock.runFor(320);
      const circles = await repositoryCircles(page, 'graph-overlay');
      const active = circles.find(circle => circle.alpha === 1);
      const peer = circles.find(circle => circle.color === '#d8e3f3' && circle.alpha === 0.95);
      await moveNearNeighbor(page, bounds, active, peer);
      expect(await nextCue(page)).toMatchObject({ x: peer.x, y: peer.y });
      const challenger = circles.find(circle => circle.color === '#e7aa7b' && circle.alpha === 0.95);
      await moveNearNeighbor(page, bounds, active, challenger, 16);
      expect(await nextCue(page)).toMatchObject({ x: peer.x, y: peer.y });
    };
    await activate();
    await page.locator('.repo-row').first().hover();
    await page.clock.runFor(1000);
    expect(await nextCue(page)).toBeNull();
    await activate();
    await page.mouse.move(1, 1);
    await page.clock.runFor(1000);
    expect(await nextCue(page)).toBeNull();
    await activate();
    const hub = await hubPosition(page, 'get-cmake');
    await page.mouse.move(hub.clientX, hub.clientY);
    await page.clock.runFor(1000);
    expect(await nextCue(page)).toBeNull();
    await activate();
    await page.mouse.wheel(0, -80);
    await page.clock.runFor(1000);
    expect(await nextCue(page)).toBeNull();
  });

  test('does not flicker between neighboring targets during boundary jitter and settles after the mouse stops', async ({ page, context }) => {
    const bounds = await openMotion(page, context, uniformMotionFixture());
    await zoomMotionOut(page);
    const native = (await repositoryCircles(page))[0];
    await clickCircleBody(page, bounds, native);
    await page.clock.runFor(320);
    const initial = await repositoryGeometry(page);
    const active = initial.find(circle => circle.alpha === 1);
    const peers = initial.filter(circle => circle.alpha === 0.95 && circle.radius >= 26);
    const distance = (point, circle) => Math.hypot(circle.x - point.x, circle.y - point.y) - circle.radius;
    const nearest = point => peers.reduce((a, b) => distance(point, a) <= distance(point, b) ? a : b);
    let boundary = null;
    for (const a of peers) {
      for (const b of peers) {
        if (a === b) continue;
        const near = peer => {
          const length = Math.hypot(peer.x - active.x, peer.y - active.y);
          return {
            x: active.x + (peer.x - active.x) / length * active.radius * 0.55,
            y: active.y + (peer.y - active.y) / length * active.radius * 0.55,
          };
        };
        let left = near(a), right = near(b);
        if (nearest(left) !== a || nearest(right) !== b) continue;
        for (let step = 0; step < 30; step++) {
          const middle = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
          if (nearest(middle) === a) left = middle;
          else right = middle;
        }
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const point = offset => ({
          x: (left.x + right.x) / 2 + (b.x - a.x) / length * offset,
          y: (left.y + right.y) / 2 + (b.y - a.y) / length * offset,
        });
        if (nearest(point(-12)) !== a || nearest(point(12)) !== b ||
          distance(point(12), a) - distance(point(12), b) <= 4 ||
          distance(point(-12), b) - distance(point(-12), a) <= 4) continue;
        boundary = { a, b, point };
        break;
      }
      if (boundary) break;
    }
    expect(boundary).not.toBeNull();
    const { a, b, point } = boundary;
    const move = async offset => {
      const position = point(offset);
      expect(Math.hypot(position.x - active.x, position.y - active.y)).toBeLessThan(active.radius);
      await page.mouse.move(bounds.x + position.x, bounds.y + position.y);
    };
    await move(-12);
    await page.clock.runFor(1000);
    const accepted = await nextCue(page);
    expect(accepted).toMatchObject({ x: a.x, y: a.y, radius: a.radius + 2 });
    const basePaints = await page.evaluate(() => window.canvasPaints['graph-base']);
    for (let step = 0; step < 16; step++) {
      await move(step % 2 ? -12 : 12);
      await page.clock.runFor(32);
      expect(await nextCue(page)).toEqual(accepted);
    }
    for (const offset of [1, -1, 1, -1]) {
      await move(offset);
      await page.clock.runFor(320);
      expect(await nextCue(page)).toEqual(accepted);
    }
    await move(12);
    await page.clock.runFor(160);
    expect(await nextCue(page)).toEqual(accepted);
    await page.clock.runFor(64);
    expect(await nextCue(page)).toMatchObject({ x: b.x, y: b.y });
    expect(await repositoryGeometry(page)).toEqual(initial);
    await expect(page.getByRole('tooltip')).toContainText('acme/p00');
    await page.clock.runFor(800);
    const paints = await page.evaluate(() => ({ ...window.canvasPaints }));
    expect(paints['graph-base']).toBe(basePaints);
    await page.clock.runFor(1000);
    expect(await page.evaluate(() => window.canvasPaints)).toEqual(paints);
  });

  test('keeps the expanded repository and neighborhood fixed across hover, focus, hubs, and pointer exit', async ({ page, context }) => {
    const bounds = await openMotion(page, context);
    const native = (await repositoryCircles(page)).find(circle => circle.color === '#ffd166');
    await clickCircleBody(page, bounds, native);
    await page.clock.runFor(320);
    const expanded = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1);
    const geometry = await repositoryGeometry(page);
    const neighbors = (await repositoryCircles(page, 'graph-overlay')).filter(circle =>
      circle.alpha < 1 && circle.radius >= 26
    );
    expect(neighbors.length).toBeGreaterThanOrEqual(3);
    const names = await page.evaluate(() => window.canvasDrawing['graph-overlay'].texts.filter(text =>
      text.color === '#101b30' && !/^[\d,.kKM]+$/.test(text.text)
    ));
    for (const neighbor of neighbors) {
      expect(names.some(text => Math.hypot(text.x - neighbor.x, text.y - neighbor.y) < neighbor.radius / 2)).toBe(true);
    }
    for (const [dx, dy] of [[12, 0], [0, -12], [-12, 8], [0, 0]]) {
      await page.mouse.move(bounds.x + expanded.x + dx, bounds.y + expanded.y + dy);
      await page.clock.runFor(64);
      await expect(page.getByRole('tooltip')).toContainText('acme/gold');
      expect((await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1)).toEqual(expanded);
    }
    const next = neighbors.find(circle => circle.color === '#d8e3f3') || neighbors[0];
    const distance = Math.hypot(next.x - expanded.x, next.y - expanded.y);
    const edge = expanded.radius + 3;
    await page.mouse.move(
      bounds.x + expanded.x + (next.x - expanded.x) / distance * edge,
      bounds.y + expanded.y + (next.y - expanded.y) / distance * edge
    );
    await page.clock.runFor(320);
    await expect(page.getByRole('tooltip')).toBeHidden();
    expect((await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1)).toEqual(expanded);
    const entering = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 0.95 && circle.radius >= 26);
    await page.mouse.move(bounds.x + entering.x, bounds.y + entering.y);
    await expect(page.getByRole('tooltip')).not.toContainText('acme/gold');
    await page.clock.runFor(1000);
    expect(await repositoryGeometry(page)).toEqual(geometry);
    await expect(page.locator('.project-title')).toContainText('gold');
    await expect(page).toHaveURL(/repo=acme%2Fgold/);
    for (const preview of [
      () => page.getByRole('button', { name: /acme\/silver/ }).hover(),
      () => page.getByRole('button', { name: /acme\/silver/ }).focus(),
      async () => {
        const hub = await hubPosition(page, 'run-cmake');
        await page.mouse.move(hub.clientX, hub.clientY);
      },
      () => page.mouse.move(1, 1),
    ]) {
      await preview();
      await page.clock.runFor(1000);
      expect(await repositoryGeometry(page)).toEqual(geometry);
      await expect(page.locator('.project-title')).toContainText('gold');
      await expect(page).toHaveURL(/repo=acme%2Fgold/);
      expect(await page.evaluate(() => window.canvasDrawing['graph-overlay'].texts
        .some(text => text.text === 'v3' && text.font.includes('monospace')))).toBe(true);
    }
    await clickCircleBody(page, bounds, entering);
    await page.clock.runFor(320);
    expect((await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1))
      .toMatchObject({ x: entering.x, y: entering.y, color: entering.color });
    await expect(page.locator('.project-title')).not.toContainText('gold');
  });

  test('does not turn a neighborhood-gap click into a repository selection', async ({ page, context }) => {
    const bounds = await openMotion(page, context);
    const native = (await repositoryCircles(page)).find(circle => circle.color === '#ffd166');
    await clickCircleBody(page, bounds, native);
    await page.clock.runFor(320);
    const circles = await repositoryCircles(page, 'graph-overlay');
    const active = circles.find(circle => circle.alpha === 1);
    const peer = circles.find(circle => circle.color === '#d8e3f3' && circle.radius >= 26);
    const distance = Math.hypot(peer.x - active.x, peer.y - active.y);
    const edge = active.radius + 3;
    const gap = {
      x: active.x + (peer.x - active.x) / distance * edge,
      y: active.y + (peer.y - active.y) / distance * edge,
    };
    await page.mouse.move(bounds.x + gap.x, bounds.y + gap.y);
    await page.clock.runFor(320);
    await expect(page.getByRole('tooltip')).toBeHidden();
    for (const circle of await repositoryCircles(page, 'graph-overlay')) {
      expect(Math.hypot(circle.x - gap.x, circle.y - gap.y)).toBeGreaterThan(circle.radius + 2);
    }
    await page.mouse.down();
    await page.mouse.up();
    await page.clock.runFor(320);
    await expect(page.locator('#inspector-mode')).toHaveText('DETAILS');
    await expect(page.getByRole('tooltip')).toBeHidden();
  });

  test('never enlarges or moves repositories on approach, hover, or keyboard focus before selection', async ({ page, context }) => {
    const bounds = await openMotion(page, context);
    for (let index = 0; index < 8; index++) {
      await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
      await page.clock.runFor(16);
    }
    const base = await repositoryCircles(page);
    const right = Math.max(...base.map(circle => circle.x + circle.radius));
    const centerY = base.find(circle => circle.color === '#ffd166').y;
    await page.mouse.move(bounds.x + right + 24, bounds.y + centerY);
    await page.clock.runFor(1000);
    expect(await repositoryCircles(page, 'graph-overlay')).toEqual([]);
    await expect(page.getByRole('tooltip')).toBeHidden();
    await expect(page.locator('#inspector-mode')).toHaveText('DETAILS');
    for (const circle of base.filter(circle => circle.color !== '#e7aa7b')) {
      await page.mouse.move(bounds.x + circle.x, bounds.y + circle.y);
      await page.clock.runFor(1000);
      expect(await repositoryCircles(page, 'graph-overlay')).toEqual([{ ...circle, alpha: 1 }]);
      await expect(page.locator('#inspector-mode')).toHaveText('PREVIEW');
      expect(new URL(page.url()).searchParams.has('repo')).toBe(false);
    }
    const row = page.getByRole('button', { name: /acme\/gold/ });
    await row.focus();
    await page.clock.runFor(1000);
    const native = base.find(circle => circle.color === '#ffd166');
    expect(await repositoryCircles(page, 'graph-overlay')).toEqual([{ ...native, alpha: 1 }]);
    await row.press('Space');
    await page.clock.runFor(320);
    expect((await motionCircle(page)).radius).toBeGreaterThan(native.radius);
    await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
    await page.keyboard.press('Escape');
    await page.mouse.move(1, 1);
    await page.clock.runFor(320);
    expect(await repositoryCircles(page, 'graph-overlay')).toEqual([]);
  });

  test('smoothly brings a partly visible repository and its readable neighbors inside the viewport', async ({ page, context }) => {
    const bounds = await openMotion(page, context);
    const original = (await repositoryCircles(page)).find(circle => circle.color === '#ffd166');
    const start = { x: bounds.x + bounds.width - 12, y: bounds.y + bounds.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - original.x - original.radius * 0.35, start.y);
    await page.mouse.up();
    await page.clock.runFor(32);
    const base = await repositoryCircles(page);
    const native = base.find(circle => circle.color === '#ffd166');
    expect(native.x).toBeLessThan(0);
    expect(native.x + native.radius).toBeGreaterThan(2);
    await page.mouse.click(bounds.x + 2, bounds.y + native.y + native.radius * 0.65);
    await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
    expect(context.pages()).toHaveLength(1);
    await page.clock.runFor(64);
    const growing = await motionCircle(page);
    expect(growing.radius).toBeGreaterThan(native.radius);
    expect(growing.x).toBeLessThan(growing.radius + 3);
    expect(growing.x - native.x).toBeLessThan(28);
    await page.clock.runFor(256);
    const readable = (await repositoryCircles(page, 'graph-overlay')).filter(circle =>
      circle.radius >= 26 && circle.alpha > 0.9
    );
    expect(readable.length).toBeGreaterThanOrEqual(3);
    for (const circle of readable) {
      expect(circle.x - circle.radius).toBeGreaterThanOrEqual(3.9);
      expect(circle.x + circle.radius).toBeLessThanOrEqual(bounds.width - 3.9);
      expect(circle.y - circle.radius).toBeGreaterThanOrEqual(43.9);
      expect(circle.y + circle.radius).toBeLessThanOrEqual(bounds.height - 51.9);
    }
    await page.mouse.move(1, 1);
    await page.keyboard.press('Escape');
    await page.clock.runFor(320);
    expect(await repositoryCircles(page)).toEqual(base);
  });

  test('keeps every painted circle disjoint throughout growth, handoff, reversal, and collapse', async ({ page, context }) => {
    const bounds = await openMotion(page, context);
    const base = await repositoryCircles(page);
    const gold = base.find(circle => circle.color === '#ffd166');
    await clickCircleBody(page, bounds, gold);
    await page.clock.runFor(320);
    const active = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1);
    for (const [dx, dy] of [[-0.65, 0], [0.65, 0], [0, -0.65], [0, 0.65], [0, 0]]) {
      await page.mouse.move(bounds.x + active.x + dx * active.radius, bounds.y + active.y + dy * active.radius);
      await page.clock.runFor(96);
    }
    const silver = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.color === '#d8e3f3');
    await clickCircleBody(page, bounds, silver);
    await page.clock.runFor(96);
    const returning = await motionCircle(page);
    await clickCircleBody(page, bounds, returning);
    await page.clock.runFor(320);
    await page.mouse.move(1, 1);
    await page.keyboard.press('Escape');
    await page.clock.runFor(320);
    const frames = await page.evaluate(() => window.canvasFrames
      .filter(frame => frame.canvas === 'graph-overlay')
      .map(frame => frame.circles.filter(circle =>
        ['#91a4bf', '#e7aa7b', '#d8e3f3', '#ffd166'].includes(circle.color) && circle.alpha > 0.001
      )));
    expect(frames.length).toBeGreaterThan(30);
    let minimum = Infinity;
    for (const circles of frames) {
      for (let left = 0; left < circles.length; left++) {
        for (let right = left + 1; right < circles.length; right++) {
          const a = circles[left], b = circles[right];
          minimum = Math.min(minimum, Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius);
        }
      }
    }
    expect(Number.isFinite(minimum)).toBe(true);
    expect(minimum).toBeGreaterThanOrEqual(-0.001);
    expect(await repositoryCircles(page)).toEqual(base);
  });

  test('uses the longest fitting owner and repository prefixes, one ellipsis character, and the actual circular space', async ({ page, context }) => {
    const owner = 'a-very-long-owner-organization-name';
    const prefix = 'repository-with-a-very-long-human-readable-name-';
    const projects = {};
    for (let index = 0; index < 45; index++) {
      const name = `${prefix}${index}`;
      projects[name] = project(1000 + index, [usage(name, 'get-cmake', 'v3')]);
    }
    await openMotion(page, context, { [owner]: projects });
    await page.locator('.repo-row').first().press('Enter');
    await page.clock.runFor(320);
    const checks = await page.evaluate(({ owner, prefix }) => {
      const drawing = window.canvasDrawing['graph-overlay'];
      const context = document.getElementById('graph-overlay').getContext('2d');
      const circles = drawing.circles.filter(circle => circle.color === '#ffd166' && circle.alpha > 0.9);
      return circles.map(circle => {
        const rows = drawing.texts.filter(text => Math.abs(text.x - circle.x) < 0.001 &&
          Math.abs(text.y - circle.y) < circle.radius &&
          (text.color === '#34425b' || (text.color === '#101b30' && !/^[\d,.kKM]+$/.test(text.text))));
        return {
          circle,
          rows: rows.map(row => {
            const full = row.color === '#34425b' ? owner : `${prefix}44`;
            const shown = row.text.slice(0, -1);
            const next = `${shown}${full[shown.length]}\u2026`;
            context.save();
            context.font = row.font;
            context.textBaseline = 'middle';
            const metrics = context.measureText(next);
            context.restore();
            const offset = row.y - circle.y;
            const extent = Math.max(Math.abs(offset - metrics.actualBoundingBoxAscent), Math.abs(offset + metrics.actualBoundingBoxDescent));
            const available = 2 * Math.sqrt(Math.max(0, (circle.radius - 2) ** 2 - extent ** 2));
            return { ...row, full, nextFits: metrics.width <= available };
          }).sort((a, b) => a.y - b.y),
        };
      });
    }, { owner, prefix });
    expect(checks.length).toBeGreaterThanOrEqual(4);
    for (const { circle, rows } of checks) {
      expect(rows).toHaveLength(2);
      expect(rows[0].bottom).toBeLessThan(rows[1].top);
      for (const row of rows) {
        expect(row.text.endsWith('\u2026')).toBe(true);
        expect(row.text.endsWith('...')).toBe(false);
        expect(row.full.startsWith(row.text.slice(0, -1))).toBe(true);
        expect(row.text.length).toBeGreaterThan(4);
        expect(row.nextFits).toBe(false);
        for (const x of [row.left, row.right]) {
          for (const y of [row.top, row.bottom]) {
            expect(Math.hypot(x - circle.x, y - circle.y)).toBeLessThanOrEqual(circle.radius - 1);
          }
        }
      }
    }
    await page.locator('.repo-row').first().press('Enter');
    await expect(page.locator('.project-owner')).toHaveText(owner);
    await expect(page.locator('.project-title')).toContainText(`${prefix}44`);
  });

  test('keeps the complete real-data neighborhood compact, on screen, smooth, and clear of the tooltip', async ({ page, context }) => {
    const database = JSON.parse(fs.readFileSync(path.join(__dirname, '../../graph/action-usage-db.json'), 'utf8'));
    const bounds = await openMotion(page, context, database);
    const point = await page.evaluate(async viewport => {
      const { normalizeDatabase, layoutRepositories } = await import('/graph/model.js');
      const database = await (await fetch('/graph/action-usage-db.json')).json();
      const repositories = normalizeDatabase(database).repositories;
      layoutRepositories(repositories, viewport);
      return repositories.find(repository => repository.id.toLowerCase() === 'diasurgical/devilutionx');
    }, { width: bounds.width, height: bounds.height });
    await clickCircleBody(page, bounds, point);
    await page.clock.runFor(320);
    const circles = (await repositoryCircles(page, 'graph-overlay')).filter(circle => circle.radius >= 26 && circle.alpha > 0.9);
    expect(circles.length).toBeGreaterThanOrEqual(4);
    expect(circles.length).toBeLessThanOrEqual(13);
    const active = circles.find(circle => circle.alpha === 1);
    for (const circle of circles) {
      expect(circle.x - circle.radius).toBeGreaterThanOrEqual(3.9);
      expect(circle.x + circle.radius).toBeLessThanOrEqual(bounds.width - 3.9);
      expect(circle.y - circle.radius).toBeGreaterThanOrEqual(43.9);
      expect(circle.y + circle.radius).toBeLessThanOrEqual(bounds.height - 51.9);
      expect(Math.hypot(circle.x - active.x, circle.y - active.y)).toBeLessThanOrEqual(active.radius + circle.radius * 3 + 16);
      if (circle !== active) {
        expect(Math.hypot(circle.x - active.x, circle.y - active.y) - active.radius - circle.radius).toBeGreaterThanOrEqual(7.4);
      }
    }
    const box = await page.getByRole('tooltip').boundingBox();
    for (const circle of circles) {
      const distance = Math.hypot(
        Math.max(Math.abs(circle.x - (box.x - bounds.x + box.width / 2)) - box.width / 2, 0),
        Math.max(Math.abs(circle.y - (box.y - bounds.y + box.height / 2)) - box.height / 2, 0)
      );
      expect(distance).toBeGreaterThanOrEqual(circle.radius + 1);
    }
    const hubs = [];
    for (const action of actions) hubs.push(await hubPosition(page, action));
    const pixels = await page.evaluate(({ active, circles, hubs }) => {
      const canvas = document.getElementById('graph-overlay');
      const context = canvas.getContext('2d');
      const ratio = canvas.width / canvas.clientWidth;
      const texts = window.canvasDrawing['graph-overlay'].texts;
      const differences = [];
      for (const peer of circles.filter(circle => circle.alpha < 1)) {
        const color = [1, 3, 5].map(offset => parseInt(peer.color.slice(offset, offset + 2), 16));
        let sampled = false;
        for (const hub of hubs) {
          for (let amount = 0.05; amount < 0.95 && !sampled; amount += 0.01) {
            const x = active.x + (hub.x - active.x) * amount;
            const y = active.y + (hub.y - active.y) * amount;
            if (Math.hypot(x - peer.x, y - peer.y) > peer.radius - 6) continue;
            if (texts.some(text => x >= text.left - 4 && x <= text.right + 4 &&
              y >= text.top - 4 && y <= text.bottom + 4)) continue;
            const data = context.getImageData(Math.round(x * ratio) - 1, Math.round(y * ratio) - 1, 3, 3).data;
            for (let pixel = 0; pixel < data.length; pixel += 4) {
              differences.push(Math.max(...color.map((channel, index) => Math.abs(data[pixel + index] - channel))));
            }
            sampled = true;
          }
        }
      }
      return differences;
    }, { active, circles, hubs });
    expect(pixels.length).toBeGreaterThan(0);
    expect(Math.max(...pixels)).toBeLessThan(24);
    const movement = await page.evaluate(count => {
      const frames = window.canvasFrames.filter(frame => frame.canvas === 'graph-overlay').map(frame =>
        frame.circles.filter(circle => circle.color === '#ffd166' && circle.radius >= 26 && circle.alpha > 0.9)
      ).filter(circles => circles.length === count);
      let maximum = 0;
      for (let frame = 1; frame < frames.length; frame++) {
        for (let circle = 0; circle < count; circle++) {
          maximum = Math.max(maximum, Math.hypot(
            frames[frame][circle].x - frames[frame - 1][circle].x,
            frames[frame][circle].y - frames[frame - 1][circle].y
          ));
        }
      }
      return { maximum, frames: frames.length };
    }, circles.length);
    expect(movement.frames).toBeGreaterThanOrEqual(4);
    expect(movement.maximum).toBeLessThan(28);
  });

  test('keeps the real-data neighborhood exactly fixed during rapid pointer movement with finite cue animation', async ({ page, context }) => {
    const database = JSON.parse(fs.readFileSync(path.join(__dirname, '../../graph/action-usage-db.json'), 'utf8'));
    const bounds = await openMotion(page, context, database);
    await page.evaluate(async () => {
      const { CanvasGraph } = await import('/graph/canvas-graph.js');
      window.neighborhoodFrames = [];
      const draw = CanvasGraph.prototype.drawHighlight;
      CanvasGraph.prototype.drawHighlight = function(time) {
        const pulsing = draw.call(this, time);
        window.neighborhoodFrames.push(this.tooltipCircles.map(circle => ({ ...circle })));
        return pulsing;
      };
    });
    const native = await page.evaluate(async viewport => {
      const { normalizeDatabase, layoutRepositories } = await import('/graph/model.js');
      const repositories = normalizeDatabase(await (await fetch('/graph/action-usage-db.json')).json()).repositories;
      layoutRepositories(repositories, viewport);
      return repositories.find(repository => repository.id === 'diasurgical/devilutionX');
    }, { width: bounds.width, height: bounds.height });
    await clickCircleBody(page, bounds, native);
    await page.clock.runFor(320);
    const initial = await page.evaluate(() => window.neighborhoodFrames.at(-1));
    const active = initial.find(circle => circle.emphasis === 1);
    await page.evaluate(() => { window.neighborhoodFrames = []; });
    for (let step = 0; step < 96; step++) {
      const angle = (step < 48 ? step : 96 - step) / 48 * Math.PI * 2;
      await page.mouse.move(
        bounds.x + active.x + Math.cos(angle) * active.radius * 0.65,
        bounds.y + active.y + Math.sin(angle) * active.radius * 0.65
      );
      await page.clock.runFor(32);
    }
    await page.clock.runFor(1000);
    const motion = await page.evaluate(({ active, initial }) => {
      let minimum = Infinity, maximum = 0, stable = true, peak = 0;
      const added = new Set();
      const frames = window.neighborhoodFrames;
      for (let index = 0; index < frames.length; index++) {
        const current = frames[index].filter(circle => circle.opacity > 0.4);
        const primary = current.find(circle => circle.emphasis === 1);
        stable &&= primary?.id === active.id && primary.x === active.x &&
          primary.y === active.y && primary.radius === active.radius &&
          current.length === initial.length &&
          current.every(circle => initial.some(other => other.id === circle.id &&
            other.x === circle.x && other.y === circle.y && other.radius === circle.radius));
        peak = Math.max(peak, current.length);
        for (const circle of current) {
          if (!initial.some(other => other.id === circle.id)) added.add(circle.id);
          const previous = frames[index - 1]?.find(other => other.id === circle.id && other.opacity > 0.4);
          if (previous) maximum = Math.max(maximum, Math.hypot(circle.x - previous.x, circle.y - previous.y));
          for (const other of current) {
            if (other.id !== circle.id) minimum = Math.min(minimum,
              Math.hypot(circle.x - other.x, circle.y - other.y) - circle.radius - other.radius);
          }
        }
      }
      return { minimum, maximum, stable, peak, promoted: added.size, frames: frames.length };
    }, { active, initial });
    expect(motion.frames).toBeGreaterThan(100);
    expect(motion.frames).toBeLessThan(300);
    expect(motion.promoted).toBe(0);
    expect(motion.stable).toBe(true);
    expect(motion.peak).toBe(initial.length);
    expect(motion.minimum).toBeGreaterThanOrEqual(-0.001);
    expect(motion.maximum).toBe(0);
    const paints = await page.evaluate(() => ({ ...window.canvasPaints }));
    await page.clock.runFor(1000);
    expect(await page.evaluate(() => window.canvasPaints)).toEqual(paints);
  });
});

test.describe('smooth circle animation', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('keeps native name links aligned with every painted animation frame', async ({ page, context }) => {
    const canvas = await openMotion(page, context);
    const native = (await repositoryCircles(page)).find(circle => circle.color === '#ffd166');
    await clickCircleBody(page, canvas, native);
    let samples = 0;
    for (let time = 0; time <= 272; time += 16) {
      await page.clock.runFor(16);
      if (await repositoryNameLink(page, 'acme/gold').count()) {
        await expectPaintedNameLink(page, 'acme/gold');
        await repositoryNameLink(page, 'acme/gold').evaluate(anchor => {
          window.originalNameLink = window.originalNameLink || anchor;
        });
        expect(await repositoryNameLink(page, 'acme/gold').evaluate(anchor =>
          anchor === window.originalNameLink
        )).toBe(true);
        samples++;
      }
    }
    expect(samples).toBeGreaterThan(5);
    await page.mouse.move(1, 1);
    await page.keyboard.press('Escape');
    for (let time = 0; time <= 272; time += 16) {
      await page.clock.runFor(16);
      if (await repositoryNameLink(page, 'acme/gold').count())
        await expectPaintedNameLink(page, 'acme/gold');
    }
    await expect(repositoryNameLink(page, 'acme/gold')).toHaveCount(native.radius >= 26 ? 1 : 0);
  });

  test('eases growth and shrinkage with neighbors, then stops without repainting the base', async ({ page, context }) => {
    const bounds = await openMotion(page, context);
    const base = await repositoryCircles(page);
    const native = base.find(circle => circle.color === '#ffd166');
    const silver = base.find(circle => circle.color === '#d8e3f3');
    const before = await page.evaluate(() => ({ ...window.canvasPaints }));
    await clickCircleBody(page, bounds, native);
    await page.clock.runFor(64);
    const growing = await motionCircle(page);
    expect(growing.radius).toBeGreaterThan(native.radius);
    const displaced = await motionCircle(page, '#d8e3f3');
    expect(Math.hypot(displaced.x - silver.x, displaced.y - silver.y)).toBeGreaterThan(0);
    await page.clock.runFor(256);
    const expanded = await motionCircle(page);
    expect(expanded.radius).toBeGreaterThan(growing.radius);
    const shifted = await motionCircle(page, '#d8e3f3');
    expect(Math.hypot(shifted.x - silver.x, shifted.y - silver.y)).toBeGreaterThan(
      Math.hypot(displaced.x - silver.x, displaced.y - silver.y)
    );
    const growth = await page.evaluate(() => window.canvasFrames
      .filter(frame => frame.canvas === 'graph-overlay')
      .map(frame => frame.circles.find(circle => circle.color === '#ffd166')?.radius)
      .filter(radius => radius !== undefined));
    expect(new Set(growth).size).toBeGreaterThan(4);
    expect(growth).toEqual(growth.slice().sort((left, right) => left - right));
    expect(growth[0]).toBeCloseTo(native.radius, 8);
    await page.evaluate(() => { window.canvasFrames = []; });
    await page.mouse.move(1, 1);
    await page.keyboard.press('Escape');
    await page.clock.runFor(64);
    const shrinking = await motionCircle(page);
    expect(shrinking.radius).toBeGreaterThan(native.radius);
    expect(shrinking.radius).toBeLessThan(expanded.radius);
    const returning = await motionCircle(page, '#d8e3f3');
    expect(Math.hypot(returning.x - silver.x, returning.y - silver.y)).toBeLessThan(
      Math.hypot(shifted.x - silver.x, shifted.y - silver.y)
    );
    await page.clock.runFor(256);
    expect(await repositoryCircles(page, 'graph-overlay')).toEqual([]);
    const shrinkage = await page.evaluate(() => window.canvasFrames
      .filter(frame => frame.canvas === 'graph-overlay')
      .map(frame => frame.circles.find(circle => circle.color === '#ffd166')?.radius)
      .filter(radius => radius !== undefined));
    expect(new Set(shrinkage).size).toBeGreaterThan(4);
    expect(shrinkage).toEqual(shrinkage.slice().sort((left, right) => right - left));
    const after = await page.evaluate(() => ({ ...window.canvasPaints }));
    expect(after['graph-base']).toBe(before['graph-base']);
    await page.clock.runFor(1000);
    expect(await page.evaluate(() => window.canvasPaints)).toEqual(after);
    expect(await repositoryCircles(page)).toEqual(base);
  });

  test('rebases rapid click handoffs and reversals on painted positions and keeps selections expanded', async ({ page, context }) => {
    const bounds = await openMotion(page, context);
    const base = await repositoryCircles(page);
    const native = base.find(circle => circle.color === '#ffd166');
    await clickCircleBody(page, bounds, native);
    await page.clock.runFor(80);
    const gold = await motionCircle(page);
    const silver = await motionCircle(page, '#d8e3f3');
    await clickCircleBody(page, bounds, silver);
    await expect(page.getByRole('tooltip')).toContainText('acme/silver');
    await page.clock.runFor(16);
    expect(await motionCircle(page)).toEqual(gold);
    expect(await motionCircle(page, '#d8e3f3')).toEqual(silver);
    await page.clock.runFor(64);
    expect((await motionCircle(page)).alpha).toBeLessThan(gold.alpha);
    expect((await motionCircle(page, '#d8e3f3')).radius).toBeGreaterThan(silver.radius);
    const currentGold = await motionCircle(page);
    await clickCircleBody(page, bounds, currentGold);
    await expect(page.getByRole('tooltip')).toContainText('acme/gold');
    await page.clock.runFor(16);
    expect(await motionCircle(page)).toEqual(currentGold);
    await page.clock.runFor(48);
    const reversing = await motionCircle(page);
    expect(reversing.radius).toBeGreaterThan(currentGold.radius);
    await page.mouse.move(bounds.x + reversing.x, bounds.y + reversing.y + reversing.radius * 0.75);
    await page.mouse.down();
    await page.clock.runFor(32);
    const holding = await motionCircle(page);
    expect(holding.radius).toBeGreaterThan(reversing.radius);
    expect(holding.radius).toBeLessThan(96);
    await page.mouse.up();
    await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
    await page.mouse.move(1, 1);
    await page.clock.runFor(320);
    const pinned = await motionCircle(page);
    expect(pinned.radius).toBeGreaterThan(reversing.radius);
    const settled = await page.evaluate(() => ({ ...window.canvasPaints }));
    await page.clock.runFor(1000);
    expect(await page.evaluate(() => window.canvasPaints)).toEqual(settled);
    await page.keyboard.press('Escape');
    await page.clock.runFor(64);
    expect((await motionCircle(page)).radius).toBeLessThan(pinned.radius);
    await page.clock.runFor(256);
    expect(await repositoryCircles(page, 'graph-overlay')).toEqual([]);
  });

  test('preserves bronze, silver, and gold diameter ratios throughout both transitions', async ({ page, context }) => {
    const bounds = await openMotion(page, context);
    const base = await repositoryCircles(page);
    const growth = [], shrinkage = [];
    for (const color of ['#e7aa7b', '#d8e3f3', '#ffd166']) {
      const native = base.find(circle => circle.color === color);
      await clickCircleBody(page, bounds, native);
      await page.clock.runFor(64);
      const growing = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.color === color && circle.alpha === 1);
      expect(growing).toBeDefined();
      growth.push(growing.radius);
      await page.clock.runFor(256);
      await page.mouse.move(1, 1);
      await page.keyboard.press('Escape');
      await page.clock.runFor(64);
      const shrinking = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.color === color && circle.alpha === 1);
      expect(shrinking).toBeDefined();
      shrinkage.push(shrinking.radius);
      await page.clock.runFor(256);
      expect(await repositoryCircles(page, 'graph-overlay')).toEqual([]);
    }
    for (const radii of [growth, shrinkage]) {
      expect(radii[1] / radii[0]).toBeCloseTo(1.5, 8);
      expect(radii[2] / radii[0]).toBeCloseTo(2, 8);
    }
  });

  test('previews keyboard focus without expansion and preserves explicit selections through camera focus', async ({ page, context }) => {
    await openMotion(page, context);
    const row = page.getByRole('button', { name: /acme\/gold/ });
    const native = (await repositoryCircles(page)).find(circle => circle.color === '#ffd166');
    await row.focus();
    await page.clock.runFor(80);
    expect((await motionCircle(page)).radius).toBeCloseTo(native.radius, 8);
    await expect(page.locator('#inspector-mode')).toHaveText('PREVIEW');
    await row.press('Enter');
    await page.clock.runFor(80);
    const focusedNative = (await repositoryCircles(page)).find(circle => circle.color === '#ffd166');
    const growing = await motionCircle(page);
    const progress = (growing.radius - focusedNative.radius) / (96 - focusedNative.radius);
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(1);
    await row.press('Enter');
    await page.clock.runFor(16);
    expect((await motionCircle(page)).radius).toBeCloseTo(
      focusedNative.radius + (96 - focusedNative.radius) * progress, 8
    );
    await page.clock.runFor(256);
    expect((await motionCircle(page)).radius).toBeCloseTo(96, 8);
    await page.getByLabel('Sort projects', { exact: true }).selectOption('name');
    await expect(page.locator('#repository-list')).toHaveAttribute('aria-busy', 'false');
    await page.clock.runFor(16);
    expect((await motionCircle(page)).radius).toBeCloseTo(96, 8);
    await page.keyboard.press('Escape');
    await page.clock.runFor(320);
    await page.locator('#graph-overlay').focus();
    await row.focus();
    await row.press('Space');
    await page.clock.runFor(320);
    const expanded = await motionCircle(page);
    await row.press('Enter');
    await page.clock.runFor(16);
    expect((await motionCircle(page)).radius).toBeCloseTo(expanded.radius, 8);
    await page.clock.runFor(320);
    await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
  });

  test('honors live reduced-motion changes and cancels stale geometry during filters and resizing', async ({ page, context }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const bounds = await openMotion(page, context);
    const native = (await repositoryCircles(page)).find(circle => circle.color === '#ffd166');
    await clickCircleBody(page, bounds, native);
    await page.clock.runFor(64);
    const growing = await motionCircle(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.runFor(32);
    const immediate = await motionCircle(page);
    expect(immediate.radius).toBeGreaterThan(growing.radius);
    await page.clock.runFor(200);
    const reduced = await page.evaluate(() => ({ ...window.canvasPaints }));
    await page.clock.runFor(500);
    expect(await page.evaluate(() => window.canvasPaints)).toEqual(reduced);
    await page.mouse.move(1, 1);
    await page.keyboard.press('Escape');
    await page.clock.runFor(16);
    expect(await repositoryCircles(page, 'graph-overlay')).toEqual([]);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await clickCircleBody(page, bounds, native);
    await page.clock.runFor(64);
    await page.getByLabel('Search projects', { exact: true }).fill('silver');
    await page.clock.runFor(160);
    await results(page, 1);
    await page.clock.runFor(320);
    expect((await repositoryCircles(page)).map(circle => circle.color)).toEqual(['#d8e3f3']);
    expect((await repositoryCircles(page, 'graph-overlay')).some(circle => circle.color === '#ffd166')).toBe(false);
    await page.setViewportSize({ width: 390, height: 844 });
    // ResizeObserver is not clock-controlled; let it queue the debounce first.
    await expect(page.locator('#repository-list')).toHaveAttribute('aria-busy', 'true');
    await page.clock.runFor(160);
    await expect(page.locator('#repository-list')).toHaveAttribute('aria-busy', 'false');
    await page.clock.runFor(320);
    expect((await repositoryCircles(page)).map(circle => circle.color)).toEqual(['#d8e3f3']);
    expect(errors).toEqual([]);
  });

  test('animates 10,000 projects in bounded overlay-only frames without idle work', async ({ page, context }) => {
    await mockDatabase(context, scaleFixture());
    await page.addInitScript(() => {
      window.canvasPaints = {};
      window.motionFrames = [];
      window.trackMotion = false;
      window.measuringMotionFrame = false;
      window.largestHoverSort = 0;
      const sort = Array.prototype.sort;
      Array.prototype.sort = function(...args) {
        if (window.measuringMotionFrame)
          window.largestHoverSort = Math.max(window.largestHoverSort, this.length);
        return sort.apply(this, args);
      };
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function(...args) {
        window.canvasPaints[this.canvas.id] = (window.canvasPaints[this.canvas.id] || 0) + 1;
        return clear.apply(this, args);
      };
      const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = callback => raf.call(window, time => {
        const before = window.canvasPaints['graph-overlay'];
        const start = performance.now();
        window.measuringMotionFrame = window.trackMotion;
        callback(time);
        window.measuringMotionFrame = false;
        if (window.trackMotion && before !== window.canvasPaints['graph-overlay']) {
          window.motionFrames.push({ time, duration: performance.now() - start });
        }
      });
    });
    await open(page);
    await settleCanvas(page);
    const basePaints = await page.evaluate(() => window.canvasPaints['graph-base']);
    await page.evaluate(() => { window.trackMotion = true; });
    await page.locator('.repo-row').first().hover();
    await expect(page.locator('#inspector-mode')).toHaveText('PREVIEW');
    await page.getByRole('button', { name: 'Pin project', exact: true }).click();
    await page.waitForTimeout(500);
    const growth = await page.evaluate(() => window.motionFrames);
    expect(growth.length).toBeGreaterThanOrEqual(4);
    expect(growth.length).toBeLessThan(60);
    const settled = await page.evaluate(() => ({ ...window.canvasPaints }));
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.canvasPaints)).toEqual(settled);
    await page.evaluate(() => { window.motionFrames = []; });
    await page.mouse.move(1, 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const shrinkage = await page.evaluate(() => window.motionFrames);
    expect(shrinkage.length).toBeGreaterThanOrEqual(4);
    expect(shrinkage.length).toBeLessThan(60);
    for (const frames of [growth, shrinkage]) {
      const durations = frames.map(frame => frame.duration).sort((left, right) => left - right);
      expect(durations[Math.floor(durations.length / 2)]).toBeLessThan(60);
    }
    const idle = await page.evaluate(() => ({ ...window.canvasPaints }));
    expect(idle['graph-base']).toBe(basePaints);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.canvasPaints)).toEqual(idle);
    expect(await page.locator('*').count()).toBeLessThan(1000);
    const bounds = await page.locator('#graph-overlay').boundingBox();
    const approach = await page.evaluate(async viewport => {
      const { normalizeDatabase, layoutRepositories } = await import('/graph/model.js');
      const database = await (await fetch('/graph/action-usage-db.json')).json();
      const repositories = normalizeDatabase(database).repositories;
      const layout = layoutRepositories(repositories, viewport);
      return {
        x: Math.max(...repositories.map(repository => repository.x + repository.radius)) + 24,
        y: layout.center.y,
      };
    }, { width: bounds.width, height: bounds.height });
    await page.evaluate(() => { window.motionFrames = []; });
    await page.mouse.move(bounds.x + approach.x, bounds.y + approach.y);
    await page.waitForTimeout(500);
    const approaching = await page.evaluate(() => window.motionFrames);
    expect(approaching.length).toBeLessThanOrEqual(1);
    await expect(page.getByRole('tooltip')).toBeHidden();
    const approached = await page.evaluate(() => ({ ...window.canvasPaints }));
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.canvasPaints)).toEqual(approached);
    await page.mouse.move(1, 1);
    await page.waitForTimeout(500);
    const restored = await page.evaluate(() => ({ ...window.canvasPaints }));
    expect(restored['graph-base']).toBe(basePaints);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.canvasPaints)).toEqual(restored);
    await page.evaluate(async () => {
      const { CanvasGraph } = await import('/graph/canvas-graph.js');
      const draw = CanvasGraph.prototype.drawHighlight;
      CanvasGraph.prototype.drawHighlight = function(time) {
        const pulsing = draw.call(this, time);
        window.nearbyGeometry = this.tooltipCircles.map(circle => ({ ...circle }));
        window.nextNavigationId = this.navigationCue?.id || null;
        window.proximityCandidateId = this.proximityCandidate?.id || null;
        return pulsing;
      };
    });
    await page.locator('.repo-row').first().hover();
    await page.getByRole('button', { name: 'Pin project', exact: true }).click();
    await page.waitForTimeout(500);
    const geometry = await page.evaluate(() => window.nearbyGeometry);
    const active = geometry.find(circle => circle.emphasis === 1);
    const move = target => page.mouse.move(bounds.x + target.x, bounds.y + target.y);
    await move(active);
    await page.waitForTimeout(500);
    const first = await page.evaluate(() => window.nearbyGeometry);
    await page.evaluate(() => { window.motionFrames = []; });
    const pending = new Set(), accepted = new Set();
    for (let step = 0; step < 24; step++) {
      const angle = step / 24 * Math.PI * 2;
      await move({
        x: active.x + Math.cos(angle) * active.radius * 0.65,
        y: active.y + Math.sin(angle) * active.radius * 0.65,
      });
      await page.waitForTimeout(16);
      const current = await page.evaluate(() => window.nearbyGeometry);
      expect(current).toEqual(first);
      const prediction = await page.evaluate(() => window.nextNavigationId);
      if (prediction) accepted.add(prediction);
      const candidate = await page.evaluate(() => window.proximityCandidateId);
      if (candidate) pending.add(candidate);
    }
    expect(pending.size).toBeGreaterThanOrEqual(2);
    for (const peer of first.filter(circle => !circle.emphasis)) {
      const length = Math.hypot(peer.x - active.x, peer.y - active.y);
      await move({
        x: active.x + (peer.x - active.x) / length * active.radius * 0.65,
        y: active.y + (peer.y - active.y) / length * active.radius * 0.65,
      });
      await page.waitForTimeout(224);
      const id = await page.evaluate(() => window.nextNavigationId);
      if (id) accepted.add(id);
      expect(await page.evaluate(() => window.nearbyGeometry)).toEqual(first);
    }
    expect(accepted.size).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => window.nearbyGeometry)).toEqual(first);
    const continuous = await page.evaluate(() => window.motionFrames.map(frame => frame.duration).sort((a, b) => a - b));
    expect(continuous[Math.floor(continuous.length / 2)]).toBeLessThan(60);
    const pointerSettled = await page.evaluate(() => ({ ...window.canvasPaints }));
    expect(pointerSettled['graph-base']).toBe(basePaints);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.canvasPaints)).toEqual(pointerSettled);
    expect(await page.evaluate(() => window.largestHoverSort)).toBeLessThanOrEqual(14);
    console.log(`10,000 animated projects: ${growth.length} growth frames, ${shrinkage.length} shrink frames, ${approaching.length} approach frames, ${continuous[Math.floor(continuous.length / 2)].toFixed(1)} ms median filtered proximity updates; fixed neighbors, no base or idle repaints.`);
  });
});

test('restores triangular action anchors and centers the repository cloud after filtering', async ({ page, context }) => {
  await mockDatabase(context);
  await trackCanvas(context);
  await open(page);
  for (const [query, count] of [['', 4], ['alpha', 1], ['C++', 4]]) {
    await page.getByLabel('Search projects', { exact: true }).fill(query);
    await results(page, count);
    await settleCanvas(page);
    const hubs = [];
    for (const action of actions) hubs.push(await hubPosition(page, action));
    const [left, bottom, right] = hubs;
    expect(left.x).toBeLessThan(bottom.x);
    expect(right.x).toBeGreaterThan(bottom.x);
    expect(left.y).toBe(right.y);
    expect(bottom.y).toBeGreaterThan(left.y + 100);
    const center = {
      x: hubs.reduce((sum, hub) => sum + hub.x, 0) / 3,
      y: hubs.reduce((sum, hub) => sum + hub.y, 0) / 3,
    };
    const circles = await repositoryCircles(page);
    expect(circles).toHaveLength(count);
    const mass = circles.reduce((sum, circle) => sum + circle.radius ** 2, 0);
    expect(circles.reduce((sum, circle) => sum + circle.x * circle.radius ** 2, 0) / mass).toBeCloseTo(center.x, 7);
    expect(circles.reduce((sum, circle) => sum + circle.y * circle.radius ** 2, 0) / mass).toBeCloseTo(center.y, 7);
    for (const circle of circles) {
      for (let index = 0; index < hubs.length; index++) {
        const from = hubs[index], to = hubs[(index + 1) % hubs.length];
        const cross = (to.x - from.x) * (circle.y - from.y) - (to.y - from.y) * (circle.x - from.x);
        expect(-cross / Math.hypot(to.x - from.x, to.y - from.y)).toBeGreaterThanOrEqual(circle.radius - 1e-6);
      }
    }
  }
});

test('reveals colored stars and owner/repository labels inside circles as zoom allows', async ({ page, context }) => {
  await mockDatabase(context);
  await trackCanvas(context);
  await open(page, '?q=alpha');
  const texts = () => page.evaluate(() => window.canvasDrawing['graph-base'].texts);
  await settleCanvas(page);
  expect((await texts()).some(entry => entry.text === 'alpha')).toBe(true);
  const initialRadius = (await repositoryCircles(page))[0].radius;
  const steps = Math.floor(Math.log(initialRadius / 20) / Math.log(1.3));
  for (let index = 0; index < steps; index++) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await settleCanvas(page);
  let drawn = await texts();
  expect(drawn.filter(entry => entry.text === '\u2605')).toEqual([
    expect.objectContaining({ color: '#596c87' }),
  ]);
  expect(drawn.some(entry => entry.text === '100')).toBe(true);
  expect(drawn.some(entry => entry.text === 'alpha' || entry.text === 'acme')).toBe(false);
  for (let index = 0; index < 4; index++) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await settleCanvas(page);
  expect((await texts()).some(entry => entry.text === '\u2605' || entry.text === 'alpha')).toBe(false);
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  await settleCanvas(page);
  drawn = await texts();
  expect(drawn.some(entry => entry.text === 'acme')).toBe(true);
  expect(drawn.some(entry => entry.text === 'alpha')).toBe(true);
  expect(drawn.some(entry => entry.text === 'acme/alpha')).toBe(false);
  await expect(page.locator('#star-legend')).toHaveText('25+100+1,000+');
  await page.getByRole('button', { name: /acme\/alpha/ }).click();
  await expect(page.locator('.project-meta .star-glyph')).toHaveCSS('color', 'rgb(89, 108, 135)');
});

test('keeps bucket fills and diameter ratios through zoom, hover, pinning, and action highlights', async ({ page, context }) => {
  await mockDatabase(context, bucketFixture());
  await trackCanvas(context);
  await open(page);
  await settleCanvas(page);
  const colors = ['#e7aa7b', '#d8e3f3', '#ffd166'];
  const baseline = await repositoryCircles(page);
  expect(baseline).toHaveLength(3);
  const pixels = await page.locator('#graph-base').evaluate((canvas, circles) => {
    const ratio = canvas.width / canvas.clientWidth;
    return circles.map(circle => Array.from(canvas.getContext('2d').getImageData(
      Math.round(circle.x * ratio), Math.round((circle.y + circle.radius * 0.78) * ratio), 1, 1
    ).data));
  }, baseline);
  expect(pixels).toEqual(baseline.map(circle => [
    parseInt(circle.color.slice(1, 3), 16),
    parseInt(circle.color.slice(3, 5), 16),
    parseInt(circle.color.slice(5, 7), 16), 255,
  ]));
  for (const direction of ['Zoom in', 'Zoom out']) {
    await page.getByRole('button', { name: direction, exact: true }).click();
    await settleCanvas(page);
    const circles = await repositoryCircles(page);
    const bronze = circles.find(circle => circle.color === colors[0]);
    expect(circles.find(circle => circle.color === colors[1]).radius / bronze.radius).toBeCloseTo(1.5, 8);
    expect(circles.find(circle => circle.color === colors[2]).radius / bronze.radius).toBeCloseTo(2, 8);
  }
  const hub = await hubPosition(page, 'get-cmake');
  await page.mouse.move(hub.clientX, hub.clientY);
  await settleCanvas(page);
  const highlighted = await repositoryCircles(page, 'graph-overlay');
  expect(highlighted.map(circle => circle.color).sort()).toEqual(colors.slice().sort());
  const bronze = highlighted.find(circle => circle.color === colors[0]);
  expect(highlighted.find(circle => circle.color === colors[1]).radius / bronze.radius).toBeCloseTo(1.5, 8);
  expect(highlighted.find(circle => circle.color === colors[2]).radius / bronze.radius).toBeCloseTo(2, 8);
  const previews = [], pinned = [];
  for (const [index, name] of ['bronze', 'silver', 'gold'].entries()) {
    await page.getByRole('button', { name: new RegExp(`acme/${name}`) }).hover();
    await settleCanvas(page);
    const preview = (await repositoryCircles(page, 'graph-overlay')).filter(circle => circle.alpha === 1);
    expect(preview).toHaveLength(1);
    expect(preview[0].color).toBe(colors[index]);
    if (name === 'gold') {
      expect(await page.evaluate(() => window.canvasDrawing['graph-overlay'].texts.map(entry => entry.text))).toContain('v3 +1');
      await expect(page.getByRole('button', { name: 'Filter by get-cmake@v4', exact: true })).toBeVisible();
    }
    previews.push(preview[0].radius);
    await page.getByRole('button', { name: new RegExp(`acme/${name}`) }).click();
    await page.mouse.move(1, 1);
    await settleCanvas(page);
    const selected = (await repositoryCircles(page, 'graph-overlay')).filter(circle => circle.alpha === 1);
    expect(selected).toHaveLength(1);
    expect(selected[0].color).toBe(colors[index]);
    await unobscuredPreview(page);
    pinned.push(selected[0].radius);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  }
  for (const radii of [previews, pinned]) {
    expect(radii[1] / radii[0]).toBeCloseTo(1.5, 8);
    expect(radii[2] / radii[0]).toBeCloseTo(2, 8);
  }
});

test('does not impose a fixed minimum that flattens bucket sizes when zoomed out', async ({ page, context }) => {
  const projects = {};
  for (let index = 0; index < 270; index++) {
    const name = `project-${index}`;
    projects[name] = project([25, 100, 1000][index % 3], [usage(name, 'get-cmake', 'v3')]);
  }
  await mockDatabase(context, { acme: projects });
  await trackCanvas(context);
  await open(page);
  for (let index = 0; index < 15; index++) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await settleCanvas(page);
  const circles = await repositoryCircles(page);
  expect(circles).toHaveLength(270);
  const bronze = circles.find(circle => circle.color === '#e7aa7b').radius;
  expect(bronze).toBeLessThan(1);
  expect(circles.find(circle => circle.color === '#d8e3f3').radius / bronze).toBeCloseTo(1.5, 8);
  expect(circles.find(circle => circle.color === '#ffd166').radius / bronze).toBeCloseTo(2, 8);
});

test('reclaims filtered space, resizes circles with the viewport, and preserves geometry for list sorting', async ({ page, context }) => {
  await mockDatabase(context, bucketFixture());
  await trackCanvas(context);
  await open(page);
  await settleCanvas(page);
  const before = (await repositoryCircles(page)).find(circle => circle.color === '#e7aa7b').radius;
  await page.getByLabel('Search projects', { exact: true }).fill('bronze');
  await page.getByLabel('Sort projects', { exact: true }).selectOption('name');
  await results(page, 1);
  await settleCanvas(page);
  const sparse = await repositoryCircles(page);
  expect(sparse).toHaveLength(1);
  expect(sparse[0].color).toBe('#e7aa7b');
  expect(sparse[0].radius).toBeGreaterThan(before * 2);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await settleCanvas(page);
  const zoomed = await repositoryCircles(page);
  await page.getByLabel('Sort projects', { exact: true }).selectOption('stars');
  await expect(page.locator('#repository-list')).toHaveAttribute('aria-busy', 'false');
  await settleCanvas(page);
  expect(await repositoryCircles(page)).toEqual(zoomed);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await repositoryCircles(page))[0].radius).toBeLessThan(sparse[0].radius);
  const mobile = (await repositoryCircles(page))[0];
  const bounds = await page.locator('#graph-base').boundingBox();
  expect(mobile.x - mobile.radius).toBeGreaterThanOrEqual(16);
  expect(mobile.x + mobile.radius).toBeLessThanOrEqual(bounds.width - 16);
  expect(mobile.y - mobile.radius).toBeGreaterThanOrEqual(44);
  expect(mobile.y + mobile.radius).toBeLessThanOrEqual(bounds.height - 52);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await expect.poll(async () => (await repositoryCircles(page))[0].radius).toBeCloseTo(sparse[0].radius, 5);
});

test('preserves an expanded neighborhood when sorting the unchanged project set', async ({ page, context }) => {
  await mockDatabase(context, bucketFixture());
  await trackCanvas(context);
  await open(page);
  await page.getByRole('button', { name: /acme\/gold/ }).click();
  await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
  await page.waitForTimeout(300);
  await settleCanvas(page);
  const before = await repositoryCircles(page, 'graph-overlay');
  expect(before.length).toBeGreaterThan(0);
  await page.getByLabel('Sort projects', { exact: true }).selectOption('name');
  await expect(page.locator('#repository-list')).toHaveAttribute('aria-busy', 'false');
  await page.waitForTimeout(300);
  await settleCanvas(page);
  const after = await repositoryCircles(page, 'graph-overlay');
  expect(after).toEqual(before);
});

test('click expansion follows displayed hit targets without hover handoffs and restores the original layout', async ({ page, context }) => {
  const projects = {};
  for (let index = 0; index < 30; index++) {
    const name = `project-${String(index).padStart(2, '0')}`;
    projects[name] = project(2000 - index, [usage(name, 'get-cmake', 'v3')]);
  }
  const database = { acme: projects };
  await mockDatabase(context, database);
  await trackCanvas(context);
  await open(page);
  await page.getByRole('button', { name: /acme\/project-00/ }).click();
  await page.keyboard.press('Escape');
  await page.mouse.move(1, 1);
  await settleCanvas(page);
  const base = await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL());
  const canvas = await page.locator('#graph-overlay').boundingBox();
  const center = { x: canvas.width / 2, y: canvas.height / 2 };
  const native = (await repositoryCircles(page)).find(circle => Math.hypot(circle.x - center.x, circle.y - center.y) < 0.01);
  await clickCircleBody(page, canvas, native);
  await settleCanvas(page);
  let drawing = await page.evaluate(() => window.canvasDrawing['graph-overlay']);
  const expanded = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1);
  expect(expanded.radius).toBeGreaterThan(native.radius);
  expect(drawing.texts.map(entry => entry.text)).toEqual(expect.arrayContaining(['acme', 'project-00', '2,000', '\u2605']));
  expect(drawing.texts.some(entry => entry.text === '\u2605' && entry.color === '#946000')).toBe(true);
  const label = drawing.texts.find(entry => entry.text === 'project-01');
  expect(label).toBeDefined();
  const neighbor = (await repositoryCircles(page, 'graph-overlay')).find(circle =>
    Math.hypot(circle.x - label.x, circle.y - label.y) < 0.001
  );
  expect(neighbor).toBeDefined();
  expect(Math.hypot(neighbor.x - center.x, neighbor.y - center.y)).toBeGreaterThan(expanded.radius + neighbor.radius);
  expect(drawing.circles.some(circle => Math.hypot(circle.x - neighbor.x, circle.y - neighbor.y) < 0.01 && Math.abs(circle.radius - neighbor.radius) < 0.01)).toBe(true);
  await page.mouse.move(canvas.x + center.x + expanded.radius * 0.6, canvas.y + center.y);
  await expect(page.getByRole('tooltip')).toContainText('acme/project-00');
  await settleCanvas(page);
  drawing = await page.evaluate(() => window.canvasDrawing['graph-overlay']);
  const current = await repositoryCircles(page, 'graph-overlay');
  const targetLabel = drawing.texts.find(entry =>
    /^project-\d\d$/.test(entry.text) && entry.text !== 'project-00' &&
    current.some(circle => circle.alpha === 0.95 &&
      Math.hypot(circle.x - entry.x, circle.y - entry.y) < 0.001 &&
      circle.x >= expanded.radius + 24 && circle.x <= canvas.width - expanded.radius - 24 &&
      circle.y >= expanded.radius + 52 && circle.y <= canvas.height - expanded.radius - 60)
  );
  expect(targetLabel).toBeDefined();
  const target = current.find(circle => circle.alpha === 0.95 &&
    Math.hypot(circle.x - targetLabel.x, circle.y - targetLabel.y) < 0.001);
  await page.mouse.move(canvas.x + target.x, canvas.y + target.y);
  await expect(page.getByRole('tooltip')).toContainText(`acme/${targetLabel.text}`);
  await settleCanvas(page);
  drawing = await page.evaluate(() => window.canvasDrawing['graph-overlay']);
  expect((await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1)).toEqual(expanded);
  await expect(page.locator('.project-title')).toContainText('project-00');
  await page.mouse.move(canvas.x + target.x + 1, canvas.y + target.y);
  await expect(page.getByRole('tooltip')).toContainText(`acme/${targetLabel.text}`);
  await clickCircleBody(page, canvas, target);
  await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
  await expect(page.locator('.project-title')).toContainText(targetLabel.text);
  await page.keyboard.press('Escape');
  await page.mouse.move(1, 1);
  await settleCanvas(page);
  expect(await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL())).toBe(base);
  expect(await page.evaluate(() => window.canvasDrawing['graph-overlay'].circles)).toEqual([]);
});

test('keeps edge-selected labels visible and fits long names without losing full inspector text', async ({ page, context }) => {
  const owner = 'a-very-long-owner-name-for-the-project';
  const name = 'a-repository-name-that-cannot-fit-on-a-single-line-inside-a-circle';
  await mockDatabase(context, { [owner]: { [name]: project(25, [usage(name, 'get-cmake', 'v3')]) } });
  await trackCanvas(context);
  await open(page);
  await page.locator('.repo-row').click();
  await page.keyboard.press('Escape');
  await settleCanvas(page);
  const canvas = await page.locator('#graph-overlay').boundingBox();
  await page.mouse.move(canvas.x + canvas.width - 20, canvas.y + 50);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width - 20 + 4 - canvas.width / 2, canvas.y + 50, { steps: 4 });
  await page.mouse.up();
  await settleCanvas(page);
  await clickCircleBody(page, canvas, (await repositoryCircles(page))[0]);
  await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
  await settleCanvas(page);
  let drawing = await page.evaluate(() => window.canvasDrawing['graph-overlay']);
  const expanded = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1);
  expect(expanded.x - expanded.radius).toBeGreaterThanOrEqual(0);
  expect(expanded.x + expanded.radius).toBeLessThanOrEqual(canvas.width);
  expect(drawing.texts.some(entry => entry.text.endsWith('\u2026'))).toBe(true);
  expect(drawing.texts.find(entry => entry.text === '\u2605').color).toBe('#9a5229');
  await expect(page.locator('.project-owner')).toHaveText(owner);
  await expect(page.locator('.project-title')).toContainText(name);
  await page.mouse.move(canvas.x + expanded.x, canvas.y + expanded.y);
  await expect(page.getByRole('tooltip')).toContainText(`${owner}/${name}`);
  await expectPaintedNameLink(page, `${owner}/${name}`);
  await page.mouse.click(canvas.x + expanded.x, canvas.y + expanded.y + expanded.radius * 0.75);
  await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
});

test('names the supported GitHub Actions and keeps headings readable across screen widths', async ({ page, context }) => {
  await mockDatabase(context);
  await open(page);
  const title = 'Usage of run-cmake, get-cmake and run-vcpkg GitHub Actions';
  await expect(page).toHaveTitle(`${title} in public GitHub repositories with more than 25 stars`);
  await expect(page.locator('.brand-name')).toHaveText(title);
  await expect(page.locator('.brand .eyebrow')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Projects using run-cmake, get-cmake and run-vcpkg');
  await expect(page.locator('.intro p')).toHaveText('Browse public GitHub repositories, see which versions of these actions they use, and open the workflows that reference them.');
  await expect(page.locator('#graph-heading')).toHaveText('Project usage map');
  await expect(page.locator('#inspector-heading')).toHaveText('Project workflow details');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    await expect(page.locator('.brand-name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy view link', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.locator('.brand-name').evaluate(link => link.scrollWidth <= link.clientWidth)).toBe(true);
  }
});

test('loads the real database without external requests or runtime errors', async ({ page }) => {
  const errors = [];
  const remoteRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:4173/')) remoteRequests.push(request.url());
  });
  const database = JSON.parse(fs.readFileSync(path.join(__dirname, '../../graph/action-usage-db.json'), 'utf8'));
  const projects = Object.entries(database).filter(([owner]) => owner !== 'LastStartTimeName')
    .flatMap(([, repositories]) => Object.values(repositories));
  const usages = projects.reduce((count, entries) => count + entries.filter(entry => entry.actionName).length, 0);
  await open(page);
  await expect(page.locator('#total-projects')).toHaveText(projects.length.toLocaleString('en'));
  await expect(page.locator('#total-usages')).toHaveText(usages.toLocaleString('en'));
  await expect(page.locator('.repo-row')).toHaveCount(40);
  await expect(page.locator('canvas')).toHaveCount(2);
  expect(remoteRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('composes search, inclusive star ranges, quick presets, and reset', async ({ page, context }) => {
  await mockDatabase(context);
  await open(page);
  await results(page, 4);
  await page.getByLabel('Minimum stars', { exact: true }).fill('100');
  await page.getByLabel('Maximum stars', { exact: true }).fill('500');
  await results(page, 2);
  await expect(page.locator('.repo-row').first()).toContainText('acme/beta');
  await page.getByLabel('Search projects', { exact: true }).fill('ALPHA graphics c++');
  await results(page, 1);
  await expect(page.locator('.repo-row')).toContainText('acme/alpha');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).first().click();
  await results(page, 4);
  await page.getByRole('button', { name: '1k+', exact: true }).click();
  await results(page, 1);
  await expect(page.locator('.repo-row')).toContainText('acme/gamma');
  await page.getByRole('button', { name: 'Any', exact: true }).click();
  await page.getByLabel('Maximum stars', { exact: true }).fill('0');
  await results(page, 1);
  await expect(page.locator('.repo-row')).toContainText('acme/delta');
});

test('distinguishes project counts from occurrences and intersects actions and versions', async ({ page, context }) => {
  await mockDatabase(context);
  await open(page);
  await expect(page.locator('#total-usages')).toHaveText('8');
  await expect(page.locator('.action-option').filter({ hasText: 'get-cmake' }).locator('.action-count')).toHaveText('3');
  await page.getByRole('checkbox', { name: 'Filter get-cmake', exact: true }).check();
  await results(page, 3);
  await page.getByRole('checkbox', { name: 'Filter run-cmake', exact: true }).check();
  await results(page, 4);
  await page.getByLabel('Match selected actions').selectOption('all');
  await results(page, 1);
  await expect(page.locator('.repo-row')).toContainText('acme/gamma');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).first().click();
  await results(page, 4);
  await page.getByLabel('Action version', { exact: true }).selectOption('get-cmake@v3');
  await results(page, 1);
  await expect(page.locator('.repo-row')).toContainText('acme/alpha');
  await expect(page.locator('#version-filter option[value="get-cmake@v4"]')).toHaveCount(1);
  await expect(page.locator('#graph-summary')).toHaveText('1 project \u00b7 3 workflow usages');
});

test('reports invalid ranges, missing versions, and zero results without hiding recovery controls', async ({ page, context }) => {
  await mockDatabase(context);
  await open(page);
  await page.getByLabel('Minimum stars', { exact: true }).fill('500');
  await page.getByLabel('Maximum stars', { exact: true }).fill('100');
  await expect(page.getByRole('alert')).toHaveText('Minimum stars must not exceed maximum stars.');
  await expect(page.locator('#results-summary')).toContainText('Fix the star range');
  await page.getByLabel('Maximum stars', { exact: true }).fill('1500');
  await expect(page.getByRole('alert')).toBeHidden();
  await results(page, 2);
  await page.getByLabel('Minimum stars', { exact: true }).fill('-1');
  await expect(page.getByRole('alert')).toContainText('non-negative');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).first().click();
  await results(page, 4);
  await page.getByLabel('Search projects', { exact: true }).fill('no-such-project');
  await results(page, 0);
  await expect(page.locator('#graph-empty')).toBeVisible();
  await page.locator('#empty-reset').click();
  await results(page, 4);
  await open(page, '?version=get-cmake%40missing');
  await results(page, 0);
  await expect(page.locator('#version-filter')).toHaveValue('get-cmake@missing');
});

test('action hubs filter on pointer click and toggle back to all projects', async ({ page, context }) => {
  await mockDatabase(context);
  await trackCanvas(context);
  await open(page);
  await settleCanvas(page);
  for (const [index, action] of actions.entries()) {
    let hub = await hubPosition(page, action);
    await page.mouse.move(hub.clientX, hub.clientY);
    await expect(page.getByRole('tooltip')).toContainText(action);
    await page.mouse.click(hub.clientX, hub.clientY);
    await results(page, [3, 2, 2][index]);
    await expect(page.getByRole('checkbox', { name: `Filter ${action}`, exact: true })).toBeChecked();
    await settleCanvas(page);
    hub = await hubPosition(page, action);
    await page.mouse.click(hub.clientX, hub.clientY);
    await results(page, 4);
    await expect(page.getByRole('checkbox', { name: `Filter ${action}`, exact: true })).not.toBeChecked();
  }
});

test('keeps every action hub clickable inside an expanded neighborhood', async ({ page, context }) => {
  await mockDatabase(context);
  await trackCanvas(context);
  for (const action of actions) {
    await open(page, '?q=gamma');
    await page.locator('.repo-row').click();
    for (let index = 0; index < 4; index++) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await settleCanvas(page);
    const hub = await hubPosition(page, action);
    const expanded = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1);
    const mask = await page.evaluate(() => window.canvasDrawing['graph-overlay'].circles.find(circle => circle.color === '#101b30'));
    const distance = Math.hypot(hub.x - mask.x, hub.y - mask.y);
    expect(distance).toBeLessThan(mask.radius);
    expect(distance).toBeGreaterThan(expanded.radius + 1);
    await page.mouse.move(hub.clientX, hub.clientY);
    await expect(page.getByRole('tooltip')).toContainText(action);
    await page.mouse.click(hub.clientX, hub.clientY);
    await expect(page.getByRole('checkbox', { name: `Filter ${action}`, exact: true })).toBeChecked();
  }
});

test('copies a restorable URL and ignores obsolete rapid search requests', async ({ page, context }) => {
  await mockDatabase(context);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, '?minStars=100&actions=get-cmake&repo=acme%2Falpha');
  await results(page, 2);
  await page.getByRole('button', { name: 'Copy view link', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('View link copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('minStars=100');
  expect(copied).toContain('actions=get-cmake');
  expect(copied).toContain('repo=acme%2Falpha');
  const search = page.getByLabel('Search projects', { exact: true });
  await search.fill('gamma');
  await search.fill('alpha');
  await results(page, 1);
  await expect(page.locator('.repo-row')).toContainText('acme/alpha');
  await expect(page).toHaveURL(/q=alpha/);
  await page.evaluate(() => {
    history.pushState(null, '', '?q=beta');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await results(page, 1);
  await expect(page.locator('.repo-row')).toContainText('acme/beta');
  await expect(search).toHaveValue('beta');
});

test('previews, pins, opens exact workflow lines, and shares the selected version', async ({ page, context }) => {
  await mockDatabase(context);
  await open(page);
  await page.getByRole('button', { name: /acme\/alpha/ }).hover();
  await expect(page.locator('#inspector-mode')).toHaveText('PREVIEW');
  await expect(page.locator('.project-title')).toContainText('alpha');
  await page.getByRole('button', { name: /acme\/alpha/ }).click();
  await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
  await page.getByRole('button', { name: /acme\/beta/ }).hover();
  await expect(page.locator('.project-title')).toContainText('alpha');
  const usage = page.locator('.workflow-details').first();
  await usage.locator('summary').click();
  await expect(usage.getByRole('link').first()).toHaveAttribute('href', 'https://github.com/acme/alpha/blob/main/.github/workflows/build.yml#L10');
  await expect(usage.getByRole('link')).toHaveCount(2);
  await page.getByRole('button', { name: 'Filter by get-cmake@v3', exact: true }).click();
  await results(page, 1);
  await expect(page).toHaveURL(/version=get-cmake%40v3/);
  await expect(page).toHaveURL(/repo=acme%2Falpha/);
  await page.reload();
  await expect(page.locator('#graph-state')).toBeHidden();
  await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
  await expect(page.locator('.project-title')).toContainText('alpha');
  await page.getByRole('button', { name: 'Unpin project', exact: true }).click();
  await expect(page.locator('#inspector-placeholder')).toBeVisible();
});

test('preserves canonical workflow branches, paths and exact line anchors', async ({ page, context }) => {
  const database = fixture();
  const urls = [
    'https://github.com/grame-cncm/faust/blob/master-dev/.github/workflows/windows.yml#L24',
    'https://github.com/katursis/Pawn.RakNet/blob/0.3.7/.github/workflows/build.yml#L32',
    'https://github.com/acme/alpha/blob/release/v1.2/.github/workflows/build%20linux.yml#L12',
    'https://github.com/acme/alpha/blob/main/.github/workflows/ci.yml.bak#L37',
  ];
  database.acme.alpha = project(100, urls.map((url, index) => ({
    actionName: 'get-cmake',
    version: 'v3',
    line: [24, 32, 12, 37][index],
    url,
  })));
  database.acme.alpha[4].repo_orig.default_branch = 'a-different-default';
  await mockDatabase(context, database);
  await open(page, '?q=alpha&repo=acme%2Falpha');
  await page.locator('.workflow-details summary').click();
  const links = page.locator('.workflow-links a');
  await expect(links).toHaveCount(urls.length);
  for (const [index, url] of urls.entries()) {
    await expect(links.nth(index)).toHaveAttribute('href', url);
    await expect(links.nth(index)).toHaveAttribute('target', '_blank');
  }
  await expect(links.first()).toHaveText('windows.yml:24 \u2197');
  await expect(links.last()).toHaveText('ci.yml.bak:37 \u2197');
});

test('opens all-action repository searches from names without replacing a pin', async ({ page, context }) => {
  await mockDatabase(context);
  await trackCanvas(context);
  await mockRepositorySearch(context);
  await open(page);
  await page.getByRole('button', { name: /acme\/beta/ }).click();
  await page.getByRole('button', { name: /acme\/delta/ }).hover();
  const link = repositoryNameLink(page, 'acme/delta');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('draggable', 'false');
  const url = await openRepositorySearch(page, () => link.click());
  expect(url.origin + url.pathname).toBe('https://github.com/search');
  expect(url.searchParams.get('type')).toBe('code');
  expect(url.searchParams.get('q')).toBe('repo:acme/delta AND (get-cmake OR run-cmake OR run-vcpkg)');
  await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
  await expect(page.locator('.project-title')).toContainText('beta');
  await expect(page).toHaveURL(/repo=acme%2Fbeta/);
  await page.getByRole('button', { name: /acme\/delta/ }).hover();
  await link.hover();
  await expectPaintedNameLink(page, 'acme/delta');
  const canvas = await page.locator('#graph-overlay').boundingBox();
  const circle = await page.evaluate(() => {
    const drawing = window.canvasDrawing['graph-overlay'];
    const label = drawing.texts.find(text => text.text === 'delta');
    return drawing.circles.find(circle => circle.color === '#91a4bf' &&
      Math.hypot(circle.x - label.x, circle.y - label.y) < 0.01);
  });
  await page.mouse.click(canvas.x + circle.x, canvas.y + circle.y + circle.radius * 0.75);
  await expect(page.locator('.project-title')).toContainText('delta');
  await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
  expect(context.pages()).toHaveLength(1);
});

test('supports native keyboard, middle, modifier and context-menu name links', async ({ page, context }) => {
  await mockDatabase(context);
  await mockRepositorySearch(context);
  await open(page, '?q=alpha');
  const link = repositoryNameLink(page, 'acme/alpha');
  await page.locator('#graph-overlay').focus();
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  await expect(link).toHaveCSS('outline-style', 'solid');
  for (const activate of [
    () => page.keyboard.press('Enter'),
    () => link.click({ button: 'middle' }),
    () => link.click({ modifiers: ['Control'] }),
  ]) {
    const url = await openRepositorySearch(page, activate);
    expect(url.searchParams.get('q')).toBe('repo:acme/alpha AND (get-cmake OR run-cmake OR run-vcpkg)');
    await expect(page.locator('#inspector-mode')).not.toHaveText('PINNED');
    expect(new URL(page.url()).searchParams.has('repo')).toBe(false);
  }
  await page.evaluate(() => {
    document.addEventListener('contextmenu', event => {
      window.nameContextMenu = {
        prevented: event.defaultPrevented,
        href: event.target.closest('a')?.href,
      };
    }, { once: true });
  });
  await link.click({ button: 'right' });
  expect(await page.evaluate(() => window.nameContextMenu)).toEqual({
    prevented: false,
    href: await link.getAttribute('href'),
  });
  expect(context.pages()).toHaveLength(1);
});

test('keeps neighborhoods and native anchor identities stable across name hover', async ({ page, context }) => {
  const canvas = await openMotion(page, context);
  const native = (await repositoryCircles(page)).find(circle => circle.color === '#ffd166');
  await clickCircleBody(page, canvas, native);
  await page.clock.runFor(32);
  const active = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1);
  const link = repositoryNameLink(page, 'acme/gold');
  await link.evaluate(anchor => { window.originalNameLink = anchor; });
  const geometry = await repositoryGeometry(page);
  const basePaints = await page.evaluate(() => window.canvasPaints['graph-base']);
  for (const [dx, dy] of [[0, 0.75], [0, 0], [0, -0.75], [0, 0], [0.8, 0], [0, 0]]) {
    await page.mouse.move(canvas.x + active.x + active.radius * dx, canvas.y + active.y + active.radius * dy);
    await page.clock.runFor(32);
    await expect(page.getByRole('tooltip')).toContainText('acme/gold');
    expect(await repositoryGeometry(page)).toEqual(geometry);
    expect(await link.evaluate(anchor => anchor === window.originalNameLink)).toBe(true);
    await expectPaintedNameLink(page, 'acme/gold');
  }
  await page.clock.runFor(1000);
  const settled = await page.evaluate(() => ({ ...window.canvasPaints }));
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => window.canvasPaints)).toEqual(settled);
  expect(settled['graph-base']).toBe(basePaints);
});

test('tracks fitted name links through camera, viewport, filter and view changes', async ({ page, context }) => {
  const name = 'a-repository-name-that-cannot-fit-on-a-single-line-inside-a-circle';
  await mockDatabase(context, { acme: { [name]: project(25, [usage(name, 'get-cmake', 'v3')]) } });
  await trackCanvas(context);
  await open(page);
  const id = `acme/${name}`;
  const link = repositoryNameLink(page, id);
  await link.evaluate(anchor => { window.originalNameLink = anchor; });
  const original = await expectPaintedNameLink(page, id);
  expect(original.label.text.endsWith('\u2026')).toBe(true);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await settleCanvas(page);
  const zoomed = await expectPaintedNameLink(page, id);
  expect(zoomed.bounds).not.toEqual(original.bounds);
  await page.locator('#graph-overlay').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await settleCanvas(page);
  const panned = await expectPaintedNameLink(page, id);
  expect(panned.bounds.left).toBeCloseTo(zoomed.bounds.left - 60, 2);
  expect(panned.bounds.top).toBeCloseTo(zoomed.bounds.top - 60, 2);
  expect(await link.evaluate(anchor => anchor === window.originalNameLink)).toBe(true);
  await link.hover();
  await settleCanvas(page);
  const base = await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL());
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -120);
  await settleCanvas(page);
  expect(await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL())).not.toBe(base);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  await expectPaintedNameLink(page, id);
  await page.setViewportSize({ width: 768, height: 1100 });
  await settleMapLayout(page);
  await expectPaintedNameLink(page, id);
  await page.getByRole('tab', { name: 'Usage trends' }).click();
  await expect(link).toBeHidden();
  await page.getByRole('tab', { name: 'Repository map' }).click();
  await settleCanvas(page);
  await expectPaintedNameLink(page, id);
  await page.getByLabel('Search projects', { exact: true }).fill('no-such-project');
  await results(page, 0);
  await expect(page.locator('.repository-name-link')).toHaveCount(0);
  await page.getByLabel('Search projects', { exact: true }).fill('');
  await results(page, 1);
  await expectPaintedNameLink(page, id);
  await page.locator('#graph-overlay').focus();
  for (let step = 0; step < 20; step++) await page.keyboard.press('ArrowRight');
  await settleCanvas(page);
  await expect(page.locator('.repository-name-link')).toHaveCount(0);
  await page.keyboard.press('0');
  await settleCanvas(page);
  await expectPaintedNameLink(page, id);
  for (let step = 0; step < 10; step++) await page.keyboard.press('-');
  await settleCanvas(page);
  await expect(page.locator('.repository-name-link')).toHaveCount(0);
});

test('hover redraws only the relationship layer and does not start an idle loop', async ({ page, context }) => {
  await mockDatabase(context);
  await page.addInitScript(() => {
    window.canvasClears = {};
    const original = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function(...args) {
      window.canvasClears[this.canvas.id] = (window.canvasClears[this.canvas.id] || 0) + 1;
      return original.apply(this, args);
    };
  });
  await open(page);
  await page.getByRole('button', { name: /acme\/alpha/ }).click();
  await page.keyboard.press('Escape');
  await page.mouse.move(1, 1);
  await settleCanvas(page);
  const canvas = await page.locator('#graph-overlay').boundingBox();
  const before = await page.evaluate(() => ({ ...window.canvasClears }));
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await expect(page.getByRole('tooltip')).toContainText('acme/alpha');
  await expect(page.getByRole('tooltip')).toContainText('get-cmake@v3');
  await settleCanvas(page);
  // Reduced motion still honors the finite target-stability interval.
  await page.waitForTimeout(224);
  const after = await page.evaluate(() => ({ ...window.canvasClears }));
  expect(after['graph-base']).toBe(before['graph-base']);
  expect(after['graph-overlay']).toBeGreaterThan(before['graph-overlay']);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.canvasClears['graph-base'])).toBe(after['graph-base']);
  expect(await page.evaluate(() => window.canvasClears['graph-overlay'])).toBe(after['graph-overlay']);
});

test('supports node dragging, zoom, panning, fit, and keyboard project selection', async ({ page, context }) => {
  let openedSearches = 0;
  page.on('popup', () => openedSearches++);
  await mockDatabase(context);
  await trackCanvas(context);
  await open(page);
  await settleCanvas(page);
  const hubs = [];
  for (const action of actions) {
    const hub = await hubPosition(page, action);
    hubs.push({ x: hub.x, y: hub.y, radius: hub.radius });
  }
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search projects', { exact: true })).toBeFocused();
  await page.getByLabel('Search projects', { exact: true }).fill('alpha');
  await results(page, 1);
  const row = page.getByRole('button', { name: /acme\/alpha/ });
  await row.focus();
  await row.press('Enter');
  await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
  await settleCanvas(page);
  const canvas = await page.locator('#graph-overlay').boundingBox();
  const center = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  await page.mouse.move(center.x + 6, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 61, center.y + 35, { steps: 5 });
  await page.mouse.up();
  expect(openedSearches).toBe(0);
  await page.keyboard.press('Escape');
  await page.mouse.move(center.x + 42, center.y + 35);
  await expect(page.getByRole('tooltip')).toContainText('acme/alpha');
  await page.mouse.move(1, 1);
  await settleCanvas(page);
  const beforeSort = await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL());
  await page.getByLabel('Sort projects', { exact: true }).selectOption('name');
  await expect(page.locator('#repository-list')).toHaveAttribute('aria-busy', 'false');
  await settleCanvas(page);
  expect(await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL())).toBe(beforeSort);
  const before = await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL());
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await settleCanvas(page);
  expect(await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL())).not.toBe(before);
  await page.locator('#graph-overlay').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('-');
  await page.keyboard.press('0');
  await expect(page.locator('#graph-overlay')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector-placeholder')).toBeVisible();
  await settleCanvas(page);
  const beforePan = await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL());
  await page.mouse.move(canvas.x + 20, canvas.y + canvas.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 60, canvas.y + canvas.height / 2 + 25, { steps: 4 });
  await page.mouse.up();
  await settleCanvas(page);
  const beforeWheel = await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL());
  expect(beforeWheel).not.toBe(beforePan);
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -120);
  await settleCanvas(page);
  expect(await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL())).not.toBe(beforeWheel);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  for (const [index, action] of actions.entries()) {
    const hub = await hubPosition(page, action);
    expect({ x: hub.x, y: hub.y, radius: hub.radius }).toEqual(hubs[index]);
  }
  await expect(page.locator('#inspector-placeholder')).toBeVisible();
});

test('recovers visibly from failed database requests', async ({ page, context }) => {
  let requests = 0;
  await context.route('**/action-usage-db.json', route => {
    requests++;
    return requests === 1
      ? route.fulfill({ status: 503, body: 'temporarily unavailable' })
      : route.fulfill({ json: fixture() });
  });
  await page.goto('/graph/graph.html');
  await expect(page.getByRole('heading', { name: 'Unable to load the map' })).toBeVisible();
  await expect(page.locator('#state-description')).toContainText('HTTP 503');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('#graph-state')).toBeHidden();
  await results(page, 4);
});

test('reports incomplete records and safely renders project-provided text', async ({ page, context }) => {
  const database = fixture();
  database.acme.alpha[3].repo_orig.description = '<img src=x onerror=alert(1)>';
  database.acme.invalid = [{ actionName: 'get-cmake' }];
  database.acme.alpha[0].url = 'javascript:alert(1)';
  await mockDatabase(context, database);
  await open(page);
  await expect(page.locator('#notice')).toContainText('skipped 1 project');
  await page.getByRole('button', { name: /acme\/alpha/ }).click();
  await expect(page.locator('.project-description')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#inspector-content img')).toHaveCount(0);
  const usage = page.locator('.workflow-details').first();
  await usage.locator('summary').click();
  await expect(usage.getByRole('link').first()).toHaveText('Search workflow \u2197');
  await expect(usage.getByRole('link').first()).toHaveAttribute('href', /https:\/\/github.com\/search/);
});

test('keeps all 10,000 projects browsable with bounded DOM and responsive exact filtering', async ({ page, context }) => {
  await mockDatabase(context, scaleFixture());
  const started = Date.now();
  await open(page);
  const loadMs = Date.now() - started;
  await expect(page.locator('#result-count')).toHaveText('10,000');
  await expect(page.locator('.repo-row')).toHaveCount(40);
  expect(await page.locator('*').count()).toBeLessThan(1000);
  const hoverStarted = Date.now();
  await page.locator('.repo-row').first().hover();
  await expect(page.locator('#inspector-mode')).toHaveText('PREVIEW');
  await settleCanvas(page);
  const hoverMs = Date.now() - hoverStarted;
  expect(hoverMs).toBeLessThan(1500);
  await page.mouse.move(1, 1);
  await expect(page.locator('#page-label')).toHaveText('Page 1 of 250');
  await page.getByLabel('Next page', { exact: true }).click();
  await expect(page.locator('#page-label')).toHaveText('Page 2 of 250');
  await expect(page.locator('.repo-row').first()).toContainText('project-09959');
  const filterStarted = Date.now();
  await page.getByLabel('Minimum stars', { exact: true }).fill('1000');
  await page.getByLabel('Maximum stars', { exact: true }).fill('2000');
  await expect(page.locator('#result-count')).toHaveText('1,001');
  await expect(page.locator('#repository-list')).toHaveAttribute('aria-busy', 'false');
  const filterMs = Date.now() - filterStarted;
  await page.getByLabel('Sort projects', { exact: true }).selectOption('name');
  await expect(page.locator('.repo-row').first()).toContainText('project-01000');
  await page.getByLabel('Search projects', { exact: true }).fill('project-01500');
  await results(page, 1);
  await expect(page.locator('.repo-row')).toContainText('project-01500');
  expect(loadMs).toBeLessThan(8000);
  expect(filterMs).toBeLessThan(3000);
  console.log(`10,000 projects: initial ${loadMs}ms; hover preview ${hoverMs}ms; inclusive star filtering ${filterMs}ms; DOM < 1,000 elements.`);
});

test.describe('small screens and touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('expands, switches, and keeps a project selected with single taps and no hover', async ({ page, context }) => {
    await mockDatabase(context, motionFixture(6));
    await trackCanvas(context);
    await open(page);
    await page.locator('#graph-overlay').scrollIntoViewIfNeeded();
    await settleMapLayout(page);
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
    const tapBody = async circle => {
      const bounds = await page.locator('#graph-overlay').boundingBox();
      await page.touchscreen.tap(
        bounds.x + circle.x,
        bounds.y + circle.y + circle.radius * 0.75
      );
      await settleMapLayout(page);
    };
    const gold = (await repositoryCircles(page)).find(circle => circle.color === '#ffd166');
    await tapBody(gold);
    await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
    await expect(page.locator('.project-title')).toContainText('gold');
    await expect(page).toHaveURL(/repo=acme%2Fgold/);
    await expect(page.getByRole('tooltip')).toBeHidden();
    expect(await nextCue(page)).toBeNull();
    expect((await repositoryCircles(page, 'graph-overlay')).some(circle => circle.alpha === 0.95)).toBe(false);
    const silver = (await repositoryCircles(page, 'graph-overlay')).find(circle =>
      circle.color === '#d8e3f3' && circle.alpha > 0.001
    );
    expect(silver).toBeDefined();
    await tapBody(silver);
    await expect(page.locator('.project-title')).toContainText('silver');
    await expect(page).toHaveURL(/repo=acme%2Fsilver/);
    const selected = (await repositoryCircles(page, 'graph-overlay')).find(circle => circle.alpha === 1);
    expect(selected.color).toBe('#d8e3f3');
    await tapBody(selected);
    await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
    await expect(page.locator('.project-title')).toContainText('silver');
    await expect(page.getByRole('tooltip')).toBeHidden();
    expect(context.pages()).toHaveLength(1);
    await page.getByRole('button', { name: 'Clear project selection', exact: true }).tap();
    await expect(page.locator('#inspector-mode')).toHaveText('DETAILS');
    expect(new URL(page.url()).searchParams.has('repo')).toBe(false);
  });

  test('opens tapped names but preserves body pinning and pinches starting on links', async ({ page, context }) => {
    let openedSearches = 0;
    page.on('popup', () => openedSearches++);
    await mockDatabase(context);
    await trackCanvas(context);
    await mockRepositorySearch(context);
    await open(page, '?q=alpha');
    const link = repositoryNameLink(page, 'acme/alpha');
    const url = await openRepositorySearch(page, () => link.tap());
    expect(url.searchParams.get('q')).toBe('repo:acme/alpha AND (get-cmake OR run-cmake OR run-vcpkg)');
    await expect(page.locator('#inspector-mode')).not.toHaveText('PINNED');
    const bounds = await link.boundingBox();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    const before = await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL());
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: x - 5, y, id: 1 }, { x: x + 5, y, id: 2 }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x - 35, y: y - 10, id: 1 }, { x: x + 35, y: y + 10, id: 2 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settleCanvas(page);
    expect(await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL())).not.toBe(before);
    expect(openedSearches).toBe(1);
    expect(context.pages()).toHaveLength(1);
    await expect(page.locator('#inspector-mode')).not.toHaveText('PINNED');
    await page.getByRole('button', { name: 'Fit view', exact: true }).tap();
    await settleCanvas(page);
    const canvas = await page.locator('#graph-overlay').boundingBox();
    const circle = (await repositoryCircles(page))[0];
    await page.touchscreen.tap(canvas.x + circle.x, canvas.y + circle.y + circle.radius * 0.75);
    await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
    expect(openedSearches).toBe(1);
  });

  test('fits mobile widths and pinches without accidentally selecting a project', async ({ page, context }) => {
    await mockDatabase(context);
    await trackCanvas(context);
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.getByRole('link', { name: 'Filters', exact: true })).toBeVisible();
    const canvas = await page.locator('#graph-overlay').boundingBox();
    const x = canvas.x + canvas.width / 2;
    const y = canvas.y + canvas.height / 2;
    await settleCanvas(page);
    const before = await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL());
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x - 70, y: y - 10, id: 1 }, { x: x + 70, y: y + 10, id: 2 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settleCanvas(page);
    expect(await page.locator('#graph-base').evaluate(canvas => canvas.toDataURL())).not.toBe(before);
    await expect(page.locator('#inspector-mode')).not.toHaveText('PINNED');
    await page.getByRole('link', { name: 'Filters', exact: true }).click();
    await page.getByLabel('Minimum stars', { exact: true }).fill('1000');
    await results(page, 1);
    await page.getByRole('button', { name: /acme\/gamma/ }).tap();
    await expect.poll(async () => (await page.locator('#graph-stage').boundingBox()).height).toBeLessThan(300);
    await settleMapLayout(page);
    const inspector = await page.locator('.inspector').boundingBox();
    const map = await page.locator('#graph-overlay').boundingBox();
    expect(inspector.y).toBeGreaterThanOrEqual(0);
    expect(inspector.y + inspector.height).toBeLessThanOrEqual(844);
    expect(map.y).toBeGreaterThanOrEqual(0);
    expect(map.y + map.height / 2).toBeLessThan(inspector.y);
    await expect(page.locator('#inspector-mode')).toHaveText('PINNED');
    await settleCanvas(page);
    const drawing = await page.evaluate(() => window.canvasDrawing['graph-overlay']);
    expect(drawing.texts.map(entry => entry.text)).toEqual(expect.arrayContaining(['get-cmake', 'run-cmake', 'run-vcpkg', 'v4', 'v3', 'v11']));
    for (const action of actions) {
      const hub = await hubPosition(page, action);
      expect(hub.x - hub.radius).toBeGreaterThan(0);
      expect(hub.x + hub.radius).toBeLessThan(map.width);
      expect(map.y + hub.y - hub.radius).toBeGreaterThanOrEqual(0);
      expect(map.y + hub.y + hub.radius).toBeLessThan(inspector.y);
    }
    const count = await page.evaluate(() => window.canvasDrawing['graph-overlay'].texts.find(entry => entry.text === '1,500'));
    const fontSize = Number(count.font.match(/([\d.]+)px/)[1]);
    expect(map.y + count.y + fontSize / 2).toBeLessThan(inspector.y);
    await unobscuredPreview(page);
    await page.getByRole('button', { name: 'Clear project selection', exact: true }).tap();
    await expect(page.locator('#inspector-mode')).toHaveText('DETAILS');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('keeps the complete triangle and pinned labels above the sheet on short screens', async ({ page, context }) => {
    await mockDatabase(context);
    await trackCanvas(context);
    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 667 }]) {
      await page.setViewportSize(size);
      await open(page, '?q=gamma');
      await page.getByRole('button', { name: /acme\/gamma/ }).tap();
      await expect(page.locator('#graph-stage')).toHaveCSS('height', '264px');
      await settleMapLayout(page);
      const inspector = await page.locator('.inspector').boundingBox();
      const canvas = await page.locator('#graph-overlay').boundingBox();
      const hubs = [];
      for (const action of actions) {
        const hub = await hubPosition(page, action);
        hubs.push(hub);
        expect(hub.clientY - hub.radius).toBeGreaterThanOrEqual(0);
        expect(hub.clientY + hub.radius).toBeLessThan(inspector.y);
      }
      expect(hubs[1].y).toBeGreaterThan(hubs[0].y);
      const drawing = await page.evaluate(() => window.canvasDrawing['graph-overlay']);
      expect(drawing.texts.map(entry => entry.text)).toEqual(expect.arrayContaining(['acme', 'gamma', '1,500', '\u2605']));
      const count = drawing.texts.find(entry => entry.text === '1,500');
      const fontSize = Number(count.font.match(/([\d.]+)px/)[1]);
      expect(canvas.y + count.y + fontSize / 2).toBeLessThan(inspector.y);
      await unobscuredPreview(page);
      await page.getByRole('button', { name: 'Clear project selection', exact: true }).tap();
    }
  });
});
