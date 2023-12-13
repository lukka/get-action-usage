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
        this.actionRootPath = this.getActionPath();
        this.executionStopDate = datehelper_1.DateHelper.addMinutes(new Date(), GHActionUsage.InternalTimeoutMinutes);
        reporter.info(`Executing until ${this.executionStopDate.toUTCString()} or until API rate limit reached.`);
        this.db = this.openDb(this.actionRootPath);
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
                this.progressBars.stop();
                console.timeLog('run()');
                this.reporter.debug(`run()>>`);
            }
        });
    }
    setRemainingCalls(restApi, searchApi) {
        this.progressBars.updateApiQuota(restApi, searchApi);
    }
    getActionPath() {
        var _a, _b;
        let actionPath = null;
        this.reporter.debug(`getActionPath()<<`);
        const ds = [
            (_a = process.cwd()) !== null && _a !== void 0 ? _a : '',
            (_b = GHActionUsage.getWorkspacePath()) !== null && _b !== void 0 ? _b : '',
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
    openDb(rootPath) {
        let db;
        const dbPath = path.join(rootPath, 'graph', GHActionUsage.UsageDbFileName);
        try {
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
    setupCron(rootPath, date) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const filePath = path.join(rootPath, ...GHActionUsage.WorkflowFilePath);
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
                                else {
                                    this.reporter.info(`no hits for key: '${key}'.`);
                                    if (this.db.exists(key)) {
                                        this.db.delete(key);
                                        this.reporter.warn(`removed the repository with key: '${key}'.`);
                                    }
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
                                                this.reporter.warn(`\n Found '${hit.actionName}@${hit.version}' in repo: ${owner}/${repo} ${repoResponse.data.stargazers_count}⭑  ${repoResponse.data.watchers_count}👀`);
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
GHActionUsage.WorkflowFilePath = [
    '.github',
    'workflows',
    'run.yml',
];
GHActionUsage.InternalTimeoutMinutes = 5 * 60;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWN0aW9udXNhZ2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvYWN0aW9udXNhZ2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBS0EseUJBQXlCO0FBQ3pCLDJCQUEyQjtBQUMzQix5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLHFDQUFxQztBQUNyQyxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBRzNDLHFFQUE0RDtBQUM1RCxpQ0FBd0M7QUFDeEMsNkNBQTBDO0FBUzFDLCtDQUFzQztBQUN0QywrQ0FBeUM7QUFFekMsTUFBYSxhQUFhO0lBa0N4QixZQUNtQixPQUFtQixFQUNuQixvQkFBa0QsRUFDbEQsUUFBbUI7O1FBRm5CLFlBQU8sR0FBUCxPQUFPLENBQVk7UUFDbkIseUJBQW9CLEdBQXBCLG9CQUFvQixDQUE4QjtRQUNsRCxhQUFRLEdBQVIsUUFBUSxDQUFXO1FBVnJCLGNBQVMsR0FBVyxNQUFNLEdBQUcsQ0FBQyxDQUFDO1FBSXhDLDJCQUFzQixHQUFXLENBQUMsQ0FBQztRQVN6QyxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUUzQyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsdUJBQVUsQ0FBQyxVQUFVLENBQzVDLElBQUksSUFBSSxFQUFFLEVBQ1YsYUFBYSxDQUFDLHNCQUFzQixDQUNyQyxDQUFDO1FBQ0YsUUFBUSxDQUFDLElBQUksQ0FDWCxtQkFBbUIsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxtQ0FBbUMsQ0FDM0YsQ0FBQztRQUNGLElBQUksQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUM7UUFDM0MsSUFBSSxDQUFDLFlBQVksR0FBRyxNQUFBLElBQUksQ0FBQyxlQUFlLEVBQUUsbUNBQUksSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDckUsUUFBUSxDQUFDLElBQUksQ0FB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QUFvQixFQUFFLEdBQVksQ0FBQyxDQUFDO3lCQUN4RDtxQkFDRjtpQkFDRjthQUNGO1lBQUMsT0FBTyxHQUFHLEVBQUU7Z0JBQ1osTUFBTSxLQUFLLEdBQUcsR0FBVSxDQUFDO2dCQUN6QixJQUFJLENBQUEsS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLE1BQU0sTUFBSyxHQUFHLEVBQUU7b0JBQ3pCLHdCQUFZLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLENBQUM7b0JBQzNDLElBQUksQ0FBQyxpQkFBaUIsQ0FDcEIsd0JBQVksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUN2RCxDQUFDO2lCQUNIO3FCQUFNO29CQUNMLHdCQUFZLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLENBQUM7b0JBQzNDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLEdBQVksQ0FBQyxDQUFDO2lCQUN4RDthQUNGO1lBRUQsT0FBTyxPQUFPLENBQUM7UUFDakIsQ0FBQztLQUFBOztBQXZlSCxzQ0F3ZUM7QUF2ZXlCLCtCQUFpQixHQUFXLHFCQUFxQixDQUFDO0FBQ2xELDZCQUFlLEdBQUcsc0JBQXNCLENBQUM7QUFDekMsOEJBQWdCLEdBQWE7SUFDbkQsU0FBUztJQUNULFdBQVc7SUFDWCxTQUFTO0NBQ1YsQ0FBQztBQUdzQixvQ0FBc0IsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQ29weXJpZ2h0IMKpIDIwMjItMjAyMyBieSBMdWNhIENhcHBhIGxjYXBwYUBnbWFpbC5jb21cbi8vIEFsbCBjb250ZW50IG9mIHRoaXMgcmVwb3NpdG9yeSBpcyBsaWNlbnNlZCB1bmRlciB0aGUgQ0MgQlktU0EgTGljZW5zZS5cbi8vIFNlZSB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IGZvciBsaWNlbnNlIGluZm9ybWF0aW9uLlxuXG5pbXBvcnQgKiBhcyBvayBmcm9tICdAb2N0b2tpdC9yZXN0JztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcbmltcG9ydCAqIGFzIExQRiBmcm9tICdscGYnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnb3MnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIGJhciBmcm9tICcuL3Byb2dyZXNzYmFyJztcbmltcG9ydCAqIGFzIGdpdGh1YiBmcm9tICcuL2dpdGh1Yic7XG5cbmltcG9ydCB7IEFwaVJhdGVMaW1pdCB9IGZyb20gJy4vYXBpbGltaXRzJztcbmltcG9ydCB7IEFwaUxpbWl0c0V4Y2VwdGlvbiB9IGZyb20gJy4vYXBpbGltaXRzZXhjZXB0aW9uJztcbmltcG9ydCB7IGNvbXBvbmVudHMgfSBmcm9tICdAb2N0b2tpdC9vcGVuYXBpLXR5cGVzJztcbmltcG9ydCB7IENvbmZpZyB9IGZyb20gJ25vZGUtanNvbi1kYi9kaXN0L2xpYi9Kc29uREJDb25maWcnO1xuaW1wb3J0IHsgdG9Dcm9uU2NoZWR1bGUgfSBmcm9tICcuL2Nyb24nO1xuaW1wb3J0IHsgRGF0ZUhlbHBlciB9IGZyb20gJy4vZGF0ZWhlbHBlcic7XG5pbXBvcnQge1xuICBJRmlsZSxcbiAgSVJlcG9zaXRvcnksXG4gIElSZXBvc2l0b3JpZXNQcm92aWRlcixcbiAgSVJlcG9zaXRvcmllc1Byb3ZpZGVyRmFjdG9yeSxcbiAgSVJlcG9zaXRvcnlNYXRjaCxcbiAgSVJlcG9ydGVyLFxufSBmcm9tICcuL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgSnNvbkRCIH0gZnJvbSAnbm9kZS1qc29uLWRiJztcbmltcG9ydCB7IFN0b3B3YXRjaCB9IGZyb20gJ3RzLXN0b3B3YXRjaCc7XG5cbmV4cG9ydCBjbGFzcyBHSEFjdGlvblVzYWdlIHtcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgTGFzdFN0YXJ0VGltZU5hbWU6IHN0cmluZyA9ICcvTGFzdFN0YXJ0VGltZU5hbWUvJztcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgVXNhZ2VEYkZpbGVOYW1lID0gJ2FjdGlvbi11c2FnZS1kYi5qc29uJztcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgV29ya2Zsb3dGaWxlUGF0aDogc3RyaW5nW10gPSBbXG4gICAgJy5naXRodWInLFxuICAgICd3b3JrZmxvd3MnLFxuICAgICdydW4ueW1sJyxcbiAgXTtcbiAgLy8gVGVybWluYXRlIHRoZSBleGVjdXRpb24gYWZ0ZXIgdGhpcyB0aW1lb3V0IHRvIHByZXZlbnQgZm9yY2VkIGNhbmNlbGxhdGlvblxuICAvLyBvbiB0aGUgcnVubmVyIChzaXggaG91cnMpXG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IEludGVybmFsVGltZW91dE1pbnV0ZXMgPSA1ICogNjA7XG5cbiAgcHJpdmF0ZSBzdGF0aWMgZ2V0V29ya3NwYWNlUGF0aCgpOiBzdHJpbmcgfCBudWxsIHtcbiAgICBjb25zdCBrZXkgPSAnR0lUSFVCX1dPUktTUEFDRSc7XG4gICAgcmV0dXJuIHByb2Nlc3MuZW52W2tleV0gPz8gbnVsbDtcbiAgfVxuXG4gIC8vIEB0cy1pZ25vcmVcbiAgcHJpdmF0ZSBzdGF0aWMgYXN5bmMgZGVsYXkobWlsbGlzOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoZ2l0aHViLmlzUnVubmluZ09uR2l0SHViUnVubmVyKCkpIHtcbiAgICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgbWlsbGlzKSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSByZWFkb25seSBkYjogSnNvbkRCO1xuICBwcml2YXRlIHJlYWRvbmx5IHByb2dyZXNzQmFyczogYmFyLlByb2dyZXNzQmFyO1xuICAvLyBEYXlzIG9mIGVhY2ggdGltZSBzZWdtZW50LlxuICBwcml2YXRlIHJlYWRvbmx5IHRpbWVSYW5nZTogbnVtYmVyID0gNjAuODc1IC8gMjtcbiAgLy8gU3RhcnRpbmcgZGF0ZSBvZiB0aGUgdGltZSBzZWdtZW50cy5cbiAgcHJpdmF0ZSByZWFkb25seSBzdGFydGluZ0RhdGU6IERhdGU7XG4gIHByaXZhdGUgcmVhZG9ubHkgZXhlY3V0aW9uU3RvcERhdGU6IERhdGU7XG4gIHByaXZhdGUgdG90YWxSZXBvc2l0b3J5Q2hlY2tlZDogbnVtYmVyID0gMDtcbiAgcHJpdmF0ZSByZWFkb25seSBhY3Rpb25Sb290UGF0aDogc3RyaW5nO1xuXG4gIHB1YmxpYyBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9jdG9raXQ6IG9rLk9jdG9raXQsXG4gICAgcHJpdmF0ZSByZWFkb25seSByZXBvc1Byb3ZpZGVyRmFjdG9yeTogSVJlcG9zaXRvcmllc1Byb3ZpZGVyRmFjdG9yeSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHJlcG9ydGVyOiBJUmVwb3J0ZXJcbiAgKSB7XG4gICAgLy8gSWRlbnRpZnkgYWN0aW9uIGRpcmVjdG9yeVxuICAgIHRoaXMuYWN0aW9uUm9vdFBhdGggPSB0aGlzLmdldEFjdGlvblBhdGgoKTtcblxuICAgIHRoaXMuZXhlY3V0aW9uU3RvcERhdGUgPSBEYXRlSGVscGVyLmFkZE1pbnV0ZXMoXG4gICAgICBuZXcgRGF0ZSgpLFxuICAgICAgR0hBY3Rpb25Vc2FnZS5JbnRlcm5hbFRpbWVvdXRNaW51dGVzXG4gICAgKTtcbiAgICByZXBvcnRlci5pbmZvKFxuICAgICAgYEV4ZWN1dGluZyB1bnRpbCAke3RoaXMuZXhlY3V0aW9uU3RvcERhdGUudG9VVENTdHJpbmcoKX0gb3IgdW50aWwgQVBJIHJhdGUgbGltaXQgcmVhY2hlZC5gXG4gICAgKTtcbiAgICB0aGlzLmRiID0gdGhpcy5vcGVuRGIodGhpcy5hY3Rpb25Sb290UGF0aCk7XG4gICAgdGhpcy5zdGFydGluZ0RhdGUgPSB0aGlzLmdldFN0YXJ0aW5nRGF0ZSgpID8/IG5ldyBEYXRlKCcyMDEwLTAxLTAxJyk7XG4gICAgcmVwb3J0ZXIuaW5mbyhgU3RhcnRpbmcgZGF0ZTogJHt0aGlzLnN0YXJ0aW5nRGF0ZS50b1VUQ1N0cmluZygpfScuYCk7XG5cbiAgICB0aGlzLnByb2dyZXNzQmFycyA9IG5ldyBiYXIuUHJvZ3Jlc3NCYXIoKTtcblxuICAgIExQRi5zbW9vdGhpbmcgPSAwLjU7XG4gICAgTFBGLmluaXQoMCk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgcnVuKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoYHJ1bigpPDwgJHtuZXcgRGF0ZSgpLnRvVVRDU3RyaW5nKCl9YCk7XG4gICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWNvbnNvbGVcbiAgICBjb25zb2xlLnRpbWUoJ3J1bigpOicpO1xuICAgIGxldCBzdGFydERhdGUgPSB0aGlzLnN0YXJ0aW5nRGF0ZTtcblxuICAgIC8vIElmIGFscmVhZHkgcnVubmluZywgZW5zdXJlIHRvIGV4aXQgYmVmb3JlIG1vZGlmeWluZyBhbnkgbG9jYWwgZmlsZSB0aGF0IHdvdWxkIHRoZW5cbiAgICAvLyBiZSBjb21taXR0ZWQuXG4gICAgaWYgKGF3YWl0IHRoaXMuaXNBbHJlYWR5UnVubmluZygpKSB7XG4gICAgICB0aGlzLnJlcG9ydGVyLmluZm8oJ0FscmVhZHkgcnVubmluZywgZXhpdGluZy4uLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuXG4gICAgICAvLyBDb21wdXRlIHRoZSB0b3RhbCB0aW1lLXNlZ21lbnRzIG9mICd0aW1lUmFuZ2UnIGRheXMgZWFjaC5cbiAgICAgIHRoaXMucHJvZ3Jlc3NCYXJzLmluaXQoc3RhcnREYXRlLCB0aGlzLnRpbWVSYW5nZSk7XG5cbiAgICAgIGxldCB0aW1lU2VnbWVudCA9IDE7XG4gICAgICBsZXQgbmV4dERhdGUgPSBEYXRlSGVscGVyLmFkZERheXMoc3RhcnREYXRlLCB0aGlzLnRpbWVSYW5nZSk7XG5cbiAgICAgIC8vIEl0ZXJhdGUgb3ZlciBhbGwgdGltZSBzZWdtZW50cy5cbiAgICAgIHdoaWxlIChzdGFydERhdGUgPCBub3cgJiYgdGhpcy5leGVjdXRpb25TdG9wRGF0ZSA+IG5ldyBEYXRlKCkpIHtcbiAgICAgICAgY29uc3QgcmVwb1Byb3ZpZGVyID0gYXdhaXQgdGhpcy5yZXBvc1Byb3ZpZGVyRmFjdG9yeS5jcmVhdGUoXG4gICAgICAgICAgdGhpcy5vY3Rva2l0LFxuICAgICAgICAgIHN0YXJ0RGF0ZSxcbiAgICAgICAgICBuZXh0RGF0ZSxcbiAgICAgICAgICB0aGlzXG4gICAgICAgICk7XG5cbiAgICAgICAgY29uc3QgcmVwb3M6IElSZXBvc2l0b3J5W10gPSBhd2FpdCB0aGlzLmdldFJlcG9MaXN0KHJlcG9Qcm92aWRlcik7XG5cbiAgICAgICAgdGhpcy5wcm9ncmVzc0JhcnMudXBkYXRlKFxuICAgICAgICAgIHN0YXJ0RGF0ZSxcbiAgICAgICAgICBuZXh0RGF0ZSxcbiAgICAgICAgICByZXBvUHJvdmlkZXIuY291bnQsXG4gICAgICAgICAgdGltZVNlZ21lbnRcbiAgICAgICAgKTtcblxuICAgICAgICBjb25zdCBzdyA9IG5ldyBTdG9wd2F0Y2goKTtcbiAgICAgICAgc3cuc3RhcnQoKTtcblxuICAgICAgICBhd2FpdCB0aGlzLml0ZXJhdGVUaW1lU2VnbWVudChyZXBvUHJvdmlkZXIsIHJlcG9zLCBzdyk7XG5cbiAgICAgICAgLy8gQWR2YW5jZSB0aW1lIHJhbmdlLlxuICAgICAgICB0aW1lU2VnbWVudCsrO1xuICAgICAgICBzdGFydERhdGUgPSBuZXh0RGF0ZTtcbiAgICAgICAgbmV4dERhdGUgPSBEYXRlSGVscGVyLmFkZERheXMoc3RhcnREYXRlLCB0aGlzLnRpbWVSYW5nZSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBpZiAoQXBpUmF0ZUxpbWl0LmlzUmF0ZUxpbWl0RXhjZXB0aW9uKGVycikpIHtcbiAgICAgICAgY29uc3QgZSA9IGVyciBhcyBBcGlMaW1pdHNFeGNlcHRpb247XG4gICAgICAgIGNvbnN0IGN1cnJlbnRSZW1haW5pbmcgPVxuICAgICAgICAgIGUucmVtYWluaW5nICE9PSB1bmRlZmluZWQgPyAnJyArIGUucmVtYWluaW5nIDogJzx1bmtub3duPic7XG4gICAgICAgIGNvbnN0IG5leHRRdW90YVJlc2V0ID0gZS5uZXh0UmVzZXRcbiAgICAgICAgICA/IGUubmV4dFJlc2V0LnRvVVRDU3RyaW5nKClcbiAgICAgICAgICA6ICc8dW5rbm93bj4nO1xuICAgICAgICB0aGlzLnJlcG9ydGVyLndhcm4oXG4gICAgICAgICAgYCR7b3MuRU9MfSR7XG4gICAgICAgICAgICBvcy5FT0xcbiAgICAgICAgICB9IEFQSSByYXRlIGxpbWl0IGFsbW9zdCByZWFjaGVkIGF0ICcke2N1cnJlbnRSZW1haW5pbmd9JyByZW1haW5pbmcgY2FsbHMuIFN0b3JpbmcgY3VycmVudCBzdGFydGluZyBkYXRlOiAnJHtzdGFydERhdGUudG9VVENTdHJpbmcoKX0nIGluIGRiLmAgK1xuICAgICAgICAgICAgYCBOZXh0IHF1b3RhIHJlc2V0IG9uICcke25leHRRdW90YVJlc2V0fScuYFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5yZXBvcnRlci53YXJuKCcnLCBlcnIgYXMgRXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIC8vIFByb2xvZ3VlXG4gICAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKCdTYXZpbmcgZGF0YSBiZWZvcmUgZXhpdGluZy4uLicpO1xuXG4gICAgICBjb25zdCBsaW1pdHMgPSBhd2FpdCB0aGlzLmdldFJlc3RDdXJyZW50TGltaXRzKCk7XG4gICAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKEpTT04uc3RyaW5naWZ5KGxpbWl0cykpO1xuXG4gICAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKFxuICAgICAgICBgZGIucHVzaCAke0dIQWN0aW9uVXNhZ2UuTGFzdFN0YXJ0VGltZU5hbWV9ICR7c3RhcnREYXRlLnRvVVRDU3RyaW5nKCl9YFxuICAgICAgKTtcbiAgICAgIHRoaXMuZGIucHVzaChcbiAgICAgICAgR0hBY3Rpb25Vc2FnZS5MYXN0U3RhcnRUaW1lTmFtZSxcbiAgICAgICAgYCR7c3RhcnREYXRlLnRvVVRDU3RyaW5nKCl9YCxcbiAgICAgICAgdHJ1ZVxuICAgICAgKTtcbiAgICAgIHRoaXMuZGIuc2F2ZSh0cnVlKTtcblxuICAgICAgLy8gTGF1bmNoaW5nIHRoZSB3b3JrZmxvdyBhZ2FpbiBhdCBsaW1pdHMucmVzZXQgdGltZSB3aWxsXG4gICAgICAvLyBleGhhdXN0cyBhZ2FpbiBhbGwgdGhlIEFQSSBxdW90YS4gTGV0J3MgcnVuIGl0IGF0IG1pZG5pZ2h0IGVhY2ggZGF5LlxuICAgICAgLy8gVGhlIGNyb24gc2NoZWR1bGUgaXMgaGFyZGNvZGVkIGluIHJ1bi55bWwuXG4gICAgICAvLyBhd2FpdCB0aGlzLnNldHVwQ3Jvbih0aGlzLmFjdGlvblJvb3RQYXRoLCBsaW1pdHMucmVzZXQpO1xuXG4gICAgICB0aGlzLnByb2dyZXNzQmFycy5zdG9wKCk7XG4gICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tY29uc29sZVxuICAgICAgY29uc29sZS50aW1lTG9nKCdydW4oKScpO1xuICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhgcnVuKCk+PmApO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBzZXRSZW1haW5pbmdDYWxscyhyZXN0QXBpPzogbnVtYmVyLCBzZWFyY2hBcGk/OiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLnByb2dyZXNzQmFycy51cGRhdGVBcGlRdW90YShyZXN0QXBpLCBzZWFyY2hBcGkpO1xuICB9XG5cbiAgLy8gSWRlbnRpZnkgdGhlIGxvY2F0aW9uIHdoZXJlIHRoZSBhY3Rpb24gaXMgY2hlY2tlZCBvdXQgYnkgc2Vla2luZyBmb3IgdGhlIHJ1bi55bWwgZmlsZS5cbiAgcHJpdmF0ZSBnZXRBY3Rpb25QYXRoKCk6IHN0cmluZyB7XG4gICAgbGV0IGFjdGlvblBhdGggPSBudWxsO1xuICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoYGdldEFjdGlvblBhdGgoKTw8YCk7XG4gICAgY29uc3QgZHMgPSBbXG4gICAgICBwcm9jZXNzLmN3ZCgpID8/ICcnLFxuICAgICAgR0hBY3Rpb25Vc2FnZS5nZXRXb3Jrc3BhY2VQYXRoKCkgPz8gJycsXG4gICAgICBgJHtfX2Rpcm5hbWUgKyBwYXRoLnNlcH0uLmAsXG4gICAgXTtcbiAgICBmb3IgKGNvbnN0IGQgb2YgZHMpIHtcbiAgICAgIGNvbnN0IHdmZnAgPSBwYXRoLmpvaW4oZCwgLi4uR0hBY3Rpb25Vc2FnZS5Xb3JrZmxvd0ZpbGVQYXRoKTtcbiAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoYGNoZWNraW5nIGZvciAnJHtkfScuLi5gKTtcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKHdmZnApKSB7XG4gICAgICAgIGFjdGlvblBhdGggPSBkO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKCFhY3Rpb25QYXRoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBpZGVudGlmeSB0aGUgYWN0aW9uIHJvb3QgZGlyZWN0b3J5LmApO1xuICAgIH1cbiAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKGBnZXRBY3Rpb25QYXRoKCk+Picke2FjdGlvblBhdGh9J2ApO1xuICAgIHJldHVybiBhY3Rpb25QYXRoO1xuICB9XG5cbiAgLy8gQ2hlY2sgd2hldGhlciBhbnkgd29ya2Zsb3cgaXMgYWxyZWFkeSBydW5uaW5nIGZvciB0aGlzIHJlcG9zaXRvcnkuXG4gIHByaXZhdGUgYXN5bmMgaXNBbHJlYWR5UnVubmluZygpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAoIWdpdGh1Yi5pc1J1bm5pbmdPbkdpdEh1YlJ1bm5lcigpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGNvbnN0IEdJVEhVQl9SRVBPU0lUT1JZID0gJ0dJVEhVQl9SRVBPU0lUT1JZJztcbiAgICBjb25zdCBvd25lcjogc3RyaW5nIHwgdW5kZWZpbmVkID0gcHJvY2Vzcy5lbnZbR0lUSFVCX1JFUE9TSVRPUlldPy5zcGxpdChcbiAgICAgICcvJ1xuICAgIClbMF07XG4gICAgY29uc3QgcmVwbzogc3RyaW5nIHwgdW5kZWZpbmVkID0gcHJvY2Vzcy5lbnZbR0lUSFVCX1JFUE9TSVRPUlldPy5zcGxpdChcbiAgICAgICcvJ1xuICAgIClbMV07XG4gICAgaWYgKCEob3duZXIgJiYgcmVwbykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYFRoZSBlbnYgdmFyIEdJVEhVQl9SRVBPU0lUT1JZIGlzIG5vdCBkZWZpbmVkOiAnJHtHSVRIVUJfUkVQT1NJVE9SWX0nLmBcbiAgICAgICk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIHR5cGUgcmVzcG9uc2VUeXBlID0gb2suUmVzdEVuZHBvaW50TWV0aG9kVHlwZXNbJ2FjdGlvbnMnXVsnbGlzdFdvcmtmbG93UnVuc0ZvclJlcG8nXVsncmVzcG9uc2UnXTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlOiByZXNwb25zZVR5cGUgPSBhd2FpdCB0aGlzLm9jdG9raXQucmVzdC5hY3Rpb25zLmxpc3RXb3JrZmxvd1J1bnNGb3JSZXBvKFxuICAgICAgICB7XG4gICAgICAgICAgb3duZXIsXG4gICAgICAgICAgcmVwbyxcbiAgICAgICAgfVxuICAgICAgKTtcbiAgICAgIHR5cGUgd29ya2Zsb3dSdW5UeXBlID0gQXJyYXk8Y29tcG9uZW50c1snc2NoZW1hcyddWyd3b3JrZmxvdy1ydW4nXT47XG4gICAgICBjb25zdCB3ZnM6IHdvcmtmbG93UnVuVHlwZSA9IHJlc3BvbnNlLmRhdGEud29ya2Zsb3dfcnVucztcbiAgICAgIGNvbnN0IHJ1bm5pbmdXZiA9IHdmcy5maWx0ZXIoXG4gICAgICAgIHdmID0+IHdmLnN0YXR1cyA9PT0gJ2luX3Byb2dyZXNzJyB8fCB3Zi5zdGF0dXMgPT09ICdxdWV1ZWQnXG4gICAgICApO1xuXG4gICAgICByZXR1cm4gcnVubmluZ1dmLmxlbmd0aCA+IDE7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnJlcG9ydGVyLmVycm9yKFxuICAgICAgICBgQ2Fubm90IGRldGVybWluZSBpZiBhbHJlYWR5IHJ1bm5pbmc6ICR7SlNPTi5zdHJpbmdpZnkoZXJyKX1gXG4gICAgICApO1xuICAgICAgdGhpcy5yZXBvcnRlci5lcnJvcihcbiAgICAgICAgYFByZXRlbmRpbmcgdG8gYmUgcnVubmluZyBhbHJlYWR5IHRvIGV4aXQgaW1tZWRpYXRlbHkgYW5kIGF2b2lkIHBvdGVudGlhbCByZWZ1c2VkICdnaXQgcHVzaCcuYFxuICAgICAgKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgb3BlbkRiKHJvb3RQYXRoOiBzdHJpbmcpOiBKc29uREIge1xuICAgIGxldCBkYjogSnNvbkRCO1xuICAgIGNvbnN0IGRiUGF0aCA9IHBhdGguam9pbihyb290UGF0aCwgJ2dyYXBoJywgR0hBY3Rpb25Vc2FnZS5Vc2FnZURiRmlsZU5hbWUpO1xuICAgIHRyeSB7XG4gICAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKGBPcGVuaW5nIERCIGF0ICcke2RiUGF0aH0nLi4uLmApO1xuICAgICAgZGIgPSBuZXcgSnNvbkRCKG5ldyBDb25maWcoZGJQYXRoLCB0cnVlLCB0cnVlLCAnLycpKTtcbiAgICAgIGRiLmdldERhdGEoR0hBY3Rpb25Vc2FnZS5MYXN0U3RhcnRUaW1lTmFtZSk7XG4gICAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKGBEQiBvcGVuZWQgYXQgJyR7ZGJQYXRofScuYCk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnJlcG9ydGVyLndhcm4oKGVyciBhcyBFcnJvcik/Lm1lc3NhZ2UpO1xuICAgICAgZnMudW5saW5rU3luYyhkYlBhdGgpO1xuICAgICAgZGIgPSBuZXcgSnNvbkRCKG5ldyBDb25maWcoZGJQYXRoLCB0cnVlLCB0cnVlLCAnLycpKTtcbiAgICAgIHRoaXMucmVwb3J0ZXIuaW5mbyhgREIgYXQgJyR7ZGJQYXRofScgcmUtb3BlbmVkIHN1Y2Nlc3NmdWxseS5gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZGI7XG4gIH1cblxuICAvLyBAdHMtaWdub3JlOiBVbnJlYWNoYWJsZSBjb2RlIGVycm9yXG4gIHByaXZhdGUgYXN5bmMgc2V0dXBDcm9uKHJvb3RQYXRoOiBzdHJpbmcsIGRhdGU6IERhdGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgLy8gUmVhZCBjb250ZW50IG9mIHdvcmtmbG93IGZpbGUuXG4gICAgICBjb25zdCBmaWxlUGF0aCA9IHBhdGguam9pbihyb290UGF0aCwgLi4uR0hBY3Rpb25Vc2FnZS5Xb3JrZmxvd0ZpbGVQYXRoKTtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsIHtcbiAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgZmxhZzogJ3InLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFBhdGNoIHRoZSBuZXh0IGV4ZWN1dGlvblxuICAgICAgY29uc3QgbmV4dENyb25TY2hlZHVsZSA9IGAnJHt0b0Nyb25TY2hlZHVsZShkYXRlKX0nYDtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdChvcy5FT0wpO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAobGluZXNbaV0uaW5kZXhPZignMCAqICogKiAqJykgIT09IC0xKSB7XG4gICAgICAgICAgY29uc3Qgb2xkQ3JvbiA9ICctIGNyb246ICc7XG4gICAgICAgICAgY29uc3Qgb2Zmc2V0ID0gbGluZXNbaSArIDFdLmluZGV4T2Yob2xkQ3Jvbik7XG4gICAgICAgICAgbGluZXNbaSArIDFdID1cbiAgICAgICAgICAgIGxpbmVzW2kgKyAxXS5zdWJzdHJpbmcoMCwgb2Zmc2V0ICsgb2xkQ3Jvbi5sZW5ndGgpICtcbiAgICAgICAgICAgIG5leHRDcm9uU2NoZWR1bGU7XG4gICAgICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhgbmV4dCBjcm9uIHNjaGVkdWxlIHNldCB0byAnJHtsaW5lc1tpICsgMV19J2ApO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBhdGNoZWRDb250ZW50ID0gbGluZXMuam9pbihvcy5FT0wpO1xuICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhwYXRjaGVkQ29udGVudCk7XG4gICAgICBmcy53cml0ZUZpbGVTeW5jKGZpbGVQYXRoLCBwYXRjaGVkQ29udGVudCk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnJlcG9ydGVyLmVycm9yKGBzZXR1cENyb24oKSBmYWlsZWQ6ICR7ZXJyfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0UmVwb0xpc3QoXG4gICAgcmVwb1Byb3ZpZGVyOiBJUmVwb3NpdG9yaWVzUHJvdmlkZXJcbiAgKTogUHJvbWlzZTxJUmVwb3NpdG9yeVtdPiB7XG4gICAgcmV0dXJuIHJlcG9Qcm92aWRlci5nZXROZXh0UmVwb3MoKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaXRlcmF0ZVRpbWVTZWdtZW50KFxuICAgIHJlcG9Qcm92aWRlcjogSVJlcG9zaXRvcmllc1Byb3ZpZGVyLFxuICAgIHJlcG9zOiBJUmVwb3NpdG9yeVtdLFxuICAgIHN3OiBTdG9wd2F0Y2hcbiAgKSB7XG4gICAgdHJ5IHtcbiAgICAgIGxldCBiYXJDb3VudGVyID0gMDtcbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGNvbnN0IHBzOiBBcnJheTxQcm9taXNlPHZvaWQ+PiA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGFSZXBvIG9mIHJlcG9zKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMucHJvZ3Jlc3NCYXJzLnVwZGF0ZVJlcG8oYmFyQ291bnRlciwge1xuICAgICAgICAgICAgICBhY3Rpb246IGJhci5Qcm9ncmVzc0Jhci5nZXRBY3Rpb25TdHJpbmcoXG4gICAgICAgICAgICAgICAgYGNoZWNraW5nIHJlcG8uLi4gJyR7YVJlcG8ub3duZXJ9LyR7YVJlcG8ubmFtZX0nYFxuICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zdCB0YXNrID0gbmV3IFByb21pc2U8dm9pZD4oYXN5bmMgKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgICBsZXQgbWF0Y2hlczogSVJlcG9zaXRvcnlNYXRjaFtdO1xuICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIG1hdGNoZXMgPSBhd2FpdCB0aGlzLmNoZWNrUmVwb3NpdG9yeShcbiAgICAgICAgICAgICAgICAgIGFSZXBvLm93bmVyLFxuICAgICAgICAgICAgICAgICAgYVJlcG8ubmFtZSxcbiAgICAgICAgICAgICAgICAgICcuZ2l0aHViL3dvcmtmbG93cydcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICBBcGlSYXRlTGltaXQuY2hlY2tSZXN0QXBpTGltaXQoXG4gICAgICAgICAgICAgICAgICAgIChlcnJvciBhcyBhbnkpPy5yZXNwb25zZT8uaGVhZGVyc1xuICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgIHJlamVjdChlcnIpO1xuICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IGtleSA9IGAvJHthUmVwby5vd25lcn0vJHthUmVwby5uYW1lfWA7XG4gICAgICAgICAgICAgIGlmIChtYXRjaGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmRiLnB1c2goa2V5LCBbLi4ubWF0Y2hlcywgYVJlcG9dLCB0cnVlKTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlcG9ydGVyLmluZm8oYG5vIGhpdHMgZm9yIGtleTogJyR7a2V5fScuYCk7XG4gICAgICAgICAgICAgICAgLy8gUmVtb3ZlIGVudHJpZXMgdGhhdCBhcmUgbm90IHVzaW5nIHRoZSBhY3Rpb25zIGFueW1vcmUuXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZGIuZXhpc3RzKGtleSkpIHtcbiAgICAgICAgICAgICAgICAgIHRoaXMuZGIuZGVsZXRlKGtleSk7XG4gICAgICAgICAgICAgICAgICB0aGlzLnJlcG9ydGVyLndhcm4oXG4gICAgICAgICAgICAgICAgICAgIGByZW1vdmVkIHRoZSByZXBvc2l0b3J5IHdpdGgga2V5OiAnJHtrZXl9Jy5gXG4gICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGJhckNvdW50ZXIrKztcbiAgICAgICAgICAgICAgdGhpcy50b3RhbFJlcG9zaXRvcnlDaGVja2VkKys7XG5cbiAgICAgICAgICAgICAgY29uc3QgdG90YWxUaW1lTWlsbGlzID0gc3cuZ2V0VGltZSgpO1xuXG4gICAgICAgICAgICAgIHRoaXMucHJvZ3Jlc3NCYXJzLnVwZGF0ZVJlcG8oYmFyQ291bnRlciwge1xuICAgICAgICAgICAgICAgIGFjdGlvbjogYmFyLlByb2dyZXNzQmFyLmdldEFjdGlvblN0cmluZyhcbiAgICAgICAgICAgICAgICAgIGBjaGVja2luZyByZXBvLi4uICcke2FSZXBvLm93bmVyfS8ke2FSZXBvLm5hbWV9J2BcbiAgICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICAgIHNwZWVkOiBgJHtMUEYubmV4dChcbiAgICAgICAgICAgICAgICAgIHRoaXMudG90YWxSZXBvc2l0b3J5Q2hlY2tlZCAvICh0b3RhbFRpbWVNaWxsaXMgLyA2MDAwMC4wKVxuICAgICAgICAgICAgICAgICkudG9GaXhlZCgxKX0gcmVwby9taW5gLnBhZFN0YXJ0KDMsICcgJyksXG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHBzLnB1c2godGFzayk7XG4gICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICBBcGlSYXRlTGltaXQudGhyb3dJZlJhdGVMaW1pdEV4Y2VlZGVkKGVycik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocHMpO1xuICAgICAgICB0aGlzLnByb2dyZXNzQmFycy51cGRhdGVSZXBvKGJhckNvdW50ZXIsIHtcbiAgICAgICAgICBhY3Rpb246IGJhci5Qcm9ncmVzc0Jhci5nZXRBY3Rpb25TdHJpbmcoYGxpc3RpbmcgcmVwb3MuLi5gKSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJlcG9zID0gYXdhaXQgdGhpcy5nZXRSZXBvTGlzdChyZXBvUHJvdmlkZXIpO1xuICAgICAgICBpZiAocmVwb3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIEFwaVJhdGVMaW1pdC50aHJvd0lmUmF0ZUxpbWl0RXhjZWVkZWQoZXJyKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldFJlc3RDdXJyZW50TGltaXRzKCk6IFByb21pc2U8e1xuICAgIHJlbWFpbmluZzogbnVtYmVyO1xuICAgIHJlc2V0OiBEYXRlO1xuICB9PiB7XG4gICAgdHlwZSByZXNwb25zZSA9IG9rLlJlc3RFbmRwb2ludE1ldGhvZFR5cGVzWydyYXRlTGltaXQnXVsnZ2V0J11bJ3Jlc3BvbnNlJ107XG4gICAgY29uc3QgbGltaXRzOiByZXNwb25zZSA9IGF3YWl0IHRoaXMub2N0b2tpdC5yZXN0LnJhdGVMaW1pdC5nZXQoKTtcbiAgICByZXR1cm4ge1xuICAgICAgcmVtYWluaW5nOiBsaW1pdHMuZGF0YS5yZXNvdXJjZXMuY29yZS5yZW1haW5pbmcsXG4gICAgICByZXNldDogbmV3IERhdGUobGltaXRzLmRhdGEucmVzb3VyY2VzLmNvcmUucmVzZXQgKiAxMDAwKSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRTdGFydGluZ0RhdGUoKTogRGF0ZSB8IG51bGwge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBkYXRlOiBzdHJpbmcgPSB0aGlzLmRiLmdldERhdGEoR0hBY3Rpb25Vc2FnZS5MYXN0U3RhcnRUaW1lTmFtZSk7XG4gICAgICBjb25zdCB0aW1lc3RhbXAgPSBEYXRlLnBhcnNlKGRhdGUpO1xuICAgICAgaWYgKGlzTmFOKHRpbWVzdGFtcCkgPT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IHN0YXJ0RGF0ZTogRGF0ZSA9IG5ldyBEYXRlKHRpbWVzdGFtcCk7XG4gICAgICAgIC8vIElmIHN0YXJ0IGRhdGUgaXMgbW9yZSByZWNlbnQgdGhhbiBfbm93XywgcmVzdGFydCBvdmVyIGJ5IHJldHVybmluZyBudWxsLlxuICAgICAgICByZXR1cm4gc3RhcnREYXRlIDwgbmV3IERhdGUoKSA/IHN0YXJ0RGF0ZSA6IG51bGw7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnJlcG9ydGVyLndhcm4oJycsIGVyciBhcyBFcnJvcik7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjaGVja1JlcG9zaXRvcnkoXG4gICAgb3duZXI6IHN0cmluZyxcbiAgICByZXBvOiBzdHJpbmcsXG4gICAgZmlsZVBhdGg6IHN0cmluZ1xuICApOiBQcm9taXNlPElSZXBvc2l0b3J5TWF0Y2hbXT4ge1xuICAgIGNvbnN0IG1hdGNoZXM6IElSZXBvc2l0b3J5TWF0Y2hbXSA9IFtdO1xuICAgIHRyeSB7XG4gICAgICB0eXBlIHQgPSBvay5SZXN0RW5kcG9pbnRNZXRob2RUeXBlc1sncmVwb3MnXVsnZ2V0Q29udGVudCddWydyZXNwb25zZSddO1xuICAgICAgY29uc3QgZGF0YTogdCA9IGF3YWl0IHRoaXMub2N0b2tpdC5yZXN0LnJlcG9zLmdldENvbnRlbnQoe1xuICAgICAgICBvd25lcixcbiAgICAgICAgcGF0aDogZmlsZVBhdGgsXG4gICAgICAgIHJlcG8sXG4gICAgICB9KTtcbiAgICAgIHRoaXMuc2V0UmVtYWluaW5nQ2FsbHMoQXBpUmF0ZUxpbWl0LmNoZWNrUmVzdEFwaUxpbWl0KGRhdGEuaGVhZGVycykpO1xuICAgICAgY29uc3QgZmlsZXM6IElGaWxlW10gPSBkYXRhLmRhdGEgYXMgSUZpbGVbXTtcbiAgICAgIGlmIChmaWxlcykge1xuICAgICAgICB0eXBlIHJwID0gb2suUmVzdEVuZHBvaW50TWV0aG9kVHlwZXNbJ3JlcG9zJ11bJ2dldCddWydyZXNwb25zZSddO1xuICAgICAgICBjb25zdCByZXBvUmVzcG9uc2U6IHJwID0gYXdhaXQgdGhpcy5vY3Rva2l0LnJlc3QucmVwb3MuZ2V0KHtcbiAgICAgICAgICBvd25lcixcbiAgICAgICAgICByZXBvLFxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5zZXRSZW1haW5pbmdDYWxscyhcbiAgICAgICAgICBBcGlSYXRlTGltaXQuY2hlY2tSZXN0QXBpTGltaXQocmVwb1Jlc3BvbnNlLmhlYWRlcnMpXG4gICAgICAgICk7XG5cbiAgICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmIChmaWxlLmRvd25sb2FkX3VybCkge1xuICAgICAgICAgICAgICB0eXBlIHJlc3AgPSBvay5SZXN0RW5kcG9pbnRNZXRob2RUeXBlc1sncmVwb3MnXVsnZ2V0Q29udGVudCddWydyZXNwb25zZSddO1xuICAgICAgICAgICAgICBjb25zdCBmOiByZXNwID0gYXdhaXQgdGhpcy5vY3Rva2l0LnJlc3QucmVwb3MuZ2V0Q29udGVudCh7XG4gICAgICAgICAgICAgICAgb3duZXIsXG4gICAgICAgICAgICAgICAgcGF0aDogZmlsZS5wYXRoLFxuICAgICAgICAgICAgICAgIHJlcG8sXG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB0aGlzLnNldFJlbWFpbmluZ0NhbGxzKEFwaVJhdGVMaW1pdC5jaGVja1Jlc3RBcGlMaW1pdChmLmhlYWRlcnMpKTtcbiAgICAgICAgICAgICAgY29uc3QgZmlsZUNvbnRlbnQgPSBCdWZmZXIuZnJvbShcbiAgICAgICAgICAgICAgICAoZi5kYXRhIGFzIGFueSkuY29udGVudCxcbiAgICAgICAgICAgICAgICAnYmFzZTY0J1xuICAgICAgICAgICAgICApLnRvU3RyaW5nKCd1dGY4Jyk7XG4gICAgICAgICAgICAgIGNvbnN0IGxpbmVzID0gZmlsZUNvbnRlbnQuc3BsaXQob3MuRU9MKTtcbiAgICAgICAgICAgICAgbGV0IGxpbmVOdW1iZXIgPSAwO1xuICAgICAgICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgICAgICAgICAgICBsaW5lTnVtYmVyKys7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVnRXhwID0gbmV3IFJlZ0V4cChcbiAgICAgICAgICAgICAgICAgICdsdWtrYS8oPzxhY3Rpb24+KD86Z2V0LWNtYWtlKXwoPzpydW4tY21ha2UpfCg/OnJ1bi12Y3BrZykpQCg/PHZlcnNpb24+W1xcXFx3XFxcXGRcXFxcLl0rKScsXG4gICAgICAgICAgICAgICAgICAnZydcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIGNvbnN0IG1hdGNoQXJyYXkgPSBsaW5lLm1hdGNoQWxsKHJlZ0V4cCk7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBtYXRjaCBvZiBtYXRjaEFycmF5KSB7XG4gICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobWF0Y2guZ3JvdXBzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY29uc3QgaGl0ID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aW9uTmFtZTogbWF0Y2guZ3JvdXBzLmFjdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgIGxpbmU6IGxpbmVOdW1iZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGdpdGh1Yi5nZXRIdG1sVXJsKGZpbGUudXJsLCBsaW5lTnVtYmVyKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHZlcnNpb246IG1hdGNoLmdyb3Vwcy52ZXJzaW9uLFxuICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXBvcnRlci53YXJuKFxuICAgICAgICAgICAgICAgICAgICAgICAgYFxcbiBGb3VuZCAnJHtoaXQuYWN0aW9uTmFtZX1AJHtoaXQudmVyc2lvbn0nIGluIHJlcG86ICR7b3duZXJ9LyR7cmVwb30gJHtyZXBvUmVzcG9uc2UuZGF0YS5zdGFyZ2F6ZXJzX2NvdW50feKtkSAgJHtyZXBvUmVzcG9uc2UuZGF0YS53YXRjaGVyc19jb3VudH3wn5GAYFxuICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgbWF0Y2hlcy5wdXNoKGhpdCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgICAgICBBcGlSYXRlTGltaXQudGhyb3dJZlJhdGVMaW1pdEV4Y2VlZGVkKGVycik7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVwb3J0ZXIud2FybihgY2hlY2tSZXBvc2l0b3J5KCk6YCwgZXJyIGFzIEVycm9yKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgIEFwaVJhdGVMaW1pdC50aHJvd0lmUmF0ZUxpbWl0RXhjZWVkZWQoZXJyKTtcbiAgICAgICAgICAgIHRoaXMucmVwb3J0ZXIud2FybihgY2hlY2tSZXBvc2l0b3J5KCk6YCwgZXJyIGFzIEVycm9yKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gZXJyIGFzIGFueTtcbiAgICAgIGlmIChlcnJvcj8uc3RhdHVzID09PSA0MDQpIHtcbiAgICAgICAgQXBpUmF0ZUxpbWl0LnRocm93SWZSYXRlTGltaXRFeGNlZWRlZChlcnIpO1xuICAgICAgICB0aGlzLnNldFJlbWFpbmluZ0NhbGxzKFxuICAgICAgICAgIEFwaVJhdGVMaW1pdC5jaGVja1Jlc3RBcGlMaW1pdChlcnJvci5yZXNwb25zZS5oZWFkZXJzKVxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgQXBpUmF0ZUxpbWl0LnRocm93SWZSYXRlTGltaXRFeGNlZWRlZChlcnIpO1xuICAgICAgICB0aGlzLnJlcG9ydGVyLndhcm4oYGNoZWNrUmVwb3NpdG9yeSgpOmAsIGVyciBhcyBFcnJvcik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG1hdGNoZXM7XG4gIH1cbn1cbiJdfQ==