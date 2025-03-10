// Copyright © 2022-2023-2024-2025 by Luca Cappa lcappa@gmail.com
// All content of this repository is licensed under the CC BY-SA License.
// See the LICENSE file in the root for license information.

import * as ok from '@octokit/rest';
import * as fs from 'fs';
import * as LPF from 'lpf';
import * as os from 'os';
import * as path from 'path';
import * as bar from './progressbar';
import * as github from './github';

import { ApiRateLimit } from './apilimits';
import { ApiLimitsException } from './apilimitsexception';
import { components } from '@octokit/openapi-types';
import { Config } from 'node-json-db/dist/lib/JsonDBConfig';
import { toCronSchedule } from './cron';
import { DateHelper } from './datehelper';
import {
  IFile,
  IRepository,
  IRepositoriesProvider,
  IRepositoriesProviderFactory,
  IRepositoryMatch,
  IReporter,
} from './interfaces';
import { JsonDB } from 'node-json-db';
import { Stopwatch } from 'ts-stopwatch';

export class GHActionUsage {
  private static readonly LastStartTimeName: string = '/LastStartTimeName/';
  private static readonly UsageDbFileName = 'action-usage-db.json';
  private static readonly WorkflowFilePath: string[] = [
    '.github',
    'workflows',
    'run.yml',
  ];
  // Terminate the execution after this timeout to prevent forced cancellation
  // on the runner (six hours)
  private static readonly InternalTimeoutMinutes = 5 * 60;

  private static getWorkspacePath(): string | null {
    const key = 'GITHUB_WORKSPACE';
    return process.env[key] ?? null;
  }

  // @ts-ignore
  private static async delay(millis: number): Promise<void> {
    if (github.isRunningOnGitHubRunner()) {
      return new Promise(resolve => setTimeout(resolve, millis));
    }
  }

  private readonly db: JsonDB;
  private readonly progressBars: bar.ProgressBar;
  // Days of each time segment.
  private readonly timeRange: number = 60.875 / 2;
  // Starting date of the time segments.
  private readonly startingDate: Date;
  private readonly executionStopDate: Date;
  private totalRepositoryChecked: number = 0;
  private readonly actionRootPath: string;

  public constructor(
    private readonly octokit: ok.Octokit,
    private readonly reposProviderFactory: IRepositoriesProviderFactory,
    private readonly reporter: IReporter
  ) {
    // Identify action directory
    this.actionRootPath = this.getActionPath();

    this.executionStopDate = DateHelper.addMinutes(
      new Date(),
      GHActionUsage.InternalTimeoutMinutes
    );
    reporter.info(
      `Executing until ${this.executionStopDate.toUTCString()} or until API rate limit reached.`
    );
    this.db = this.openDb(this.actionRootPath);
    this.startingDate = this.getStartingDate() ?? new Date('2010-01-01');
    reporter.info(`Starting date: ${this.startingDate.toUTCString()}'.`);

    this.progressBars = new bar.ProgressBar();

    LPF.smoothing = 0.5;
    LPF.init(0);
  }

  public async run(): Promise<void> {
    this.reporter.debug(`run()<< ${new Date().toUTCString()}`);
    // tslint:disable-next-line:no-console
    console.time('run():');
    let startDate = this.startingDate;

    // If already running, ensure to exit before modifying any local file that would then
    // be committed.
    if (await this.isAlreadyRunning()) {
      this.reporter.info('Already running, exiting...');
      return;
    }

    try {
      const now = new Date();

      // Compute the total time-segments of 'timeRange' days each.
      this.progressBars.init(startDate, this.timeRange);

      let timeSegment = 1;
      let nextDate = DateHelper.addDays(startDate, this.timeRange);

      // Iterate over all time segments.
      while (startDate < now && this.executionStopDate > new Date()) {
        const repoProvider = await this.reposProviderFactory.create(
          this.octokit,
          startDate,
          nextDate,
          this
        );

        const repos: IRepository[] = await this.getRepoList(repoProvider);

        this.progressBars.update(
          startDate,
          nextDate,
          repoProvider.count,
          timeSegment
        );

        const sw = new Stopwatch();
        sw.start();

        await this.iterateTimeSegment(repoProvider, repos, sw);

        // Advance time range.
        timeSegment++;
        startDate = nextDate;
        nextDate = DateHelper.addDays(startDate, this.timeRange);
      }
    } catch (err) {
      if (ApiRateLimit.isRateLimitException(err)) {
        const e = err as ApiLimitsException;
        const currentRemaining =
          e.remaining !== undefined ? '' + e.remaining : '<unknown>';
        const nextQuotaReset = e.nextReset
          ? e.nextReset.toUTCString()
          : '<unknown>';
        this.reporter.warn(
          `${os.EOL}${
            os.EOL
          } API rate limit almost reached at '${currentRemaining}' remaining calls. Storing current starting date: '${startDate.toUTCString()}' in db.` +
            ` Next quota reset on '${nextQuotaReset}'.`
        );
      } else {
        this.reporter.warn('', err as Error);
        throw err;
      }
    } finally {
      // Prologue
      this.reporter.debug('Saving data before exiting...');

      const limits = await this.getRestCurrentLimits();
      this.reporter.debug(JSON.stringify(limits));

      this.reporter.debug(
        `db.push ${GHActionUsage.LastStartTimeName} ${startDate.toUTCString()}`
      );
      this.db.push(
        GHActionUsage.LastStartTimeName,
        `${startDate.toUTCString()}`,
        true
      );
      this.db.save(true);

      // Launching the workflow again at limits.reset time will
      // exhausts again all the API quota. Let's run it at midnight each day.
      // The cron schedule is hardcoded in run.yml.
      // await this.setupCron(this.actionRootPath, limits.reset);

      this.progressBars.stop();
      // tslint:disable-next-line:no-console
      console.timeLog('run()');
      this.reporter.debug(`run()>>`);
    }
  }

  public setRemainingCalls(restApi?: number, searchApi?: number): void {
    this.progressBars.updateApiQuota(restApi, searchApi);
  }

  // Identify the location where the action is checked out by seeking for the run.yml file.
  private getActionPath(): string {
    let actionPath = null;
    this.reporter.debug(`getActionPath()<<`);
    const ds = [
      process.cwd() ?? '',
      GHActionUsage.getWorkspacePath() ?? '',
      `${__dirname + path.sep}..`,
    ];
    for (const d of ds) {
      const wffp = path.join(d, ...GHActionUsage.WorkflowFilePath);
      this.reporter.debug(`checking for '${d}'...`);
      if (fs.existsSync(wffp)) {
        actionPath = d;
        break;
      }
    }
    if (!actionPath) {
      throw new Error(`Cannot identify the action root directory.`);
    }
    this.reporter.debug(`getActionPath()>>'${actionPath}'`);
    return actionPath;
  }

  // Check whether any workflow is already running for this repository.
  private async isAlreadyRunning(): Promise<boolean> {
    if (!github.isRunningOnGitHubRunner()) {
      return false;
    }
    const GITHUB_REPOSITORY = 'GITHUB_REPOSITORY';
    const owner: string | undefined = process.env[GITHUB_REPOSITORY]?.split(
      '/'
    )[0];
    const repo: string | undefined = process.env[GITHUB_REPOSITORY]?.split(
      '/'
    )[1];
    if (!(owner && repo)) {
      throw new Error(
        `The env var GITHUB_REPOSITORY is not defined: '${GITHUB_REPOSITORY}'.`
      );
    }

    try {
      type responseType = ok.RestEndpointMethodTypes['actions']['listWorkflowRunsForRepo']['response'];
      const response: responseType = await this.octokit.rest.actions.listWorkflowRunsForRepo(
        {
          owner,
          repo,
        }
      );
      type workflowRunType = Array<components['schemas']['workflow-run']>;
      const wfs: workflowRunType = response.data.workflow_runs;
      const runningWf = wfs.filter(
        wf => wf.status === 'in_progress' || wf.status === 'queued'
      );

      return runningWf.length > 1;
    } catch (err) {
      this.reporter.error(
        `Cannot determine if already running: ${JSON.stringify(err)}`
      );
      this.reporter.error(
        `Pretending to be running already to exit immediately and avoid potential refused 'git push'.`
      );
      return true;
    }
  }

  private openDb(rootPath: string): JsonDB {
    let db: JsonDB;
    const dbPath = path.join(rootPath, 'graph', GHActionUsage.UsageDbFileName);
    try {
      this.reporter.debug(`Opening DB at '${dbPath}'....`);
      db = new JsonDB(new Config(dbPath, true, true, '/'));
      db.getData(GHActionUsage.LastStartTimeName);
      this.reporter.debug(`DB opened at '${dbPath}'.`);
    } catch (err) {
      this.reporter.warn((err as Error)?.message);
      fs.unlinkSync(dbPath);
      db = new JsonDB(new Config(dbPath, true, true, '/'));
      this.reporter.info(`DB at '${dbPath}' re-opened successfully.`);
    }

    return db;
  }

  // @ts-ignore: Unreachable code error
  private async setupCron(rootPath: string, date: Date): Promise<void> {
    try {
      // Read content of workflow file.
      const filePath = path.join(rootPath, ...GHActionUsage.WorkflowFilePath);
      const content = fs.readFileSync(filePath, {
        encoding: 'utf8',
        flag: 'r',
      });

      // Patch the next execution
      const nextCronSchedule = `'${toCronSchedule(date)}'`;
      const lines = content.split(os.EOL);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('0 * * * *') !== -1) {
          const oldCron = '- cron: ';
          const offset = lines[i + 1].indexOf(oldCron);
          lines[i + 1] =
            lines[i + 1].substring(0, offset + oldCron.length) +
            nextCronSchedule;
          this.reporter.debug(`next cron schedule set to '${lines[i + 1]}'`);
          break;
        }
      }

      const patchedContent = lines.join(os.EOL);
      this.reporter.debug(patchedContent);
      fs.writeFileSync(filePath, patchedContent);
    } catch (err) {
      this.reporter.error(`setupCron() failed: ${err}`);
    }
  }

  private async getRepoList(
    repoProvider: IRepositoriesProvider
  ): Promise<IRepository[]> {
    return repoProvider.getNextRepos();
  }

  private async iterateTimeSegment(
    repoProvider: IRepositoriesProvider,
    repos: IRepository[],
    sw: Stopwatch
  ) {
    try {
      let barCounter = 0;
      while (true) {
        const ps: Array<Promise<void>> = [];
        for (const aRepo of repos) {
          try {
            this.progressBars.updateRepo(barCounter, {
              action: bar.ProgressBar.getActionString(
                `checking repo... '${aRepo.owner}/${aRepo.name}'`
              ),
            });
            const task = new Promise<void>(async (resolve, reject) => {
              let matches: IRepositoryMatch[];
              try {
                matches = await this.checkRepository(
                  aRepo.owner,
                  aRepo.name,
                  '.github/workflows'
                );
              } catch (error) {
                try {
                  ApiRateLimit.checkRestApiLimit(
                    (error as any)?.response?.headers
                  );
                } catch (err) {
                  reject(err);
                  return;
                }
                reject(error);
                return;
              }

              const key = `/${aRepo.owner}/${aRepo.name}`;
              if (matches.length > 0) {
                this.db.push(key, [...matches, aRepo], true);
              } else {
                this.reporter.info(`no hits for key: '${key}'.`);
                // Remove entries that are not using the actions anymore.
                if (this.db.exists(key)) {
                  this.db.delete(key);
                  this.reporter.warn(
                    `removed the repository with key: '${key}'.`
                  );
                }
              }

              barCounter++;
              this.totalRepositoryChecked++;

              const totalTimeMillis = sw.getTime();

              this.progressBars.updateRepo(barCounter, {
                action: bar.ProgressBar.getActionString(
                  `checking repo... '${aRepo.owner}/${aRepo.name}'`
                ),
                speed: `${LPF.next(
                  this.totalRepositoryChecked / (totalTimeMillis / 60000.0)
                ).toFixed(1)} repo/min`.padStart(3, ' '),
              });
              resolve();
            });
            ps.push(task);
          } catch (err) {
            ApiRateLimit.throwIfRateLimitExceeded(err);
          }
        }

        await Promise.all(ps);
        this.progressBars.updateRepo(barCounter, {
          action: bar.ProgressBar.getActionString(`listing repos...`),
        });
        repos = await this.getRepoList(repoProvider);
        if (repos.length === 0) {
          break;
        }
      }
    } catch (err) {
      ApiRateLimit.throwIfRateLimitExceeded(err);
    }
  }

  private async getRestCurrentLimits(): Promise<{
    remaining: number;
    reset: Date;
  }> {
    type response = ok.RestEndpointMethodTypes['rateLimit']['get']['response'];
    const limits: response = await this.octokit.rest.rateLimit.get();
    return {
      remaining: limits.data.resources.core.remaining,
      reset: new Date(limits.data.resources.core.reset * 1000),
    };
  }

  private getStartingDate(): Date | null {
    try {
      const date: string = this.db.getData(GHActionUsage.LastStartTimeName);
      const timestamp = Date.parse(date);
      if (isNaN(timestamp) === false) {
        const startDate: Date = new Date(timestamp);
        // If start date is more recent than _now_, restart over by returning null.
        return startDate < new Date() ? startDate : null;
      }
    } catch (err) {
      this.reporter.warn('', err as Error);
    }
    return null;
  }

  private async checkRepository(
    owner: string,
    repo: string,
    filePath: string
  ): Promise<IRepositoryMatch[]> {
    const matches: IRepositoryMatch[] = [];
    try {
      type t = ok.RestEndpointMethodTypes['repos']['getContent']['response'];
      const data: t = await this.octokit.rest.repos.getContent({
        owner,
        path: filePath,
        repo,
      });
      this.setRemainingCalls(ApiRateLimit.checkRestApiLimit(data.headers));
      const files: IFile[] = data.data as IFile[];
      if (files) {
        type rp = ok.RestEndpointMethodTypes['repos']['get']['response'];
        const repoResponse: rp = await this.octokit.rest.repos.get({
          owner,
          repo,
        });
        this.setRemainingCalls(
          ApiRateLimit.checkRestApiLimit(repoResponse.headers)
        );

        for (const file of files) {
          try {
            if (file.download_url) {
              type resp = ok.RestEndpointMethodTypes['repos']['getContent']['response'];
              const f: resp = await this.octokit.rest.repos.getContent({
                owner,
                path: file.path,
                repo,
              });
              this.setRemainingCalls(ApiRateLimit.checkRestApiLimit(f.headers));
              const fileContent = Buffer.from(
                (f.data as any).content,
                'base64'
              ).toString('utf8');
              const lines = fileContent.split(os.EOL);
              let lineNumber = 0;
              for (const line of lines) {
                lineNumber++;
                const regExp = new RegExp(
                  'lukka/(?<action>(?:get-cmake)|(?:run-cmake)|(?:run-vcpkg))@(?<version>[\\w\\d\\.]+)',
                  'g'
                );
                const matchArray = line.matchAll(regExp);
                for (const match of matchArray) {
                  try {
                    if (match.groups) {
                      const hit = {
                        actionName: match.groups.action,
                        line: lineNumber,
                        url: github.getHtmlUrl(file.url, lineNumber),
                        version: match.groups.version,
                      };
                      this.reporter.warn(
                        `\n Found '${hit.actionName}@${hit.version}' in repo: ${owner}/${repo} ${repoResponse.data.stargazers_count}⭑  ${repoResponse.data.watchers_count}👀`
                      );
                      matches.push(hit);
                    }
                  } catch (err) {
                    ApiRateLimit.throwIfRateLimitExceeded(err);
                    this.reporter.warn(`checkRepository():`, err as Error);
                  }
                }
              }
            }
          } catch (err) {
            ApiRateLimit.throwIfRateLimitExceeded(err);
            this.reporter.warn(`checkRepository():`, err as Error);
          }
        }
      }
    } catch (err) {
      const error = err as any;
      if (error?.status === 404) {
        ApiRateLimit.throwIfRateLimitExceeded(err);
        this.setRemainingCalls(
          ApiRateLimit.checkRestApiLimit(error.response.headers)
        );
      } else {
        ApiRateLimit.throwIfRateLimitExceeded(err);
        this.reporter.warn(`checkRepository():`, err as Error);
      }
    }

    return matches;
  }
}
