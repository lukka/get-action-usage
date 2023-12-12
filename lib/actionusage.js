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
                const nextRunDate = new Date(new Date().setUTCHours(24, 0, 0, 0));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWN0aW9udXNhZ2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvYWN0aW9udXNhZ2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBS0EseUJBQXlCO0FBQ3pCLDJCQUEyQjtBQUMzQix5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLHFDQUFxQztBQUNyQyxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBRzNDLHFFQUE0RDtBQUM1RCxpQ0FBd0M7QUFDeEMsNkNBQTBDO0FBUzFDLCtDQUFzQztBQUN0QywrQ0FBeUM7QUFFekMsTUFBYSxhQUFhO0lBa0N4QixZQUNtQixPQUFtQixFQUNuQixvQkFBa0QsRUFDbEQsUUFBbUI7O1FBRm5CLFlBQU8sR0FBUCxPQUFPLENBQVk7UUFDbkIseUJBQW9CLEdBQXBCLG9CQUFvQixDQUE4QjtRQUNsRCxhQUFRLEdBQVIsUUFBUSxDQUFXO1FBVnJCLGNBQVMsR0FBVyxNQUFNLEdBQUcsQ0FBQyxDQUFDO1FBSXhDLDJCQUFzQixHQUFXLENBQUMsQ0FBQztRQVN6QyxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUUzQyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsdUJBQVUsQ0FBQyxVQUFVLENBQzVDLElBQUksSUFBSSxFQUFFLEVBQ1YsYUFBYSxDQUFDLHNCQUFzQixDQUNyQyxDQUFDO1FBQ0YsUUFBUSxDQUFDLElBQUksQ0FDWCxtQkFBbUIsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxtQ0FBbUMsQ0FDM0YsQ0FBQztRQUNGLElBQUksQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUM7UUFDM0MsSUFBSSxDQUFDLFlBQVksR0FBRyxNQUFBLElBQUksQ0FBQyxlQUFlLEVBQUUsbUNBQUksSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDckUsUUFBUSxDQUFDLElBQUksQ0FB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aWwuY29tXG4vLyBBbGwgY29udGVudCBvZiB0aGlzIHJlcG9zaXRvcnkgaXMgbGljZW5zZWQgdW5kZXIgdGhlIENDIEJZLVNBIExpY2Vuc2UuXG4vLyBTZWUgdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBmb3IgbGljZW5zZSBpbmZvcm1hdGlvbi5cblxuaW1wb3J0ICogYXMgb2sgZnJvbSAnQG9jdG9raXQvcmVzdCc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBMUEYgZnJvbSAnbHBmJztcbmltcG9ydCAqIGFzIG9zIGZyb20gJ29zJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyBiYXIgZnJvbSAnLi9wcm9ncmVzc2Jhcic7XG5pbXBvcnQgKiBhcyBnaXRodWIgZnJvbSAnLi9naXRodWInO1xuXG5pbXBvcnQgeyBBcGlSYXRlTGltaXQgfSBmcm9tICcuL2FwaWxpbWl0cyc7XG5pbXBvcnQgeyBBcGlMaW1pdHNFeGNlcHRpb24gfSBmcm9tICcuL2FwaWxpbWl0c2V4Y2VwdGlvbic7XG5pbXBvcnQgeyBjb21wb25lbnRzIH0gZnJvbSAnQG9jdG9raXQvb3BlbmFwaS10eXBlcyc7XG5pbXBvcnQgeyBDb25maWcgfSBmcm9tICdub2RlLWpzb24tZGIvZGlzdC9saWIvSnNvbkRCQ29uZmlnJztcbmltcG9ydCB7IHRvQ3JvblNjaGVkdWxlIH0gZnJvbSAnLi9jcm9uJztcbmltcG9ydCB7IERhdGVIZWxwZXIgfSBmcm9tICcuL2RhdGVoZWxwZXInO1xuaW1wb3J0IHtcbiAgSUZpbGUsXG4gIElSZXBvc2l0b3J5LFxuICBJUmVwb3NpdG9yaWVzUHJvdmlkZXIsXG4gIElSZXBvc2l0b3JpZXNQcm92aWRlckZhY3RvcnksXG4gIElSZXBvc2l0b3J5TWF0Y2gsXG4gIElSZXBvcnRlcixcbn0gZnJvbSAnLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IEpzb25EQiB9IGZyb20gJ25vZGUtanNvbi1kYic7XG5pbXBvcnQgeyBTdG9wd2F0Y2ggfSBmcm9tICd0cy1zdG9wd2F0Y2gnO1xuXG5leHBvcnQgY2xhc3MgR0hBY3Rpb25Vc2FnZSB7XG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IExhc3RTdGFydFRpbWVOYW1lOiBzdHJpbmcgPSAnL0xhc3RTdGFydFRpbWVOYW1lLyc7XG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IFVzYWdlRGJGaWxlTmFtZSA9ICdhY3Rpb24tdXNhZ2UtZGIuanNvbic7XG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IFdvcmtmbG93RmlsZVBhdGg6IHN0cmluZ1tdID0gW1xuICAgICcuZ2l0aHViJyxcbiAgICAnd29ya2Zsb3dzJyxcbiAgICAncnVuLnltbCcsXG4gIF07XG4gIC8vIFRlcm1pbmF0ZSB0aGUgZXhlY3V0aW9uIGFmdGVyIHRoaXMgdGltZW91dCB0byBwcmV2ZW50IGZvcmNlZCBjYW5jZWxsYXRpb25cbiAgLy8gb24gdGhlIHJ1bm5lciAoc2l4IGhvdXJzKVxuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBJbnRlcm5hbFRpbWVvdXRNaW51dGVzID0gNSAqIDYwO1xuXG4gIHByaXZhdGUgc3RhdGljIGdldFdvcmtzcGFjZVBhdGgoKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3Qga2V5ID0gJ0dJVEhVQl9XT1JLU1BBQ0UnO1xuICAgIHJldHVybiBwcm9jZXNzLmVudltrZXldID8/IG51bGw7XG4gIH1cblxuICAvLyBAdHMtaWdub3JlXG4gIHByaXZhdGUgc3RhdGljIGFzeW5jIGRlbGF5KG1pbGxpczogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKGdpdGh1Yi5pc1J1bm5pbmdPbkdpdEh1YlJ1bm5lcigpKSB7XG4gICAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIG1pbGxpcykpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcmVhZG9ubHkgZGI6IEpzb25EQjtcbiAgcHJpdmF0ZSByZWFkb25seSBwcm9ncmVzc0JhcnM6IGJhci5Qcm9ncmVzc0JhcjtcbiAgLy8gRGF5cyBvZiBlYWNoIHRpbWUgc2VnbWVudC5cbiAgcHJpdmF0ZSByZWFkb25seSB0aW1lUmFuZ2U6IG51bWJlciA9IDYwLjg3NSAvIDI7XG4gIC8vIFN0YXJ0aW5nIGRhdGUgb2YgdGhlIHRpbWUgc2VnbWVudHMuXG4gIHByaXZhdGUgcmVhZG9ubHkgc3RhcnRpbmdEYXRlOiBEYXRlO1xuICBwcml2YXRlIHJlYWRvbmx5IGV4ZWN1dGlvblN0b3BEYXRlOiBEYXRlO1xuICBwcml2YXRlIHRvdGFsUmVwb3NpdG9yeUNoZWNrZWQ6IG51bWJlciA9IDA7XG4gIHByaXZhdGUgcmVhZG9ubHkgYWN0aW9uUm9vdFBhdGg6IHN0cmluZztcblxuICBwdWJsaWMgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBvY3Rva2l0OiBvay5PY3Rva2l0LFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcmVwb3NQcm92aWRlckZhY3Rvcnk6IElSZXBvc2l0b3JpZXNQcm92aWRlckZhY3RvcnksXG4gICAgcHJpdmF0ZSByZWFkb25seSByZXBvcnRlcjogSVJlcG9ydGVyXG4gICkge1xuICAgIC8vIElkZW50aWZ5IGFjdGlvbiBkaXJlY3RvcnlcbiAgICB0aGlzLmFjdGlvblJvb3RQYXRoID0gdGhpcy5nZXRBY3Rpb25QYXRoKCk7XG5cbiAgICB0aGlzLmV4ZWN1dGlvblN0b3BEYXRlID0gRGF0ZUhlbHBlci5hZGRNaW51dGVzKFxuICAgICAgbmV3IERhdGUoKSxcbiAgICAgIEdIQWN0aW9uVXNhZ2UuSW50ZXJuYWxUaW1lb3V0TWludXRlc1xuICAgICk7XG4gICAgcmVwb3J0ZXIuaW5mbyhcbiAgICAgIGBFeGVjdXRpbmcgdW50aWwgJHt0aGlzLmV4ZWN1dGlvblN0b3BEYXRlLnRvVVRDU3RyaW5nKCl9IG9yIHVudGlsIEFQSSByYXRlIGxpbWl0IHJlYWNoZWQuYFxuICAgICk7XG4gICAgdGhpcy5kYiA9IHRoaXMub3BlbkRiKHRoaXMuYWN0aW9uUm9vdFBhdGgpO1xuICAgIHRoaXMuc3RhcnRpbmdEYXRlID0gdGhpcy5nZXRTdGFydGluZ0RhdGUoKSA/PyBuZXcgRGF0ZSgnMjAxMC0wMS0wMScpO1xuICAgIHJlcG9ydGVyLmluZm8oYFN0YXJ0aW5nIGRhdGU6ICR7dGhpcy5zdGFydGluZ0RhdGUudG9VVENTdHJpbmcoKX0nLmApO1xuXG4gICAgdGhpcy5wcm9ncmVzc0JhcnMgPSBuZXcgYmFyLlByb2dyZXNzQmFyKCk7XG5cbiAgICBMUEYuc21vb3RoaW5nID0gMC41O1xuICAgIExQRi5pbml0KDApO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHJ1bigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKGBydW4oKTw8ICR7bmV3IERhdGUoKS50b1VUQ1N0cmluZygpfWApO1xuICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1jb25zb2xlXG4gICAgY29uc29sZS50aW1lKCdydW4oKTonKTtcbiAgICBsZXQgc3RhcnREYXRlID0gdGhpcy5zdGFydGluZ0RhdGU7XG5cbiAgICAvLyBJZiBhbHJlYWR5IHJ1bm5pbmcsIGVuc3VyZSB0byBleGl0IGJlZm9yZSBtb2RpZnlpbmcgYW55IGxvY2FsIGZpbGUgdGhhdCB3b3VsZCB0aGVuXG4gICAgLy8gYmUgY29tbWl0dGVkLlxuICAgIGlmIChhd2FpdCB0aGlzLmlzQWxyZWFkeVJ1bm5pbmcoKSkge1xuICAgICAgdGhpcy5yZXBvcnRlci5pbmZvKCdBbHJlYWR5IHJ1bm5pbmcsIGV4aXRpbmcuLi4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcblxuICAgICAgLy8gQ29tcHV0ZSB0aGUgdG90YWwgdGltZS1zZWdtZW50cyBvZiAndGltZVJhbmdlJyBkYXlzIGVhY2guXG4gICAgICB0aGlzLnByb2dyZXNzQmFycy5pbml0KHN0YXJ0RGF0ZSwgdGhpcy50aW1lUmFuZ2UpO1xuXG4gICAgICBsZXQgdGltZVNlZ21lbnQgPSAxO1xuICAgICAgbGV0IG5leHREYXRlID0gRGF0ZUhlbHBlci5hZGREYXlzKHN0YXJ0RGF0ZSwgdGhpcy50aW1lUmFuZ2UpO1xuXG4gICAgICAvLyBJdGVyYXRlIG92ZXIgYWxsIHRpbWUgc2VnbWVudHMuXG4gICAgICB3aGlsZSAoc3RhcnREYXRlIDwgbm93ICYmIHRoaXMuZXhlY3V0aW9uU3RvcERhdGUgPiBuZXcgRGF0ZSgpKSB7XG4gICAgICAgIGNvbnN0IHJlcG9Qcm92aWRlciA9IGF3YWl0IHRoaXMucmVwb3NQcm92aWRlckZhY3RvcnkuY3JlYXRlKFxuICAgICAgICAgIHRoaXMub2N0b2tpdCxcbiAgICAgICAgICBzdGFydERhdGUsXG4gICAgICAgICAgbmV4dERhdGUsXG4gICAgICAgICAgdGhpc1xuICAgICAgICApO1xuXG4gICAgICAgIGNvbnN0IHJlcG9zOiBJUmVwb3NpdG9yeVtdID0gYXdhaXQgdGhpcy5nZXRSZXBvTGlzdChyZXBvUHJvdmlkZXIpO1xuXG4gICAgICAgIHRoaXMucHJvZ3Jlc3NCYXJzLnVwZGF0ZShcbiAgICAgICAgICBzdGFydERhdGUsXG4gICAgICAgICAgbmV4dERhdGUsXG4gICAgICAgICAgcmVwb1Byb3ZpZGVyLmNvdW50LFxuICAgICAgICAgIHRpbWVTZWdtZW50XG4gICAgICAgICk7XG5cbiAgICAgICAgY29uc3Qgc3cgPSBuZXcgU3RvcHdhdGNoKCk7XG4gICAgICAgIHN3LnN0YXJ0KCk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5pdGVyYXRlVGltZVNlZ21lbnQocmVwb1Byb3ZpZGVyLCByZXBvcywgc3cpO1xuXG4gICAgICAgIC8vIEFkdmFuY2UgdGltZSByYW5nZS5cbiAgICAgICAgdGltZVNlZ21lbnQrKztcbiAgICAgICAgc3RhcnREYXRlID0gbmV4dERhdGU7XG4gICAgICAgIG5leHREYXRlID0gRGF0ZUhlbHBlci5hZGREYXlzKHN0YXJ0RGF0ZSwgdGhpcy50aW1lUmFuZ2UpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKEFwaVJhdGVMaW1pdC5pc1JhdGVMaW1pdEV4Y2VwdGlvbihlcnIpKSB7XG4gICAgICAgIGNvbnN0IGUgPSBlcnIgYXMgQXBpTGltaXRzRXhjZXB0aW9uO1xuICAgICAgICBjb25zdCBjdXJyZW50UmVtYWluaW5nID1cbiAgICAgICAgICBlLnJlbWFpbmluZyAhPT0gdW5kZWZpbmVkID8gJycgKyBlLnJlbWFpbmluZyA6ICc8dW5rbm93bj4nO1xuICAgICAgICBjb25zdCBuZXh0UXVvdGFSZXNldCA9IGUubmV4dFJlc2V0XG4gICAgICAgICAgPyBlLm5leHRSZXNldC50b1VUQ1N0cmluZygpXG4gICAgICAgICAgOiAnPHVua25vd24+JztcbiAgICAgICAgdGhpcy5yZXBvcnRlci53YXJuKFxuICAgICAgICAgIGAke29zLkVPTH0ke1xuICAgICAgICAgICAgb3MuRU9MXG4gICAgICAgICAgfSBBUEkgcmF0ZSBsaW1pdCBhbG1vc3QgcmVhY2hlZCBhdCAnJHtjdXJyZW50UmVtYWluaW5nfScgcmVtYWluaW5nIGNhbGxzLiBTdG9yaW5nIGN1cnJlbnQgc3RhcnRpbmcgZGF0ZTogJyR7c3RhcnREYXRlLnRvVVRDU3RyaW5nKCl9JyBpbiBkYi5gICtcbiAgICAgICAgICAgIGAgTmV4dCBxdW90YSByZXNldCBvbiAnJHtuZXh0UXVvdGFSZXNldH0nLmBcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucmVwb3J0ZXIud2FybignJywgZXJyIGFzIEVycm9yKTtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICAvLyBQcm9sb2d1ZVxuICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZygnU2F2aW5nIGRhdGEgYmVmb3JlIGV4aXRpbmcuLi4nKTtcblxuICAgICAgY29uc3QgbGltaXRzID0gYXdhaXQgdGhpcy5nZXRSZXN0Q3VycmVudExpbWl0cygpO1xuICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhKU09OLnN0cmluZ2lmeShsaW1pdHMpKTtcblxuICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhcbiAgICAgICAgYGRiLnB1c2ggJHtHSEFjdGlvblVzYWdlLkxhc3RTdGFydFRpbWVOYW1lfSAke3N0YXJ0RGF0ZS50b1VUQ1N0cmluZygpfWBcbiAgICAgICk7XG4gICAgICB0aGlzLmRiLnB1c2goXG4gICAgICAgIEdIQWN0aW9uVXNhZ2UuTGFzdFN0YXJ0VGltZU5hbWUsXG4gICAgICAgIGAke3N0YXJ0RGF0ZS50b1VUQ1N0cmluZygpfWAsXG4gICAgICAgIHRydWVcbiAgICAgICk7XG4gICAgICB0aGlzLmRiLnNhdmUodHJ1ZSk7XG5cbiAgICAgIC8vIExhdW5jaGluZyB0aGUgd29ya2Zsb3cgYWdhaW4gYXQgbGltaXRzLnJlc2V0IHRpbWUgd2lsbFxuICAgICAgLy8gZXhoYXVzdHMgYWdhaW4gYWxsIHRoZSBBUEkgcXVvdGEuIExldCdzIHJ1biBpdCBhdCBtaWRuaWdodCBlYWNoIGRheS5cbiAgICAgIC8vIGF3YWl0IHRoaXMuc2V0dXBDcm9uKHRoaXMuYWN0aW9uUm9vdFBhdGgsIGxpbWl0cy5yZXNldCk7XG4gICAgICBjb25zdCBuZXh0UnVuRGF0ZSA9IG5ldyBEYXRlKG5ldyBEYXRlKCkuc2V0VVRDSG91cnMoMjQsIDAsIDAsIDApKTtcbiAgICAgIGF3YWl0IHRoaXMuc2V0dXBDcm9uKHRoaXMuYWN0aW9uUm9vdFBhdGgsIG5leHRSdW5EYXRlKTtcblxuICAgICAgdGhpcy5wcm9ncmVzc0JhcnMuc3RvcCgpO1xuICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWNvbnNvbGVcbiAgICAgIGNvbnNvbGUudGltZUxvZygncnVuKCknKTtcbiAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoYHJ1bigpPj5gKTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgc2V0UmVtYWluaW5nQ2FsbHMocmVzdEFwaT86IG51bWJlciwgc2VhcmNoQXBpPzogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5wcm9ncmVzc0JhcnMudXBkYXRlQXBpUXVvdGEocmVzdEFwaSwgc2VhcmNoQXBpKTtcbiAgfVxuXG4gIC8vIElkZW50aWZ5IHRoZSBsb2NhdGlvbiB3aGVyZSB0aGUgYWN0aW9uIGlzIGNoZWNrZWQgb3V0IGJ5IHNlZWtpbmcgZm9yIHRoZSBydW4ueW1sIGZpbGUuXG4gIHByaXZhdGUgZ2V0QWN0aW9uUGF0aCgpOiBzdHJpbmcge1xuICAgIGxldCBhY3Rpb25QYXRoID0gbnVsbDtcbiAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKGBnZXRBY3Rpb25QYXRoKCk8PGApO1xuICAgIGNvbnN0IGRzID0gW1xuICAgICAgcHJvY2Vzcy5jd2QoKSA/PyAnJyxcbiAgICAgIEdIQWN0aW9uVXNhZ2UuZ2V0V29ya3NwYWNlUGF0aCgpID8/ICcnLFxuICAgICAgYCR7X19kaXJuYW1lICsgcGF0aC5zZXB9Li5gLFxuICAgIF07XG4gICAgZm9yIChjb25zdCBkIG9mIGRzKSB7XG4gICAgICBjb25zdCB3ZmZwID0gcGF0aC5qb2luKGQsIC4uLkdIQWN0aW9uVXNhZ2UuV29ya2Zsb3dGaWxlUGF0aCk7XG4gICAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKGBjaGVja2luZyBmb3IgJyR7ZH0nLi4uYCk7XG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyh3ZmZwKSkge1xuICAgICAgICBhY3Rpb25QYXRoID0gZDtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmICghYWN0aW9uUGF0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgaWRlbnRpZnkgdGhlIGFjdGlvbiByb290IGRpcmVjdG9yeS5gKTtcbiAgICB9XG4gICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhgZ2V0QWN0aW9uUGF0aCgpPj4nJHthY3Rpb25QYXRofSdgKTtcbiAgICByZXR1cm4gYWN0aW9uUGF0aDtcbiAgfVxuXG4gIC8vIENoZWNrIHdoZXRoZXIgYW55IHdvcmtmbG93IGlzIGFscmVhZHkgcnVubmluZyBmb3IgdGhpcyByZXBvc2l0b3J5LlxuICBwcml2YXRlIGFzeW5jIGlzQWxyZWFkeVJ1bm5pbmcoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKCFnaXRodWIuaXNSdW5uaW5nT25HaXRIdWJSdW5uZXIoKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBjb25zdCBHSVRIVUJfUkVQT1NJVE9SWSA9ICdHSVRIVUJfUkVQT1NJVE9SWSc7XG4gICAgY29uc3Qgb3duZXI6IHN0cmluZyB8IHVuZGVmaW5lZCA9IHByb2Nlc3MuZW52W0dJVEhVQl9SRVBPU0lUT1JZXT8uc3BsaXQoXG4gICAgICAnLydcbiAgICApWzBdO1xuICAgIGNvbnN0IHJlcG86IHN0cmluZyB8IHVuZGVmaW5lZCA9IHByb2Nlc3MuZW52W0dJVEhVQl9SRVBPU0lUT1JZXT8uc3BsaXQoXG4gICAgICAnLydcbiAgICApWzFdO1xuICAgIGlmICghKG93bmVyICYmIHJlcG8pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBUaGUgZW52IHZhciBHSVRIVUJfUkVQT1NJVE9SWSBpcyBub3QgZGVmaW5lZDogJyR7R0lUSFVCX1JFUE9TSVRPUll9Jy5gXG4gICAgICApO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICB0eXBlIHJlc3BvbnNlVHlwZSA9IG9rLlJlc3RFbmRwb2ludE1ldGhvZFR5cGVzWydhY3Rpb25zJ11bJ2xpc3RXb3JrZmxvd1J1bnNGb3JSZXBvJ11bJ3Jlc3BvbnNlJ107XG4gICAgICBjb25zdCByZXNwb25zZTogcmVzcG9uc2VUeXBlID0gYXdhaXQgdGhpcy5vY3Rva2l0LnJlc3QuYWN0aW9ucy5saXN0V29ya2Zsb3dSdW5zRm9yUmVwbyhcbiAgICAgICAge1xuICAgICAgICAgIG93bmVyLFxuICAgICAgICAgIHJlcG8sXG4gICAgICAgIH1cbiAgICAgICk7XG4gICAgICB0eXBlIHdvcmtmbG93UnVuVHlwZSA9IEFycmF5PGNvbXBvbmVudHNbJ3NjaGVtYXMnXVsnd29ya2Zsb3ctcnVuJ10+O1xuICAgICAgY29uc3Qgd2ZzOiB3b3JrZmxvd1J1blR5cGUgPSByZXNwb25zZS5kYXRhLndvcmtmbG93X3J1bnM7XG4gICAgICBjb25zdCBydW5uaW5nV2YgPSB3ZnMuZmlsdGVyKFxuICAgICAgICB3ZiA9PiB3Zi5zdGF0dXMgPT09ICdpbl9wcm9ncmVzcycgfHwgd2Yuc3RhdHVzID09PSAncXVldWVkJ1xuICAgICAgKTtcblxuICAgICAgcmV0dXJuIHJ1bm5pbmdXZi5sZW5ndGggPiAxO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhpcy5yZXBvcnRlci5lcnJvcihcbiAgICAgICAgYENhbm5vdCBkZXRlcm1pbmUgaWYgYWxyZWFkeSBydW5uaW5nOiAke0pTT04uc3RyaW5naWZ5KGVycil9YFxuICAgICAgKTtcbiAgICAgIHRoaXMucmVwb3J0ZXIuZXJyb3IoXG4gICAgICAgIGBQcmV0ZW5kaW5nIHRvIGJlIHJ1bm5pbmcgYWxyZWFkeSB0byBleGl0IGltbWVkaWF0ZWx5IGFuZCBhdm9pZCBwb3RlbnRpYWwgcmVmdXNlZCAnZ2l0IHB1c2gnLmBcbiAgICAgICk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIG9wZW5EYihyb290UGF0aDogc3RyaW5nKTogSnNvbkRCIHtcbiAgICBsZXQgZGI6IEpzb25EQjtcbiAgICBjb25zdCBkYlBhdGggPSBwYXRoLmpvaW4ocm9vdFBhdGgsICdncmFwaCcsIEdIQWN0aW9uVXNhZ2UuVXNhZ2VEYkZpbGVOYW1lKTtcbiAgICB0cnkge1xuICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhgT3BlbmluZyBEQiBhdCAnJHtkYlBhdGh9Jy4uLi5gKTtcbiAgICAgIGRiID0gbmV3IEpzb25EQihuZXcgQ29uZmlnKGRiUGF0aCwgdHJ1ZSwgdHJ1ZSwgJy8nKSk7XG4gICAgICBkYi5nZXREYXRhKEdIQWN0aW9uVXNhZ2UuTGFzdFN0YXJ0VGltZU5hbWUpO1xuICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhgREIgb3BlbmVkIGF0ICcke2RiUGF0aH0nLmApO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhpcy5yZXBvcnRlci53YXJuKChlcnIgYXMgRXJyb3IpPy5tZXNzYWdlKTtcbiAgICAgIGZzLnVubGlua1N5bmMoZGJQYXRoKTtcbiAgICAgIGRiID0gbmV3IEpzb25EQihuZXcgQ29uZmlnKGRiUGF0aCwgdHJ1ZSwgdHJ1ZSwgJy8nKSk7XG4gICAgICB0aGlzLnJlcG9ydGVyLmluZm8oYERCIGF0ICcke2RiUGF0aH0nIHJlLW9wZW5lZCBzdWNjZXNzZnVsbHkuYCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGRiO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzZXR1cENyb24ocm9vdFBhdGg6IHN0cmluZywgZGF0ZTogRGF0ZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBSZWFkIGNvbnRlbnQgb2Ygd29ya2Zsb3cgZmlsZS5cbiAgICAgIGNvbnN0IGZpbGVQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAuLi5HSEFjdGlvblVzYWdlLldvcmtmbG93RmlsZVBhdGgpO1xuICAgICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwge1xuICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICBmbGFnOiAncicsXG4gICAgICB9KTtcblxuICAgICAgLy8gUGF0Y2ggdGhlIG5leHQgZXhlY3V0aW9uXG4gICAgICBjb25zdCBuZXh0Q3JvblNjaGVkdWxlID0gYCcke3RvQ3JvblNjaGVkdWxlKGRhdGUpfSdgO1xuICAgICAgY29uc3QgbGluZXMgPSBjb250ZW50LnNwbGl0KG9zLkVPTCk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmIChsaW5lc1tpXS5pbmRleE9mKCcwICogKiAqIConKSAhPT0gLTEpIHtcbiAgICAgICAgICBjb25zdCBvbGRDcm9uID0gJy0gY3JvbjogJztcbiAgICAgICAgICBjb25zdCBvZmZzZXQgPSBsaW5lc1tpICsgMV0uaW5kZXhPZihvbGRDcm9uKTtcbiAgICAgICAgICBsaW5lc1tpICsgMV0gPVxuICAgICAgICAgICAgbGluZXNbaSArIDFdLnN1YnN0cmluZygwLCBvZmZzZXQgKyBvbGRDcm9uLmxlbmd0aCkgK1xuICAgICAgICAgICAgbmV4dENyb25TY2hlZHVsZTtcbiAgICAgICAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKGBuZXh0IGNyb24gc2NoZWR1bGUgc2V0IHRvICcke2xpbmVzW2kgKyAxXX0nYCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgcGF0Y2hlZENvbnRlbnQgPSBsaW5lcy5qb2luKG9zLkVPTCk7XG4gICAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKHBhdGNoZWRDb250ZW50KTtcbiAgICAgIGZzLndyaXRlRmlsZVN5bmMoZmlsZVBhdGgsIHBhdGNoZWRDb250ZW50KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHRoaXMucmVwb3J0ZXIuZXJyb3IoYHNldHVwQ3JvbigpIGZhaWxlZDogJHtlcnJ9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZXRSZXBvTGlzdChcbiAgICByZXBvUHJvdmlkZXI6IElSZXBvc2l0b3JpZXNQcm92aWRlclxuICApOiBQcm9taXNlPElSZXBvc2l0b3J5W10+IHtcbiAgICByZXR1cm4gcmVwb1Byb3ZpZGVyLmdldE5leHRSZXBvcygpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBpdGVyYXRlVGltZVNlZ21lbnQoXG4gICAgcmVwb1Byb3ZpZGVyOiBJUmVwb3NpdG9yaWVzUHJvdmlkZXIsXG4gICAgcmVwb3M6IElSZXBvc2l0b3J5W10sXG4gICAgc3c6IFN0b3B3YXRjaFxuICApIHtcbiAgICB0cnkge1xuICAgICAgbGV0IGJhckNvdW50ZXIgPSAwO1xuICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgY29uc3QgcHM6IEFycmF5PFByb21pc2U8dm9pZD4+ID0gW107XG4gICAgICAgIGZvciAoY29uc3QgYVJlcG8gb2YgcmVwb3MpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgdGhpcy5wcm9ncmVzc0JhcnMudXBkYXRlUmVwbyhiYXJDb3VudGVyLCB7XG4gICAgICAgICAgICAgIGFjdGlvbjogYmFyLlByb2dyZXNzQmFyLmdldEFjdGlvblN0cmluZyhcbiAgICAgICAgICAgICAgICBgY2hlY2tpbmcgcmVwby4uLiAnJHthUmVwby5vd25lcn0vJHthUmVwby5uYW1lfSdgXG4gICAgICAgICAgICAgICksXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnN0IHRhc2sgPSBuZXcgUHJvbWlzZTx2b2lkPihhc3luYyAocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICAgIGxldCBtYXRjaGVzOiBJUmVwb3NpdG9yeU1hdGNoW107XG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgbWF0Y2hlcyA9IGF3YWl0IHRoaXMuY2hlY2tSZXBvc2l0b3J5KFxuICAgICAgICAgICAgICAgICAgYVJlcG8ub3duZXIsXG4gICAgICAgICAgICAgICAgICBhUmVwby5uYW1lLFxuICAgICAgICAgICAgICAgICAgJy5naXRodWIvd29ya2Zsb3dzJ1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgIEFwaVJhdGVMaW1pdC5jaGVja1Jlc3RBcGlMaW1pdChcbiAgICAgICAgICAgICAgICAgICAgKGVycm9yIGFzIGFueSk/LnJlc3BvbnNlPy5oZWFkZXJzXG4gICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycik7XG4gICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY29uc3Qga2V5ID0gYC8ke2FSZXBvLm93bmVyfS8ke2FSZXBvLm5hbWV9YDtcbiAgICAgICAgICAgICAgaWYgKG1hdGNoZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHRoaXMuZGIucHVzaChrZXksIFsuLi5tYXRjaGVzLCBhUmVwb10sIHRydWUpO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMucmVwb3J0ZXIuaW5mbyhgbm8gaGl0cyBmb3Iga2V5OiAnJHtrZXl9Jy5gKTtcbiAgICAgICAgICAgICAgICAvLyBSZW1vdmUgZW50cmllcyB0aGF0IGFyZSBub3QgdXNpbmcgdGhlIGFjdGlvbnMgYW55bW9yZS5cbiAgICAgICAgICAgICAgICBpZiAodGhpcy5kYi5leGlzdHMoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgdGhpcy5kYi5kZWxldGUoa2V5KTtcbiAgICAgICAgICAgICAgICAgIHRoaXMucmVwb3J0ZXIud2FybihcbiAgICAgICAgICAgICAgICAgICAgYHJlbW92ZWQgdGhlIHJlcG9zaXRvcnkgd2l0aCBrZXk6ICcke2tleX0nLmBcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgYmFyQ291bnRlcisrO1xuICAgICAgICAgICAgICB0aGlzLnRvdGFsUmVwb3NpdG9yeUNoZWNrZWQrKztcblxuICAgICAgICAgICAgICBjb25zdCB0b3RhbFRpbWVNaWxsaXMgPSBzdy5nZXRUaW1lKCk7XG5cbiAgICAgICAgICAgICAgdGhpcy5wcm9ncmVzc0JhcnMudXBkYXRlUmVwbyhiYXJDb3VudGVyLCB7XG4gICAgICAgICAgICAgICAgYWN0aW9uOiBiYXIuUHJvZ3Jlc3NCYXIuZ2V0QWN0aW9uU3RyaW5nKFxuICAgICAgICAgICAgICAgICAgYGNoZWNraW5nIHJlcG8uLi4gJyR7YVJlcG8ub3duZXJ9LyR7YVJlcG8ubmFtZX0nYFxuICAgICAgICAgICAgICAgICksXG4gICAgICAgICAgICAgICAgc3BlZWQ6IGAke0xQRi5uZXh0KFxuICAgICAgICAgICAgICAgICAgdGhpcy50b3RhbFJlcG9zaXRvcnlDaGVja2VkIC8gKHRvdGFsVGltZU1pbGxpcyAvIDYwMDAwLjApXG4gICAgICAgICAgICAgICAgKS50b0ZpeGVkKDEpfSByZXBvL21pbmAucGFkU3RhcnQoMywgJyAnKSxcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcHMucHVzaCh0YXNrKTtcbiAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgIEFwaVJhdGVMaW1pdC50aHJvd0lmUmF0ZUxpbWl0RXhjZWVkZWQoZXJyKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChwcyk7XG4gICAgICAgIHRoaXMucHJvZ3Jlc3NCYXJzLnVwZGF0ZVJlcG8oYmFyQ291bnRlciwge1xuICAgICAgICAgIGFjdGlvbjogYmFyLlByb2dyZXNzQmFyLmdldEFjdGlvblN0cmluZyhgbGlzdGluZyByZXBvcy4uLmApLFxuICAgICAgICB9KTtcbiAgICAgICAgcmVwb3MgPSBhd2FpdCB0aGlzLmdldFJlcG9MaXN0KHJlcG9Qcm92aWRlcik7XG4gICAgICAgIGlmIChyZXBvcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgQXBpUmF0ZUxpbWl0LnRocm93SWZSYXRlTGltaXRFeGNlZWRlZChlcnIpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0UmVzdEN1cnJlbnRMaW1pdHMoKTogUHJvbWlzZTx7XG4gICAgcmVtYWluaW5nOiBudW1iZXI7XG4gICAgcmVzZXQ6IERhdGU7XG4gIH0+IHtcbiAgICB0eXBlIHJlc3BvbnNlID0gb2suUmVzdEVuZHBvaW50TWV0aG9kVHlwZXNbJ3JhdGVMaW1pdCddWydnZXQnXVsncmVzcG9uc2UnXTtcbiAgICBjb25zdCBsaW1pdHM6IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5vY3Rva2l0LnJlc3QucmF0ZUxpbWl0LmdldCgpO1xuICAgIHJldHVybiB7XG4gICAgICByZW1haW5pbmc6IGxpbWl0cy5kYXRhLnJlc291cmNlcy5jb3JlLnJlbWFpbmluZyxcbiAgICAgIHJlc2V0OiBuZXcgRGF0ZShsaW1pdHMuZGF0YS5yZXNvdXJjZXMuY29yZS5yZXNldCAqIDEwMDApLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGdldFN0YXJ0aW5nRGF0ZSgpOiBEYXRlIHwgbnVsbCB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRhdGU6IHN0cmluZyA9IHRoaXMuZGIuZ2V0RGF0YShHSEFjdGlvblVzYWdlLkxhc3RTdGFydFRpbWVOYW1lKTtcbiAgICAgIGNvbnN0IHRpbWVzdGFtcCA9IERhdGUucGFyc2UoZGF0ZSk7XG4gICAgICBpZiAoaXNOYU4odGltZXN0YW1wKSA9PT0gZmFsc2UpIHtcbiAgICAgICAgY29uc3Qgc3RhcnREYXRlOiBEYXRlID0gbmV3IERhdGUodGltZXN0YW1wKTtcbiAgICAgICAgLy8gSWYgc3RhcnQgZGF0ZSBpcyBtb3JlIHJlY2VudCB0aGFuIF9ub3dfLCByZXN0YXJ0IG92ZXIgYnkgcmV0dXJuaW5nIG51bGwuXG4gICAgICAgIHJldHVybiBzdGFydERhdGUgPCBuZXcgRGF0ZSgpID8gc3RhcnREYXRlIDogbnVsbDtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHRoaXMucmVwb3J0ZXIud2FybignJywgZXJyIGFzIEVycm9yKTtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNoZWNrUmVwb3NpdG9yeShcbiAgICBvd25lcjogc3RyaW5nLFxuICAgIHJlcG86IHN0cmluZyxcbiAgICBmaWxlUGF0aDogc3RyaW5nXG4gICk6IFByb21pc2U8SVJlcG9zaXRvcnlNYXRjaFtdPiB7XG4gICAgY29uc3QgbWF0Y2hlczogSVJlcG9zaXRvcnlNYXRjaFtdID0gW107XG4gICAgdHJ5IHtcbiAgICAgIHR5cGUgdCA9IG9rLlJlc3RFbmRwb2ludE1ldGhvZFR5cGVzWydyZXBvcyddWydnZXRDb250ZW50J11bJ3Jlc3BvbnNlJ107XG4gICAgICBjb25zdCBkYXRhOiB0ID0gYXdhaXQgdGhpcy5vY3Rva2l0LnJlc3QucmVwb3MuZ2V0Q29udGVudCh7XG4gICAgICAgIG93bmVyLFxuICAgICAgICBwYXRoOiBmaWxlUGF0aCxcbiAgICAgICAgcmVwbyxcbiAgICAgIH0pO1xuICAgICAgdGhpcy5zZXRSZW1haW5pbmdDYWxscyhBcGlSYXRlTGltaXQuY2hlY2tSZXN0QXBpTGltaXQoZGF0YS5oZWFkZXJzKSk7XG4gICAgICBjb25zdCBmaWxlczogSUZpbGVbXSA9IGRhdGEuZGF0YSBhcyBJRmlsZVtdO1xuICAgICAgaWYgKGZpbGVzKSB7XG4gICAgICAgIHR5cGUgcnAgPSBvay5SZXN0RW5kcG9pbnRNZXRob2RUeXBlc1sncmVwb3MnXVsnZ2V0J11bJ3Jlc3BvbnNlJ107XG4gICAgICAgIGNvbnN0IHJlcG9SZXNwb25zZTogcnAgPSBhd2FpdCB0aGlzLm9jdG9raXQucmVzdC5yZXBvcy5nZXQoe1xuICAgICAgICAgIG93bmVyLFxuICAgICAgICAgIHJlcG8sXG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnNldFJlbWFpbmluZ0NhbGxzKFxuICAgICAgICAgIEFwaVJhdGVMaW1pdC5jaGVja1Jlc3RBcGlMaW1pdChyZXBvUmVzcG9uc2UuaGVhZGVycylcbiAgICAgICAgKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKGZpbGUuZG93bmxvYWRfdXJsKSB7XG4gICAgICAgICAgICAgIHR5cGUgcmVzcCA9IG9rLlJlc3RFbmRwb2ludE1ldGhvZFR5cGVzWydyZXBvcyddWydnZXRDb250ZW50J11bJ3Jlc3BvbnNlJ107XG4gICAgICAgICAgICAgIGNvbnN0IGY6IHJlc3AgPSBhd2FpdCB0aGlzLm9jdG9raXQucmVzdC5yZXBvcy5nZXRDb250ZW50KHtcbiAgICAgICAgICAgICAgICBvd25lcixcbiAgICAgICAgICAgICAgICBwYXRoOiBmaWxlLnBhdGgsXG4gICAgICAgICAgICAgICAgcmVwbyxcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIHRoaXMuc2V0UmVtYWluaW5nQ2FsbHMoQXBpUmF0ZUxpbWl0LmNoZWNrUmVzdEFwaUxpbWl0KGYuaGVhZGVycykpO1xuICAgICAgICAgICAgICBjb25zdCBmaWxlQ29udGVudCA9IEJ1ZmZlci5mcm9tKFxuICAgICAgICAgICAgICAgIChmLmRhdGEgYXMgYW55KS5jb250ZW50LFxuICAgICAgICAgICAgICAgICdiYXNlNjQnXG4gICAgICAgICAgICAgICkudG9TdHJpbmcoJ3V0ZjgnKTtcbiAgICAgICAgICAgICAgY29uc3QgbGluZXMgPSBmaWxlQ29udGVudC5zcGxpdChvcy5FT0wpO1xuICAgICAgICAgICAgICBsZXQgbGluZU51bWJlciA9IDA7XG4gICAgICAgICAgICAgIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgICAgICAgICAgICAgIGxpbmVOdW1iZXIrKztcbiAgICAgICAgICAgICAgICBjb25zdCByZWdFeHAgPSBuZXcgUmVnRXhwKFxuICAgICAgICAgICAgICAgICAgJ2x1a2thLyg/PGFjdGlvbj4oPzpnZXQtY21ha2UpfCg/OnJ1bi1jbWFrZSl8KD86cnVuLXZjcGtnKSlAKD88dmVyc2lvbj5bXFxcXHdcXFxcZFxcXFwuXSspJyxcbiAgICAgICAgICAgICAgICAgICdnJ1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgY29uc3QgbWF0Y2hBcnJheSA9IGxpbmUubWF0Y2hBbGwocmVnRXhwKTtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IG1hdGNoIG9mIG1hdGNoQXJyYXkpIHtcbiAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChtYXRjaC5ncm91cHMpIHtcbiAgICAgICAgICAgICAgICAgICAgICBjb25zdCBoaXQgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhY3Rpb25OYW1lOiBtYXRjaC5ncm91cHMuYWN0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgbGluZTogbGluZU51bWJlcixcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogZ2l0aHViLmdldEh0bWxVcmwoZmlsZS51cmwsIGxpbmVOdW1iZXIpLFxuICAgICAgICAgICAgICAgICAgICAgICAgdmVyc2lvbjogbWF0Y2guZ3JvdXBzLnZlcnNpb24sXG4gICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgICB0aGlzLnJlcG9ydGVyLndhcm4oXG4gICAgICAgICAgICAgICAgICAgICAgICBgXFxuIEZvdW5kICcke2hpdC5hY3Rpb25OYW1lfUAke2hpdC52ZXJzaW9ufScgaW4gcmVwbzogJHtvd25lcn0vJHtyZXBvfSAke3JlcG9SZXNwb25zZS5kYXRhLnN0YXJnYXplcnNfY291bnR94q2RICAke3JlcG9SZXNwb25zZS5kYXRhLndhdGNoZXJzX2NvdW50ffCfkYBgXG4gICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICBtYXRjaGVzLnB1c2goaGl0KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgIEFwaVJhdGVMaW1pdC50aHJvd0lmUmF0ZUxpbWl0RXhjZWVkZWQoZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXBvcnRlci53YXJuKGBjaGVja1JlcG9zaXRvcnkoKTpgLCBlcnIgYXMgRXJyb3IpO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgQXBpUmF0ZUxpbWl0LnRocm93SWZSYXRlTGltaXRFeGNlZWRlZChlcnIpO1xuICAgICAgICAgICAgdGhpcy5yZXBvcnRlci53YXJuKGBjaGVja1JlcG9zaXRvcnkoKTpgLCBlcnIgYXMgRXJyb3IpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc3QgZXJyb3IgPSBlcnIgYXMgYW55O1xuICAgICAgaWYgKGVycm9yPy5zdGF0dXMgPT09IDQwNCkge1xuICAgICAgICBBcGlSYXRlTGltaXQudGhyb3dJZlJhdGVMaW1pdEV4Y2VlZGVkKGVycik7XG4gICAgICAgIHRoaXMuc2V0UmVtYWluaW5nQ2FsbHMoXG4gICAgICAgICAgQXBpUmF0ZUxpbWl0LmNoZWNrUmVzdEFwaUxpbWl0KGVycm9yLnJlc3BvbnNlLmhlYWRlcnMpXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBBcGlSYXRlTGltaXQudGhyb3dJZlJhdGVMaW1pdEV4Y2VlZGVkKGVycik7XG4gICAgICAgIHRoaXMucmVwb3J0ZXIud2FybihgY2hlY2tSZXBvc2l0b3J5KCk6YCwgZXJyIGFzIEVycm9yKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbWF0Y2hlcztcbiAgfVxufVxuIl19