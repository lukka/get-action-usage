import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function step(name: string, filename: string): string {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', filename),
    'utf8'
  );
  const found = workflow
    .split('\n    - ')
    .find(section => section.startsWith(`name: ${name}\n`));
  if (!found) throw new Error(`Missing workflow step: ${name}`);
  return found;
}

function runStep(name: string, filename: string, directory: string) {
  const script = /\n      run: \|\n((?:        [^\n]*(?:\n|$))+)/.exec(
    step(name, filename)
  );
  if (!script) throw new Error(`Missing workflow script: ${name}`);
  return spawnSync(
    'bash',
    [
      '--noprofile',
      '--norc',
      '-e',
      '-o',
      'pipefail',
      '-c',
      script[1]
        .split('\n')
        .map(line => line.slice(8))
        .join('\n'),
    ],
    { cwd: directory, encoding: 'utf8' }
  );
}

test('reports snapshot failure after independent database persistence', () => {
  const recording = step('Record usage trend snapshot', 'run.yml');
  expect(recording).toContain('id: record-history');
  expect(recording).toContain('continue-on-error: true');
  const reporting = step('Report usage snapshot failure', 'run.yml');
  expect(reporting).toContain(
    "if: always() && steps.record-history.outcome == 'failure'"
  );
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'run.yml'),
    'utf8'
  );
  expect(workflow.indexOf('Report usage snapshot failure')).toBeGreaterThan(
    workflow.indexOf('Publish updated action explorer and database')
  );
  expect(
    workflow.indexOf('Publish updated action explorer and database')
  ).toBeGreaterThan(workflow.indexOf('Commit DB content and update CRON job'));
  const result = runStep('Report usage snapshot failure', 'run.yml', __dirname);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain(
    '::error::Usage trend snapshot recording failed.'
  );
});

describe('generated explorer asset guard', () => {
  let directory: string;
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: directory, stdio: 'pipe' });
  const check = () =>
    runStep('Verify generated explorer assets', 'build-test.yml', directory);

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-assets-'));
    fs.mkdirSync(path.join(directory, 'graph'));
    fs.writeFileSync(path.join(directory, 'graph/model.js'), 'export {};\n');
    git('init', '--quiet');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    git('add', 'graph/model.js');
    git(
      'commit',
      '--quiet',
      '-m',
      'Saved assets\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
    );
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  test('accepts committed assets and unrelated untracked files', () => {
    fs.writeFileSync(
      path.join(directory, 'graph/notes.txt'),
      'Not JavaScript.\n'
    );
    expect(check().status).toBe(0);
  });

  test('rejects untracked generated JavaScript, including ignored files', () => {
    fs.writeFileSync(path.join(directory, 'graph/new.js'), 'export {};\n');
    expect(check().status).toBe(1);
    fs.writeFileSync(path.join(directory, '.gitignore'), 'graph/new.js\n');
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::');
    expect(result.stdout).toContain('graph/new.js');
  });

  test('rejects changed or staged generated files until they are committed', () => {
    fs.appendFileSync(
      path.join(directory, 'graph/model.js'),
      'export const changed = true;\n'
    );
    expect(check().status).toBe(1);
    git('add', 'graph/model.js');
    expect(check().status).toBe(1);
    git(
      'commit',
      '--quiet',
      '-m',
      'Updated assets\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
    );
    expect(check().status).toBe(0);
  });
});
