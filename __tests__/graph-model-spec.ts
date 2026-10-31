import {
  ACTIONS,
  DEFAULT_FILTERS,
  circleDetail,
  filterRepositories,
  Filters,
  githubUrl,
  layoutRepositories,
  MAP_INSETS,
  normalizeDatabase,
  readView,
  repositorySearch,
  SpatialIndex,
  STAR_TIERS,
  starTier,
  workflowSearch,
  writeView,
} from '../web/model';

const viewport = { width: 800, height: 600 };

function usage(actionName: string, version: string, line = 10) {
  return {
    actionName,
    version,
    line,
    url: `https://github.com/acme/alpha/blob/main/.github/workflows/build.yml#L${line}`,
  };
}

function entries(stars: number, usages: unknown[], description = '') {
  return [...usages, { stars, repo_orig: { description, language: 'C++' } }];
}

function sample() {
  return normalizeDatabase({
    LastStartTimeName: 'scan progress, not the last update date',
    acme: {
      alpha: entries(
        100,
        [usage('get-cmake', 'v3'), usage('get-cmake', 'v3', 20)],
        'A graphics toolkit'
      ),
      beta: entries(500, [usage('run-cmake', 'v2')]),
      gamma: entries(1000, [
        usage('get-cmake', 'v4'),
        usage('run-cmake', 'v3'),
        usage('run-vcpkg', 'a'.repeat(40)),
      ]),
    },
  }).repositories;
}

function filtered(overrides: Partial<Filters> = {}) {
  return filterRepositories(sample(), { ...DEFAULT_FILTERS, ...overrides });
}

describe('database normalization', () => {
  test('retains workflow occurrences but counts unique projects', () => {
    const repositories = sample();
    expect(repositories).toHaveLength(3);
    expect(repositories[0].usages).toHaveLength(2);
    expect(repositories[0].actions).toEqual(['get-cmake']);
    const result = filtered();
    expect(result.occurrences).toBe(6);
    expect(result.actions[0]).toEqual({
      action: 'get-cmake',
      projects: 2,
      occurrences: 3,
    });
    expect(
      result.versions.find(version => version.id === 'get-cmake@v3')
    ).toEqual({
      id: 'get-cmake@v3',
      action: 'get-cmake',
      version: 'v3',
      projects: 1,
      occurrences: 2,
    });
  });

  test('finds metadata without assuming it is the last entry', () => {
    const normalized = normalizeDatabase({
      acme: {
        alpha: [{ stars: 0, repo_orig: {} }, usage('get-cmake', 'latest')],
      },
    });
    expect(normalized.repositories[0].stars).toBe(0);
    expect(normalized.repositories[0].usages[0].version).toBe('latest');
  });

  test('deduplicates identical occurrences, not different source lines', () => {
    const normalized = normalizeDatabase({
      acme: {
        alpha: entries(10, [
          usage('get-cmake', 'v3'),
          usage('get-cmake', 'v3'),
          usage('get-cmake', 'v3', 11),
        ]),
      },
    });
    expect(normalized.repositories[0].usages).toHaveLength(2);
  });

  test('reports incomplete records instead of silently swallowing errors', () => {
    const normalized = normalizeDatabase({
      acme: {
        alpha: entries(10, [
          usage('get-cmake', 'v3'),
          usage('unknown', 'v1'),
          { actionName: 'run-cmake' },
        ]),
        invalid: [{ actionName: 'get-cmake' }],
        negative: entries(-1, [usage('get-cmake', 'v3')]),
        fractional: entries(1.5, [usage('get-cmake', 'v3')]),
        nonArray: null,
      },
    });
    expect(normalized.repositories).toHaveLength(1);
    expect(normalized.skippedRepositories).toBe(4);
    expect(normalized.skippedUsages).toBe(2);
    expect(() => normalizeDatabase([])).toThrow('not a JSON object');
    expect(() => normalizeDatabase({ acme: null })).toThrow(
      'Invalid repository collection'
    );
    expect(() => normalizeDatabase({ acme: { invalid: [] } })).toThrow(
      'No valid projects'
    );
  });

  test('only exposes HTTPS GitHub source URLs', () => {
    expect(githubUrl('javascript:alert(1)')).toBeNull();
    expect(githubUrl('https://github.com.evil.example/a')).toBeNull();
    expect(githubUrl('https://user:password@github.com/a')).toBeNull();
    expect(githubUrl('http://github.com/a')).toBeNull();
    expect(githubUrl('not a URL')).toBeNull();
    expect(githubUrl(undefined)).toBeNull();
    expect(githubUrl('https://github.com/acme/alpha')).toBe(
      'https://github.com/acme/alpha'
    );
    expect(workflowSearch(sample()[0])).toContain('repo%3Aacme%2Falpha');
  });

  test('searches all three actions across repository source files', () => {
    const repository = {
      ...sample()[0],
      id: 'jatinchowdhury18/KlonCentaur',
    };
    const url = new URL(repositorySearch(repository));
    expect(url.origin + url.pathname).toBe('https://github.com/search');
    expect(url.searchParams.get('type')).toBe('code');
    expect(url.searchParams.get('q')).toBe(
      'repo:jatinchowdhury18/KlonCentaur AND (get-cmake OR run-cmake OR run-vcpkg)'
    );
  });

  test('keeps workflow searches and exact-version source fallbacks scoped', () => {
    const repository = sample()[0];
    expect(new URL(workflowSearch(repository)).searchParams.get('q')).toBe(
      'repo:acme/alpha path:.github/workflows'
    );
    expect(
      new URL(
        workflowSearch(repository, repository.usages[0])
      ).searchParams.get('q')
    ).toBe('repo:acme/alpha path:.github/workflows "lukka/get-cmake@v3"');
  });
});

describe('composable project filters', () => {
  test('uses inclusive star boundaries and handles zero maximum', () => {
    expect(filtered({ minStars: 100, maxStars: 500 }).ids).toEqual([
      'acme/beta',
      'acme/alpha',
    ]);
    expect(filtered({ minStars: 500, maxStars: 500 }).ids).toEqual([
      'acme/beta',
    ]);
    expect(filtered({ maxStars: 0 }).ids).toEqual([]);
    expect(filtered({ minStars: 1001 }).ids).toEqual([]);
  });

  test('matches all case-insensitive query tokens in names, descriptions, and languages', () => {
    expect(filtered({ query: 'ACME GRAPHICS c++' }).ids).toEqual([
      'acme/alpha',
    ]);
    expect(filtered({ query: 'acme gamma' }).ids).toEqual(['acme/gamma']);
    expect(filtered({ query: 'graphics gamma' }).ids).toEqual([]);
    expect(filtered({ query: '   ' }).ids).toHaveLength(3);
  });

  test('matches any or all selected actions without duplicate projects', () => {
    const actions: Filters['actions'] = ['get-cmake', 'run-cmake'];
    expect(filtered({ actions }).ids).toEqual([
      'acme/gamma',
      'acme/beta',
      'acme/alpha',
    ]);
    expect(filtered({ actions, match: 'all' }).ids).toEqual(['acme/gamma']);
    expect(filtered({ actions: [] }).ids).toHaveLength(3);
  });

  test('combines versions with other filters and keeps alternative version facets', () => {
    const result = filtered({ minStars: 100, version: 'get-cmake@v3' });
    expect(result.ids).toEqual(['acme/alpha']);
    expect(result.versions.map(version => version.id)).toContain(
      'get-cmake@v4'
    );
    expect(result.actions[0].projects).toBe(1);
    expect(result.actions[0].occurrences).toBe(2);
    expect(filtered({ minStars: 101, version: 'get-cmake@v3' }).ids).toEqual(
      []
    );
    expect(filtered({ version: 'get-cmake@missing' }).ids).toEqual([]);
    expect(filtered({ version: `run-vcpkg@${'a'.repeat(40)}` }).ids).toEqual([
      'acme/gamma',
    ]);
  });

  test('sorts by stars, names, or occurrences with deterministic ties', () => {
    expect(filtered().ids).toEqual(['acme/gamma', 'acme/beta', 'acme/alpha']);
    expect(filtered({ sort: 'name' }).ids).toEqual([
      'acme/alpha',
      'acme/beta',
      'acme/gamma',
    ]);
    expect(filtered({ sort: 'usage' }).ids).toEqual([
      'acme/gamma',
      'acme/alpha',
      'acme/beta',
    ]);
  });
});

describe('circle contents and star buckets', () => {
  test('uses the exact bronze, silver, and gold star boundaries', () => {
    for (const [stars, minimum] of [
      [0, 0],
      [24, 0],
      [25, 25],
      [99, 25],
      [100, 100],
      [999, 100],
      [1000, 1000],
      [100000, 1000],
    ]) {
      expect(starTier(stars).minimum).toBe(minimum);
    }
    expect(new Set(STAR_TIERS.map(tier => tier.color)).size).toBe(4);
    expect(new Set(STAR_TIERS.map(tier => tier.textColor)).size).toBe(4);
    expect(
      [25, 99, 100, 999, 1000, 100000].map(stars => starTier(stars).size)
    ).toEqual([1, 1, 1.5, 1.5, 2, 2]);
  });

  test('reveals contents by on-screen radius, not by an arbitrary node limit', () => {
    expect(circleDetail(0)).toBe('none');
    expect(circleDetail(19.99)).toBe('none');
    expect(circleDetail(20)).toBe('stars');
    expect(circleDetail(25.99)).toBe('stars');
    expect(circleDetail(26)).toBe('names');
    const radius = starTier(100).size * 10;
    expect(circleDetail(radius)).toBe('none');
    expect(circleDetail(radius * 1.5)).toBe('stars');
    expect(circleDetail(radius * 2)).toBe('names');
    expect(circleDetail(radius * 4)).toBe('names');
  });
});

describe('layout and pointer index', () => {
  test('uses available map width instead of oversized proportional side margins', () => {
    for (const size of [
      viewport,
      { width: 360, height: 470 },
      { width: 1400, height: 760 },
    ]) {
      const layout = layoutRepositories(sample(), size);
      const [left, , right] = layout.hubs;
      const hubRadius = Math.min(32, size.width / 10);
      expect(right.x - left.x).toBeGreaterThan(size.width * 0.7);
      expect(left.x - hubRadius).toBeGreaterThanOrEqual(16);
      expect(size.width - right.x - hubRadius).toBeGreaterThanOrEqual(16);
    }
  });

  test('restores the original action vertices and their triangle centroid', () => {
    for (const size of [
      viewport,
      { width: 360, height: 470 },
      { width: 1400, height: 760 },
      { width: 290, height: 240 },
    ]) {
      const layout = layoutRepositories(sample(), size);
      const [left, bottom, right] = layout.hubs;
      expect([left.action, bottom.action, right.action]).toEqual([
        'get-cmake',
        'run-cmake',
        'run-vcpkg',
      ]);
      expect(left.x).toBeLessThan(bottom.x);
      expect(right.x).toBeGreaterThan(bottom.x);
      expect(left.y).toBe(right.y);
      expect(bottom.y).toBeGreaterThan(left.y);
      expect(layout.center.x).toBeCloseTo(
        (left.x + bottom.x + right.x) / 3,
        10
      );
      expect(layout.center.y).toBeCloseTo(
        (left.y + bottom.y + right.y) / 3,
        10
      );
      for (const hub of layout.hubs) {
        expect(hub.x).toBeGreaterThan(0);
        expect(hub.x).toBeLessThan(size.width);
        expect(hub.y).toBeGreaterThan(0);
        expect(hub.y).toBeLessThan(size.height);
      }
    }
  });

  test('keeps large neighboring circles separated at every zoom level', () => {
    const projects: Record<string, unknown> = {};
    for (let index = 0; index < 100; index++) {
      projects[`project-${index}`] = entries(100000, [
        usage('get-cmake', 'v3'),
      ]);
    }
    const repositories = normalizeDatabase({ acme: projects }).repositories;
    layoutRepositories(repositories, viewport);
    for (let left = 0; left < repositories.length; left++) {
      for (let right = left + 1; right < repositories.length; right++) {
        const first = repositories[left];
        const second = repositories[right];
        expect(
          Math.hypot(first.x - second.x, first.y - second.y) -
            first.radius -
            second.radius
        ).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('is deterministic independently of database order and has positive finite sizes', () => {
    const first = sample();
    const second = sample().reverse();
    expect(layoutRepositories(first, viewport)).toEqual(
      layoutRepositories(second, viewport)
    );
    for (const repository of first) {
      const other = second.find(item => item.id === repository.id)!;
      expect([repository.x, repository.y, repository.radius]).toEqual([
        other.x,
        other.y,
        other.radius,
      ]);
      expect(repository.radius).toBeGreaterThan(0);
      expect(repository.radius).toBeLessThan(viewport.height / 2);
      expect(Number.isFinite(repository.x)).toBe(true);
    }
  });

  test('preserves bucket diameter ratios rather than scaling with raw star counts', () => {
    const repositories = normalizeDatabase({
      acme: {
        bronze: entries(25, [usage('get-cmake', 'v3')]),
        bronzeAgain: entries(99, [usage('get-cmake', 'v3')]),
        silver: entries(100, [usage('get-cmake', 'v3')]),
        silverAgain: entries(999, [usage('get-cmake', 'v3')]),
        gold: entries(1000, [usage('get-cmake', 'v3')]),
        goldAgain: entries(100000, [usage('get-cmake', 'v3')]),
      },
    }).repositories;
    for (const size of [
      viewport,
      { width: 360, height: 470 },
      { width: 1400, height: 760 },
    ]) {
      layoutRepositories(repositories, size);
      const unit = repositories[0].radius;
      for (const repository of repositories) {
        expect(repository.radius / unit).toBeCloseTo(
          starTier(repository.stars).size,
          10
        );
      }
    }
  });

  test('grows sparse results into reclaimed space and adapts to viewport dimensions', () => {
    const projects: Record<string, unknown> = {};
    for (let index = 0; index < 100; index++) {
      projects[`project-${index}`] = entries(25, [usage('get-cmake', 'v3')]);
    }
    const repositories = normalizeDatabase({ acme: projects }).repositories;
    const dense = layoutRepositories(repositories, viewport);
    const denseRadius = repositories[0].radius;
    const visible = repositories.slice(0, 4);
    const sparse = layoutRepositories(visible, viewport);
    expect(sparse.center).toEqual(dense.center);
    expect(visible[0].radius).toBeGreaterThan(denseRadius * 3);
    const single = visible.slice(0, 1);
    const layout = layoutRepositories(single, viewport);
    const largeRadius = single[0].radius;
    expect(largeRadius).toBeGreaterThan(
      0.9 *
        Math.min(
          (layout.hubs[2].x - layout.hubs[0].x) / (2 * Math.sqrt(3)),
          (layout.hubs[1].y - layout.hubs[0].y) / 3
        )
    );
    expect(single[0].x).toBe(layout.center.x);
    expect(single[0].y).toBe(layout.center.y);
    layoutRepositories(single, { width: 360, height: 470 });
    expect(single[0].radius).toBeLessThan(largeRadius);
    expect(single[0].x - single[0].radius).toBeGreaterThan(MAP_INSETS.left);
    expect(single[0].y - single[0].radius).toBeGreaterThan(MAP_INSETS.top);
    expect(single[0].x + single[0].radius).toBeLessThan(360 - MAP_INSETS.right);
    expect(single[0].y + single[0].radius).toBeLessThan(
      470 - MAP_INSETS.bottom
    );
  });

  test('fills every side of the central cloud instead of separate action compartments', () => {
    const projects: Record<string, unknown> = {};
    for (let index = 0; index < 30; index++) {
      projects[`project-${index}`] = entries(1000, [usage('get-cmake', 'v3')]);
    }
    const repositories = normalizeDatabase({ acme: projects }).repositories;
    const layout = layoutRepositories(repositories, viewport);
    const quadrants = [0, 0, 0, 0];
    for (const repository of repositories) {
      const quadrant =
        (repository.x > layout.center.x ? 1 : 0) +
        (repository.y > layout.center.y ? 2 : 0);
      quadrants[quadrant]++;
    }
    expect(quadrants.every(count => count >= 4)).toBe(true);
    const width =
      Math.max(
        ...repositories.map(repository => repository.x + repository.radius)
      ) -
      Math.min(
        ...repositories.map(repository => repository.x - repository.radius)
      );
    const height =
      Math.max(
        ...repositories.map(repository => repository.y + repository.radius)
      ) -
      Math.min(
        ...repositories.map(repository => repository.y - repository.radius)
      );
    expect(width).toBeGreaterThan(
      (0.7 * (layout.hubs[2].x - layout.hubs[0].x)) / Math.sqrt(3)
    );
    expect(height).toBeGreaterThan(
      (1.4 * (layout.hubs[1].y - layout.hubs[0].y)) / 3
    );
  });

  test('attracts mixed action usages to the triangle center without overlap or escaped circles', () => {
    const projects: Record<string, unknown> = {};
    for (let index = 0; index < 70; index++) {
      const mask = (index % 7) + 1;
      projects[`project-${index}`] = entries(
        [25, 100, 1000][index % 3],
        ACTIONS.filter((_, action) => mask & (1 << action)).map(action =>
          usage(action.name, 'v3')
        )
      );
    }
    const repositories = normalizeDatabase({ acme: projects }).repositories;
    for (const size of [
      viewport,
      { width: 360, height: 470 },
      { width: 1400, height: 760 },
      { width: 290, height: 240 },
    ]) {
      repositories.forEach(repository => {
        repository.x = -10000;
        repository.y = 10000;
      });
      const layout = layoutRepositories(repositories, size);
      const mass = repositories.reduce(
        (sum, repository) => sum + repository.radius ** 2,
        0
      );
      expect(
        repositories.reduce(
          (sum, repository) => sum + repository.x * repository.radius ** 2,
          0
        ) / mass
      ).toBeCloseTo(layout.center.x, 8);
      expect(
        repositories.reduce(
          (sum, repository) => sum + repository.y * repository.radius ** 2,
          0
        ) / mass
      ).toBeCloseTo(layout.center.y, 8);
      for (let left = 0; left < repositories.length; left++) {
        const first = repositories[left];
        for (let edge = 0; edge < layout.hubs.length; edge++) {
          const from = layout.hubs[edge];
          const to = layout.hubs[(edge + 1) % layout.hubs.length];
          const cross =
            (to.x - from.x) * (first.y - from.y) -
            (to.y - from.y) * (first.x - from.x);
          expect(
            -cross / Math.hypot(to.x - from.x, to.y - from.y)
          ).toBeGreaterThanOrEqual(first.radius - 1e-8);
        }
        expect(first.x - first.radius).toBeGreaterThanOrEqual(MAP_INSETS.left);
        expect(first.y - first.radius).toBeGreaterThanOrEqual(MAP_INSETS.top);
        expect(first.x + first.radius).toBeLessThanOrEqual(
          size.width - MAP_INSETS.right
        );
        expect(first.y + first.radius).toBeLessThanOrEqual(
          size.height - MAP_INSETS.bottom
        );
        for (let right = left + 1; right < repositories.length; right++) {
          const second = repositories[right];
          expect(
            Math.hypot(first.x - second.x, first.y - second.y) -
              first.radius -
              second.radius
          ).toBeGreaterThanOrEqual(-1e-8);
        }
      }
    }
  });

  test('keeps empty layouts valid and rejects unusable viewport dimensions explicitly', () => {
    const empty = layoutRepositories([], viewport);
    expect(empty.hubs).toHaveLength(3);
    expect(Number.isFinite(empty.center.x)).toBe(true);
    expect(Number.isFinite(empty.center.y)).toBe(true);
    expect(() => layoutRepositories(sample(), { width: 0, height: 0 })).toThrow(
      'viewport'
    );
    expect(() =>
      layoutRepositories(sample(), { width: 360, height: 180 })
    ).toThrow('viewport');
  });

  test('reserves every hub hit area when fitting dense short mobile maps', () => {
    for (const count of [1, 1000]) {
      const projects: Record<string, unknown> = {};
      for (let index = 0; index < count; index++) {
        projects[`project-${index}`] = entries([25, 100, 1000][index % 3], [
          usage('get-cmake', 'v3'),
        ]);
      }
      const repositories = normalizeDatabase({ acme: projects }).repositories;
      for (const size of [
        viewport,
        { width: 360, height: 264 },
        { width: 290, height: 240 },
      ]) {
        const layout = layoutRepositories(repositories, size);
        const hitRadius = Math.min(32, size.width / 10) + 8;
        for (const repository of repositories) {
          for (const hub of layout.hubs) {
            expect(
              Math.hypot(repository.x - hub.x, repository.y - hub.y) -
                repository.radius
            ).toBeGreaterThanOrEqual(hitRadius);
          }
        }
      }
    }
  });

  test('finds the nearest visible node, including negative cells and zoom padding', () => {
    const repositories = sample();
    repositories[0].x = -100;
    repositories[0].y = -100;
    repositories[1].x = 100;
    repositories[1].y = 100;
    repositories[2].x = 500;
    repositories[2].y = 500;
    const index = new SpatialIndex(repositories);
    expect(index.within({ x: -105, y: -100 }, 5)).toEqual([repositories[0]]);
    expect(index.within({ x: 0, y: 0 }, 5)).toEqual([]);
    expect(index.find({ x: -100, y: -100 }, 0)).toBe(repositories[0]);
    expect(index.find({ x: -120, y: -100 }, 20)).toBe(repositories[0]);
    expect(index.find({ x: 0, y: 0 }, 0)).toBeNull();
    const hidden = new SpatialIndex([repositories[1]]);
    expect(hidden.find({ x: -100, y: -100 }, 0)).toBeNull();
    index.move(repositories[0], { x: 1000, y: -1000 });
    expect(index.find({ x: -100, y: -100 }, 0)).toBeNull();
    expect(index.within({ x: -100, y: -100 }, 5)).toEqual([]);
    expect(index.find({ x: 1000, y: -1000 }, 0)).toBe(repositories[0]);
  });

  test('prefers a circle containing the point over a closer padded hit', () => {
    const repositories = sample().slice(0, 2);
    repositories[0].x = 0;
    repositories[0].y = 0;
    repositories[0].radius = 20;
    repositories[1].x = 32;
    repositories[1].y = 0;
    repositories[1].radius = 10;
    const index = new SpatialIndex(repositories);
    expect(index.find({ x: 18, y: 0 }, 5)).toBe(repositories[0]);
  });

  test('keeps ten thousand projects centralized and disjoint without truncating results', () => {
    const projects: Record<string, unknown> = {};
    for (let index = 0; index < 10000; index++) {
      projects[`project-${index}`] = entries(index, [usage('get-cmake', 'v3')]);
    }
    const repositories = normalizeDatabase({ acme: projects }).repositories;
    const layout = layoutRepositories(repositories, viewport);
    expect(layout.hubs).toHaveLength(3);
    expect(
      repositories.every(
        repository =>
          Number.isFinite(repository.x) && Number.isFinite(repository.y)
      )
    ).toBe(true);
    expect(filterRepositories(repositories, DEFAULT_FILTERS).ids).toHaveLength(
      10000
    );
    const maximum = repositories.reduce(
      (radius, repository) => Math.max(radius, repository.radius),
      0
    );
    const index = new SpatialIndex(repositories, maximum * 2);
    expect(
      repositories.every(repository =>
        index
          .within(repository, repository.radius)
          .every(neighbor => neighbor.id === repository.id)
      )
    ).toBe(true);
    const mass = repositories.reduce(
      (sum, repository) => sum + repository.radius ** 2,
      0
    );
    expect(
      repositories.reduce(
        (sum, repository) => sum + repository.x * repository.radius ** 2,
        0
      ) / mass
    ).toBeCloseTo(layout.center.x, 8);
    expect(
      repositories.reduce(
        (sum, repository) => sum + repository.y * repository.radius ** 2,
        0
      ) / mass
    ).toBeCloseTo(layout.center.y, 8);
    expect(index.find(repositories[5000], 0)!.id).toBe(repositories[5000].id);
  });
});

describe('shareable views', () => {
  test('round trips filters, exact commit versions, and a pinned project', () => {
    const filters: Filters = {
      query: 'acme C++',
      minStars: 100,
      maxStars: 5000,
      actions: ['get-cmake', 'run-vcpkg'],
      match: 'all',
      version: `run-vcpkg@${'a'.repeat(40)}`,
      sort: 'usage',
    };
    expect(readView(writeView(filters, 'acme/alpha'))).toEqual({
      filters,
      selected: 'acme/alpha',
      view: 'map',
      metric: 'projects',
      warnings: [],
    });
    expect(
      readView(writeView({ ...DEFAULT_FILTERS, maxStars: 0 }, null)).filters
        .maxStars
    ).toBe(0);
    expect(writeView(DEFAULT_FILTERS, null)).toBe('');
  });

  test('shares the trends view and metric without losing map filters', () => {
    const filters = { ...DEFAULT_FILTERS, query: 'acme' };
    const query = writeView(filters, 'acme/alpha', 'trends', 'occurrences');
    expect(readView(query)).toEqual({
      filters,
      selected: 'acme/alpha',
      view: 'trends',
      metric: 'occurrences',
      warnings: [],
    });
    expect(readView('?view=unknown&metric=unknown').warnings).toHaveLength(2);
    expect(readView('?view=unknown').view).toBe('map');
    expect(readView('?metric=unknown').metric).toBe('projects');
  });

  test('keeps the trend metric in map links even while the charts are hidden', () => {
    const filters = { ...DEFAULT_FILTERS, query: 'acme' };
    const query = writeView(filters, 'acme/alpha', 'map', 'occurrences');
    expect(readView(query)).toEqual({
      filters,
      selected: 'acme/alpha',
      view: 'map',
      metric: 'occurrences',
      warnings: [],
    });
    expect(new URLSearchParams(query).has('view')).toBe(false);
    expect(writeView(DEFAULT_FILTERS, null, 'map', 'projects')).toBe('');
  });

  test('reports invalid URL filters and preserves unknown versions as empty results', () => {
    const parsed = readView(
      '?minStars=NaN&actions=unknown,get-cmake,get-cmake&version=get-cmake%40missing'
    );
    expect(parsed.filters.minStars).toBe(0);
    expect(parsed.filters.actions).toEqual(['get-cmake']);
    expect(parsed.filters.version).toBe('get-cmake@missing');
    expect(parsed.warnings).toHaveLength(2);
    expect(readView('?minStars=500&maxStars=10').warnings).toEqual([
      'Ignored an inverted star range.',
    ]);
    expect(readView('?minStars=-1&maxStars=1.5').warnings).toHaveLength(2);
  });
});
