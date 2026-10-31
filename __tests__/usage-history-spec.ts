import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  mergeSnapshots,
  updateUsageHistory,
  usageSnapshot,
  weeklyRevisions,
} from '../scripts/usage-history';
import { normalizeUsageHistory, UsageHistory } from '../web/model';

function database(count = 1) {
  const projects: Record<string, unknown> = {};
  for (let index = 0; index < count; index++) {
    projects[`project-${index}`] = [
      { actionName: 'get-cmake', version: 'v3', line: 10 },
      { actionName: 'get-cmake', version: 'v3', line: 10 },
      { actionName: 'get-cmake', version: 'v3', line: 20 },
      { actionName: 'run-cmake', version: 'v3', line: 30 },
      { stars: 25, repo_orig: {} },
    ];
  }
  return { acme: projects, LastStartTimeName: '2010-01-01' };
}

const firstDate = new Date('2022-06-06T05:40:39.000Z');
const nextDate = new Date('2026-10-24T03:39:31.000Z');

describe('recorded usage history', () => {
  test('uses the same distinct repositories and deduplicated occurrences as the map', () => {
    const snapshot = usageSnapshot(database(2), nextDate);
    expect(snapshot).toEqual({
      date: nextDate.toISOString(),
      commit: null,
      skippedRepositories: 0,
      skippedUsages: 0,
      actions: [
        { action: 'get-cmake', projects: 2, occurrences: 4 },
        { action: 'run-cmake', projects: 2, occurrences: 2 },
        { action: 'run-vcpkg', projects: 0, occurrences: 0 },
      ],
    });
    expect(snapshot.date).not.toContain('2010');
  });

  test('preserves explicit incomplete-record counts', () => {
    const input = database();
    input.acme.incomplete = [];
    input.acme['project-0'] = [
      { actionName: 'get-cmake', version: 'v3' },
      { actionName: 'unknown', version: 'v1' },
      { stars: 25, repo_orig: {} },
    ];
    const snapshot = usageSnapshot(input, nextDate);
    expect(snapshot.skippedRepositories).toBe(1);
    expect(snapshot.skippedUsages).toBe(1);
  });

  test('normalizes dates and action order without mutating input', () => {
    const first = usageSnapshot(database(2), firstDate);
    const last = usageSnapshot(database(1), nextDate);
    last.actions.reverse();
    const normalized = normalizeUsageHistory({
      version: 1,
      snapshots: [last, first],
    });
    expect(normalized.snapshots.map(snapshot => snapshot.date)).toEqual([
      first.date,
      last.date,
    ]);
    expect(normalized.snapshots[1].actions[0].action).toBe('get-cmake');
    expect(last.actions[0].action).toBe('run-vcpkg');
    expect(normalized.snapshots[1].actions[0].projects).toBe(1);
    expect(
      normalizeUsageHistory({ version: 1, snapshots: [] }).snapshots
    ).toHaveLength(0);
  });

  test('rejects malformed or ambiguous history instead of plotting invented zeroes', () => {
    const valid = usageSnapshot(database(), nextDate);
    for (const value of [
      null,
      { version: 2, snapshots: [] },
      { version: 1, snapshots: {} },
      { version: 1, snapshots: [valid, valid] },
      { version: 1, snapshots: [{ ...valid, date: 'not a date' }] },
      {
        version: 1,
        snapshots: [{ ...valid, date: '2026-02-30T00:00:00.000Z' }],
      },
      { version: 1, snapshots: [{ ...valid, commit: 'not a commit' }] },
      { version: 1, snapshots: [{ ...valid, skippedUsages: -1 }] },
      {
        version: 1,
        snapshots: [{ ...valid, actions: valid.actions.slice(1) }],
      },
      {
        version: 1,
        snapshots: [
          {
            ...valid,
            actions: [valid.actions[0], valid.actions[0], valid.actions[2]],
          },
        ],
      },
      {
        version: 1,
        snapshots: [
          {
            ...valid,
            actions: [
              { action: 'get-cmake', projects: 2, occurrences: 1 },
              ...valid.actions.slice(1),
            ],
          },
        ],
      },
      {
        version: 1,
        snapshots: [
          {
            ...valid,
            actions: [
              { action: 'get-cmake', projects: 0.5, occurrences: 1 },
              ...valid.actions.slice(1),
            ],
          },
        ],
      },
    ]) {
      expect(() => normalizeUsageHistory(value)).toThrow();
    }
  });

  test('selects the last saved snapshot in each UTC week plus the first baseline', () => {
    const revisions = [
      { commit: '3', date: '2026-01-05T00:00:00Z' },
      { commit: '1', date: '2025-12-29T23:59:59Z' },
      { commit: '2', date: '2026-01-04T23:59:59Z' },
      { commit: '0', date: '2025-12-29T00:00:00Z' },
    ];
    expect(
      weeklyRevisions(revisions).map(revision => revision.commit)
    ).toEqual(['0', '2', '3']);
    expect(weeklyRevisions([])).toEqual([]);
  });

  test('merges idempotently and retains collector-run snapshots during backfill', () => {
    const first = usageSnapshot(database(), firstDate);
    const last = usageSnapshot(database(2), nextDate);
    const history = mergeSnapshots({ version: 1, snapshots: [last] }, [first]);
    expect(mergeSnapshots(history, [first])).toEqual(history);
    expect(history.snapshots).toHaveLength(2);
    expect(
      mergeSnapshots(history, [usageSnapshot(database(3), nextDate)])
        .snapshots[1].actions[0].projects
    ).toBe(3);
  });

  test('reconciles the same source revision without dropping equal-count scans', () => {
    const commit = 'a'.repeat(40);
    const first = usageSnapshot(database(), firstDate);
    const recorded = usageSnapshot(database(), nextDate);
    const duplicate = usageSnapshot(
      database(),
      new Date(nextDate.getTime() + 60000),
      commit
    );
    const history = mergeSnapshots(
      {
        version: 1,
        snapshots: [
          first,
          recorded,
          duplicate,
          {
            ...duplicate,
            date: new Date(nextDate.getTime() + 120000).toISOString(),
          },
        ],
      },
      [{ ...recorded, commit }]
    );
    expect(history.snapshots).toEqual([first, { ...recorded, commit }]);
    expect(mergeSnapshots(history, [{ ...recorded, commit }])).toEqual(history);
  });
});

describe('history persistence', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-history-'));
    fs.mkdirSync(path.join(directory, 'graph'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('backfills actual Git snapshots and persists subsequent collection runs', () => {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: directory, stdio: 'pipe' });
    git('init', '--quiet');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    for (const [index, date] of [
      '2022-06-06T05:40:39Z',
      '2022-06-08T05:40:39Z',
      '2022-06-11T05:40:39Z',
      '2022-06-13T05:40:39Z',
    ].entries()) {
      fs.writeFileSync(
        path.join(directory, 'graph/action-usage-db.json'),
        JSON.stringify(database(index + 1))
      );
      git('add', 'graph/action-usage-db.json');
      execFileSync(
        'git',
        [
          'commit',
          '--quiet',
          '-m',
          'Saved scan\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>',
        ],
        {
          cwd: directory,
          env: {
            ...process.env,
            GIT_AUTHOR_DATE: date,
            GIT_COMMITTER_DATE: date,
          },
          stdio: 'pipe',
        }
      );
    }
    const backfilled = updateUsageHistory('backfill', directory);
    expect(
      backfilled.snapshots.map(snapshot => snapshot.actions[0].projects)
    ).toEqual([1, 3, 4]);
    expect(
      backfilled.snapshots.every(snapshot => snapshot.commit?.length === 40)
    ).toBe(true);
    const updated = updateUsageHistory('record', directory, nextDate);
    expect(updated.snapshots).toHaveLength(4);
    expect(updated.snapshots[3].commit).toBeNull();
    expect(updateUsageHistory('backfill', directory)).toEqual(updated);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(directory, 'graph/usage-history.json'),
          'utf8'
        )
      )
    ).toEqual(updated);
  });

  test('does not overwrite invalid existing history', () => {
    const filename = path.join(directory, 'graph/usage-history.json');
    fs.writeFileSync(filename, '{"version": 2}');
    expect(() => updateUsageHistory('record', directory)).toThrow('version 1');
    expect(fs.readFileSync(filename, 'utf8')).toBe('{"version": 2}');
  });

  test('uses committed collector timestamps instead of counting their commits again', () => {
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: directory,
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
    git('init', '--quiet');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    const commit = (date: Date) =>
      execFileSync(
        'git',
        [
          'commit',
          '--quiet',
          '-m',
          'Saved scan\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>',
        ],
        {
          cwd: directory,
          env: {
            ...process.env,
            GIT_AUTHOR_DATE: date.toISOString(),
            GIT_COMMITTER_DATE: date.toISOString(),
          },
          stdio: 'pipe',
        }
      );
    const dates = [firstDate, nextDate];
    let recorded: UsageHistory = { version: 1, snapshots: [] };
    for (const [index, date] of dates.entries()) {
      fs.writeFileSync(
        path.join(directory, 'graph/action-usage-db.json'),
        JSON.stringify({
          ...database(),
          LastStartTimeName: date.toISOString(),
        })
      );
      recorded = updateUsageHistory('record', directory, date);
      git('add', 'graph/action-usage-db.json', 'graph/usage-history.json');
      commit(new Date(date.getTime() + 60000));
      expect(recorded.snapshots).toHaveLength(index + 1);
    }
    const backfilled = updateUsageHistory('backfill', directory);
    expect(backfilled.snapshots.map(snapshot => snapshot.date)).toEqual(
      dates.map(date => date.toISOString())
    );
    expect(backfilled.snapshots.map(snapshot => snapshot.actions)).toEqual(
      recorded.snapshots.map(snapshot => snapshot.actions)
    );
    expect(backfilled.snapshots.map(snapshot => snapshot.commit)).toEqual([
      git('rev-parse', 'HEAD^'),
      git('rev-parse', 'HEAD'),
    ]);
    expect(updateUsageHistory('backfill', directory)).toEqual(backfilled);

    const databaseOnlyDate = new Date(nextDate.getTime() + 86400000);
    fs.writeFileSync(
      path.join(directory, 'graph/action-usage-db.json'),
      JSON.stringify({
        ...database(),
        LastStartTimeName: databaseOnlyDate.toISOString(),
      })
    );
    git('add', 'graph/action-usage-db.json');
    commit(databaseOnlyDate);
    const revised = updateUsageHistory('backfill', directory);
    expect(revised.snapshots.slice(0, 2)).toEqual(backfilled.snapshots);
    expect(revised.snapshots[2].date).toBe(databaseOnlyDate.toISOString());
    expect(revised.snapshots[2].commit).toBe(git('rev-parse', 'HEAD'));
    expect(updateUsageHistory('backfill', directory)).toEqual(revised);
  });
});
