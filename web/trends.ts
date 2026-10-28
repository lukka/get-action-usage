import {
  ACTIONS,
  normalizeUsageHistory,
  TrendMetric,
  UsageHistory,
  UsageSnapshot,
} from './model.js';

const number = new Intl.NumberFormat('en');
const date = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});
const month = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const WIDTH = 520;
const HEIGHT = 280;
const PLOT = { left: 58, right: 495, top: 24, bottom: 232 };

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

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
  text = ''
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, String(value));
  node.textContent = text;
  return node;
}

function metricLabel(metric: TrendMetric): string {
  return metric === 'projects' ? 'repositories' : 'workflow usages';
}

function chart(
  action: typeof ACTIONS[number],
  snapshots: UsageSnapshot[],
  metric: TrendMetric,
  maximum: number
): HTMLElement {
  const counts = snapshots.map(snapshot => {
    const count = snapshot.actions.find(entry => entry.action === action.name);
    if (!count) throw new Error(`Missing ${action.name} history.`);
    return count;
  });
  const values = counts.map(count => count[metric]);
  const times = snapshots.map(snapshot => Date.parse(snapshot.date));
  const first = times[0];
  const last = times[times.length - 1];
  const x = (time: number) =>
    first === last
      ? (PLOT.left + PLOT.right) / 2
      : PLOT.left +
        ((time - first) / (last - first)) * (PLOT.right - PLOT.left);
  const y = (value: number) =>
    PLOT.bottom - (value / maximum) * (PLOT.bottom - PLOT.top);
  const card = create('article', 'panel trend-card');
  card.dataset.action = action.name;
  const heading = create('h3');
  heading.id = `trend-${action.name}`;
  const dot = create('i', `action-dot ${action.name}`);
  dot.setAttribute('aria-hidden', 'true');
  heading.append(dot, document.createTextNode(action.name));
  card.setAttribute('aria-labelledby', heading.id);
  const total = create('p', 'trend-total');
  total.append(
    create('strong', '', number.format(values[values.length - 1])),
    document.createTextNode(`${metricLabel(metric)} in the latest snapshot`)
  );
  const delta = values[values.length - 1] - values[0];
  const change = create(
    'p',
    'trend-change',
    snapshots.length === 1
      ? 'One snapshot so far; a trend needs more observations.'
      : `${delta > 0 ? '+' : ''}${number.format(
          delta
        )} since the first snapshot`
  );
  const plot = svg('svg', {
    class: 'trend-plot',
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    role: 'slider',
    tabindex: 0,
    'aria-label': `${action.name}: recorded ${metricLabel(metric)} over time, ${
      snapshots.length
    } snapshots`,
    'aria-describedby': `trend-help trend-reading-${action.name}`,
    'aria-valuemin': 1,
    'aria-valuemax': snapshots.length,
  });
  for (let tick = 0; tick <= 4; tick++) {
    const value = (maximum * tick) / 4;
    const position = y(value);
    plot.append(
      svg('line', {
        class: 'trend-grid',
        x1: PLOT.left,
        x2: PLOT.right,
        y1: position,
        y2: position,
      }),
      svg(
        'text',
        { x: PLOT.left - 10, y: position + 5, 'text-anchor': 'end' },
        number.format(value)
      )
    );
  }
  const ticks = first === last ? [first] : [first, (first + last) / 2, last];
  for (const [index, time] of ticks.entries()) {
    plot.append(
      svg(
        'text',
        {
          x: x(time),
          y: PLOT.bottom + 28,
          'text-anchor':
            ticks.length === 1
              ? 'middle'
              : index === 0
              ? 'start'
              : index === 2
              ? 'end'
              : 'middle',
        },
        month.format(time)
      )
    );
  }
  plot.append(
    svg('path', {
      class: 'trend-line',
      stroke: action.color,
      d: values
        .map(
          (value, index) => `${index ? 'L' : 'M'}${x(times[index])},${y(value)}`
        )
        .join(' '),
    })
  );
  const cursor = svg('line', {
    class: 'trend-cursor',
    y1: PLOT.top,
    y2: PLOT.bottom,
  });
  const point = svg('circle', {
    class: 'trend-point',
    r: 5,
    fill: action.color,
    stroke: '#ffffff',
    'stroke-width': 2,
  });
  plot.append(cursor, point);
  const reading = create('p', 'trend-reading');
  reading.id = `trend-reading-${action.name}`;
  reading.setAttribute('aria-live', 'polite');
  reading.setAttribute('aria-atomic', 'true');
  let selected = -1;
  const select = (index: number) => {
    if (selected === index) return;
    selected = index;
    plot.setAttribute('aria-valuenow', String(index + 1));
    plot.setAttribute(
      'aria-valuetext',
      `${date.format(times[index])} UTC, ${number.format(
        values[index]
      )} ${metricLabel(metric)}`
    );
    cursor.setAttribute('x1', String(x(times[index])));
    cursor.setAttribute('x2', String(x(times[index])));
    point.setAttribute('cx', String(x(times[index])));
    point.setAttribute('cy', String(y(values[index])));
    const timestamp = create('time', '', `${date.format(times[index])} UTC`);
    timestamp.dateTime = snapshots[index].date;
    reading.replaceChildren(
      create(
        'strong',
        '',
        `${number.format(values[index])} ${metricLabel(metric)}`
      ),
      timestamp
    );
    if (
      snapshots[index].skippedRepositories ||
      snapshots[index].skippedUsages
    ) {
      reading.append(
        document.createTextNode(
          `Dataset-wide omissions: ${number.format(
            snapshots[index].skippedRepositories
          )} projects, ${number.format(snapshots[index].skippedUsages)} usages.`
        )
      );
    }
  };
  select(snapshots.length - 1);
  const inspect = (event: PointerEvent) => {
    const bounds = plot.getBoundingClientRect();
    const position = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
    let nearest = 0;
    for (let index = 1; index < times.length; index++) {
      if (
        Math.abs(x(times[index]) - position) <
        Math.abs(x(times[nearest]) - position)
      )
        nearest = index;
    }
    select(nearest);
  };
  plot.addEventListener('pointermove', inspect);
  plot.addEventListener('pointerdown', inspect);
  plot.addEventListener('keydown', event => {
    if (
      ![
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    select(
      event.key === 'Home'
        ? 0
        : event.key === 'End'
        ? snapshots.length - 1
        : Math.max(
            0,
            Math.min(
              snapshots.length - 1,
              selected +
                (event.key === 'ArrowLeft' || event.key === 'ArrowDown'
                  ? -1
                  : 1)
            )
          )
    );
  });
  const details = create('details', 'trend-data');
  details.append(create('summary', '', 'Snapshot data'));
  let tableRendered = false;
  details.addEventListener('toggle', () => {
    if (!details.open || tableRendered) return;
    tableRendered = true;
    const wrap = create('div', 'trend-table-wrap');
    const table = create('table');
    table.append(
      create(
        'caption',
        '',
        `${action.name}: recorded counts, not executions. Skipped counts apply to the entire dataset.`
      )
    );
    const head = create('thead');
    const labels = create('tr');
    for (const text of [
      'Snapshot (UTC)',
      'Repositories',
      'Workflow usages',
      'Skipped projects',
      'Skipped usages',
    ]) {
      const cell = create('th', '', text);
      cell.scope = 'col';
      labels.append(cell);
    }
    head.append(labels);
    const body = create('tbody');
    for (const [index, snapshot] of snapshots.entries()) {
      const row = create('tr');
      const timestamp = create('th', '', date.format(times[index]));
      timestamp.scope = 'row';
      row.append(
        timestamp,
        create('td', '', number.format(counts[index].projects)),
        create('td', '', number.format(counts[index].occurrences)),
        create('td', '', number.format(snapshot.skippedRepositories)),
        create('td', '', number.format(snapshot.skippedUsages))
      );
      body.append(row);
    }
    table.append(head, body);
    wrap.append(table);
    details.append(wrap);
  });
  card.append(heading, total, change, plot, reading, details);
  return card;
}

export class UsageTrends {
  private history: UsageHistory | null = null;
  private loading = false;
  private readonly measure: HTMLSelectElement;

  public constructor(
    private readonly root: HTMLElement,
    private metric: TrendMetric,
    onMetricChange: (metric: TrendMetric) => void
  ) {
    this.measure = this.element<HTMLSelectElement>('trend-metric');
    this.measure.value = metric;
    this.measure.addEventListener('change', () => {
      this.setMetric(
        this.measure.value === 'occurrences' ? 'occurrences' : 'projects'
      );
      onMetricChange(this.metric);
    });
    this.element('retry-history').addEventListener('click', () => this.load());
  }

  public setMetric(metric: TrendMetric): void {
    this.metric = metric;
    this.measure.value = metric;
    if (this.history) this.render();
  }

  public show(): void {
    if (!this.history && !this.loading) void this.load();
  }

  private element<T extends HTMLElement>(id: string): T {
    const node = this.root.querySelector<T>(`#${id}`);
    if (!node) throw new Error(`Missing trends element: ${id}`);
    return node;
  }

  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.measure.disabled = true;
    this.element('history-state').hidden = false;
    this.element('retry-history').hidden = true;
    this.element('history-state-title').textContent = 'Loading usage history';
    this.element('history-state-description').textContent =
      'Reading historical database snapshots.';
    this.element('history-summary').textContent =
      'Loading saved usage history...';
    try {
      const response = await fetch(
        new URL('./usage-history.json', import.meta.url),
        {
          cache: 'no-cache',
        }
      );
      if (!response.ok)
        throw new Error(`History request failed (HTTP ${response.status}).`);
      this.history = normalizeUsageHistory(await response.json());
      this.render();
    } catch (error) {
      this.element('trend-charts').replaceChildren();
      this.element('history-summary').textContent =
        'Usage history unavailable.';
      this.element('history-state-title').textContent =
        'Unable to load usage history';
      this.element('history-state-description').textContent = `${
        error instanceof Error ? error.message : String(error)
      } Retry, or switch back to the repository map.`;
      this.element('retry-history').hidden = false;
    } finally {
      this.loading = false;
    }
  }

  private render(): void {
    const snapshots = this.history?.snapshots;
    if (!snapshots) return;
    const charts = this.element('trend-charts');
    charts.replaceChildren();
    if (!snapshots.length) {
      this.element('history-summary').textContent = 'No saved snapshots yet.';
      this.element('history-state').hidden = false;
      this.element('history-state-title').textContent = 'No usage history yet';
      this.element('history-state-description').textContent =
        'A collector run will save the first observation. Historical snapshots can also be backfilled from Git.';
      return;
    }
    this.element('history-state').hidden = true;
    this.measure.disabled = false;
    this.element('history-summary').textContent = `${number.format(
      snapshots.length
    )} saved snapshots. Latest: ${date.format(
      Date.parse(snapshots[snapshots.length - 1].date)
    )} UTC. Historical points are sampled weekly; new scans add a snapshot.`;
    const warning = this.element('history-warning');
    warning.hidden = !snapshots.some(
      snapshot => snapshot.skippedRepositories || snapshot.skippedUsages
    );
    warning.textContent =
      'Some snapshots contain incomplete records. These records are excluded; chart readings and tables report dataset-wide omissions.';
    const maximum = snapshots.reduce(
      (largest, snapshot) =>
        snapshot.actions.reduce(
          (current, count) => Math.max(current, count[this.metric]),
          largest
        ),
      1
    );
    const unit = Math.max(1, Math.pow(10, Math.floor(Math.log10(maximum / 4))));
    const ceiling = Math.ceil(maximum / 4 / unit) * unit * 4;
    for (const action of ACTIONS)
      charts.append(chart(action, snapshots, this.metric, ceiling));
  }
}
