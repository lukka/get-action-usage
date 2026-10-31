export const ACTIONS = [
  { name: 'get-cmake', color: '#b5a0ff' },
  { name: 'run-cmake', color: '#ffcb79' },
  { name: 'run-vcpkg', color: '#6fe0ca' },
] as const;

export type ActionName = typeof ACTIONS[number]['name'];

export interface Usage {
  action: ActionName;
  version: string;
  url: string | null;
  line: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Repository extends Point {
  id: string;
  owner: string;
  name: string;
  stars: number;
  description: string;
  language: string;
  url: string;
  actions: ActionName[];
  usages: Usage[];
  searchText: string;
  radius: number;
}

export interface Filters {
  query: string;
  minStars: number;
  maxStars: number | null;
  actions: ActionName[];
  match: 'any' | 'all';
  version: string;
  sort: 'stars' | 'name' | 'usage';
}

export const DEFAULT_FILTERS: Filters = {
  query: '',
  minStars: 0,
  maxStars: null,
  actions: [],
  match: 'any',
  version: '',
  sort: 'stars',
};

export const PAGE_SIZE = 40;

export const STAR_TIERS = [
  {
    minimum: 0,
    label: '<25',
    name: 'unranked',
    color: '#91a4bf',
    textColor: '#657187',
    size: 1,
  },
  {
    minimum: 25,
    label: '25+',
    name: 'bronze',
    color: '#e7aa7b',
    textColor: '#9a5229',
    size: 1,
  },
  {
    minimum: 100,
    label: '100+',
    name: 'silver',
    color: '#d8e3f3',
    textColor: '#596c87',
    size: 1.5,
  },
  {
    minimum: 1000,
    label: '1,000+',
    name: 'gold',
    color: '#ffd166',
    textColor: '#946000',
    size: 2,
  },
] as const;

export function starTier(stars: number): typeof STAR_TIERS[number] {
  for (let index = STAR_TIERS.length - 1; index > 0; index--) {
    if (stars >= STAR_TIERS[index].minimum) return STAR_TIERS[index];
  }
  return STAR_TIERS[0];
}

export function circleDetail(radius: number): 'none' | 'stars' | 'names' {
  return radius >= 26 ? 'names' : radius >= 20 ? 'stars' : 'none';
}

export interface Circle extends Point {
  id: string;
  radius: number;
}

export interface ActionCount {
  action: ActionName;
  projects: number;
  occurrences: number;
}

export type ExplorerView = 'map' | 'trends';
export type TrendMetric = 'projects' | 'occurrences';

export interface UsageSnapshot {
  date: string;
  commit: string | null;
  actions: ActionCount[];
  skippedRepositories: number;
  skippedUsages: number;
}

export interface UsageHistory {
  version: 1;
  snapshots: UsageSnapshot[];
}

export interface VersionCount extends ActionCount {
  id: string;
  version: string;
}

export interface FilterResult {
  ids: string[];
  actions: ActionCount[];
  versions: VersionCount[];
  occurrences: number;
}

export interface Hub extends Point {
  action: ActionName;
  color: string;
}

export interface Viewport {
  width: number;
  height: number;
}

export const MAP_INSETS = { top: 44, right: 16, bottom: 52, left: 16 };
export const HUB_HIT_PADDING = 8;

export function actionHubRadius(width: number): number {
  return Math.min(32, width / 10);
}

export interface Layout extends Viewport {
  hubs: Hub[];
  center: Point;
}

export type WorkerRequest =
  | { type: 'load' }
  | {
      type: 'filter';
      requestId: number;
      filters: Filters;
      viewport: Viewport;
    };

export type WorkerResponse =
  | {
      type: 'loaded';
      repositories: Repository[];
      skippedRepositories: number;
      skippedUsages: number;
    }
  | {
      type: 'filtered';
      requestId: number;
      result: FilterResult;
      layout: Layout;
      circles: Circle[];
    }
  | { type: 'error'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isActionName(value: unknown): value is ActionName {
  return ACTIONS.some(action => action.name === value);
}

export function githubUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function workflowSearch(repository: Repository, usage?: Usage): string {
  const action = usage ? ` "lukka/${usage.action}@${usage.version}"` : '';
  return `https://github.com/search?type=code&q=${encodeURIComponent(
    `repo:${repository.id} path:.github/workflows${action}`
  )}`;
}

export function repositorySearch(repository: Repository): string {
  return `https://github.com/search?type=code&q=${encodeURIComponent(
    `repo:${repository.id} AND (${ACTIONS.map(action => action.name).join(
      ' OR '
    )})`
  )}`;
}

export function versionId(usage: Usage): string {
  return `${usage.action}@${usage.version}`;
}

export function normalizeDatabase(database: unknown) {
  if (!isRecord(database)) {
    throw new Error('The usage database is not a JSON object.');
  }

  const repositories: Repository[] = [];
  let skippedRepositories = 0;
  let skippedUsages = 0;
  for (const [owner, projects] of Object.entries(database)) {
    if (owner === 'LastStartTimeName') {
      continue;
    }
    if (!isRecord(projects)) {
      throw new Error(`Invalid repository collection for "${owner}".`);
    }
    for (const [name, entries] of Object.entries(projects)) {
      if (!Array.isArray(entries)) {
        skippedRepositories++;
        continue;
      }
      const metadata = entries.find(
        entry => isRecord(entry) && isRecord(entry.repo_orig)
      );
      if (
        !isRecord(metadata) ||
        typeof metadata.stars !== 'number' ||
        !Number.isSafeInteger(metadata.stars) ||
        metadata.stars < 0 ||
        !isRecord(metadata.repo_orig)
      ) {
        skippedRepositories++;
        continue;
      }
      const usages: Usage[] = [];
      const seen = new Set<string>();
      for (const entry of entries) {
        if (!isRecord(entry) || !('actionName' in entry)) {
          continue;
        }
        if (
          !isActionName(entry.actionName) ||
          typeof entry.version !== 'string' ||
          !entry.version.trim()
        ) {
          skippedUsages++;
          continue;
        }
        const usage: Usage = {
          action: entry.actionName,
          version: entry.version.trim(),
          url: githubUrl(entry.url),
          line:
            typeof entry.line === 'number' && Number.isInteger(entry.line)
              ? entry.line
              : 0,
        };
        const key = JSON.stringify(usage);
        if (!seen.has(key)) {
          usages.push(usage);
          seen.add(key);
        }
      }
      if (!usages.length) {
        skippedRepositories++;
        continue;
      }
      const id = `${owner}/${name}`;
      const original = metadata.repo_orig;
      const description =
        typeof original.description === 'string' ? original.description : '';
      const language =
        typeof original.language === 'string' ? original.language : '';
      repositories.push({
        id,
        owner,
        name,
        description,
        language,
        stars: metadata.stars,
        url: `https://github.com/${encodeURIComponent(
          owner
        )}/${encodeURIComponent(name)}`,
        actions: ACTIONS.map(action => action.name).filter(action =>
          usages.some(usage => usage.action === action)
        ),
        usages,
        searchText: `${id} ${description} ${language}`.toLowerCase(),
        radius: starTier(metadata.stars).size,
        x: 0,
        y: 0,
      });
    }
  }
  if (!repositories.length && skippedRepositories) {
    throw new Error('No valid projects were found in the usage database.');
  }
  return { repositories, skippedRepositories, skippedUsages };
}

export function normalizeUsageHistory(value: unknown): UsageHistory {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.snapshots)
  ) {
    throw new Error('The usage history must contain version 1 and snapshots.');
  }
  const isCount = (count: unknown): count is number =>
    typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
  const dates = new Set<string>();
  const snapshots = value.snapshots.map(
    (entry: unknown): UsageSnapshot => {
      if (!isRecord(entry)) throw new Error('Invalid usage history snapshot.');
      const { date, commit, skippedRepositories, skippedUsages } = entry;
      if (
        typeof date !== 'string' ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString() !== date ||
        dates.has(date)
      ) {
        throw new Error(
          'Usage history dates must be unique ISO UTC timestamps.'
        );
      }
      if (
        (commit !== null &&
          (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit))) ||
        !isCount(skippedRepositories) ||
        !isCount(skippedUsages) ||
        !Array.isArray(entry.actions) ||
        entry.actions.length !== ACTIONS.length
      ) {
        throw new Error(`Invalid usage history snapshot at ${date}.`);
      }
      const entries: unknown[] = entry.actions;
      const actions = ACTIONS.map(
        ({ name }): ActionCount => {
          const count = entries.find(
            candidate => isRecord(candidate) && candidate.action === name
          );
          if (
            !isRecord(count) ||
            !isCount(count.projects) ||
            !isCount(count.occurrences) ||
            count.occurrences < count.projects
          ) {
            throw new Error(`Invalid ${name} usage counts at ${date}.`);
          }
          return {
            action: name,
            projects: count.projects,
            occurrences: count.occurrences,
          };
        }
      );
      dates.add(date);
      return { date, commit, actions, skippedRepositories, skippedUsages };
    }
  );
  snapshots.sort((left, right) => left.date.localeCompare(right.date));
  return { version: 1, snapshots };
}

const collator = new Intl.Collator('en', {
  sensitivity: 'base',
  numeric: true,
});

export function filterRepositories(
  repositories: Repository[],
  filters: Filters
): FilterResult {
  const tokens = filters.query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const matching: Repository[] = [];
  const actions: ActionCount[] = ACTIONS.map(action => ({
    action: action.name,
    projects: 0,
    occurrences: 0,
  }));
  const versions = new Map<string, VersionCount>();
  let occurrences = 0;
  for (const repository of repositories) {
    if (
      repository.stars < filters.minStars ||
      (filters.maxStars !== null && repository.stars > filters.maxStars) ||
      !tokens.every(token => repository.searchText.includes(token))
    ) {
      continue;
    }
    if (filters.actions.length) {
      const matches = (action: ActionName) =>
        repository.actions.includes(action);
      if (
        !(filters.match === 'all'
          ? filters.actions.every(matches)
          : filters.actions.some(matches))
      ) {
        continue;
      }
    }
    const seenVersions = new Set<string>();
    for (const usage of repository.usages) {
      const id = versionId(usage);
      let version = versions.get(id);
      if (!version) {
        version = {
          id,
          action: usage.action,
          version: usage.version,
          projects: 0,
          occurrences: 0,
        };
        versions.set(id, version);
      }
      version.occurrences++;
      if (!seenVersions.has(id)) {
        version.projects++;
        seenVersions.add(id);
      }
    }
    if (filters.version && !seenVersions.has(filters.version)) {
      continue;
    }
    matching.push(repository);
    occurrences += repository.usages.length;
    for (const count of actions) {
      if (repository.actions.includes(count.action)) {
        count.projects++;
      }
      count.occurrences += repository.usages.filter(
        usage => usage.action === count.action
      ).length;
    }
  }
  matching.sort((left, right) => {
    const difference =
      filters.sort === 'stars'
        ? right.stars - left.stars
        : filters.sort === 'usage'
        ? right.usages.length - left.usages.length
        : 0;
    return difference || collator.compare(left.id, right.id);
  });
  return {
    ids: matching.map(repository => repository.id),
    actions,
    versions: Array.from(versions.values()).sort(
      (left, right) =>
        collator.compare(left.action, right.action) ||
        right.projects - left.projects ||
        collator.compare(left.version, right.version)
    ),
    occurrences,
  };
}

export function layoutRepositories(
  repositories: Repository[],
  viewport: Viewport
): Layout {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= MAP_INSETS.left + MAP_INSETS.right ||
    viewport.height <= MAP_INSETS.top + MAP_INSETS.bottom
  ) {
    throw new Error('The map viewport is too small to lay out projects.');
  }
  const hubRadius = actionHubRadius(viewport.width);
  const side = hubRadius + Math.max(16, viewport.width * 0.035);
  const top = MAP_INSETS.top + hubRadius + 12;
  const bottom = viewport.height - MAP_INSETS.bottom - hubRadius - 8;
  const halfWidth = viewport.width / 2 - side;
  if (halfWidth <= 0 || bottom <= top) {
    throw new Error('The map viewport is too small to lay out projects.');
  }
  const center = { x: viewport.width / 2, y: top + (bottom - top) / 3 };
  const layout: Layout = {
    ...viewport,
    center,
    hubs: ACTIONS.map((action, index) => ({
      action: action.name,
      color: action.color,
      x: index === 1 ? center.x : index === 0 ? side : viewport.width - side,
      y: index === 1 ? bottom : top,
    })),
  };
  // Cap the inellipse axes to reserve the hubs' full pointer hit areas.
  const hubClearance = hubRadius + HUB_HIT_PADDING;
  const radiusX = Math.min(halfWidth / Math.sqrt(3), halfWidth - hubClearance);
  const radiusY = Math.min(
    (bottom - top) / 3,
    bottom - center.y - hubClearance
  );
  const minimum = Math.min(radiusX, radiusY);
  if (minimum <= 0) {
    throw new Error('The map viewport is too small to lay out projects.');
  }
  if (!repositories.length) return layout;
  const ordered = repositories
    .slice()
    .sort(
      (left, right) =>
        right.stars - left.stars || collator.compare(left.id, right.id)
    );
  const circles: Circle[] = [];
  const gap = 0.2;
  let offset = 0,
    outer = 0,
    ring = 0;
  while (offset < ordered.length) {
    const radius = starTier(ordered[offset].stars).size;
    const distance = offset ? outer + radius + gap : 0;
    const capacity = distance
      ? Math.max(
          1,
          Math.floor(Math.PI / Math.asin((radius + gap / 2) / distance))
        )
      : 1;
    let end = offset + 1;
    while (
      end < ordered.length &&
      end - offset < capacity &&
      starTier(ordered[end].stars).size === radius
    ) {
      end++;
    }
    for (let index = offset; index < end; index++) {
      const angle =
        ring * Math.PI * (3 - Math.sqrt(5)) +
        ((index - offset) / (end - offset)) * Math.PI * 2;
      circles.push({
        id: ordered[index].id,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        radius,
      });
    }
    outer = distance + radius;
    offset = end;
    ring++;
  }

  const index = new SpatialIndex(circles, 4.6);
  // Bounded center attraction; swept collision constraints keep every move disjoint.
  for (let iteration = 0; iteration < 24; iteration++) {
    let moved = 0;
    for (const circle of circles) {
      const distance = Math.hypot(circle.x, circle.y);
      if (!distance) continue;
      const step = Math.min(circle.radius * 0.45, distance * 0.15);
      const dx = (-circle.x / distance) * step;
      const dy = (-circle.y / distance) * step;
      let amount = 1;
      for (const neighbor of index.within(
        { x: circle.x + dx / 2, y: circle.y + dy / 2 },
        step / 2 + circle.radius + gap
      )) {
        if (neighbor.id === circle.id) continue;
        const x = neighbor.x - circle.x;
        const y = neighbor.y - circle.y;
        const projection = x * dx + y * dy;
        if (projection <= 0) continue;
        const perpendicular =
          x * x + y * y - (projection * projection) / (step * step);
        const clearance = circle.radius + neighbor.radius + gap;
        if (perpendicular >= clearance * clearance) continue;
        const contact =
          (projection -
            Math.sqrt((clearance * clearance - perpendicular) * step * step)) /
          (step * step);
        amount = Math.min(amount, Math.max(0, contact - 1e-8));
      }
      if (!amount) continue;
      index.move(circle, {
        x: circle.x + dx * amount,
        y: circle.y + dy * amount,
      });
      moved = Math.max(moved, step * amount);
    }
    if (moved < 1e-5) break;
  }

  const mass = circles.reduce((sum, circle) => sum + circle.radius ** 2, 0);
  const gravity = {
    x:
      circles.reduce((sum, circle) => sum + circle.x * circle.radius ** 2, 0) /
      mass,
    y:
      circles.reduce((sum, circle) => sum + circle.y * circle.radius ** 2, 0) /
      mass,
  };
  for (const circle of circles) {
    circle.x -= gravity.x;
    circle.y -= gravity.y;
  }
  // The centroid-centered inellipse keeps the entire cloud inside the triangle.
  const extent = circles.reduce(
    (maximum, circle) =>
      Math.max(maximum, Math.hypot(circle.x, circle.y) + circle.radius),
    0
  );
  const unit = (minimum * 0.985) / extent;
  circles.forEach((circle, position) => {
    Object.assign(ordered[position], {
      x: center.x + circle.x * unit * (radiusX / minimum),
      y: center.y + circle.y * unit * (radiusY / minimum),
      radius: circle.radius * unit,
    });
  });
  return layout;
}

export class SpatialIndex<T extends Circle = Repository> {
  private readonly cells = new Map<string, Set<T>>();
  private readonly locations = new Map<string, string>();
  private readonly maxRadius: number;

  public constructor(repositories: T[], private readonly size = 32) {
    this.maxRadius = repositories.reduce(
      (maximum, repository) => Math.max(maximum, repository.radius),
      0
    );
    repositories.forEach(repository => this.add(repository));
  }

  public move(repository: T, point: Point): void {
    const previous = this.locations.get(repository.id);
    if (previous) {
      const cell = this.cells.get(previous);
      if (cell) {
        cell.delete(repository);
        if (!cell.size) {
          this.cells.delete(previous);
        }
      }
    }
    repository.x = point.x;
    repository.y = point.y;
    this.add(repository);
  }

  public within(point: Point, radius: number): T[] {
    const found: T[] = [];
    const reach = radius + this.maxRadius;
    for (
      let x = Math.floor((point.x - reach) / this.size);
      x <= Math.floor((point.x + reach) / this.size);
      x++
    ) {
      for (
        let y = Math.floor((point.y - reach) / this.size);
        y <= Math.floor((point.y + reach) / this.size);
        y++
      ) {
        const cell = this.cells.get(`${x},${y}`);
        if (!cell) continue;
        for (const circle of cell) {
          if (
            Math.hypot(circle.x - point.x, circle.y - point.y) <=
            radius + circle.radius
          ) {
            found.push(circle);
          }
        }
      }
    }
    return found;
  }

  public find(point: Point, padding: number): T | null {
    const reach = this.maxRadius + padding;
    let nearest: T | null = null;
    let nearestDistance = Infinity;
    let nearestContainsPoint = false;
    for (
      let x = Math.floor((point.x - reach) / this.size);
      x <= Math.floor((point.x + reach) / this.size);
      x++
    ) {
      for (
        let y = Math.floor((point.y - reach) / this.size);
        y <= Math.floor((point.y + reach) / this.size);
        y++
      ) {
        const cell = this.cells.get(`${x},${y}`);
        if (!cell) {
          continue;
        }
        for (const repository of cell) {
          const distance = Math.hypot(
            repository.x - point.x,
            repository.y - point.y
          );
          const containsPoint = distance <= repository.radius;
          if (
            distance <= repository.radius + padding &&
            ((containsPoint && !nearestContainsPoint) ||
              (containsPoint === nearestContainsPoint &&
                distance < nearestDistance))
          ) {
            nearest = repository;
            nearestDistance = distance;
            nearestContainsPoint = containsPoint;
          }
        }
      }
    }
    return nearest;
  }

  private add(repository: T): void {
    const key = `${Math.floor(repository.x / this.size)},${Math.floor(
      repository.y / this.size
    )}`;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Set();
      this.cells.set(key, cell);
    }
    cell.add(repository);
    this.locations.set(repository.id, key);
  }
}

export function readView(search: string) {
  const parameters = new URLSearchParams(search);
  const warnings: string[] = [];
  const starValue = (key: string, fallback: number | null) => {
    const value = parameters.get(key);
    if (value === null || value === '') {
      return fallback;
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
      warnings.push(`Ignored invalid ${key} value.`);
      return fallback;
    }
    return number;
  };
  const selectedActions = (parameters.get('actions') || '')
    .split(',')
    .filter(Boolean);
  if (selectedActions.some(action => !isActionName(action))) {
    warnings.push('Ignored an unknown action filter.');
  }
  const filters: Filters = {
    ...DEFAULT_FILTERS,
    query: parameters.get('q') || '',
    minStars: starValue('minStars', 0) || 0,
    maxStars: starValue('maxStars', null),
    actions: Array.from(new Set(selectedActions.filter(isActionName))),
    match: parameters.get('match') === 'all' ? 'all' : 'any',
    version: parameters.get('version') || '',
    sort:
      parameters.get('sort') === 'name'
        ? 'name'
        : parameters.get('sort') === 'usage'
        ? 'usage'
        : 'stars',
  };
  if (filters.maxStars !== null && filters.minStars > filters.maxStars) {
    warnings.push('Ignored an inverted star range.');
    filters.minStars = 0;
    filters.maxStars = null;
  }
  const viewParameter = parameters.get('view');
  const metricParameter = parameters.get('metric');
  if (viewParameter && viewParameter !== 'map' && viewParameter !== 'trends') {
    warnings.push('Ignored an unknown visualization view.');
  }
  if (
    metricParameter &&
    metricParameter !== 'projects' &&
    metricParameter !== 'occurrences'
  ) {
    warnings.push('Ignored an unknown trend metric.');
  }
  const view: ExplorerView = viewParameter === 'trends' ? 'trends' : 'map';
  const metric: TrendMetric =
    metricParameter === 'occurrences' ? 'occurrences' : 'projects';
  return { filters, selected: parameters.get('repo'), view, metric, warnings };
}

export function writeView(
  filters: Filters,
  selected: string | null,
  view: ExplorerView = 'map',
  metric: TrendMetric = 'projects'
): string {
  const parameters = new URLSearchParams();
  if (filters.query) parameters.set('q', filters.query);
  if (filters.minStars) parameters.set('minStars', String(filters.minStars));
  if (filters.maxStars !== null)
    parameters.set('maxStars', String(filters.maxStars));
  if (filters.actions.length)
    parameters.set('actions', filters.actions.join(','));
  if (filters.match !== 'any') parameters.set('match', filters.match);
  if (filters.version) parameters.set('version', filters.version);
  if (filters.sort !== 'stars') parameters.set('sort', filters.sort);
  if (selected) parameters.set('repo', selected);
  if (view === 'trends') parameters.set('view', view);
  if (metric !== 'projects') parameters.set('metric', metric);
  return parameters.toString();
}
