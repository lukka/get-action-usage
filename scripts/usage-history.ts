import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_FILTERS,
  filterRepositories,
  normalizeDatabase,
  normalizeUsageHistory,
  UsageHistory,
  UsageSnapshot,
} from '../web/model';

const DATABASE = 'graph/action-usage-db.json';
const HISTORY = 'graph/usage-history.json';

export interface HistoryRevision {
  commit: string;
  date: string;
}

export function weeklyRevisions(
  revisions: HistoryRevision[]
): HistoryRevision[] {
  const weeks = new Map<string, HistoryRevision>();
  let first: HistoryRevision | null = null;
  for (const revision of revisions) {
    const date = new Date(revision.date);
    const normalized = { ...revision, date: date.toISOString() };
    if (!first || normalized.date < first.date) first = normalized;
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const week = date.toISOString();
    const previous = weeks.get(week);
    if (!previous || normalized.date > previous.date)
      weeks.set(week, normalized);
  }
  const selected = Array.from(weeks.values());
  const baseline = first;
  if (
    baseline &&
    !selected.some(revision => revision.commit === baseline.commit)
  )
    selected.push(baseline);
  return selected.sort((left, right) => left.date.localeCompare(right.date));
}

export function usageSnapshot(
  database: unknown,
  date: Date,
  commit: string | null = null
): UsageSnapshot {
  const normalized = normalizeDatabase(database);
  const result = filterRepositories(normalized.repositories, DEFAULT_FILTERS);
  return {
    date: date.toISOString(),
    commit,
    actions: result.actions,
    skippedRepositories: normalized.skippedRepositories,
    skippedUsages: normalized.skippedUsages,
  };
}

export function mergeSnapshots(
  history: UsageHistory,
  snapshots: UsageSnapshot[]
): UsageHistory {
  const byDate = new Map(
    history.snapshots.map(snapshot => [snapshot.date, snapshot])
  );
  for (const snapshot of snapshots) byDate.set(snapshot.date, snapshot);
  return normalizeUsageHistory({
    version: 1,
    snapshots: Array.from(byDate.values()),
  });
}

export function updateUsageHistory(
  mode: 'record' | 'backfill',
  root = process.cwd(),
  now = new Date()
): UsageHistory {
  const filename = path.join(root, HISTORY);
  const history: UsageHistory = fs.existsSync(filename)
    ? normalizeUsageHistory(JSON.parse(fs.readFileSync(filename, 'utf8')))
    : { version: 1, snapshots: [] };
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  const snapshots: UsageSnapshot[] = [];
  if (mode === 'backfill') {
    if (git('rev-parse', '--is-shallow-repository') === 'true') {
      throw new Error('Backfilling needs full Git history; fetch --unshallow.');
    }
    const log = git(
      'log',
      '--first-parent',
      '--format=%H%x09%cI',
      '--',
      DATABASE
    );
    if (!log) throw new Error(`No saved Git history found for ${DATABASE}.`);
    const revisions = weeklyRevisions(
      log.split('\n').map(line => {
        const [commit, date] = line.split('\t');
        return { commit, date };
      })
    );
    for (const revision of revisions) {
      snapshots.push(
        usageSnapshot(
          JSON.parse(git('show', `${revision.commit}:${DATABASE}`)),
          new Date(revision.date),
          revision.commit
        )
      );
    }
  } else {
    snapshots.push(
      usageSnapshot(
        JSON.parse(fs.readFileSync(path.join(root, DATABASE), 'utf8')),
        now
      )
    );
  }
  for (const snapshot of snapshots) {
    if (snapshot.skippedRepositories || snapshot.skippedUsages) {
      console.warn(
        `${snapshot.date}: skipped ${snapshot.skippedRepositories} incomplete repositories and ${snapshot.skippedUsages} usages.`
      );
    }
  }
  const updated = mergeSnapshots(history, snapshots);
  fs.writeFileSync(filename, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(
    `${mode}: saved ${updated.snapshots.length} usage snapshots to ${HISTORY}.`
  );
  return updated;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (
    args.length !== 1 ||
    (args[0] !== '--record' && args[0] !== '--backfill')
  ) {
    throw new Error(
      'Usage: ts-node scripts/usage-history.ts --record|--backfill'
    );
  }
  updateUsageHistory(args[0] === '--record' ? 'record' : 'backfill');
}
