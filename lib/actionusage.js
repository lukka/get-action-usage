"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GHActionUsage = void 0;
const fs = require("fs");
const LPF = require("lpf");
const os = require("os");
const path = require("path");
const bar = require("./progressbar");
const github = require("./github");
const apilimits_1 = require("./apilimits");
const JsonDBConfig_1 = require("node-json-db/dist/lib/JsonDBConfig");
const cron_1 = require("./cron");
const datehelper_1 = require("./datehelper");
const node_json_db_1 = require("node-json-db");
const ts_stopwatch_1 = require("ts-stopwatch");
class GHActionUsage {
    constructor(octokit, reposProviderFactory, reporter) {
        var _a;
        this.octokit = octokit;
        this.reposProviderFactory = reposProviderFactory;
        this.reporter = reporter;
        this.timeRange = 60.875 / 2;
        this.totalRepositoryChecked = 0;
        this.executionStopDate = datehelper_1.DateHelper.addMinutes(new Date(), GHActionUsage.InternalTimeoutMinutes);
        reporter.info(`Executing until ${this.executionStopDate.toUTCString()} or until API rate limit reached.`);
        this.db = this.openDb();
        this.startingDate = (_a = this.getStartingDate()) !== null && _a !== void 0 ? _a : new Date('2010-01-01');
        reporter.info(`Starting date: ${this.startingDate.toUTCString()}'.`);
        this.progressBars = new bar.ProgressBar();
        LPF.smoothing = 0.5;
        LPF.init(0);
    }
    static getWorkspacePath() {
        var _a;
        const key = 'GITHUB_WORKSPACE';
        return (_a = process.env[key]) !== null && _a !== void 0 ? _a : null;
    }
    static delay(millis) {
        return __awaiter(this, void 0, void 0, function* () {
            if (github.isRunningOnGitHubRunner()) {
                return new Promise(resolve => setTimeout(resolve, millis));
            }
        });
    }
    run() {
        return __awaiter(this, void 0, void 0, function* () {
            this.reporter.debug(`run()<< ${new Date().toUTCString()}`);
            console.time('run():');
            let startDate = this.startingDate;
            if (yield this.isAlreadyRunning()) {
                this.reporter.info('Already running, exiting...');
                return;
            }
            try {
                const now = new Date();
                this.progressBars.init(startDate, this.timeRange);
                let timeSegment = 1;
                let nextDate = datehelper_1.DateHelper.addDays(startDate, this.timeRange);
                while (startDate < now && this.executionStopDate > new Date()) {
                    const repoProvider = yield this.reposProviderFactory.create(this.octokit, startDate, nextDate, this);
                    const repos = yield this.getRepoList(repoProvider);
                    this.progressBars.update(startDate, nextDate, repoProvider.count, timeSegment);
                    const sw = new ts_stopwatch_1.Stopwatch();
                    sw.start();
                    yield this.iterateTimeSegment(repoProvider, repos, sw);
                    timeSegment++;
                    startDate = nextDate;
                    nextDate = datehelper_1.DateHelper.addDays(startDate, this.timeRange);
                }
            }
            catch (err) {
                if (apilimits_1.ApiRateLimit.isRateLimitException(err)) {
                    const e = err;
                    const currentRemaining = e.remaining !== undefined ? '' + e.remaining : '<unknown>';
                    const nextQuotaReset = e.nextReset
                        ? e.nextReset.toUTCString()
                        : '<unknown>';
                    this.reporter.warn(`${os.EOL}${os.EOL} API rate limit almost reached at '${currentRemaining}' remaining calls. Storing current starting date: '${startDate.toUTCString()}' in db.` +
                        ` Next quota reset on '${nextQuotaReset}'.`);
                }
                else {
                    this.reporter.warn('', err);
                    throw err;
                }
            }
            finally {
                this.reporter.debug('Saving data before exiting...');
                const limits = yield this.getRestCurrentLimits();
                this.reporter.debug(JSON.stringify(limits));
                this.reporter.debug(`db.push ${GHActionUsage.LastStartTimeName} ${startDate.toUTCString()}`);
                this.db.push(GHActionUsage.LastStartTimeName, `${startDate.toUTCString()}`, true);
                this.db.save(true);
                yield this.setupCron(limits.reset);
                this.progressBars.stop();
                console.timeLog('run()');
                this.reporter.debug(`run()>>`);
            }
        });
    }
    setRemainingCalls(restApi, searchApi) {
        this.progressBars.updateApiQuota(restApi, searchApi);
    }
    isAlreadyRunning() {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            if (!github.isRunningOnGitHubRunner()) {
                return false;
            }
            const GITHUB_REPOSITORY = 'GITHUB_REPOSITORY';
            const owner = (_a = process.env[GITHUB_REPOSITORY]) === null || _a === void 0 ? void 0 : _a.split('/')[0];
            const repo = (_b = process.env[GITHUB_REPOSITORY]) === null || _b === void 0 ? void 0 : _b.split('/')[1];
            if (!(owner && repo)) {
                throw new Error(`The env var GITHUB_REPOSITORY is not defined: '${GITHUB_REPOSITORY}'.`);
            }
            try {
                const response = yield this.octokit.rest.actions.listWorkflowRunsForRepo({
                    owner,
                    repo,
                });
                const wfs = response.data.workflow_runs;
                const runningWf = wfs.filter(wf => wf.status === 'in_progress' || wf.status === 'queued');
                return runningWf.length > 1;
            }
            catch (err) {
                this.reporter.error(`Cannot determine if already running: ${JSON.stringify(err)}`);
                this.reporter.error(`Pretending to be running already to exit immediately and avoid potential refused 'git push'.`);
                return true;
            }
        });
    }
    openDb() {
        let db;
        let dbPath = path.join('graph', GHActionUsage.UsageDbFileName);
        try {
            const workDir = GHActionUsage.getWorkspacePath();
            if (workDir) {
                dbPath = path.join(workDir, dbPath);
            }
            this.reporter.debug(`Opening DB at '${dbPath}'....`);
            db = new node_json_db_1.JsonDB(new JsonDBConfig_1.Config(dbPath, true, true, '/'));
            db.getData(GHActionUsage.LastStartTimeName);
            this.reporter.debug(`DB opened at '${dbPath}'.`);
        }
        catch (err) {
            this.reporter.warn(err === null || err === void 0 ? void 0 : err.message);
            fs.unlinkSync(dbPath);
            db = new node_json_db_1.JsonDB(new JsonDBConfig_1.Config(dbPath, true, true, '/'));
            this.reporter.info(`DB at '${dbPath}' re-opened successfully.`);
        }
        return db;
    }
    setupCron(date) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const filePath = path.join((_a = GHActionUsage.getWorkspacePath()) !== null && _a !== void 0 ? _a : '', '.github/workflows', GHActionUsage.WorkflowFileName);
                const content = fs.readFileSync(filePath, {
                    encoding: 'utf8',
                    flag: 'r',
                });
                const nextCronSchedule = `'${(0, cron_1.toCronSchedule)(date)}'`;
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
            }
            catch (err) {
                this.reporter.error(`setupCron() failed: ${err}`);
            }
        });
    }
    getRepoList(repoProvider) {
        return __awaiter(this, void 0, void 0, function* () {
            return repoProvider.getNextRepos();
        });
    }
    iterateTimeSegment(repoProvider, repos, sw) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                let barCounter = 0;
                while (true) {
                    const ps = [];
                    for (const aRepo of repos) {
                        try {
                            this.progressBars.updateRepo(barCounter, {
                                action: bar.ProgressBar.getActionString(`checking repo... '${aRepo.owner}/${aRepo.name}'`),
                            });
                            const task = new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                                var _a;
                                let matches;
                                try {
                                    matches = yield this.checkRepository(aRepo.owner, aRepo.name, '.github/workflows');
                                }
                                catch (error) {
                                    try {
                                        apilimits_1.ApiRateLimit.checkRestApiLimit((_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.headers);
                                    }
                                    catch (err) {
                                        reject(err);
                                        return;
                                    }
                                    reject(error);
                                    return;
                                }
                                const key = `/${aRepo.owner}/${aRepo.name}`;
                                if (matches.length > 0) {
                                    this.db.push(key, [...matches, aRepo], true);
                                }
                                barCounter++;
                                this.totalRepositoryChecked++;
                                const totalTimeMillis = sw.getTime();
                                this.progressBars.updateRepo(barCounter, {
                                    action: bar.ProgressBar.getActionString(`checking repo... '${aRepo.owner}/${aRepo.name}'`),
                                    speed: `${LPF.next(this.totalRepositoryChecked / (totalTimeMillis / 60000.0)).toFixed(1)} repo/min`.padStart(3, ' '),
                                });
                                resolve();
                            }));
                            ps.push(task);
                        }
                        catch (err) {
                            apilimits_1.ApiRateLimit.throwIfRateLimitExceeded(err);
                        }
                    }
                    yield Promise.all(ps);
                    this.progressBars.updateRepo(barCounter, {
                        action: bar.ProgressBar.getActionString(`listing repos...`),
                    });
                    repos = yield this.getRepoList(repoProvider);
                    if (repos.length === 0) {
                        break;
                    }
                }
            }
            catch (err) {
                apilimits_1.ApiRateLimit.throwIfRateLimitExceeded(err);
            }
        });
    }
    getRestCurrentLimits() {
        return __awaiter(this, void 0, void 0, function* () {
            const limits = yield this.octokit.rest.rateLimit.get();
            return {
                remaining: limits.data.resources.core.remaining,
                reset: new Date(limits.data.resources.core.reset * 1000),
            };
        });
    }
    getStartingDate() {
        try {
            const date = this.db.getData(GHActionUsage.LastStartTimeName);
            const timestamp = Date.parse(date);
            if (isNaN(timestamp) === false) {
                const startDate = new Date(timestamp);
                return startDate < new Date() ? startDate : null;
            }
        }
        catch (err) {
            this.reporter.warn('', err);
        }
        return null;
    }
    checkRepository(owner, repo, filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            const matches = [];
            try {
                const data = yield this.octokit.rest.repos.getContent({
                    owner,
                    path: filePath,
                    repo,
                });
                this.setRemainingCalls(apilimits_1.ApiRateLimit.checkRestApiLimit(data.headers));
                const files = data.data;
                if (files) {
                    const repoResponse = yield this.octokit.rest.repos.get({
                        owner,
                        repo,
                    });
                    this.setRemainingCalls(apilimits_1.ApiRateLimit.checkRestApiLimit(repoResponse.headers));
                    for (const file of files) {
                        try {
                            if (file.download_url) {
                                const f = yield this.octokit.rest.repos.getContent({
                                    owner,
                                    path: file.path,
                                    repo,
                                });
                                this.setRemainingCalls(apilimits_1.ApiRateLimit.checkRestApiLimit(f.headers));
                                const fileContent = Buffer.from(f.data.content, 'base64').toString('utf8');
                                const lines = fileContent.split(os.EOL);
                                let lineNumber = 0;
                                for (const line of lines) {
                                    lineNumber++;
                                    const regExp = new RegExp('lukka/(?<action>(?:get-cmake)|(?:run-cmake)|(?:run-vcpkg))@(?<version>[\\w\\d\\.]+)', 'g');
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
                                                this.reporter.info(`\n Found '${hit.actionName}@${hit.version}' in repo: ${owner}/${repo} ${repoResponse.data.stargazers_count}⭑  ${repoResponse.data.watchers_count}👀`);
                                                matches.push(hit);
                                            }
                                        }
                                        catch (err) {
                                            apilimits_1.ApiRateLimit.throwIfRateLimitExceeded(err);
                                            this.reporter.warn(`checkRepository():`, err);
                                        }
                                    }
                                }
                            }
                        }
                        catch (err) {
                            apilimits_1.ApiRateLimit.throwIfRateLimitExceeded(err);
                            this.reporter.warn(`checkRepository():`, err);
                        }
                    }
                }
            }
            catch (err) {
                const error = err;
                if ((error === null || error === void 0 ? void 0 : error.status) === 404) {
                    apilimits_1.ApiRateLimit.throwIfRateLimitExceeded(err);
                    this.setRemainingCalls(apilimits_1.ApiRateLimit.checkRestApiLimit(error.response.headers));
                }
                else {
                    apilimits_1.ApiRateLimit.throwIfRateLimitExceeded(err);
                    this.reporter.warn(`checkRepository():`, err);
                }
            }
            return matches;
        });
    }
}
exports.GHActionUsage = GHActionUsage;
GHActionUsage.LastStartTimeName = '/LastStartTimeName/';
GHActionUsage.UsageDbFileName = 'action-usage-db.json';
GHActionUsage.WorkflowFileName = 'run.yml';
GHActionUsage.InternalTimeoutMinutes = 5 * 60;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWN0aW9udXNhZ2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvYWN0aW9udXNhZ2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBS0EseUJBQXlCO0FBQ3pCLDJCQUEyQjtBQUMzQix5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLHFDQUFxQztBQUNyQyxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBRzNDLHFFQUE0RDtBQUM1RCxpQ0FBd0M7QUFDeEMsNkNBQTBDO0FBUzFDLCtDQUFzQztBQUN0QywrQ0FBeUM7QUFFekMsTUFBYSxhQUFhO0lBNkJ4QixZQUNtQixPQUFtQixFQUNuQixvQkFBa0QsRUFDbEQsUUFBbUI7O1FBRm5CLFlBQU8sR0FBUCxPQUFPLENBQVk7UUFDbkIseUJBQW9CLEdBQXBCLG9CQUFvQixDQUE4QjtRQUNsRCxhQUFRLEdBQVIsUUFBUSxDQUFXO1FBVHJCLGNBQVMsR0FBVyxNQUFNLEdBQUcsQ0FBQyxDQUFDO1FBSXhDLDJCQUFzQixHQUFXLENBQUMsQ0FBQztRQU96QyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsdUJBQVUsQ0FBQyxVQUFVLENBQzVDLElBQUksSUFBSSxFQUFFLEVBQ1YsYUFBYSxDQUFDLHNCQUFzQixDQUNyQyxDQUFDO1FBQ0YsUUFBUSxDQUFDLElBQUksQ0FDWCxtQkFBbUIsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxtQ0FBbUMsQ0FDM0YsQ0FBQztRQUNGLElBQUksQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ3hCLElBQUksQ0FBQyxZQUFZLEdBQUcsTUFBQSxJQUFJLENBQUMsZUFBZSxFQUFFLG1DQUFJLElBQUksSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ3JFLFFBQVEsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLElBQUksQ0FBQyxZQUFZLENBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBRXJFLElBQUksQ0FBQyxZ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LENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLENBQUM7NEJBQzNDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLEdBQVksQ0FBQyxDQUFDO3lCQUN4RDtxQkFDRjtpQkFDRjthQUNGO1lBQUMsT0FBTyxHQUFHLEVBQUU7Z0JBQ1osTUFBTSxLQUFLLEdBQUcsR0FBVSxDQUFDO2dCQUN6QixJQUFJLENBQUEsS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLE1BQU0sTUFBSyxHQUFHLEVBQUU7b0JBQ3pCLHdCQUFZLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLENBQUM7b0JBQzNDLElBQUksQ0FBQyxpQkFBaUIsQ0FDcEIsd0JBQVksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUN2RCxDQUFDO2lCQUNIO3FCQUFNO29CQUNMLHdCQUFZLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLENBQUM7b0JBQzNDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLEdBQVksQ0FBQyxDQUFDO2lCQUN4RDthQUNGO1lBRUQsT0FBTyxPQUFPLENBQUM7UUFDakIsQ0FBQztLQUFBOztBQW5jSCxzQ0FvY0M7QUFuY3lCLCtCQUFpQixHQUFXLHFCQUFxQixDQUFDO0FBQ2xELDZCQUFlLEdBQUcsc0JBQXNCLENBQUM7QUFDekMsOEJBQWdCLEdBQUcsU0FBUyxDQUFDO0FBRzdCLG9DQUFzQixHQUFHLENBQUMsR0FBRyxFQUFFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgwqkgMjAyMiBieSBMdWNhIENhcHBhIGxjYXBwYUBnbWFpbC5jb21cbi8vIEFsbCBjb250ZW50IG9mIHRoaXMgcmVwb3NpdG9yeSBpcyBsaWNlbnNlZCB1bmRlciB0aGUgQ0MgQlktU0EgTGljZW5zZS5cbi8vIFNlZSB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IGZvciBsaWNlbnNlIGluZm9ybWF0aW9uLlxuXG5pbXBvcnQgKiBhcyBvayBmcm9tICdAb2N0b2tpdC9yZXN0JztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcbmltcG9ydCAqIGFzIExQRiBmcm9tICdscGYnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnb3MnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIGJhciBmcm9tICcuL3Byb2dyZXNzYmFyJztcbmltcG9ydCAqIGFzIGdpdGh1YiBmcm9tICcuL2dpdGh1Yic7XG5cbmltcG9ydCB7IEFwaVJhdGVMaW1pdCB9IGZyb20gJy4vYXBpbGltaXRzJztcbmltcG9ydCB7IEFwaUxpbWl0c0V4Y2VwdGlvbiB9IGZyb20gJy4vYXBpbGltaXRzZXhjZXB0aW9uJztcbmltcG9ydCB7IGNvbXBvbmVudHMgfSBmcm9tICdAb2N0b2tpdC9vcGVuYXBpLXR5cGVzJztcbmltcG9ydCB7IENvbmZpZyB9IGZyb20gJ25vZGUtanNvbi1kYi9kaXN0L2xpYi9Kc29uREJDb25maWcnO1xuaW1wb3J0IHsgdG9Dcm9uU2NoZWR1bGUgfSBmcm9tICcuL2Nyb24nO1xuaW1wb3J0IHsgRGF0ZUhlbHBlciB9IGZyb20gJy4vZGF0ZWhlbHBlcic7XG5pbXBvcnQge1xuICBJRmlsZSxcbiAgSVJlcG9zaXRvcnksXG4gIElSZXBvc2l0b3JpZXNQcm92aWRlcixcbiAgSVJlcG9zaXRvcmllc1Byb3ZpZGVyRmFjdG9yeSxcbiAgSVJlcG9zaXRvcnlNYXRjaCxcbiAgSVJlcG9ydGVyLFxufSBmcm9tICcuL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgSnNvbkRCIH0gZnJvbSAnbm9kZS1qc29uLWRiJztcbmltcG9ydCB7IFN0b3B3YXRjaCB9IGZyb20gJ3RzLXN0b3B3YXRjaCc7XG5cbmV4cG9ydCBjbGFzcyBHSEFjdGlvblVzYWdlIHtcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgTGFzdFN0YXJ0VGltZU5hbWU6IHN0cmluZyA9ICcvTGFzdFN0YXJ0VGltZU5hbWUvJztcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgVXNhZ2VEYkZpbGVOYW1lID0gJ2FjdGlvbi11c2FnZS1kYi5qc29uJztcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgV29ya2Zsb3dGaWxlTmFtZSA9ICdydW4ueW1sJztcbiAgLy8gVGVybWluYXRlIHRoZSBleGVjdXRpb24gYWZ0ZXIgdGhpcyB0aW1lb3V0IHRvIHByZXZlbnQgZm9yY2VkIGNhbmNlbGxhdGlvblxuICAvLyBvbiB0aGUgcnVubmVyIChzaXggaG91cnMpXG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IEludGVybmFsVGltZW91dE1pbnV0ZXMgPSA1ICogNjA7XG5cbiAgcHJpdmF0ZSBzdGF0aWMgZ2V0V29ya3NwYWNlUGF0aCgpOiBzdHJpbmcgfCBudWxsIHtcbiAgICBjb25zdCBrZXkgPSAnR0lUSFVCX1dPUktTUEFDRSc7XG4gICAgcmV0dXJuIHByb2Nlc3MuZW52W2tleV0gPz8gbnVsbDtcbiAgfVxuXG4gIC8vIEB0cy1pZ25vcmVcbiAgcHJpdmF0ZSBzdGF0aWMgYXN5bmMgZGVsYXkobWlsbGlzOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoZ2l0aHViLmlzUnVubmluZ09uR2l0SHViUnVubmVyKCkpIHtcbiAgICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgbWlsbGlzKSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSByZWFkb25seSBkYjogSnNvbkRCO1xuICBwcml2YXRlIHJlYWRvbmx5IHByb2dyZXNzQmFyczogYmFyLlByb2dyZXNzQmFyO1xuICAvLyBEYXlzIG9mIGVhY2ggdGltZSBzZWdtZW50LlxuICBwcml2YXRlIHJlYWRvbmx5IHRpbWVSYW5nZTogbnVtYmVyID0gNjAuODc1IC8gMjtcbiAgLy8gU3RhcnRpbmcgZGF0ZSBvZiB0aGUgdGltZSBzZWdtZW50cy5cbiAgcHJpdmF0ZSByZWFkb25seSBzdGFydGluZ0RhdGU6IERhdGU7XG4gIHByaXZhdGUgcmVhZG9ubHkgZXhlY3V0aW9uU3RvcERhdGU6IERhdGU7XG4gIHByaXZhdGUgdG90YWxSZXBvc2l0b3J5Q2hlY2tlZDogbnVtYmVyID0gMDtcblxuICBwdWJsaWMgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBvY3Rva2l0OiBvay5PY3Rva2l0LFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcmVwb3NQcm92aWRlckZhY3Rvcnk6IElSZXBvc2l0b3JpZXNQcm92aWRlckZhY3RvcnksXG4gICAgcHJpdmF0ZSByZWFkb25seSByZXBvcnRlcjogSVJlcG9ydGVyXG4gICkge1xuICAgIHRoaXMuZXhlY3V0aW9uU3RvcERhdGUgPSBEYXRlSGVscGVyLmFkZE1pbnV0ZXMoXG4gICAgICBuZXcgRGF0ZSgpLFxuICAgICAgR0hBY3Rpb25Vc2FnZS5JbnRlcm5hbFRpbWVvdXRNaW51dGVzXG4gICAgKTtcbiAgICByZXBvcnRlci5pbmZvKFxuICAgICAgYEV4ZWN1dGluZyB1bnRpbCAke3RoaXMuZXhlY3V0aW9uU3RvcERhdGUudG9VVENTdHJpbmcoKX0gb3IgdW50aWwgQVBJIHJhdGUgbGltaXQgcmVhY2hlZC5gXG4gICAgKTtcbiAgICB0aGlzLmRiID0gdGhpcy5vcGVuRGIoKTtcbiAgICB0aGlzLnN0YXJ0aW5nRGF0ZSA9IHRoaXMuZ2V0U3RhcnRpbmdEYXRlKCkgPz8gbmV3IERhdGUoJzIwMTAtMDEtMDEnKTtcbiAgICByZXBvcnRlci5pbmZvKGBTdGFydGluZyBkYXRlOiAke3RoaXMuc3RhcnRpbmdEYXRlLnRvVVRDU3RyaW5nKCl9Jy5gKTtcblxuICAgIHRoaXMucHJvZ3Jlc3NCYXJzID0gbmV3IGJhci5Qcm9ncmVzc0JhcigpO1xuXG4gICAgTFBGLnNtb290aGluZyA9IDAuNTtcbiAgICBMUEYuaW5pdCgwKTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBydW4oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhgcnVuKCk8PCAke25ldyBEYXRlKCkudG9VVENTdHJpbmcoKX1gKTtcbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tY29uc29sZVxuICAgIGNvbnNvbGUudGltZSgncnVuKCk6Jyk7XG4gICAgbGV0IHN0YXJ0RGF0ZSA9IHRoaXMuc3RhcnRpbmdEYXRlO1xuXG4gICAgLy8gSWYgYWxyZWFkeSBydW5uaW5nLCBlbnN1cmUgdG8gZXhpdCBiZWZvcmUgbW9kaWZ5aW5nIGFueSBsb2NhbCBmaWxlIHRoYXQgd291bGQgdGhlblxuICAgIC8vIGJlIGNvbW1pdHRlZC5cbiAgICBpZiAoYXdhaXQgdGhpcy5pc0FscmVhZHlSdW5uaW5nKCkpIHtcbiAgICAgIHRoaXMucmVwb3J0ZXIuaW5mbygnQWxyZWFkeSBydW5uaW5nLCBleGl0aW5nLi4uJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG5cbiAgICAgIC8vIENvbXB1dGUgdGhlIHRvdGFsIHRpbWUtc2VnbWVudHMgb2YgJ3RpbWVSYW5nZScgZGF5cyBlYWNoLlxuICAgICAgdGhpcy5wcm9ncmVzc0JhcnMuaW5pdChzdGFydERhdGUsIHRoaXMudGltZVJhbmdlKTtcblxuICAgICAgbGV0IHRpbWVTZWdtZW50ID0gMTtcbiAgICAgIGxldCBuZXh0RGF0ZSA9IERhdGVIZWxwZXIuYWRkRGF5cyhzdGFydERhdGUsIHRoaXMudGltZVJhbmdlKTtcblxuICAgICAgLy8gSXRlcmF0ZSBvdmVyIGFsbCB0aW1lIHNlZ21lbnRzLlxuICAgICAgd2hpbGUgKHN0YXJ0RGF0ZSA8IG5vdyAmJiB0aGlzLmV4ZWN1dGlvblN0b3BEYXRlID4gbmV3IERhdGUoKSkge1xuICAgICAgICBjb25zdCByZXBvUHJvdmlkZXIgPSBhd2FpdCB0aGlzLnJlcG9zUHJvdmlkZXJGYWN0b3J5LmNyZWF0ZShcbiAgICAgICAgICB0aGlzLm9jdG9raXQsXG4gICAgICAgICAgc3RhcnREYXRlLFxuICAgICAgICAgIG5leHREYXRlLFxuICAgICAgICAgIHRoaXNcbiAgICAgICAgKTtcblxuICAgICAgICBjb25zdCByZXBvczogSVJlcG9zaXRvcnlbXSA9IGF3YWl0IHRoaXMuZ2V0UmVwb0xpc3QocmVwb1Byb3ZpZGVyKTtcblxuICAgICAgICB0aGlzLnByb2dyZXNzQmFycy51cGRhdGUoXG4gICAgICAgICAgc3RhcnREYXRlLFxuICAgICAgICAgIG5leHREYXRlLFxuICAgICAgICAgIHJlcG9Qcm92aWRlci5jb3VudCxcbiAgICAgICAgICB0aW1lU2VnbWVudFxuICAgICAgICApO1xuXG4gICAgICAgIGNvbnN0IHN3ID0gbmV3IFN0b3B3YXRjaCgpO1xuICAgICAgICBzdy5zdGFydCgpO1xuXG4gICAgICAgIGF3YWl0IHRoaXMuaXRlcmF0ZVRpbWVTZWdtZW50KHJlcG9Qcm92aWRlciwgcmVwb3MsIHN3KTtcblxuICAgICAgICAvLyBBZHZhbmNlIHRpbWUgcmFuZ2UuXG4gICAgICAgIHRpbWVTZWdtZW50Kys7XG4gICAgICAgIHN0YXJ0RGF0ZSA9IG5leHREYXRlO1xuICAgICAgICBuZXh0RGF0ZSA9IERhdGVIZWxwZXIuYWRkRGF5cyhzdGFydERhdGUsIHRoaXMudGltZVJhbmdlKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChBcGlSYXRlTGltaXQuaXNSYXRlTGltaXRFeGNlcHRpb24oZXJyKSkge1xuICAgICAgICBjb25zdCBlID0gZXJyIGFzIEFwaUxpbWl0c0V4Y2VwdGlvbjtcbiAgICAgICAgY29uc3QgY3VycmVudFJlbWFpbmluZyA9XG4gICAgICAgICAgZS5yZW1haW5pbmcgIT09IHVuZGVmaW5lZCA/ICcnICsgZS5yZW1haW5pbmcgOiAnPHVua25vd24+JztcbiAgICAgICAgY29uc3QgbmV4dFF1b3RhUmVzZXQgPSBlLm5leHRSZXNldFxuICAgICAgICAgID8gZS5uZXh0UmVzZXQudG9VVENTdHJpbmcoKVxuICAgICAgICAgIDogJzx1bmtub3duPic7XG4gICAgICAgIHRoaXMucmVwb3J0ZXIud2FybihcbiAgICAgICAgICBgJHtvcy5FT0x9JHtcbiAgICAgICAgICAgIG9zLkVPTFxuICAgICAgICAgIH0gQVBJIHJhdGUgbGltaXQgYWxtb3N0IHJlYWNoZWQgYXQgJyR7Y3VycmVudFJlbWFpbmluZ30nIHJlbWFpbmluZyBjYWxscy4gU3RvcmluZyBjdXJyZW50IHN0YXJ0aW5nIGRhdGU6ICcke3N0YXJ0RGF0ZS50b1VUQ1N0cmluZygpfScgaW4gZGIuYCArXG4gICAgICAgICAgICBgIE5leHQgcXVvdGEgcmVzZXQgb24gJyR7bmV4dFF1b3RhUmVzZXR9Jy5gXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnJlcG9ydGVyLndhcm4oJycsIGVyciBhcyBFcnJvcik7XG4gICAgICAgIHRocm93IGVycjtcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgLy8gUHJvbG9ndWVcbiAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoJ1NhdmluZyBkYXRhIGJlZm9yZSBleGl0aW5nLi4uJyk7XG5cbiAgICAgIGNvbnN0IGxpbWl0cyA9IGF3YWl0IHRoaXMuZ2V0UmVzdEN1cnJlbnRMaW1pdHMoKTtcbiAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoSlNPTi5zdHJpbmdpZnkobGltaXRzKSk7XG5cbiAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoXG4gICAgICAgIGBkYi5wdXNoICR7R0hBY3Rpb25Vc2FnZS5MYXN0U3RhcnRUaW1lTmFtZX0gJHtzdGFydERhdGUudG9VVENTdHJpbmcoKX1gXG4gICAgICApO1xuICAgICAgdGhpcy5kYi5wdXNoKFxuICAgICAgICBHSEFjdGlvblVzYWdlLkxhc3RTdGFydFRpbWVOYW1lLFxuICAgICAgICBgJHtzdGFydERhdGUudG9VVENTdHJpbmcoKX1gLFxuICAgICAgICB0cnVlXG4gICAgICApO1xuICAgICAgdGhpcy5kYi5zYXZlKHRydWUpO1xuXG4gICAgICBhd2FpdCB0aGlzLnNldHVwQ3JvbihsaW1pdHMucmVzZXQpO1xuXG4gICAgICB0aGlzLnByb2dyZXNzQmFycy5zdG9wKCk7XG4gICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tY29uc29sZVxuICAgICAgY29uc29sZS50aW1lTG9nKCdydW4oKScpO1xuICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhgcnVuKCk+PmApO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBzZXRSZW1haW5pbmdDYWxscyhyZXN0QXBpPzogbnVtYmVyLCBzZWFyY2hBcGk/OiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLnByb2dyZXNzQmFycy51cGRhdGVBcGlRdW90YShyZXN0QXBpLCBzZWFyY2hBcGkpO1xuICB9XG5cbiAgLy8gQ2hlY2sgd2hldGhlciBhbnkgd29ya2Zsb3cgaXMgYWxyZWFkeSBydW5uaW5nIGZvciB0aGlzIHJlcG9zaXRvcnkuXG4gIHByaXZhdGUgYXN5bmMgaXNBbHJlYWR5UnVubmluZygpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAoIWdpdGh1Yi5pc1J1bm5pbmdPbkdpdEh1YlJ1bm5lcigpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGNvbnN0IEdJVEhVQl9SRVBPU0lUT1JZID0gJ0dJVEhVQl9SRVBPU0lUT1JZJztcbiAgICBjb25zdCBvd25lcjogc3RyaW5nIHwgdW5kZWZpbmVkID0gcHJvY2Vzcy5lbnZbR0lUSFVCX1JFUE9TSVRPUlldPy5zcGxpdChcbiAgICAgICcvJ1xuICAgIClbMF07XG4gICAgY29uc3QgcmVwbzogc3RyaW5nIHwgdW5kZWZpbmVkID0gcHJvY2Vzcy5lbnZbR0lUSFVCX1JFUE9TSVRPUlldPy5zcGxpdChcbiAgICAgICcvJ1xuICAgIClbMV07XG4gICAgaWYgKCEob3duZXIgJiYgcmVwbykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYFRoZSBlbnYgdmFyIEdJVEhVQl9SRVBPU0lUT1JZIGlzIG5vdCBkZWZpbmVkOiAnJHtHSVRIVUJfUkVQT1NJVE9SWX0nLmBcbiAgICAgICk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIHR5cGUgcmVzcG9uc2VUeXBlID0gb2suUmVzdEVuZHBvaW50TWV0aG9kVHlwZXNbJ2FjdGlvbnMnXVsnbGlzdFdvcmtmbG93UnVuc0ZvclJlcG8nXVsncmVzcG9uc2UnXTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlOiByZXNwb25zZVR5cGUgPSBhd2FpdCB0aGlzLm9jdG9raXQucmVzdC5hY3Rpb25zLmxpc3RXb3JrZmxvd1J1bnNGb3JSZXBvKFxuICAgICAgICB7XG4gICAgICAgICAgb3duZXIsXG4gICAgICAgICAgcmVwbyxcbiAgICAgICAgfVxuICAgICAgKTtcbiAgICAgIHR5cGUgd29ya2Zsb3dSdW5UeXBlID0gQXJyYXk8Y29tcG9uZW50c1snc2NoZW1hcyddWyd3b3JrZmxvdy1ydW4nXT47XG4gICAgICBjb25zdCB3ZnM6IHdvcmtmbG93UnVuVHlwZSA9IHJlc3BvbnNlLmRhdGEud29ya2Zsb3dfcnVucztcbiAgICAgIGNvbnN0IHJ1bm5pbmdXZiA9IHdmcy5maWx0ZXIoXG4gICAgICAgIHdmID0+IHdmLnN0YXR1cyA9PT0gJ2luX3Byb2dyZXNzJyB8fCB3Zi5zdGF0dXMgPT09ICdxdWV1ZWQnXG4gICAgICApO1xuXG4gICAgICByZXR1cm4gcnVubmluZ1dmLmxlbmd0aCA+IDE7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnJlcG9ydGVyLmVycm9yKFxuICAgICAgICBgQ2Fubm90IGRldGVybWluZSBpZiBhbHJlYWR5IHJ1bm5pbmc6ICR7SlNPTi5zdHJpbmdpZnkoZXJyKX1gXG4gICAgICApO1xuICAgICAgdGhpcy5yZXBvcnRlci5lcnJvcihcbiAgICAgICAgYFByZXRlbmRpbmcgdG8gYmUgcnVubmluZyBhbHJlYWR5IHRvIGV4aXQgaW1tZWRpYXRlbHkgYW5kIGF2b2lkIHBvdGVudGlhbCByZWZ1c2VkICdnaXQgcHVzaCcuYFxuICAgICAgKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgb3BlbkRiKCk6IEpzb25EQiB7XG4gICAgbGV0IGRiOiBKc29uREI7XG4gICAgbGV0IGRiUGF0aCA9IHBhdGguam9pbignZ3JhcGgnLCBHSEFjdGlvblVzYWdlLlVzYWdlRGJGaWxlTmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHdvcmtEaXIgPSBHSEFjdGlvblVzYWdlLmdldFdvcmtzcGFjZVBhdGgoKTtcbiAgICAgIGlmICh3b3JrRGlyKSB7XG4gICAgICAgIGRiUGF0aCA9IHBhdGguam9pbih3b3JrRGlyLCBkYlBhdGgpO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKGBPcGVuaW5nIERCIGF0ICcke2RiUGF0aH0nLi4uLmApO1xuICAgICAgZGIgPSBuZXcgSnNvbkRCKG5ldyBDb25maWcoZGJQYXRoLCB0cnVlLCB0cnVlLCAnLycpKTtcbiAgICAgIGRiLmdldERhdGEoR0hBY3Rpb25Vc2FnZS5MYXN0U3RhcnRUaW1lTmFtZSk7XG4gICAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKGBEQiBvcGVuZWQgYXQgJyR7ZGJQYXRofScuYCk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnJlcG9ydGVyLndhcm4oKGVyciBhcyBFcnJvcik/Lm1lc3NhZ2UpO1xuICAgICAgZnMudW5saW5rU3luYyhkYlBhdGgpO1xuICAgICAgZGIgPSBuZXcgSnNvbkRCKG5ldyBDb25maWcoZGJQYXRoLCB0cnVlLCB0cnVlLCAnLycpKTtcbiAgICAgIHRoaXMucmVwb3J0ZXIuaW5mbyhgREIgYXQgJyR7ZGJQYXRofScgcmUtb3BlbmVkIHN1Y2Nlc3NmdWxseS5gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZGI7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNldHVwQ3JvbihkYXRlOiBEYXRlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFJlYWQgY29udGVudCBvZiB3b3JrZmxvdyBmaWxlLlxuICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4oXG4gICAgICAgIEdIQWN0aW9uVXNhZ2UuZ2V0V29ya3NwYWNlUGF0aCgpID8/ICcnLFxuICAgICAgICAnLmdpdGh1Yi93b3JrZmxvd3MnLFxuICAgICAgICBHSEFjdGlvblVzYWdlLldvcmtmbG93RmlsZU5hbWVcbiAgICAgICk7XG4gICAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCB7XG4gICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgIGZsYWc6ICdyJyxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBQYXRjaCB0aGUgbmV4dCBleGVjdXRpb25cbiAgICAgIGNvbnN0IG5leHRDcm9uU2NoZWR1bGUgPSBgJyR7dG9Dcm9uU2NoZWR1bGUoZGF0ZSl9J2A7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQob3MuRU9MKTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKGxpbmVzW2ldLmluZGV4T2YoJzAgKiAqICogKicpICE9PSAtMSkge1xuICAgICAgICAgIGNvbnN0IG9sZENyb24gPSAnLSBjcm9uOiAnO1xuICAgICAgICAgIGNvbnN0IG9mZnNldCA9IGxpbmVzW2kgKyAxXS5pbmRleE9mKG9sZENyb24pO1xuICAgICAgICAgIGxpbmVzW2kgKyAxXSA9XG4gICAgICAgICAgICBsaW5lc1tpICsgMV0uc3Vic3RyaW5nKDAsIG9mZnNldCArIG9sZENyb24ubGVuZ3RoKSArXG4gICAgICAgICAgICBuZXh0Q3JvblNjaGVkdWxlO1xuICAgICAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoYG5leHQgY3JvbiBzY2hlZHVsZSBzZXQgdG8gJyR7bGluZXNbaSArIDFdfSdgKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXRjaGVkQ29udGVudCA9IGxpbmVzLmpvaW4ob3MuRU9MKTtcbiAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcocGF0Y2hlZENvbnRlbnQpO1xuICAgICAgZnMud3JpdGVGaWxlU3luYyhmaWxlUGF0aCwgcGF0Y2hlZENvbnRlbnQpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhpcy5yZXBvcnRlci5lcnJvcihgc2V0dXBDcm9uKCkgZmFpbGVkOiAke2Vycn1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldFJlcG9MaXN0KFxuICAgIHJlcG9Qcm92aWRlcjogSVJlcG9zaXRvcmllc1Byb3ZpZGVyXG4gICk6IFByb21pc2U8SVJlcG9zaXRvcnlbXT4ge1xuICAgIHJldHVybiByZXBvUHJvdmlkZXIuZ2V0TmV4dFJlcG9zKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGl0ZXJhdGVUaW1lU2VnbWVudChcbiAgICByZXBvUHJvdmlkZXI6IElSZXBvc2l0b3JpZXNQcm92aWRlcixcbiAgICByZXBvczogSVJlcG9zaXRvcnlbXSxcbiAgICBzdzogU3RvcHdhdGNoXG4gICkge1xuICAgIHRyeSB7XG4gICAgICBsZXQgYmFyQ291bnRlciA9IDA7XG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBjb25zdCBwczogQXJyYXk8UHJvbWlzZTx2b2lkPj4gPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBhUmVwbyBvZiByZXBvcykge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0aGlzLnByb2dyZXNzQmFycy51cGRhdGVSZXBvKGJhckNvdW50ZXIsIHtcbiAgICAgICAgICAgICAgYWN0aW9uOiBiYXIuUHJvZ3Jlc3NCYXIuZ2V0QWN0aW9uU3RyaW5nKFxuICAgICAgICAgICAgICAgIGBjaGVja2luZyByZXBvLi4uICcke2FSZXBvLm93bmVyfS8ke2FSZXBvLm5hbWV9J2BcbiAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgY29uc3QgdGFzayA9IG5ldyBQcm9taXNlPHZvaWQ+KGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgICAgbGV0IG1hdGNoZXM6IElSZXBvc2l0b3J5TWF0Y2hbXTtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBtYXRjaGVzID0gYXdhaXQgdGhpcy5jaGVja1JlcG9zaXRvcnkoXG4gICAgICAgICAgICAgICAgICBhUmVwby5vd25lcixcbiAgICAgICAgICAgICAgICAgIGFSZXBvLm5hbWUsXG4gICAgICAgICAgICAgICAgICAnLmdpdGh1Yi93b3JrZmxvd3MnXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgQXBpUmF0ZUxpbWl0LmNoZWNrUmVzdEFwaUxpbWl0KFxuICAgICAgICAgICAgICAgICAgICAoZXJyb3IgYXMgYW55KT8ucmVzcG9uc2U/LmhlYWRlcnNcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjb25zdCBrZXkgPSBgLyR7YVJlcG8ub3duZXJ9LyR7YVJlcG8ubmFtZX1gO1xuICAgICAgICAgICAgICBpZiAobWF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5kYi5wdXNoKGtleSwgWy4uLm1hdGNoZXMsIGFSZXBvXSwgdHJ1ZSk7XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBiYXJDb3VudGVyKys7XG4gICAgICAgICAgICAgIHRoaXMudG90YWxSZXBvc2l0b3J5Q2hlY2tlZCsrO1xuXG4gICAgICAgICAgICAgIGNvbnN0IHRvdGFsVGltZU1pbGxpcyA9IHN3LmdldFRpbWUoKTtcblxuICAgICAgICAgICAgICB0aGlzLnByb2dyZXNzQmFycy51cGRhdGVSZXBvKGJhckNvdW50ZXIsIHtcbiAgICAgICAgICAgICAgICBhY3Rpb246IGJhci5Qcm9ncmVzc0Jhci5nZXRBY3Rpb25TdHJpbmcoXG4gICAgICAgICAgICAgICAgICBgY2hlY2tpbmcgcmVwby4uLiAnJHthUmVwby5vd25lcn0vJHthUmVwby5uYW1lfSdgXG4gICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICAgICBzcGVlZDogYCR7TFBGLm5leHQoXG4gICAgICAgICAgICAgICAgICB0aGlzLnRvdGFsUmVwb3NpdG9yeUNoZWNrZWQgLyAodG90YWxUaW1lTWlsbGlzIC8gNjAwMDAuMClcbiAgICAgICAgICAgICAgICApLnRvRml4ZWQoMSl9IHJlcG8vbWluYC5wYWRTdGFydCgzLCAnICcpLFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBwcy5wdXNoKHRhc2spO1xuICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgQXBpUmF0ZUxpbWl0LnRocm93SWZSYXRlTGltaXRFeGNlZWRlZChlcnIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHBzKTtcbiAgICAgICAgdGhpcy5wcm9ncmVzc0JhcnMudXBkYXRlUmVwbyhiYXJDb3VudGVyLCB7XG4gICAgICAgICAgYWN0aW9uOiBiYXIuUHJvZ3Jlc3NCYXIuZ2V0QWN0aW9uU3RyaW5nKGBsaXN0aW5nIHJlcG9zLi4uYCksXG4gICAgICAgIH0pO1xuICAgICAgICByZXBvcyA9IGF3YWl0IHRoaXMuZ2V0UmVwb0xpc3QocmVwb1Byb3ZpZGVyKTtcbiAgICAgICAgaWYgKHJlcG9zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBBcGlSYXRlTGltaXQudGhyb3dJZlJhdGVMaW1pdEV4Y2VlZGVkKGVycik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZXRSZXN0Q3VycmVudExpbWl0cygpOiBQcm9taXNlPHtcbiAgICByZW1haW5pbmc6IG51bWJlcjtcbiAgICByZXNldDogRGF0ZTtcbiAgfT4ge1xuICAgIHR5cGUgcmVzcG9uc2UgPSBvay5SZXN0RW5kcG9pbnRNZXRob2RUeXBlc1sncmF0ZUxpbWl0J11bJ2dldCddWydyZXNwb25zZSddO1xuICAgIGNvbnN0IGxpbWl0czogcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm9jdG9raXQucmVzdC5yYXRlTGltaXQuZ2V0KCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlbWFpbmluZzogbGltaXRzLmRhdGEucmVzb3VyY2VzLmNvcmUucmVtYWluaW5nLFxuICAgICAgcmVzZXQ6IG5ldyBEYXRlKGxpbWl0cy5kYXRhLnJlc291cmNlcy5jb3JlLnJlc2V0ICogMTAwMCksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0U3RhcnRpbmdEYXRlKCk6IERhdGUgfCBudWxsIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZGF0ZTogc3RyaW5nID0gdGhpcy5kYi5nZXREYXRhKEdIQWN0aW9uVXNhZ2UuTGFzdFN0YXJ0VGltZU5hbWUpO1xuICAgICAgY29uc3QgdGltZXN0YW1wID0gRGF0ZS5wYXJzZShkYXRlKTtcbiAgICAgIGlmIChpc05hTih0aW1lc3RhbXApID09PSBmYWxzZSkge1xuICAgICAgICBjb25zdCBzdGFydERhdGU6IERhdGUgPSBuZXcgRGF0ZSh0aW1lc3RhbXApO1xuICAgICAgICAvLyBJZiBzdGFydCBkYXRlIGlzIG1vcmUgcmVjZW50IHRoYW4gX25vd18sIHJlc3RhcnQgb3ZlciBieSByZXR1cm5pbmcgbnVsbC5cbiAgICAgICAgcmV0dXJuIHN0YXJ0RGF0ZSA8IG5ldyBEYXRlKCkgPyBzdGFydERhdGUgOiBudWxsO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhpcy5yZXBvcnRlci53YXJuKCcnLCBlcnIgYXMgRXJyb3IpO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY2hlY2tSZXBvc2l0b3J5KFxuICAgIG93bmVyOiBzdHJpbmcsXG4gICAgcmVwbzogc3RyaW5nLFxuICAgIGZpbGVQYXRoOiBzdHJpbmdcbiAgKTogUHJvbWlzZTxJUmVwb3NpdG9yeU1hdGNoW10+IHtcbiAgICBjb25zdCBtYXRjaGVzOiBJUmVwb3NpdG9yeU1hdGNoW10gPSBbXTtcbiAgICB0cnkge1xuICAgICAgdHlwZSB0ID0gb2suUmVzdEVuZHBvaW50TWV0aG9kVHlwZXNbJ3JlcG9zJ11bJ2dldENvbnRlbnQnXVsncmVzcG9uc2UnXTtcbiAgICAgIGNvbnN0IGRhdGE6IHQgPSBhd2FpdCB0aGlzLm9jdG9raXQucmVzdC5yZXBvcy5nZXRDb250ZW50KHtcbiAgICAgICAgb3duZXIsXG4gICAgICAgIHBhdGg6IGZpbGVQYXRoLFxuICAgICAgICByZXBvLFxuICAgICAgfSk7XG4gICAgICB0aGlzLnNldFJlbWFpbmluZ0NhbGxzKEFwaVJhdGVMaW1pdC5jaGVja1Jlc3RBcGlMaW1pdChkYXRhLmhlYWRlcnMpKTtcbiAgICAgIGNvbnN0IGZpbGVzOiBJRmlsZVtdID0gZGF0YS5kYXRhIGFzIElGaWxlW107XG4gICAgICBpZiAoZmlsZXMpIHtcbiAgICAgICAgdHlwZSBycCA9IG9rLlJlc3RFbmRwb2ludE1ldGhvZFR5cGVzWydyZXBvcyddWydnZXQnXVsncmVzcG9uc2UnXTtcbiAgICAgICAgY29uc3QgcmVwb1Jlc3BvbnNlOiBycCA9IGF3YWl0IHRoaXMub2N0b2tpdC5yZXN0LnJlcG9zLmdldCh7XG4gICAgICAgICAgb3duZXIsXG4gICAgICAgICAgcmVwbyxcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuc2V0UmVtYWluaW5nQ2FsbHMoXG4gICAgICAgICAgQXBpUmF0ZUxpbWl0LmNoZWNrUmVzdEFwaUxpbWl0KHJlcG9SZXNwb25zZS5oZWFkZXJzKVxuICAgICAgICApO1xuXG4gICAgICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAoZmlsZS5kb3dubG9hZF91cmwpIHtcbiAgICAgICAgICAgICAgdHlwZSByZXNwID0gb2suUmVzdEVuZHBvaW50TWV0aG9kVHlwZXNbJ3JlcG9zJ11bJ2dldENvbnRlbnQnXVsncmVzcG9uc2UnXTtcbiAgICAgICAgICAgICAgY29uc3QgZjogcmVzcCA9IGF3YWl0IHRoaXMub2N0b2tpdC5yZXN0LnJlcG9zLmdldENvbnRlbnQoe1xuICAgICAgICAgICAgICAgIG93bmVyLFxuICAgICAgICAgICAgICAgIHBhdGg6IGZpbGUucGF0aCxcbiAgICAgICAgICAgICAgICByZXBvLFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgdGhpcy5zZXRSZW1haW5pbmdDYWxscyhBcGlSYXRlTGltaXQuY2hlY2tSZXN0QXBpTGltaXQoZi5oZWFkZXJzKSk7XG4gICAgICAgICAgICAgIGNvbnN0IGZpbGVDb250ZW50ID0gQnVmZmVyLmZyb20oXG4gICAgICAgICAgICAgICAgKGYuZGF0YSBhcyBhbnkpLmNvbnRlbnQsXG4gICAgICAgICAgICAgICAgJ2Jhc2U2NCdcbiAgICAgICAgICAgICAgKS50b1N0cmluZygndXRmOCcpO1xuICAgICAgICAgICAgICBjb25zdCBsaW5lcyA9IGZpbGVDb250ZW50LnNwbGl0KG9zLkVPTCk7XG4gICAgICAgICAgICAgIGxldCBsaW5lTnVtYmVyID0gMDtcbiAgICAgICAgICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICAgICAgICAgICAgbGluZU51bWJlcisrO1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlZ0V4cCA9IG5ldyBSZWdFeHAoXG4gICAgICAgICAgICAgICAgICAnbHVra2EvKD88YWN0aW9uPig/OmdldC1jbWFrZSl8KD86cnVuLWNtYWtlKXwoPzpydW4tdmNwa2cpKUAoPzx2ZXJzaW9uPltcXFxcd1xcXFxkXFxcXC5dKyknLFxuICAgICAgICAgICAgICAgICAgJ2cnXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBjb25zdCBtYXRjaEFycmF5ID0gbGluZS5tYXRjaEFsbChyZWdFeHApO1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgbWF0Y2ggb2YgbWF0Y2hBcnJheSkge1xuICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG1hdGNoLmdyb3Vwcykge1xuICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGhpdCA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjdGlvbk5hbWU6IG1hdGNoLmdyb3Vwcy5hY3Rpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICBsaW5lOiBsaW5lTnVtYmVyLFxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBnaXRodWIuZ2V0SHRtbFVybChmaWxlLnVybCwgbGluZU51bWJlciksXG4gICAgICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uOiBtYXRjaC5ncm91cHMudmVyc2lvbixcbiAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgIHRoaXMucmVwb3J0ZXIuaW5mbyhcbiAgICAgICAgICAgICAgICAgICAgICAgIGBcXG4gRm91bmQgJyR7aGl0LmFjdGlvbk5hbWV9QCR7aGl0LnZlcnNpb259JyBpbiByZXBvOiAke293bmVyfS8ke3JlcG99ICR7cmVwb1Jlc3BvbnNlLmRhdGEuc3RhcmdhemVyc19jb3VudH3irZEgICR7cmVwb1Jlc3BvbnNlLmRhdGEud2F0Y2hlcnNfY291bnR98J+RgGBcbiAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgIG1hdGNoZXMucHVzaChoaXQpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgQXBpUmF0ZUxpbWl0LnRocm93SWZSYXRlTGltaXRFeGNlZWRlZChlcnIpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlcG9ydGVyLndhcm4oYGNoZWNrUmVwb3NpdG9yeSgpOmAsIGVyciBhcyBFcnJvcik7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICBBcGlSYXRlTGltaXQudGhyb3dJZlJhdGVMaW1pdEV4Y2VlZGVkKGVycik7XG4gICAgICAgICAgICB0aGlzLnJlcG9ydGVyLndhcm4oYGNoZWNrUmVwb3NpdG9yeSgpOmAsIGVyciBhcyBFcnJvcik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zdCBlcnJvciA9IGVyciBhcyBhbnk7XG4gICAgICBpZiAoZXJyb3I/LnN0YXR1cyA9PT0gNDA0KSB7XG4gICAgICAgIEFwaVJhdGVMaW1pdC50aHJvd0lmUmF0ZUxpbWl0RXhjZWVkZWQoZXJyKTtcbiAgICAgICAgdGhpcy5zZXRSZW1haW5pbmdDYWxscyhcbiAgICAgICAgICBBcGlSYXRlTGltaXQuY2hlY2tSZXN0QXBpTGltaXQoZXJyb3IucmVzcG9uc2UuaGVhZGVycylcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIEFwaVJhdGVMaW1pdC50aHJvd0lmUmF0ZUxpbWl0RXhjZWVkZWQoZXJyKTtcbiAgICAgICAgdGhpcy5yZXBvcnRlci53YXJuKGBjaGVja1JlcG9zaXRvcnkoKTpgLCBlcnIgYXMgRXJyb3IpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBtYXRjaGVzO1xuICB9XG59XG4iXX0=