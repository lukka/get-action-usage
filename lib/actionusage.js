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
                const nextRunDate = new Date();
                nextRunDate.setUTCHours(24, 0, 0, 0);
                yield this.setupCron(this.actionRootPath, nextRunDate);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWN0aW9udXNhZ2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvYWN0aW9udXNhZ2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBS0EseUJBQXlCO0FBQ3pCLDJCQUEyQjtBQUMzQix5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLHFDQUFxQztBQUNyQyxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBRzNDLHFFQUE0RDtBQUM1RCxpQ0FBd0M7QUFDeEMsNkNBQTBDO0FBUzFDLCtDQUFzQztBQUN0QywrQ0FBeUM7QUFFekMsTUFBYSxhQUFhO0lBa0N4QixZQUNtQixPQUFtQixFQUNuQixvQkFBa0QsRUFDbEQsUUFBbUI7O1FBRm5CLFlBQU8sR0FBUCxPQUFPLENBQVk7UUFDbkIseUJBQW9CLEdBQXBCLG9CQUFvQixDQUE4QjtRQUNsRCxhQUFRLEdBQVIsUUFBUSxDQUFXO1FBVnJCLGNBQVMsR0FBVyxNQUFNLEdBQUcsQ0FBQyxDQUFDO1FBSXhDLDJCQUFzQixHQUFXLENBQUMsQ0FBQztRQVN6QyxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUUzQyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsdUJBQVUsQ0FBQyxVQUFVLENBQzVDLElBQUksSUFBSSxFQUFFLEVBQ1YsYUFBYSxDQUFDLHNCQUFzQixDQUNyQyxDQUFDO1FBQ0YsUUFBUSxDQUFDLElBQUksQ0FDWCxtQkFBbUIsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxtQ0FBbUMsQ0FDM0YsQ0FBQztRQUNGLElBQUksQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUM7UUFDM0MsSUFBSSxDQUFDLFlBQVksR0FBRyxNQUFBLElBQUksQ0FBQyxlQUFlLEVBQUUsbUNBQUksSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDckUsUUFBUSxDQUFDLElBQUksQ0FB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QUFRLENBQUMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLEdBQVksQ0FBQyxDQUFDO3lDQUN4RDtxQ0FDRjtpQ0FDRjs2QkFDRjt5QkFDRjt3QkFBQyxPQUFPLEdBQUcsRUFBRTs0QkFDWix3QkFBWSxDQUFDLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxDQUFDOzRCQUMzQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxHQUFZLENBQUMsQ0FBQzt5QkFDeEQ7cUJBQ0Y7aUJBQ0Y7YUFDRjtZQUFDLE9BQU8sR0FBRyxFQUFFO2dCQUNaLE1BQU0sS0FBSyxHQUFHLEdBQVUsQ0FBQztnQkFDekIsSUFBSSxDQUFBLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxNQUFNLE1BQUssR0FBRyxFQUFFO29CQUN6Qix3QkFBWSxDQUFDLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUMzQyxJQUFJLENBQUMsaUJBQWlCLENBQ3BCLHdCQUFZLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FDdkQsQ0FBQztpQkFDSDtxQkFBTTtvQkFDTCx3QkFBWSxDQUFDLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUMzQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxHQUFZLENBQUMsQ0FBQztpQkFDeEQ7YUFDRjtZQUVELE9BQU8sT0FBTyxDQUFDO1FBQ2pCLENBQUM7S0FBQTs7QUF4ZUgsc0NBeWVDO0FBeGV5QiwrQkFBaUIsR0FBVyxxQkFBcUIsQ0FBQztBQUNsRCw2QkFBZSxHQUFHLHNCQUFzQixDQUFDO0FBQ3pDLDhCQUFnQixHQUFhO0lBQ25ELFNBQVM7SUFDVCxXQUFXO0lBQ1gsU0FBUztDQUNWLENBQUM7QUFHc0Isb0NBQXNCLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCDCqSAyMDIyLTIwMjMgYnkgTHVjYSBDYXBwYSBsY2FwcGFAZ21haWwuY29tXG4vLyBBbGwgY29udGVudCBvZiB0aGlzIHJlcG9zaXRvcnkgaXMgbGljZW5zZWQgdW5kZXIgdGhlIENDIEJZLVNBIExpY2Vuc2UuXG4vLyBTZWUgdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBmb3IgbGljZW5zZSBpbmZvcm1hdGlvbi5cblxuaW1wb3J0ICogYXMgb2sgZnJvbSAnQG9jdG9raXQvcmVzdCc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBMUEYgZnJvbSAnbHBmJztcbmltcG9ydCAqIGFzIG9zIGZyb20gJ29zJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyBiYXIgZnJvbSAnLi9wcm9ncmVzc2Jhcic7XG5pbXBvcnQgKiBhcyBnaXRodWIgZnJvbSAnLi9naXRodWInO1xuXG5pbXBvcnQgeyBBcGlSYXRlTGltaXQgfSBmcm9tICcuL2FwaWxpbWl0cyc7XG5pbXBvcnQgeyBBcGlMaW1pdHNFeGNlcHRpb24gfSBmcm9tICcuL2FwaWxpbWl0c2V4Y2VwdGlvbic7XG5pbXBvcnQgeyBjb21wb25lbnRzIH0gZnJvbSAnQG9jdG9raXQvb3BlbmFwaS10eXBlcyc7XG5pbXBvcnQgeyBDb25maWcgfSBmcm9tICdub2RlLWpzb24tZGIvZGlzdC9saWIvSnNvbkRCQ29uZmlnJztcbmltcG9ydCB7IHRvQ3JvblNjaGVkdWxlIH0gZnJvbSAnLi9jcm9uJztcbmltcG9ydCB7IERhdGVIZWxwZXIgfSBmcm9tICcuL2RhdGVoZWxwZXInO1xuaW1wb3J0IHtcbiAgSUZpbGUsXG4gIElSZXBvc2l0b3J5LFxuICBJUmVwb3NpdG9yaWVzUHJvdmlkZXIsXG4gIElSZXBvc2l0b3JpZXNQcm92aWRlckZhY3RvcnksXG4gIElSZXBvc2l0b3J5TWF0Y2gsXG4gIElSZXBvcnRlcixcbn0gZnJvbSAnLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IEpzb25EQiB9IGZyb20gJ25vZGUtanNvbi1kYic7XG5pbXBvcnQgeyBTdG9wd2F0Y2ggfSBmcm9tICd0cy1zdG9wd2F0Y2gnO1xuXG5leHBvcnQgY2xhc3MgR0hBY3Rpb25Vc2FnZSB7XG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IExhc3RTdGFydFRpbWVOYW1lOiBzdHJpbmcgPSAnL0xhc3RTdGFydFRpbWVOYW1lLyc7XG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IFVzYWdlRGJGaWxlTmFtZSA9ICdhY3Rpb24tdXNhZ2UtZGIuanNvbic7XG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IFdvcmtmbG93RmlsZVBhdGg6IHN0cmluZ1tdID0gW1xuICAgICcuZ2l0aHViJyxcbiAgICAnd29ya2Zsb3dzJyxcbiAgICAncnVuLnltbCcsXG4gIF07XG4gIC8vIFRlcm1pbmF0ZSB0aGUgZXhlY3V0aW9uIGFmdGVyIHRoaXMgdGltZW91dCB0byBwcmV2ZW50IGZvcmNlZCBjYW5jZWxsYXRpb25cbiAgLy8gb24gdGhlIHJ1bm5lciAoc2l4IGhvdXJzKVxuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBJbnRlcm5hbFRpbWVvdXRNaW51dGVzID0gNSAqIDYwO1xuXG4gIHByaXZhdGUgc3RhdGljIGdldFdvcmtzcGFjZVBhdGgoKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3Qga2V5ID0gJ0dJVEhVQl9XT1JLU1BBQ0UnO1xuICAgIHJldHVybiBwcm9jZXNzLmVudltrZXldID8/IG51bGw7XG4gIH1cblxuICAvLyBAdHMtaWdub3JlXG4gIHByaXZhdGUgc3RhdGljIGFzeW5jIGRlbGF5KG1pbGxpczogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKGdpdGh1Yi5pc1J1bm5pbmdPbkdpdEh1YlJ1bm5lcigpKSB7XG4gICAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIG1pbGxpcykpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcmVhZG9ubHkgZGI6IEpzb25EQjtcbiAgcHJpdmF0ZSByZWFkb25seSBwcm9ncmVzc0JhcnM6IGJhci5Qcm9ncmVzc0JhcjtcbiAgLy8gRGF5cyBvZiBlYWNoIHRpbWUgc2VnbWVudC5cbiAgcHJpdmF0ZSByZWFkb25seSB0aW1lUmFuZ2U6IG51bWJlciA9IDYwLjg3NSAvIDI7XG4gIC8vIFN0YXJ0aW5nIGRhdGUgb2YgdGhlIHRpbWUgc2VnbWVudHMuXG4gIHByaXZhdGUgcmVhZG9ubHkgc3RhcnRpbmdEYXRlOiBEYXRlO1xuICBwcml2YXRlIHJlYWRvbmx5IGV4ZWN1dGlvblN0b3BEYXRlOiBEYXRlO1xuICBwcml2YXRlIHRvdGFsUmVwb3NpdG9yeUNoZWNrZWQ6IG51bWJlciA9IDA7XG4gIHByaXZhdGUgcmVhZG9ubHkgYWN0aW9uUm9vdFBhdGg6IHN0cmluZztcblxuICBwdWJsaWMgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBvY3Rva2l0OiBvay5PY3Rva2l0LFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcmVwb3NQcm92aWRlckZhY3Rvcnk6IElSZXBvc2l0b3JpZXNQcm92aWRlckZhY3RvcnksXG4gICAgcHJpdmF0ZSByZWFkb25seSByZXBvcnRlcjogSVJlcG9ydGVyXG4gICkge1xuICAgIC8vIElkZW50aWZ5IGFjdGlvbiBkaXJlY3RvcnlcbiAgICB0aGlzLmFjdGlvblJvb3RQYXRoID0gdGhpcy5nZXRBY3Rpb25QYXRoKCk7XG5cbiAgICB0aGlzLmV4ZWN1dGlvblN0b3BEYXRlID0gRGF0ZUhlbHBlci5hZGRNaW51dGVzKFxuICAgICAgbmV3IERhdGUoKSxcbiAgICAgIEdIQWN0aW9uVXNhZ2UuSW50ZXJuYWxUaW1lb3V0TWludXRlc1xuICAgICk7XG4gICAgcmVwb3J0ZXIuaW5mbyhcbiAgICAgIGBFeGVjdXRpbmcgdW50aWwgJHt0aGlzLmV4ZWN1dGlvblN0b3BEYXRlLnRvVVRDU3RyaW5nKCl9IG9yIHVudGlsIEFQSSByYXRlIGxpbWl0IHJlYWNoZWQuYFxuICAgICk7XG4gICAgdGhpcy5kYiA9IHRoaXMub3BlbkRiKHRoaXMuYWN0aW9uUm9vdFBhdGgpO1xuICAgIHRoaXMuc3RhcnRpbmdEYXRlID0gdGhpcy5nZXRTdGFydGluZ0RhdGUoKSA/PyBuZXcgRGF0ZSgnMjAxMC0wMS0wMScpO1xuICAgIHJlcG9ydGVyLmluZm8oYFN0YXJ0aW5nIGRhdGU6ICR7dGhpcy5zdGFydGluZ0RhdGUudG9VVENTdHJpbmcoKX0nLmApO1xuXG4gICAgdGhpcy5wcm9ncmVzc0JhcnMgPSBuZXcgYmFyLlByb2dyZXNzQmFyKCk7XG5cbiAgICBMUEYuc21vb3RoaW5nID0gMC41O1xuICAgIExQRi5pbml0KDApO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHJ1bigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKGBydW4oKTw8ICR7bmV3IERhdGUoKS50b1VUQ1N0cmluZygpfWApO1xuICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1jb25zb2xlXG4gICAgY29uc29sZS50aW1lKCdydW4oKTonKTtcbiAgICBsZXQgc3RhcnREYXRlID0gdGhpcy5zdGFydGluZ0RhdGU7XG5cbiAgICAvLyBJZiBhbHJlYWR5IHJ1bm5pbmcsIGVuc3VyZSB0byBleGl0IGJlZm9yZSBtb2RpZnlpbmcgYW55IGxvY2FsIGZpbGUgdGhhdCB3b3VsZCB0aGVuXG4gICAgLy8gYmUgY29tbWl0dGVkLlxuICAgIGlmIChhd2FpdCB0aGlzLmlzQWxyZWFkeVJ1bm5pbmcoKSkge1xuICAgICAgdGhpcy5yZXBvcnRlci5pbmZvKCdBbHJlYWR5IHJ1bm5pbmcsIGV4aXRpbmcuLi4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcblxuICAgICAgLy8gQ29tcHV0ZSB0aGUgdG90YWwgdGltZS1zZWdtZW50cyBvZiAndGltZVJhbmdlJyBkYXlzIGVhY2guXG4gICAgICB0aGlzLnByb2dyZXNzQmFycy5pbml0KHN0YXJ0RGF0ZSwgdGhpcy50aW1lUmFuZ2UpO1xuXG4gICAgICBsZXQgdGltZVNlZ21lbnQgPSAxO1xuICAgICAgbGV0IG5leHREYXRlID0gRGF0ZUhlbHBlci5hZGREYXlzKHN0YXJ0RGF0ZSwgdGhpcy50aW1lUmFuZ2UpO1xuXG4gICAgICAvLyBJdGVyYXRlIG92ZXIgYWxsIHRpbWUgc2VnbWVudHMuXG4gICAgICB3aGlsZSAoc3RhcnREYXRlIDwgbm93ICYmIHRoaXMuZXhlY3V0aW9uU3RvcERhdGUgPiBuZXcgRGF0ZSgpKSB7XG4gICAgICAgIGNvbnN0IHJlcG9Qcm92aWRlciA9IGF3YWl0IHRoaXMucmVwb3NQcm92aWRlckZhY3RvcnkuY3JlYXRlKFxuICAgICAgICAgIHRoaXMub2N0b2tpdCxcbiAgICAgICAgICBzdGFydERhdGUsXG4gICAgICAgICAgbmV4dERhdGUsXG4gICAgICAgICAgdGhpc1xuICAgICAgICApO1xuXG4gICAgICAgIGNvbnN0IHJlcG9zOiBJUmVwb3NpdG9yeVtdID0gYXdhaXQgdGhpcy5nZXRSZXBvTGlzdChyZXBvUHJvdmlkZXIpO1xuXG4gICAgICAgIHRoaXMucHJvZ3Jlc3NCYXJzLnVwZGF0ZShcbiAgICAgICAgICBzdGFydERhdGUsXG4gICAgICAgICAgbmV4dERhdGUsXG4gICAgICAgICAgcmVwb1Byb3ZpZGVyLmNvdW50LFxuICAgICAgICAgIHRpbWVTZWdtZW50XG4gICAgICAgICk7XG5cbiAgICAgICAgY29uc3Qgc3cgPSBuZXcgU3RvcHdhdGNoKCk7XG4gICAgICAgIHN3LnN0YXJ0KCk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5pdGVyYXRlVGltZVNlZ21lbnQocmVwb1Byb3ZpZGVyLCByZXBvcywgc3cpO1xuXG4gICAgICAgIC8vIEFkdmFuY2UgdGltZSByYW5nZS5cbiAgICAgICAgdGltZVNlZ21lbnQrKztcbiAgICAgICAgc3RhcnREYXRlID0gbmV4dERhdGU7XG4gICAgICAgIG5leHREYXRlID0gRGF0ZUhlbHBlci5hZGREYXlzKHN0YXJ0RGF0ZSwgdGhpcy50aW1lUmFuZ2UpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKEFwaVJhdGVMaW1pdC5pc1JhdGVMaW1pdEV4Y2VwdGlvbihlcnIpKSB7XG4gICAgICAgIGNvbnN0IGUgPSBlcnIgYXMgQXBpTGltaXRzRXhjZXB0aW9uO1xuICAgICAgICBjb25zdCBjdXJyZW50UmVtYWluaW5nID1cbiAgICAgICAgICBlLnJlbWFpbmluZyAhPT0gdW5kZWZpbmVkID8gJycgKyBlLnJlbWFpbmluZyA6ICc8dW5rbm93bj4nO1xuICAgICAgICBjb25zdCBuZXh0UXVvdGFSZXNldCA9IGUubmV4dFJlc2V0XG4gICAgICAgICAgPyBlLm5leHRSZXNldC50b1VUQ1N0cmluZygpXG4gICAgICAgICAgOiAnPHVua25vd24+JztcbiAgICAgICAgdGhpcy5yZXBvcnRlci53YXJuKFxuICAgICAgICAgIGAke29zLkVPTH0ke1xuICAgICAgICAgICAgb3MuRU9MXG4gICAgICAgICAgfSBBUEkgcmF0ZSBsaW1pdCBhbG1vc3QgcmVhY2hlZCBhdCAnJHtjdXJyZW50UmVtYWluaW5nfScgcmVtYWluaW5nIGNhbGxzLiBTdG9yaW5nIGN1cnJlbnQgc3RhcnRpbmcgZGF0ZTogJyR7c3RhcnREYXRlLnRvVVRDU3RyaW5nKCl9JyBpbiBkYi5gICtcbiAgICAgICAgICAgIGAgTmV4dCBxdW90YSByZXNldCBvbiAnJHtuZXh0UXVvdGFSZXNldH0nLmBcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucmVwb3J0ZXIud2FybignJywgZXJyIGFzIEVycm9yKTtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICAvLyBQcm9sb2d1ZVxuICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZygnU2F2aW5nIGRhdGEgYmVmb3JlIGV4aXRpbmcuLi4nKTtcblxuICAgICAgY29uc3QgbGltaXRzID0gYXdhaXQgdGhpcy5nZXRSZXN0Q3VycmVudExpbWl0cygpO1xuICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhKU09OLnN0cmluZ2lmeShsaW1pdHMpKTtcblxuICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhcbiAgICAgICAgYGRiLnB1c2ggJHtHSEFjdGlvblVzYWdlLkxhc3RTdGFydFRpbWVOYW1lfSAke3N0YXJ0RGF0ZS50b1VUQ1N0cmluZygpfWBcbiAgICAgICk7XG4gICAgICB0aGlzLmRiLnB1c2goXG4gICAgICAgIEdIQWN0aW9uVXNhZ2UuTGFzdFN0YXJ0VGltZU5hbWUsXG4gICAgICAgIGAke3N0YXJ0RGF0ZS50b1VUQ1N0cmluZygpfWAsXG4gICAgICAgIHRydWVcbiAgICAgICk7XG4gICAgICB0aGlzLmRiLnNhdmUodHJ1ZSk7XG5cbiAgICAgIC8vIExhdW5jaGluZyB0aGUgd29ya2Zsb3cgYWdhaW4gYXQgbGltaXRzLnJlc2V0IHRpbWUgd2lsbFxuICAgICAgLy8gZXhoYXVzdHMgYWdhaW4gYWxsIHRoZSBBUEkgcXVvdGEuIExldCdzIHJ1biBpdCBhdCBtaWRuaWdodCBlYWNoIGRheS5cbiAgICAgIC8vIGF3YWl0IHRoaXMuc2V0dXBDcm9uKHRoaXMuYWN0aW9uUm9vdFBhdGgsIGxpbWl0cy5yZXNldCk7XG4gICAgICBjb25zdCBuZXh0UnVuRGF0ZSA9IG5ldyBEYXRlKCk7XG4gICAgICBuZXh0UnVuRGF0ZS5zZXRVVENIb3VycygyNCwgMCwgMCwgMCk7XG4gICAgICBhd2FpdCB0aGlzLnNldHVwQ3Jvbih0aGlzLmFjdGlvblJvb3RQYXRoLCBuZXh0UnVuRGF0ZSk7XG5cbiAgICAgIHRoaXMucHJvZ3Jlc3NCYXJzLnN0b3AoKTtcbiAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1jb25zb2xlXG4gICAgICBjb25zb2xlLnRpbWVMb2coJ3J1bigpJyk7XG4gICAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKGBydW4oKT4+YCk7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIHNldFJlbWFpbmluZ0NhbGxzKHJlc3RBcGk/OiBudW1iZXIsIHNlYXJjaEFwaT86IG51bWJlcik6IHZvaWQge1xuICAgIHRoaXMucHJvZ3Jlc3NCYXJzLnVwZGF0ZUFwaVF1b3RhKHJlc3RBcGksIHNlYXJjaEFwaSk7XG4gIH1cblxuICAvLyBJZGVudGlmeSB0aGUgbG9jYXRpb24gd2hlcmUgdGhlIGFjdGlvbiBpcyBjaGVja2VkIG91dCBieSBzZWVraW5nIGZvciB0aGUgcnVuLnltbCBmaWxlLlxuICBwcml2YXRlIGdldEFjdGlvblBhdGgoKTogc3RyaW5nIHtcbiAgICBsZXQgYWN0aW9uUGF0aCA9IG51bGw7XG4gICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhgZ2V0QWN0aW9uUGF0aCgpPDxgKTtcbiAgICBjb25zdCBkcyA9IFtcbiAgICAgIHByb2Nlc3MuY3dkKCkgPz8gJycsXG4gICAgICBHSEFjdGlvblVzYWdlLmdldFdvcmtzcGFjZVBhdGgoKSA/PyAnJyxcbiAgICAgIGAke19fZGlybmFtZSArIHBhdGguc2VwfS4uYCxcbiAgICBdO1xuICAgIGZvciAoY29uc3QgZCBvZiBkcykge1xuICAgICAgY29uc3Qgd2ZmcCA9IHBhdGguam9pbihkLCAuLi5HSEFjdGlvblVzYWdlLldvcmtmbG93RmlsZVBhdGgpO1xuICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhgY2hlY2tpbmcgZm9yICcke2R9Jy4uLmApO1xuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMod2ZmcCkpIHtcbiAgICAgICAgYWN0aW9uUGF0aCA9IGQ7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoIWFjdGlvblBhdGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGlkZW50aWZ5IHRoZSBhY3Rpb24gcm9vdCBkaXJlY3RvcnkuYCk7XG4gICAgfVxuICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoYGdldEFjdGlvblBhdGgoKT4+JyR7YWN0aW9uUGF0aH0nYCk7XG4gICAgcmV0dXJuIGFjdGlvblBhdGg7XG4gIH1cblxuICAvLyBDaGVjayB3aGV0aGVyIGFueSB3b3JrZmxvdyBpcyBhbHJlYWR5IHJ1bm5pbmcgZm9yIHRoaXMgcmVwb3NpdG9yeS5cbiAgcHJpdmF0ZSBhc3luYyBpc0FscmVhZHlSdW5uaW5nKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGlmICghZ2l0aHViLmlzUnVubmluZ09uR2l0SHViUnVubmVyKCkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgY29uc3QgR0lUSFVCX1JFUE9TSVRPUlkgPSAnR0lUSFVCX1JFUE9TSVRPUlknO1xuICAgIGNvbnN0IG93bmVyOiBzdHJpbmcgfCB1bmRlZmluZWQgPSBwcm9jZXNzLmVudltHSVRIVUJfUkVQT1NJVE9SWV0/LnNwbGl0KFxuICAgICAgJy8nXG4gICAgKVswXTtcbiAgICBjb25zdCByZXBvOiBzdHJpbmcgfCB1bmRlZmluZWQgPSBwcm9jZXNzLmVudltHSVRIVUJfUkVQT1NJVE9SWV0/LnNwbGl0KFxuICAgICAgJy8nXG4gICAgKVsxXTtcbiAgICBpZiAoIShvd25lciAmJiByZXBvKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgVGhlIGVudiB2YXIgR0lUSFVCX1JFUE9TSVRPUlkgaXMgbm90IGRlZmluZWQ6ICcke0dJVEhVQl9SRVBPU0lUT1JZfScuYFxuICAgICAgKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgdHlwZSByZXNwb25zZVR5cGUgPSBvay5SZXN0RW5kcG9pbnRNZXRob2RUeXBlc1snYWN0aW9ucyddWydsaXN0V29ya2Zsb3dSdW5zRm9yUmVwbyddWydyZXNwb25zZSddO1xuICAgICAgY29uc3QgcmVzcG9uc2U6IHJlc3BvbnNlVHlwZSA9IGF3YWl0IHRoaXMub2N0b2tpdC5yZXN0LmFjdGlvbnMubGlzdFdvcmtmbG93UnVuc0ZvclJlcG8oXG4gICAgICAgIHtcbiAgICAgICAgICBvd25lcixcbiAgICAgICAgICByZXBvLFxuICAgICAgICB9XG4gICAgICApO1xuICAgICAgdHlwZSB3b3JrZmxvd1J1blR5cGUgPSBBcnJheTxjb21wb25lbnRzWydzY2hlbWFzJ11bJ3dvcmtmbG93LXJ1biddPjtcbiAgICAgIGNvbnN0IHdmczogd29ya2Zsb3dSdW5UeXBlID0gcmVzcG9uc2UuZGF0YS53b3JrZmxvd19ydW5zO1xuICAgICAgY29uc3QgcnVubmluZ1dmID0gd2ZzLmZpbHRlcihcbiAgICAgICAgd2YgPT4gd2Yuc3RhdHVzID09PSAnaW5fcHJvZ3Jlc3MnIHx8IHdmLnN0YXR1cyA9PT0gJ3F1ZXVlZCdcbiAgICAgICk7XG5cbiAgICAgIHJldHVybiBydW5uaW5nV2YubGVuZ3RoID4gMTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHRoaXMucmVwb3J0ZXIuZXJyb3IoXG4gICAgICAgIGBDYW5ub3QgZGV0ZXJtaW5lIGlmIGFscmVhZHkgcnVubmluZzogJHtKU09OLnN0cmluZ2lmeShlcnIpfWBcbiAgICAgICk7XG4gICAgICB0aGlzLnJlcG9ydGVyLmVycm9yKFxuICAgICAgICBgUHJldGVuZGluZyB0byBiZSBydW5uaW5nIGFscmVhZHkgdG8gZXhpdCBpbW1lZGlhdGVseSBhbmQgYXZvaWQgcG90ZW50aWFsIHJlZnVzZWQgJ2dpdCBwdXNoJy5gXG4gICAgICApO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBvcGVuRGIocm9vdFBhdGg6IHN0cmluZyk6IEpzb25EQiB7XG4gICAgbGV0IGRiOiBKc29uREI7XG4gICAgY29uc3QgZGJQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnZ3JhcGgnLCBHSEFjdGlvblVzYWdlLlVzYWdlRGJGaWxlTmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoYE9wZW5pbmcgREIgYXQgJyR7ZGJQYXRofScuLi4uYCk7XG4gICAgICBkYiA9IG5ldyBKc29uREIobmV3IENvbmZpZyhkYlBhdGgsIHRydWUsIHRydWUsICcvJykpO1xuICAgICAgZGIuZ2V0RGF0YShHSEFjdGlvblVzYWdlLkxhc3RTdGFydFRpbWVOYW1lKTtcbiAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoYERCIG9wZW5lZCBhdCAnJHtkYlBhdGh9Jy5gKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHRoaXMucmVwb3J0ZXIud2FybigoZXJyIGFzIEVycm9yKT8ubWVzc2FnZSk7XG4gICAgICBmcy51bmxpbmtTeW5jKGRiUGF0aCk7XG4gICAgICBkYiA9IG5ldyBKc29uREIobmV3IENvbmZpZyhkYlBhdGgsIHRydWUsIHRydWUsICcvJykpO1xuICAgICAgdGhpcy5yZXBvcnRlci5pbmZvKGBEQiBhdCAnJHtkYlBhdGh9JyByZS1vcGVuZWQgc3VjY2Vzc2Z1bGx5LmApO1xuICAgIH1cblxuICAgIHJldHVybiBkYjtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2V0dXBDcm9uKHJvb3RQYXRoOiBzdHJpbmcsIGRhdGU6IERhdGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgLy8gUmVhZCBjb250ZW50IG9mIHdvcmtmbG93IGZpbGUuXG4gICAgICBjb25zdCBmaWxlUGF0aCA9IHBhdGguam9pbihyb290UGF0aCwgLi4uR0hBY3Rpb25Vc2FnZS5Xb3JrZmxvd0ZpbGVQYXRoKTtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsIHtcbiAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgZmxhZzogJ3InLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFBhdGNoIHRoZSBuZXh0IGV4ZWN1dGlvblxuICAgICAgY29uc3QgbmV4dENyb25TY2hlZHVsZSA9IGAnJHt0b0Nyb25TY2hlZHVsZShkYXRlKX0nYDtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdChvcy5FT0wpO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAobGluZXNbaV0uaW5kZXhPZignMCAqICogKiAqJykgIT09IC0xKSB7XG4gICAgICAgICAgY29uc3Qgb2xkQ3JvbiA9ICctIGNyb246ICc7XG4gICAgICAgICAgY29uc3Qgb2Zmc2V0ID0gbGluZXNbaSArIDFdLmluZGV4T2Yob2xkQ3Jvbik7XG4gICAgICAgICAgbGluZXNbaSArIDFdID1cbiAgICAgICAgICAgIGxpbmVzW2kgKyAxXS5zdWJzdHJpbmcoMCwgb2Zmc2V0ICsgb2xkQ3Jvbi5sZW5ndGgpICtcbiAgICAgICAgICAgIG5leHRDcm9uU2NoZWR1bGU7XG4gICAgICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhgbmV4dCBjcm9uIHNjaGVkdWxlIHNldCB0byAnJHtsaW5lc1tpICsgMV19J2ApO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBhdGNoZWRDb250ZW50ID0gbGluZXMuam9pbihvcy5FT0wpO1xuICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhwYXRjaGVkQ29udGVudCk7XG4gICAgICBmcy53cml0ZUZpbGVTeW5jKGZpbGVQYXRoLCBwYXRjaGVkQ29udGVudCk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnJlcG9ydGVyLmVycm9yKGBzZXR1cENyb24oKSBmYWlsZWQ6ICR7ZXJyfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0UmVwb0xpc3QoXG4gICAgcmVwb1Byb3ZpZGVyOiBJUmVwb3NpdG9yaWVzUHJvdmlkZXJcbiAgKTogUHJvbWlzZTxJUmVwb3NpdG9yeVtdPiB7XG4gICAgcmV0dXJuIHJlcG9Qcm92aWRlci5nZXROZXh0UmVwb3MoKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaXRlcmF0ZVRpbWVTZWdtZW50KFxuICAgIHJlcG9Qcm92aWRlcjogSVJlcG9zaXRvcmllc1Byb3ZpZGVyLFxuICAgIHJlcG9zOiBJUmVwb3NpdG9yeVtdLFxuICAgIHN3OiBTdG9wd2F0Y2hcbiAgKSB7XG4gICAgdHJ5IHtcbiAgICAgIGxldCBiYXJDb3VudGVyID0gMDtcbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGNvbnN0IHBzOiBBcnJheTxQcm9taXNlPHZvaWQ+PiA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGFSZXBvIG9mIHJlcG9zKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMucHJvZ3Jlc3NCYXJzLnVwZGF0ZVJlcG8oYmFyQ291bnRlciwge1xuICAgICAgICAgICAgICBhY3Rpb246IGJhci5Qcm9ncmVzc0Jhci5nZXRBY3Rpb25TdHJpbmcoXG4gICAgICAgICAgICAgICAgYGNoZWNraW5nIHJlcG8uLi4gJyR7YVJlcG8ub3duZXJ9LyR7YVJlcG8ubmFtZX0nYFxuICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zdCB0YXNrID0gbmV3IFByb21pc2U8dm9pZD4oYXN5bmMgKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgICBsZXQgbWF0Y2hlczogSVJlcG9zaXRvcnlNYXRjaFtdO1xuICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIG1hdGNoZXMgPSBhd2FpdCB0aGlzLmNoZWNrUmVwb3NpdG9yeShcbiAgICAgICAgICAgICAgICAgIGFSZXBvLm93bmVyLFxuICAgICAgICAgICAgICAgICAgYVJlcG8ubmFtZSxcbiAgICAgICAgICAgICAgICAgICcuZ2l0aHViL3dvcmtmbG93cydcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICBBcGlSYXRlTGltaXQuY2hlY2tSZXN0QXBpTGltaXQoXG4gICAgICAgICAgICAgICAgICAgIChlcnJvciBhcyBhbnkpPy5yZXNwb25zZT8uaGVhZGVyc1xuICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgIHJlamVjdChlcnIpO1xuICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IGtleSA9IGAvJHthUmVwby5vd25lcn0vJHthUmVwby5uYW1lfWA7XG4gICAgICAgICAgICAgIGlmIChtYXRjaGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmRiLnB1c2goa2V5LCBbLi4ubWF0Y2hlcywgYVJlcG9dLCB0cnVlKTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlcG9ydGVyLmluZm8oYG5vIGhpdHMgZm9yIGtleTogJyR7a2V5fScuYCk7XG4gICAgICAgICAgICAgICAgLy8gUmVtb3ZlIGVudHJpZXMgdGhhdCBhcmUgbm90IHVzaW5nIHRoZSBhY3Rpb25zIGFueW1vcmUuXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZGIuZXhpc3RzKGtleSkpIHtcbiAgICAgICAgICAgICAgICAgIHRoaXMuZGIuZGVsZXRlKGtleSk7XG4gICAgICAgICAgICAgICAgICB0aGlzLnJlcG9ydGVyLndhcm4oXG4gICAgICAgICAgICAgICAgICAgIGByZW1vdmVkIHRoZSByZXBvc2l0b3J5IHdpdGgga2V5OiAnJHtrZXl9Jy5gXG4gICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGJhckNvdW50ZXIrKztcbiAgICAgICAgICAgICAgdGhpcy50b3RhbFJlcG9zaXRvcnlDaGVja2VkKys7XG5cbiAgICAgICAgICAgICAgY29uc3QgdG90YWxUaW1lTWlsbGlzID0gc3cuZ2V0VGltZSgpO1xuXG4gICAgICAgICAgICAgIHRoaXMucHJvZ3Jlc3NCYXJzLnVwZGF0ZVJlcG8oYmFyQ291bnRlciwge1xuICAgICAgICAgICAgICAgIGFjdGlvbjogYmFyLlByb2dyZXNzQmFyLmdldEFjdGlvblN0cmluZyhcbiAgICAgICAgICAgICAgICAgIGBjaGVja2luZyByZXBvLi4uICcke2FSZXBvLm93bmVyfS8ke2FSZXBvLm5hbWV9J2BcbiAgICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICAgIHNwZWVkOiBgJHtMUEYubmV4dChcbiAgICAgICAgICAgICAgICAgIHRoaXMudG90YWxSZXBvc2l0b3J5Q2hlY2tlZCAvICh0b3RhbFRpbWVNaWxsaXMgLyA2MDAwMC4wKVxuICAgICAgICAgICAgICAgICkudG9GaXhlZCgxKX0gcmVwby9taW5gLnBhZFN0YXJ0KDMsICcgJyksXG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHBzLnB1c2godGFzayk7XG4gICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICBBcGlSYXRlTGltaXQudGhyb3dJZlJhdGVMaW1pdEV4Y2VlZGVkKGVycik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocHMpO1xuICAgICAgICB0aGlzLnByb2dyZXNzQmFycy51cGRhdGVSZXBvKGJhckNvdW50ZXIsIHtcbiAgICAgICAgICBhY3Rpb246IGJhci5Qcm9ncmVzc0Jhci5nZXRBY3Rpb25TdHJpbmcoYGxpc3RpbmcgcmVwb3MuLi5gKSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJlcG9zID0gYXdhaXQgdGhpcy5nZXRSZXBvTGlzdChyZXBvUHJvdmlkZXIpO1xuICAgICAgICBpZiAocmVwb3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIEFwaVJhdGVMaW1pdC50aHJvd0lmUmF0ZUxpbWl0RXhjZWVkZWQoZXJyKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldFJlc3RDdXJyZW50TGltaXRzKCk6IFByb21pc2U8e1xuICAgIHJlbWFpbmluZzogbnVtYmVyO1xuICAgIHJlc2V0OiBEYXRlO1xuICB9PiB7XG4gICAgdHlwZSByZXNwb25zZSA9IG9rLlJlc3RFbmRwb2ludE1ldGhvZFR5cGVzWydyYXRlTGltaXQnXVsnZ2V0J11bJ3Jlc3BvbnNlJ107XG4gICAgY29uc3QgbGltaXRzOiByZXNwb25zZSA9IGF3YWl0IHRoaXMub2N0b2tpdC5yZXN0LnJhdGVMaW1pdC5nZXQoKTtcbiAgICByZXR1cm4ge1xuICAgICAgcmVtYWluaW5nOiBsaW1pdHMuZGF0YS5yZXNvdXJjZXMuY29yZS5yZW1haW5pbmcsXG4gICAgICByZXNldDogbmV3IERhdGUobGltaXRzLmRhdGEucmVzb3VyY2VzLmNvcmUucmVzZXQgKiAxMDAwKSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRTdGFydGluZ0RhdGUoKTogRGF0ZSB8IG51bGwge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBkYXRlOiBzdHJpbmcgPSB0aGlzLmRiLmdldERhdGEoR0hBY3Rpb25Vc2FnZS5MYXN0U3RhcnRUaW1lTmFtZSk7XG4gICAgICBjb25zdCB0aW1lc3RhbXAgPSBEYXRlLnBhcnNlKGRhdGUpO1xuICAgICAgaWYgKGlzTmFOKHRpbWVzdGFtcCkgPT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IHN0YXJ0RGF0ZTogRGF0ZSA9IG5ldyBEYXRlKHRpbWVzdGFtcCk7XG4gICAgICAgIC8vIElmIHN0YXJ0IGRhdGUgaXMgbW9yZSByZWNlbnQgdGhhbiBfbm93XywgcmVzdGFydCBvdmVyIGJ5IHJldHVybmluZyBudWxsLlxuICAgICAgICByZXR1cm4gc3RhcnREYXRlIDwgbmV3IERhdGUoKSA/IHN0YXJ0RGF0ZSA6IG51bGw7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnJlcG9ydGVyLndhcm4oJycsIGVyciBhcyBFcnJvcik7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjaGVja1JlcG9zaXRvcnkoXG4gICAgb3duZXI6IHN0cmluZyxcbiAgICByZXBvOiBzdHJpbmcsXG4gICAgZmlsZVBhdGg6IHN0cmluZ1xuICApOiBQcm9taXNlPElSZXBvc2l0b3J5TWF0Y2hbXT4ge1xuICAgIGNvbnN0IG1hdGNoZXM6IElSZXBvc2l0b3J5TWF0Y2hbXSA9IFtdO1xuICAgIHRyeSB7XG4gICAgICB0eXBlIHQgPSBvay5SZXN0RW5kcG9pbnRNZXRob2RUeXBlc1sncmVwb3MnXVsnZ2V0Q29udGVudCddWydyZXNwb25zZSddO1xuICAgICAgY29uc3QgZGF0YTogdCA9IGF3YWl0IHRoaXMub2N0b2tpdC5yZXN0LnJlcG9zLmdldENvbnRlbnQoe1xuICAgICAgICBvd25lcixcbiAgICAgICAgcGF0aDogZmlsZVBhdGgsXG4gICAgICAgIHJlcG8sXG4gICAgICB9KTtcbiAgICAgIHRoaXMuc2V0UmVtYWluaW5nQ2FsbHMoQXBpUmF0ZUxpbWl0LmNoZWNrUmVzdEFwaUxpbWl0KGRhdGEuaGVhZGVycykpO1xuICAgICAgY29uc3QgZmlsZXM6IElGaWxlW10gPSBkYXRhLmRhdGEgYXMgSUZpbGVbXTtcbiAgICAgIGlmIChmaWxlcykge1xuICAgICAgICB0eXBlIHJwID0gb2suUmVzdEVuZHBvaW50TWV0aG9kVHlwZXNbJ3JlcG9zJ11bJ2dldCddWydyZXNwb25zZSddO1xuICAgICAgICBjb25zdCByZXBvUmVzcG9uc2U6IHJwID0gYXdhaXQgdGhpcy5vY3Rva2l0LnJlc3QucmVwb3MuZ2V0KHtcbiAgICAgICAgICBvd25lcixcbiAgICAgICAgICByZXBvLFxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5zZXRSZW1haW5pbmdDYWxscyhcbiAgICAgICAgICBBcGlSYXRlTGltaXQuY2hlY2tSZXN0QXBpTGltaXQocmVwb1Jlc3BvbnNlLmhlYWRlcnMpXG4gICAgICAgICk7XG5cbiAgICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmIChmaWxlLmRvd25sb2FkX3VybCkge1xuICAgICAgICAgICAgICB0eXBlIHJlc3AgPSBvay5SZXN0RW5kcG9pbnRNZXRob2RUeXBlc1sncmVwb3MnXVsnZ2V0Q29udGVudCddWydyZXNwb25zZSddO1xuICAgICAgICAgICAgICBjb25zdCBmOiByZXNwID0gYXdhaXQgdGhpcy5vY3Rva2l0LnJlc3QucmVwb3MuZ2V0Q29udGVudCh7XG4gICAgICAgICAgICAgICAgb3duZXIsXG4gICAgICAgICAgICAgICAgcGF0aDogZmlsZS5wYXRoLFxuICAgICAgICAgICAgICAgIHJlcG8sXG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB0aGlzLnNldFJlbWFpbmluZ0NhbGxzKEFwaVJhdGVMaW1pdC5jaGVja1Jlc3RBcGlMaW1pdChmLmhlYWRlcnMpKTtcbiAgICAgICAgICAgICAgY29uc3QgZmlsZUNvbnRlbnQgPSBCdWZmZXIuZnJvbShcbiAgICAgICAgICAgICAgICAoZi5kYXRhIGFzIGFueSkuY29udGVudCxcbiAgICAgICAgICAgICAgICAnYmFzZTY0J1xuICAgICAgICAgICAgICApLnRvU3RyaW5nKCd1dGY4Jyk7XG4gICAgICAgICAgICAgIGNvbnN0IGxpbmVzID0gZmlsZUNvbnRlbnQuc3BsaXQob3MuRU9MKTtcbiAgICAgICAgICAgICAgbGV0IGxpbmVOdW1iZXIgPSAwO1xuICAgICAgICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgICAgICAgICAgICBsaW5lTnVtYmVyKys7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVnRXhwID0gbmV3IFJlZ0V4cChcbiAgICAgICAgICAgICAgICAgICdsdWtrYS8oPzxhY3Rpb24+KD86Z2V0LWNtYWtlKXwoPzpydW4tY21ha2UpfCg/OnJ1bi12Y3BrZykpQCg/PHZlcnNpb24+W1xcXFx3XFxcXGRcXFxcLl0rKScsXG4gICAgICAgICAgICAgICAgICAnZydcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIGNvbnN0IG1hdGNoQXJyYXkgPSBsaW5lLm1hdGNoQWxsKHJlZ0V4cCk7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBtYXRjaCBvZiBtYXRjaEFycmF5KSB7XG4gICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobWF0Y2guZ3JvdXBzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY29uc3QgaGl0ID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aW9uTmFtZTogbWF0Y2guZ3JvdXBzLmFjdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgIGxpbmU6IGxpbmVOdW1iZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGdpdGh1Yi5nZXRIdG1sVXJsKGZpbGUudXJsLCBsaW5lTnVtYmVyKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHZlcnNpb246IG1hdGNoLmdyb3Vwcy52ZXJzaW9uLFxuICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXBvcnRlci53YXJuKFxuICAgICAgICAgICAgICAgICAgICAgICAgYFxcbiBGb3VuZCAnJHtoaXQuYWN0aW9uTmFtZX1AJHtoaXQudmVyc2lvbn0nIGluIHJlcG86ICR7b3duZXJ9LyR7cmVwb30gJHtyZXBvUmVzcG9uc2UuZGF0YS5zdGFyZ2F6ZXJzX2NvdW50feKtkSAgJHtyZXBvUmVzcG9uc2UuZGF0YS53YXRjaGVyc19jb3VudH3wn5GAYFxuICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgbWF0Y2hlcy5wdXNoKGhpdCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgICAgICBBcGlSYXRlTGltaXQudGhyb3dJZlJhdGVMaW1pdEV4Y2VlZGVkKGVycik7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVwb3J0ZXIud2FybihgY2hlY2tSZXBvc2l0b3J5KCk6YCwgZXJyIGFzIEVycm9yKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgIEFwaVJhdGVMaW1pdC50aHJvd0lmUmF0ZUxpbWl0RXhjZWVkZWQoZXJyKTtcbiAgICAgICAgICAgIHRoaXMucmVwb3J0ZXIud2FybihgY2hlY2tSZXBvc2l0b3J5KCk6YCwgZXJyIGFzIEVycm9yKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gZXJyIGFzIGFueTtcbiAgICAgIGlmIChlcnJvcj8uc3RhdHVzID09PSA0MDQpIHtcbiAgICAgICAgQXBpUmF0ZUxpbWl0LnRocm93SWZSYXRlTGltaXRFeGNlZWRlZChlcnIpO1xuICAgICAgICB0aGlzLnNldFJlbWFpbmluZ0NhbGxzKFxuICAgICAgICAgIEFwaVJhdGVMaW1pdC5jaGVja1Jlc3RBcGlMaW1pdChlcnJvci5yZXNwb25zZS5oZWFkZXJzKVxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgQXBpUmF0ZUxpbWl0LnRocm93SWZSYXRlTGltaXRFeGNlZWRlZChlcnIpO1xuICAgICAgICB0aGlzLnJlcG9ydGVyLndhcm4oYGNoZWNrUmVwb3NpdG9yeSgpOmAsIGVyciBhcyBFcnJvcik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG1hdGNoZXM7XG4gIH1cbn1cbiJdfQ==