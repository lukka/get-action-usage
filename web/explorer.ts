import { CanvasGraph, GraphHit } from './canvas-graph.js';
import { UsageTrends } from './trends.js';
import {
  ACTIONS,
  ActionName,
  Circle,
  DEFAULT_FILTERS,
  ExplorerView,
  FilterResult,
  Filters,
  Layout,
  PAGE_SIZE,
  Point,
  readView,
  Repository,
  STAR_TIERS,
  starTier,
  TrendMetric,
  Usage,
  versionId,
  WorkerRequest,
  WorkerResponse,
  workflowSearch,
  writeView,
} from './model.js';

function element<T extends HTMLElement>(id: string): T {
  const found = document.querySelector<T>(`#${id}`);
  if (!found) throw new Error(`Missing interface element: ${id}`);
  return found;
}

function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function externalLink(
  text: string,
  url: string,
  className = ''
): HTMLAnchorElement {
  const link = create('a', className, text);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

const number = new Intl.NumberFormat('en');
const compact = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
function quantity(count: number, singular: string): string {
  return `${number.format(count)} ${singular}${count === 1 ? '' : 's'}`;
}
function starCount(repository: Repository, shortened = false): HTMLSpanElement {
  const tier = starTier(repository.stars);
  const badge = create('span', 'repo-stars');
  const star = create('i', 'star-glyph', '\u2605');
  star.style.color = tier.textColor;
  star.setAttribute('aria-hidden', 'true');
  badge.title = `${number.format(repository.stars)} stars (${tier.name}, ${
    tier.label
  })`;
  badge.setAttribute('aria-label', badge.title);
  badge.append(
    document.createTextNode(
      (shortened ? compact : number).format(repository.stars)
    ),
    star
  );
  return badge;
}
const initialView = readView(location.search);
let activeView: ExplorerView = initialView.view;
let trendMetric: TrendMetric = initialView.metric;
let filters: Filters = initialView.filters;
let pinned = initialView.selected;
let revealOnResult = Boolean(pinned);
let previewed: Repository | null = null;
let inspectorKey = '';
let tooltipKey = '';
let tooltipWidth = 0;
let tooltipHeight = 0;
let tooltipStageWidth = 0;
let worker: Worker | null = null;
let loaded = false;
let repositories: Repository[] = [];
let byId = new Map<string, Repository>();
let layout: Layout = { hubs: [], center: { x: 0, y: 0 }, width: 0, height: 0 };
let result: FilterResult = {
  ids: [],
  actions: [],
  versions: [],
  occurrences: 0,
};
let page = 0;
let requestId = 0;
let filterTimer: number | undefined;
let fitOnResult = true;
const messages = [...initialView.warnings];
const search = element<HTMLInputElement>('project-search');
const minStars = element<HTMLInputElement>('min-stars');
const maxStars = element<HTMLInputElement>('max-stars');
const match = element<HTMLSelectElement>('action-match');
const version = element<HTMLSelectElement>('version-filter');
const sort = element<HTMLSelectElement>('sort-order');
const list = element<HTMLUListElement>('repository-list');
const tooltip = element<HTMLDivElement>('graph-tooltip');
const stage = element<HTMLDivElement>('graph-stage');
const filterFieldset = element<HTMLFieldSetElement>('filters');
const actionInputs = new Map<ActionName, HTMLInputElement>();
const actionCounts = new Map<ActionName, HTMLSpanElement>();

function notify(message: string): void {
  if (!messages.includes(message)) messages.push(message);
  const notice = element('notice');
  notice.textContent = messages.join(' ');
  notice.hidden = !messages.length;
}

function viewUrl(): string {
  const query = writeView(filters, pinned, activeView, trendMetric);
  return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
}

function saveView(): void {
  history.replaceState(null, '', viewUrl());
}

function getRepository(id: string): Repository {
  const repository = byId.get(id);
  if (!repository) throw new Error(`Unknown project in filter results: ${id}`);
  return repository;
}

const graph = new CanvasGraph(
  element<HTMLCanvasElement>('graph-base'),
  element<HTMLCanvasElement>('graph-overlay'),
  {
    hover: (hit, point, radius, avoid) => {
      showTooltip(hit, point, radius, avoid);
      if (hit && hit.kind === 'repository') {
        previewed = hit.repository;
        renderInspector();
      }
    },
    select: repository => selectRepository(repository, false),
    action: action => {
      filters.actions =
        filters.actions.length === 1 && filters.actions[0] === action
          ? []
          : [action];
      syncControls();
      requestFilters();
    },
    clear: clearSelection,
    resize: () => requestFilters(true, 80),
  }
);

const trends = new UsageTrends(element('trends-view'), trendMetric, metric => {
  trendMetric = metric;
  saveView();
});

function showView(view: ExplorerView, push = false): void {
  const changed = activeView !== view;
  activeView = view;
  if (push && changed) history.pushState(null, '', viewUrl());
  const map = view === 'map';
  element('map-view').hidden = !map;
  element('trends-view').hidden = map;
  element('dataset-summary').hidden = !map;
  element('page-heading').textContent = map
    ? 'Projects using run-cmake, get-cmake and run-vcpkg'
    : 'Usage trends for run-cmake, get-cmake and run-vcpkg';
  element('page-description').textContent = map
    ? 'Browse public GitHub repositories, see which versions of these actions they use, and open the workflows that reference them.'
    : 'See how recorded repository and workflow usage has changed over time for each action.';
  const skip = element<HTMLAnchorElement>('skip-content');
  skip.href = map ? '#project-search' : '#trends-view';
  skip.textContent = map ? 'Skip to project search' : 'Skip to usage trends';
  for (const name of ['map', 'trends']) {
    const tab = element<HTMLButtonElement>(`${name}-tab`);
    tab.setAttribute('aria-selected', String(name === view));
    tab.tabIndex = name === view ? 0 : -1;
  }
  tooltip.hidden = true;
  previewed = null;
  graph.setActive(map);
  renderInspector();
  if (!(push && changed)) saveView();
  if (map) {
    if (!loaded && !worker) load();
    else if (loaded) requestFilters(false);
  } else {
    window.clearTimeout(filterTimer);
    requestId++;
    trends.show();
  }
}

function syncControls(): void {
  search.value = filters.query;
  minStars.value = filters.minStars ? String(filters.minStars) : '';
  maxStars.value = filters.maxStars === null ? '' : String(filters.maxStars);
  match.value = filters.match;
  match.disabled = filters.actions.length < 2;
  sort.value = filters.sort;
  for (const [action, input] of actionInputs)
    input.checked = filters.actions.includes(action);
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-stars]'
  )) {
    button.setAttribute(
      'aria-pressed',
      String(
        Number(button.dataset.stars) === filters.minStars &&
          filters.maxStars === null
      )
    );
  }
  element('filter-error').hidden = true;
  for (const input of [minStars, maxStars]) {
    input.setCustomValidity('');
    input.removeAttribute('aria-invalid');
  }
}

function validStars(): boolean {
  const min = minStars.value === '' ? 0 : Number(minStars.value);
  const max = maxStars.value === '' ? null : Number(maxStars.value);
  const invalid =
    minStars.validity.badInput ||
    maxStars.validity.badInput ||
    !Number.isSafeInteger(min) ||
    min < 0 ||
    (max !== null && (!Number.isSafeInteger(max) || max < 0));
  const message = invalid
    ? 'Use whole, non-negative star counts.'
    : max !== null && min > max
    ? 'Minimum stars must not exceed maximum stars.'
    : '';
  const error = element('filter-error');
  error.textContent = message;
  error.hidden = !message;
  for (const input of [minStars, maxStars]) {
    input.setCustomValidity(message);
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  if (message) {
    window.clearTimeout(filterTimer);
    requestId++;
    list.setAttribute('aria-busy', 'false');
    element('results-summary').textContent =
      'Fix the star range to update results.';
    return false;
  }
  filters.minStars = min;
  filters.maxStars = max;
  return true;
}

function requestFilters(fit = true, delay = 0): void {
  const target = worker;
  if (activeView !== 'map' || !loaded || !target || !validStars()) return;
  window.clearTimeout(filterTimer);
  const currentRequest = ++requestId;
  fitOnResult = fit;
  list.setAttribute('aria-busy', 'true');
  element('results-summary').textContent = 'Updating projects...';
  tooltip.hidden = true;
  const send = () => {
    const message: WorkerRequest = {
      type: 'filter',
      requestId: currentRequest,
      filters,
      viewport: graph.viewport(),
    };
    target.postMessage(message);
  };
  if (delay) filterTimer = window.setTimeout(send, delay);
  else send();
  saveView();
}

function resetFilters(): void {
  filters = { ...DEFAULT_FILTERS, actions: [] };
  syncControls();
  requestFilters();
}

function selectRepository(repository: Repository, focus: boolean): void {
  pinned = repository.id;
  previewed = repository;
  graph.select(pinned);
  if (focus) graph.focus(pinned);
  element('selection-status').textContent = `Pinned ${
    repository.id
  }, using ${repository.actions.join(', ')}. Project details are open.`;
  renderInspector();
  revealPinnedProject();
  updateSelection();
  saveView();
}

function revealPinnedProject(): void {
  if (window.matchMedia('(max-width: 760px)').matches) {
    if (pinned) graph.focus(pinned);
    element('action-map').scrollIntoView({ block: 'start' });
  }
}

function clearSelection(): void {
  const restoreFocus =
    element('inspector-content').contains(document.activeElement) ||
    element('close-inspector') === document.activeElement;
  const previous = pinned;
  pinned = null;
  previewed = null;
  graph.select(null);
  graph.preview(null);
  tooltip.hidden = true;
  renderInspector();
  updateSelection();
  element('selection-status').textContent = 'Project selection cleared.';
  if (restoreFocus) {
    const row = Array.from(
      list.querySelectorAll<HTMLButtonElement>('.repo-row')
    ).find(button => button.dataset.repository === previous);
    const target = window.matchMedia('(max-width: 760px)').matches
      ? element('graph-overlay')
      : row || element('graph-overlay');
    target.focus({ preventScroll: true });
    graph.preview(null);
    previewed = null;
    renderInspector();
  }
  saveView();
}

function updateSelection(): void {
  for (const button of list.querySelectorAll<HTMLButtonElement>('.repo-row')) {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.repository === pinned)
    );
  }
}

function renderList(): void {
  const totalPages = Math.ceil(result.ids.length / PAGE_SIZE);
  page = Math.max(0, Math.min(page, totalPages - 1));
  const fragment = document.createDocumentFragment();
  for (const id of result.ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const repository = getRepository(id);
    const item = create('li');
    const button = create('button', 'repo-row');
    button.type = 'button';
    button.dataset.repository = id;
    button.setAttribute('aria-pressed', String(id === pinned));
    button.title = `${id} - ${number.format(repository.stars)} stars`;
    const top = create('span', 'repo-row-top');
    top.append(create('span', 'repo-id', id), starCount(repository, true));
    const actions = create('span', 'repo-actions');
    for (const action of repository.actions) {
      const badge = create('span', 'repo-action');
      badge.append(
        create('i', `action-dot ${action}`),
        document.createTextNode(action)
      );
      actions.append(badge);
    }
    button.append(top, actions);
    const preview = () => {
      previewed = repository;
      graph.preview(id);
      renderInspector();
    };
    button.addEventListener('pointerenter', preview);
    button.addEventListener('focus', preview);
    button.addEventListener('pointerleave', () => graph.preview(null));
    button.addEventListener('blur', () => graph.preview(null));
    button.addEventListener('click', () => selectRepository(repository, true));
    item.append(button);
    fragment.append(item);
  }
  list.replaceChildren(fragment);
  list.scrollTop = 0;
  element('list-empty').hidden = Boolean(result.ids.length);
  element('result-count').textContent = number.format(result.ids.length);
  element('results-summary').textContent = `${number.format(
    result.ids.length
  )} of ${quantity(repositories.length, 'project')}`;
  element('page-label').textContent = `Page ${
    totalPages ? page + 1 : 0
  } of ${number.format(totalPages)}`;
  element<HTMLButtonElement>('previous-page').disabled = page === 0;
  element<HTMLButtonElement>('next-page').disabled = page + 1 >= totalPages;
}

function renderVersions(): void {
  const fragment = document.createDocumentFragment();
  const all = create('option', '', 'All recorded versions');
  all.value = '';
  fragment.append(all);
  if (
    filters.version &&
    !result.versions.some(entry => entry.id === filters.version)
  ) {
    const missing = create('option', '', `${filters.version} (0 projects)`);
    missing.value = filters.version;
    fragment.append(missing);
  }
  for (const action of ACTIONS) {
    const group = create('optgroup');
    group.label = action.name;
    for (const entry of result.versions.filter(
      item => item.action === action.name
    )) {
      const option = create(
        'option',
        '',
        `${entry.version} (${quantity(entry.projects, 'project')})`
      );
      option.value = entry.id;
      group.append(option);
    }
    if (group.children.length) fragment.append(group);
  }
  version.replaceChildren(fragment);
  version.value = filters.version;
}

function renderInspector(): void {
  const repository = pinned ? byId.get(pinned) : previewed;
  const key = `${repository?.id || ''}:${pinned || ''}:${filters.version}`;
  if (key === inspectorKey) return;
  inspectorKey = key;
  const content = element('inspector-content');
  const placeholder = element('inspector-placeholder');
  placeholder.hidden = Boolean(repository);
  content.hidden = !repository;
  element('close-inspector').hidden = !repository;
  element('project-inspector').classList.toggle(
    'is-pinned',
    Boolean(pinned && repository)
  );
  element('inspector-mode').textContent = pinned
    ? 'PINNED'
    : repository
    ? 'PREVIEW'
    : 'DETAILS';
  content.replaceChildren();
  if (!repository) return;
  const title = create('h3', 'project-title');
  title.append(externalLink(`${repository.name} \u2197`, repository.url));
  const metadata = create('div', 'project-meta');
  metadata.append(starCount(repository));
  if (repository.language)
    metadata.append(create('span', '', repository.language));
  metadata.append(
    create('span', '', quantity(repository.usages.length, 'usage'))
  );
  content.append(
    create('p', 'project-owner', repository.owner),
    title,
    metadata
  );
  if (repository.description)
    content.append(create('p', 'project-description', repository.description));
  const controls = create('div', 'inspector-buttons');
  const pin = create('button', '', pinned ? 'Unpin project' : 'Pin project');
  pin.type = 'button';
  pin.addEventListener('click', () => {
    if (pinned) clearSelection();
    else selectRepository(repository, false);
  });
  controls.append(
    pin,
    externalLink('Search workflows \u2197', workflowSearch(repository))
  );
  content.append(
    controls,
    create('h3', 'usage-heading', 'ACTIONS & RECORDED VERSIONS')
  );
  for (const action of repository.actions) {
    const section = create('section', 'usage-action');
    const heading = create('h4');
    heading.append(
      create('i', `action-dot ${action}`),
      externalLink(action, `https://github.com/lukka/${action}`)
    );
    section.append(heading);
    const versions = new Map<string, Usage[]>();
    for (const usage of repository.usages.filter(
      entry => entry.action === action
    )) {
      const group = versions.get(usage.version) || [];
      group.push(usage);
      versions.set(usage.version, group);
    }
    for (const [name, usages] of versions) {
      const entry = create('div', 'version-entry');
      const button = create('button', 'version-button', name);
      const id = versionId(usages[0]);
      button.type = 'button';
      button.title = `Filter projects using ${id}`;
      button.setAttribute('aria-label', `Filter by ${id}`);
      button.setAttribute('aria-pressed', String(filters.version === id));
      button.addEventListener('click', () => {
        filters.version = filters.version === id ? '' : id;
        requestFilters();
      });
      const details = create('details', 'workflow-details');
      details.append(
        create(
          'summary',
          '',
          `${usages.length} workflow ${
            usages.length === 1 ? 'usage' : 'usages'
          } \u00b7 view source`
        )
      );
      let rendered = false;
      details.addEventListener('toggle', () => {
        if (!details.open || rendered) return;
        rendered = true;
        const links = create('div', 'workflow-links');
        for (const usage of usages) {
          let label = 'Search workflow';
          if (usage.url) {
            const path = new URL(usage.url).pathname;
            label = `${path.slice(path.lastIndexOf('/') + 1)}${
              usage.line ? `:${usage.line}` : ''
            }`;
          }
          links.append(
            externalLink(
              `${label} \u2197`,
              usage.url || workflowSearch(repository, usage)
            )
          );
        }
        details.append(links);
      });
      entry.append(button, details);
      section.append(entry);
    }
    content.append(section);
  }
}

function showTooltip(
  hit: GraphHit | null,
  point: Point,
  radius = 0,
  avoid: readonly Circle[] = []
): void {
  if (!hit) {
    tooltip.hidden = true;
    tooltipKey = '';
    return;
  }
  const key = hit.kind === 'repository' ? hit.repository.id : hit.hub.action;
  if (key !== tooltipKey) {
    tooltipKey = key;
    tooltipStageWidth = 0;
    tooltip.replaceChildren();
    if (hit.kind === 'repository') {
      tooltip.append(create('strong', '', hit.repository.id));
      tooltip.append(
        create(
          'span',
          '',
          `${number.format(
            hit.repository.stars
          )} stars \u00b7 click circle body to expand and pin`
        )
      );
      for (const action of hit.repository.actions) {
        const versions = Array.from(
          new Set(
            hit.repository.usages
              .filter(usage => usage.action === action)
              .map(usage => usage.version)
          )
        );
        tooltip.append(
          create(
            'span',
            '',
            `${action}@${versions
              .map(value =>
                value.length > 16 ? `${value.slice(0, 13)}...` : value
              )
              .slice(0, 2)
              .join(', ')}${versions.length > 2 ? ' ...' : ''}`
          )
        );
      }
    } else {
      tooltip.append(
        create('strong', '', hit.hub.action),
        create('span', '', 'Hover to highlight projects. Click to filter.')
      );
    }
  }
  tooltip.hidden = false;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (tooltipStageWidth !== width) {
    tooltipWidth = tooltip.offsetWidth;
    tooltipHeight = tooltip.offsetHeight;
    tooltipStageWidth = width;
  }
  const right = Math.max(8, width - tooltipWidth - 8);
  const bottom = Math.max(36, height - tooltipHeight - 40);
  const gap = radius + 16;
  const xs = [
    point.x + gap,
    point.x - gap - tooltipWidth,
    point.x - tooltipWidth / 2,
    8,
    right,
  ];
  const ys = [
    point.y - tooltipHeight / 2,
    point.y + gap,
    point.y - gap - tooltipHeight,
    36,
    bottom,
  ];
  const obstacles = [...avoid, { id: 'active', ...point, radius }];
  let position = { x: 8, y: 36 };
  let minimum = Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const candidate = {
        x: Math.max(8, Math.min(right, x)),
        y: Math.max(36, Math.min(bottom, y)),
      };
      let score = Math.hypot(
        candidate.x + tooltipWidth / 2 - point.x,
        candidate.y + tooltipHeight / 2 - point.y
      );
      for (const circle of obstacles) {
        const clearance = Math.hypot(
          Math.max(
            Math.abs(circle.x - candidate.x - tooltipWidth / 2) -
              tooltipWidth / 2,
            0
          ),
          Math.max(
            Math.abs(circle.y - candidate.y - tooltipHeight / 2) -
              tooltipHeight / 2,
            0
          )
        );
        score += Math.max(0, circle.radius + 8 - clearance) ** 2 * 10000;
      }
      if (score < minimum) {
        minimum = score;
        position = candidate;
      }
    }
  }
  tooltip.style.left = `${position.x}px`;
  tooltip.style.top = `${position.y}px`;
}

function showError(message: string): void {
  loaded = false;
  window.clearTimeout(filterTimer);
  worker?.terminate();
  worker = null;
  filterFieldset.disabled = true;
  sort.disabled = true;
  element('graph-state').hidden = false;
  element('graph-empty').hidden = true;
  element('state-title').textContent = 'Unable to load the map';
  element(
    'state-description'
  ).textContent = `${message} Serve the graph assets and database together, then retry.`;
  element<HTMLButtonElement>('retry-load').hidden = false;
  const mark = document.querySelector<HTMLElement>('.loading-mark');
  if (mark) mark.hidden = true;
  element('results-summary').textContent = 'Project data is unavailable.';
  element('graph-summary').textContent = 'Map unavailable';
  list.setAttribute('aria-busy', 'false');
}

function receive(message: WorkerResponse): void {
  if (message.type === 'error') {
    showError(message.message);
    return;
  }
  if (message.type === 'loaded') {
    repositories = message.repositories;
    byId = new Map(repositories.map(repository => [repository.id, repository]));
    previewed = previewed ? byId.get(previewed.id) || null : null;
    inspectorKey = '';
    loaded = true;
    filterFieldset.disabled = false;
    sort.disabled = false;
    element('total-projects').textContent = number.format(repositories.length);
    element('total-usages').textContent = number.format(
      repositories.reduce(
        (count, repository) => count + repository.usages.length,
        0
      )
    );
    if (message.skippedRepositories || message.skippedUsages) {
      notify(
        `The database contains incomplete records: skipped ${quantity(
          message.skippedRepositories,
          'project'
        )} and ${quantity(message.skippedUsages, 'usage')}.`
      );
    }
    if (pinned && !byId.has(pinned)) {
      notify(`The linked project "${pinned}" is not in this database.`);
      pinned = null;
    }
    requestFilters();
    return;
  }
  if (message.requestId !== requestId) return;
  const previousIds = new Set(result.ids);
  const sameLayout =
    layout.width === message.layout.width &&
    layout.height === message.layout.height &&
    layout.center.x === message.layout.center.x &&
    layout.center.y === message.layout.center.y &&
    layout.hubs.length === message.layout.hubs.length &&
    layout.hubs.every(
      (hub, index) =>
        hub.action === message.layout.hubs[index].action &&
        hub.x === message.layout.hubs[index].x &&
        hub.y === message.layout.hubs[index].y
    );
  const repack =
    fitOnResult ||
    !sameLayout ||
    result.ids.length !== message.result.ids.length ||
    message.result.ids.some(id => !previousIds.has(id));
  result = message.result;
  if (repack) {
    layout = message.layout;
    for (const circle of message.circles) {
      const repository = getRepository(circle.id);
      repository.x = circle.x;
      repository.y = circle.y;
      repository.radius = circle.radius;
    }
  }
  page = 0;
  if (pinned && !result.ids.includes(pinned)) {
    pinned = null;
    previewed = null;
    element('selection-status').textContent =
      'The pinned project is outside the current filters. Selection cleared.';
  }
  if (previewed && !result.ids.includes(previewed.id)) previewed = null;
  graph.setData(result.ids.map(getRepository), layout, result.actions, repack);
  graph.select(pinned);
  if (repack && pinned && window.matchMedia('(max-width: 760px)').matches) {
    graph.focus(pinned);
  }
  renderList();
  renderVersions();
  renderInspector();
  if (revealOnResult) {
    if (pinned) revealPinnedProject();
    revealOnResult = false;
  }
  for (const count of result.actions) {
    const output = actionCounts.get(count.action);
    if (output) {
      output.textContent = number.format(count.projects);
      output.title = `${quantity(count.projects, 'project')}, ${quantity(
        count.occurrences,
        'workflow usage'
      )} in the current results`;
    }
  }
  element('graph-state').hidden = true;
  element('graph-empty').hidden = Boolean(result.ids.length);
  element('graph-summary').textContent = `${quantity(
    result.ids.length,
    'project'
  )} \u00b7 ${quantity(result.occurrences, 'workflow usage')}`;
  list.setAttribute('aria-busy', 'false');
  syncPresetButtons();
  saveView();
}

function syncPresetButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-stars]'
  )) {
    button.setAttribute(
      'aria-pressed',
      String(
        Number(button.dataset.stars) === filters.minStars &&
          filters.maxStars === null
      )
    );
  }
}

function load(): void {
  worker?.terminate();
  loaded = false;
  element('graph-state').hidden = false;
  element('retry-load').hidden = true;
  element('state-title').textContent = 'Loading GitHub Actions usage';
  element('state-description').textContent =
    'Loading public repositories and recorded workflow usages.';
  const mark = document.querySelector<HTMLElement>('.loading-mark');
  if (mark) mark.hidden = false;
  try {
    worker = new Worker(new URL('./data-worker.js', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) =>
      receive(event.data);
    worker.onerror = event =>
      showError(event.message || 'The data worker could not start.');
    const message: WorkerRequest = { type: 'load' };
    worker.postMessage(message);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

for (const tier of STAR_TIERS.filter(item => item.minimum >= 25)) {
  const label = create('span');
  const circle = create('i', 'legend-bucket');
  circle.style.backgroundColor = tier.color;
  circle.style.width = circle.style.height = `${tier.size * 6}px`;
  circle.setAttribute('aria-hidden', 'true');
  label.title = `${tier.name} stars: ${tier.label}; relative diameter ${tier.size}`;
  label.append(circle, document.createTextNode(tier.label));
  element('star-legend').append(label);
}

for (const action of ACTIONS) {
  const label = create('label', 'action-option');
  const input = create('input');
  input.type = 'checkbox';
  input.value = action.name;
  input.setAttribute('aria-label', `Filter ${action.name}`);
  input.addEventListener('change', () => {
    filters.actions = ACTIONS.filter(
      item => actionInputs.get(item.name)?.checked
    ).map(item => item.name);
    match.disabled = filters.actions.length < 2;
    requestFilters();
  });
  const count = create('span', 'action-count', '\u2014');
  count.setAttribute('aria-hidden', 'true');
  actionInputs.set(action.name, input);
  actionCounts.set(action.name, count);
  label.append(
    input,
    create('i', `action-dot ${action.name}`),
    create('span', 'action-name', action.name),
    count
  );
  element('action-filters').append(label);
}

search.addEventListener('input', () => {
  filters.query = search.value;
  requestFilters(true, 120);
});
for (const input of [minStars, maxStars])
  input.addEventListener('input', () => requestFilters(true, 120));
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-stars]'
)) {
  button.addEventListener('click', () => {
    filters.minStars = Number(button.dataset.stars);
    filters.maxStars = null;
    syncControls();
    requestFilters();
  });
}
match.addEventListener('change', () => {
  filters.match = match.value === 'all' ? 'all' : 'any';
  requestFilters();
});
version.addEventListener('change', () => {
  filters.version = version.value;
  requestFilters();
});
sort.addEventListener('change', () => {
  filters.sort =
    sort.value === 'name' ? 'name' : sort.value === 'usage' ? 'usage' : 'stars';
  requestFilters(false);
});
for (const id of ['reset-filters', 'empty-reset'])
  element(id).addEventListener('click', resetFilters);
element('previous-page').addEventListener('click', () => {
  page--;
  renderList();
});
element('next-page').addEventListener('click', () => {
  page++;
  renderList();
});
element('zoom-in').addEventListener('click', () => graph.zoomBy(1.3));
element('zoom-out').addEventListener('click', () => graph.zoomBy(1 / 1.3));
element('fit-view').addEventListener('click', () => graph.fit());
element('retry-load').addEventListener('click', load);
element('close-inspector').addEventListener('click', clearSelection);
for (const name of ['map', 'trends'] as const) {
  const tab = element(`${name}-tab`);
  tab.addEventListener('click', () => showView(name, true));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 'map'
        : event.key === 'End'
        ? 'trends'
        : name === 'map'
        ? 'trends'
        : 'map';
    showView(next, true);
    element(`${next}-tab`).focus();
  });
}
element('copy-view').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    notify(
      'View link copied. The view, metric, filters and pinned project are included.'
    );
  } catch {
    notify(
      'Could not copy automatically. Copy the view URL from your address bar.'
    );
  }
});
document.addEventListener('keydown', event => {
  if (activeView !== 'map') return;
  const target = event.target;
  const editing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);
  if (
    event.key === '/' &&
    !editing &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    search.focus();
  }
  if (event.key === 'Escape') clearSelection();
});
window.addEventListener('popstate', () => {
  const view = readView(location.search);
  filters = view.filters;
  pinned = view.selected;
  trendMetric = view.metric;
  trends.setMetric(trendMetric);
  revealOnResult = Boolean(pinned);
  previewed = null;
  view.warnings.forEach(notify);
  syncControls();
  showView(view.view);
});
sort.disabled = true;
syncControls();
if (messages.length) element('notice').textContent = messages.join(' ');
element('notice').hidden = !messages.length;
showView(activeView);
