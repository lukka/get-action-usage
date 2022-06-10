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
                yield this.setupCron(this.actionRootPath, limits.reset);
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
GHActionUsage.WorkflowFilePath = [
    '.github',
    'workflows',
    'run.yml',
];
GHActionUsage.InternalTimeoutMinutes = 5 * 60;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWN0aW9udXNhZ2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvYWN0aW9udXNhZ2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBS0EseUJBQXlCO0FBQ3pCLDJCQUEyQjtBQUMzQix5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLHFDQUFxQztBQUNyQyxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBRzNDLHFFQUE0RDtBQUM1RCxpQ0FBd0M7QUFDeEMsNkNBQTBDO0FBUzFDLCtDQUFzQztBQUN0QywrQ0FBeUM7QUFFekMsTUFBYSxhQUFhO0lBa0N4QixZQUNtQixPQUFtQixFQUNuQixvQkFBa0QsRUFDbEQsUUFBbUI7O1FBRm5CLFlBQU8sR0FBUCxPQUFPLENBQVk7UUFDbkIseUJBQW9CLEdBQXBCLG9CQUFvQixDQUE4QjtRQUNsRCxhQUFRLEdBQVIsUUFBUSxDQUFXO1FBVnJCLGNBQVMsR0FBVyxNQUFNLEdBQUcsQ0FBQyxDQUFDO1FBSXhDLDJCQUFzQixHQUFXLENBQUMsQ0FBQztRQVN6QyxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUUzQyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsdUJBQVUsQ0FBQyxVQUFVLENBQzVDLElBQUksSUFBSSxFQUFFLEVBQ1YsYUFBYSxDQUFDLHNCQUFzQixDQUNyQyxDQUFDO1FBQ0YsUUFBUSxDQUFDLElBQUksQ0FDWCxtQkFBbUIsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxtQ0FBbUMsQ0FDM0YsQ0FBQztRQUNGLElBQUksQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUM7UUFDM0MsSUFBSSxDQUFDLFlBQVksR0FBRyxNQUFBLElBQUksQ0FBQyxlQUFlLEVBQUUsbUNBQUksSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDckUsUUFBUSxDQUFDLElBQUksQ0FB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WSxDQUFDLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUMzQyxJQUFJLENBQUMsaUJBQWlCLENBQ3BCLHdCQUFZLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FDdkQsQ0FBQztpQkFDSDtxQkFBTTtvQkFDTCx3QkFBWSxDQUFDLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUMzQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxHQUFZLENBQUMsQ0FBQztpQkFDeEQ7YUFDRjtZQUVELE9BQU8sT0FBTyxDQUFDO1FBQ2pCLENBQUM7S0FBQTs7QUExZEgsc0NBMmRDO0FBMWR5QiwrQkFBaUIsR0FBVyxxQkFBcUIsQ0FBQztBQUNsRCw2QkFBZSxHQUFHLHNCQUFzQixDQUFDO0FBQ3pDLDhCQUFnQixHQUFhO0lBQ25ELFNBQVM7SUFDVCxXQUFXO0lBQ1gsU0FBUztDQUNWLENBQUM7QUFHc0Isb0NBQXNCLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCDCqSAyMDIyIGJ5IEx1Y2EgQ2FwcGEgbGNhcHBhQGdtYWlsLmNvbVxuLy8gQWxsIGNvbnRlbnQgb2YgdGhpcyByZXBvc2l0b3J5IGlzIGxpY2Vuc2VkIHVuZGVyIHRoZSBDQyBCWS1TQSBMaWNlbnNlLlxuLy8gU2VlIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3QgZm9yIGxpY2Vuc2UgaW5mb3JtYXRpb24uXG5cbmltcG9ydCAqIGFzIG9rIGZyb20gJ0BvY3Rva2l0L3Jlc3QnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgTFBGIGZyb20gJ2xwZic7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdvcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgYmFyIGZyb20gJy4vcHJvZ3Jlc3NiYXInO1xuaW1wb3J0ICogYXMgZ2l0aHViIGZyb20gJy4vZ2l0aHViJztcblxuaW1wb3J0IHsgQXBpUmF0ZUxpbWl0IH0gZnJvbSAnLi9hcGlsaW1pdHMnO1xuaW1wb3J0IHsgQXBpTGltaXRzRXhjZXB0aW9uIH0gZnJvbSAnLi9hcGlsaW1pdHNleGNlcHRpb24nO1xuaW1wb3J0IHsgY29tcG9uZW50cyB9IGZyb20gJ0BvY3Rva2l0L29wZW5hcGktdHlwZXMnO1xuaW1wb3J0IHsgQ29uZmlnIH0gZnJvbSAnbm9kZS1qc29uLWRiL2Rpc3QvbGliL0pzb25EQkNvbmZpZyc7XG5pbXBvcnQgeyB0b0Nyb25TY2hlZHVsZSB9IGZyb20gJy4vY3Jvbic7XG5pbXBvcnQgeyBEYXRlSGVscGVyIH0gZnJvbSAnLi9kYXRlaGVscGVyJztcbmltcG9ydCB7XG4gIElGaWxlLFxuICBJUmVwb3NpdG9yeSxcbiAgSVJlcG9zaXRvcmllc1Byb3ZpZGVyLFxuICBJUmVwb3NpdG9yaWVzUHJvdmlkZXJGYWN0b3J5LFxuICBJUmVwb3NpdG9yeU1hdGNoLFxuICBJUmVwb3J0ZXIsXG59IGZyb20gJy4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBKc29uREIgfSBmcm9tICdub2RlLWpzb24tZGInO1xuaW1wb3J0IHsgU3RvcHdhdGNoIH0gZnJvbSAndHMtc3RvcHdhdGNoJztcblxuZXhwb3J0IGNsYXNzIEdIQWN0aW9uVXNhZ2Uge1xuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBMYXN0U3RhcnRUaW1lTmFtZTogc3RyaW5nID0gJy9MYXN0U3RhcnRUaW1lTmFtZS8nO1xuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBVc2FnZURiRmlsZU5hbWUgPSAnYWN0aW9uLXVzYWdlLWRiLmpzb24nO1xuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBXb3JrZmxvd0ZpbGVQYXRoOiBzdHJpbmdbXSA9IFtcbiAgICAnLmdpdGh1YicsXG4gICAgJ3dvcmtmbG93cycsXG4gICAgJ3J1bi55bWwnLFxuICBdO1xuICAvLyBUZXJtaW5hdGUgdGhlIGV4ZWN1dGlvbiBhZnRlciB0aGlzIHRpbWVvdXQgdG8gcHJldmVudCBmb3JjZWQgY2FuY2VsbGF0aW9uXG4gIC8vIG9uIHRoZSBydW5uZXIgKHNpeCBob3VycylcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgSW50ZXJuYWxUaW1lb3V0TWludXRlcyA9IDUgKiA2MDtcblxuICBwcml2YXRlIHN0YXRpYyBnZXRXb3Jrc3BhY2VQYXRoKCk6IHN0cmluZyB8IG51bGwge1xuICAgIGNvbnN0IGtleSA9ICdHSVRIVUJfV09SS1NQQUNFJztcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZba2V5XSA/PyBudWxsO1xuICB9XG5cbiAgLy8gQHRzLWlnbm9yZVxuICBwcml2YXRlIHN0YXRpYyBhc3luYyBkZWxheShtaWxsaXM6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChnaXRodWIuaXNSdW5uaW5nT25HaXRIdWJSdW5uZXIoKSkge1xuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCBtaWxsaXMpKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHJlYWRvbmx5IGRiOiBKc29uREI7XG4gIHByaXZhdGUgcmVhZG9ubHkgcHJvZ3Jlc3NCYXJzOiBiYXIuUHJvZ3Jlc3NCYXI7XG4gIC8vIERheXMgb2YgZWFjaCB0aW1lIHNlZ21lbnQuXG4gIHByaXZhdGUgcmVhZG9ubHkgdGltZVJhbmdlOiBudW1iZXIgPSA2MC44NzUgLyAyO1xuICAvLyBTdGFydGluZyBkYXRlIG9mIHRoZSB0aW1lIHNlZ21lbnRzLlxuICBwcml2YXRlIHJlYWRvbmx5IHN0YXJ0aW5nRGF0ZTogRGF0ZTtcbiAgcHJpdmF0ZSByZWFkb25seSBleGVjdXRpb25TdG9wRGF0ZTogRGF0ZTtcbiAgcHJpdmF0ZSB0b3RhbFJlcG9zaXRvcnlDaGVja2VkOiBudW1iZXIgPSAwO1xuICBwcml2YXRlIHJlYWRvbmx5IGFjdGlvblJvb3RQYXRoOiBzdHJpbmc7XG5cbiAgcHVibGljIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb2N0b2tpdDogb2suT2N0b2tpdCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHJlcG9zUHJvdmlkZXJGYWN0b3J5OiBJUmVwb3NpdG9yaWVzUHJvdmlkZXJGYWN0b3J5LFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcmVwb3J0ZXI6IElSZXBvcnRlclxuICApIHtcbiAgICAvLyBJZGVudGlmeSBhY3Rpb24gZGlyZWN0b3J5XG4gICAgdGhpcy5hY3Rpb25Sb290UGF0aCA9IHRoaXMuZ2V0QWN0aW9uUGF0aCgpO1xuXG4gICAgdGhpcy5leGVjdXRpb25TdG9wRGF0ZSA9IERhdGVIZWxwZXIuYWRkTWludXRlcyhcbiAgICAgIG5ldyBEYXRlKCksXG4gICAgICBHSEFjdGlvblVzYWdlLkludGVybmFsVGltZW91dE1pbnV0ZXNcbiAgICApO1xuICAgIHJlcG9ydGVyLmluZm8oXG4gICAgICBgRXhlY3V0aW5nIHVudGlsICR7dGhpcy5leGVjdXRpb25TdG9wRGF0ZS50b1VUQ1N0cmluZygpfSBvciB1bnRpbCBBUEkgcmF0ZSBsaW1pdCByZWFjaGVkLmBcbiAgICApO1xuICAgIHRoaXMuZGIgPSB0aGlzLm9wZW5EYih0aGlzLmFjdGlvblJvb3RQYXRoKTtcbiAgICB0aGlzLnN0YXJ0aW5nRGF0ZSA9IHRoaXMuZ2V0U3RhcnRpbmdEYXRlKCkgPz8gbmV3IERhdGUoJzIwMTAtMDEtMDEnKTtcbiAgICByZXBvcnRlci5pbmZvKGBTdGFydGluZyBkYXRlOiAke3RoaXMuc3RhcnRpbmdEYXRlLnRvVVRDU3RyaW5nKCl9Jy5gKTtcblxuICAgIHRoaXMucHJvZ3Jlc3NCYXJzID0gbmV3IGJhci5Qcm9ncmVzc0JhcigpO1xuXG4gICAgTFBGLnNtb290aGluZyA9IDAuNTtcbiAgICBMUEYuaW5pdCgwKTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBydW4oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhgcnVuKCk8PCAke25ldyBEYXRlKCkudG9VVENTdHJpbmcoKX1gKTtcbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tY29uc29sZVxuICAgIGNvbnNvbGUudGltZSgncnVuKCk6Jyk7XG4gICAgbGV0IHN0YXJ0RGF0ZSA9IHRoaXMuc3RhcnRpbmdEYXRlO1xuXG4gICAgLy8gSWYgYWxyZWFkeSBydW5uaW5nLCBlbnN1cmUgdG8gZXhpdCBiZWZvcmUgbW9kaWZ5aW5nIGFueSBsb2NhbCBmaWxlIHRoYXQgd291bGQgdGhlblxuICAgIC8vIGJlIGNvbW1pdHRlZC5cbiAgICBpZiAoYXdhaXQgdGhpcy5pc0FscmVhZHlSdW5uaW5nKCkpIHtcbiAgICAgIHRoaXMucmVwb3J0ZXIuaW5mbygnQWxyZWFkeSBydW5uaW5nLCBleGl0aW5nLi4uJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG5cbiAgICAgIC8vIENvbXB1dGUgdGhlIHRvdGFsIHRpbWUtc2VnbWVudHMgb2YgJ3RpbWVSYW5nZScgZGF5cyBlYWNoLlxuICAgICAgdGhpcy5wcm9ncmVzc0JhcnMuaW5pdChzdGFydERhdGUsIHRoaXMudGltZVJhbmdlKTtcblxuICAgICAgbGV0IHRpbWVTZWdtZW50ID0gMTtcbiAgICAgIGxldCBuZXh0RGF0ZSA9IERhdGVIZWxwZXIuYWRkRGF5cyhzdGFydERhdGUsIHRoaXMudGltZVJhbmdlKTtcblxuICAgICAgLy8gSXRlcmF0ZSBvdmVyIGFsbCB0aW1lIHNlZ21lbnRzLlxuICAgICAgd2hpbGUgKHN0YXJ0RGF0ZSA8IG5vdyAmJiB0aGlzLmV4ZWN1dGlvblN0b3BEYXRlID4gbmV3IERhdGUoKSkge1xuICAgICAgICBjb25zdCByZXBvUHJvdmlkZXIgPSBhd2FpdCB0aGlzLnJlcG9zUHJvdmlkZXJGYWN0b3J5LmNyZWF0ZShcbiAgICAgICAgICB0aGlzLm9jdG9raXQsXG4gICAgICAgICAgc3RhcnREYXRlLFxuICAgICAgICAgIG5leHREYXRlLFxuICAgICAgICAgIHRoaXNcbiAgICAgICAgKTtcblxuICAgICAgICBjb25zdCByZXBvczogSVJlcG9zaXRvcnlbXSA9IGF3YWl0IHRoaXMuZ2V0UmVwb0xpc3QocmVwb1Byb3ZpZGVyKTtcblxuICAgICAgICB0aGlzLnByb2dyZXNzQmFycy51cGRhdGUoXG4gICAgICAgICAgc3RhcnREYXRlLFxuICAgICAgICAgIG5leHREYXRlLFxuICAgICAgICAgIHJlcG9Qcm92aWRlci5jb3VudCxcbiAgICAgICAgICB0aW1lU2VnbWVudFxuICAgICAgICApO1xuXG4gICAgICAgIGNvbnN0IHN3ID0gbmV3IFN0b3B3YXRjaCgpO1xuICAgICAgICBzdy5zdGFydCgpO1xuXG4gICAgICAgIGF3YWl0IHRoaXMuaXRlcmF0ZVRpbWVTZWdtZW50KHJlcG9Qcm92aWRlciwgcmVwb3MsIHN3KTtcblxuICAgICAgICAvLyBBZHZhbmNlIHRpbWUgcmFuZ2UuXG4gICAgICAgIHRpbWVTZWdtZW50Kys7XG4gICAgICAgIHN0YXJ0RGF0ZSA9IG5leHREYXRlO1xuICAgICAgICBuZXh0RGF0ZSA9IERhdGVIZWxwZXIuYWRkRGF5cyhzdGFydERhdGUsIHRoaXMudGltZVJhbmdlKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChBcGlSYXRlTGltaXQuaXNSYXRlTGltaXRFeGNlcHRpb24oZXJyKSkge1xuICAgICAgICBjb25zdCBlID0gZXJyIGFzIEFwaUxpbWl0c0V4Y2VwdGlvbjtcbiAgICAgICAgY29uc3QgY3VycmVudFJlbWFpbmluZyA9XG4gICAgICAgICAgZS5yZW1haW5pbmcgIT09IHVuZGVmaW5lZCA/ICcnICsgZS5yZW1haW5pbmcgOiAnPHVua25vd24+JztcbiAgICAgICAgY29uc3QgbmV4dFF1b3RhUmVzZXQgPSBlLm5leHRSZXNldFxuICAgICAgICAgID8gZS5uZXh0UmVzZXQudG9VVENTdHJpbmcoKVxuICAgICAgICAgIDogJzx1bmtub3duPic7XG4gICAgICAgIHRoaXMucmVwb3J0ZXIud2FybihcbiAgICAgICAgICBgJHtvcy5FT0x9JHtcbiAgICAgICAgICAgIG9zLkVPTFxuICAgICAgICAgIH0gQVBJIHJhdGUgbGltaXQgYWxtb3N0IHJlYWNoZWQgYXQgJyR7Y3VycmVudFJlbWFpbmluZ30nIHJlbWFpbmluZyBjYWxscy4gU3RvcmluZyBjdXJyZW50IHN0YXJ0aW5nIGRhdGU6ICcke3N0YXJ0RGF0ZS50b1VUQ1N0cmluZygpfScgaW4gZGIuYCArXG4gICAgICAgICAgICBgIE5leHQgcXVvdGEgcmVzZXQgb24gJyR7bmV4dFF1b3RhUmVzZXR9Jy5gXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnJlcG9ydGVyLndhcm4oJycsIGVyciBhcyBFcnJvcik7XG4gICAgICAgIHRocm93IGVycjtcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgLy8gUHJvbG9ndWVcbiAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoJ1NhdmluZyBkYXRhIGJlZm9yZSBleGl0aW5nLi4uJyk7XG5cbiAgICAgIGNvbnN0IGxpbWl0cyA9IGF3YWl0IHRoaXMuZ2V0UmVzdEN1cnJlbnRMaW1pdHMoKTtcbiAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoSlNPTi5zdHJpbmdpZnkobGltaXRzKSk7XG5cbiAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoXG4gICAgICAgIGBkYi5wdXNoICR7R0hBY3Rpb25Vc2FnZS5MYXN0U3RhcnRUaW1lTmFtZX0gJHtzdGFydERhdGUudG9VVENTdHJpbmcoKX1gXG4gICAgICApO1xuICAgICAgdGhpcy5kYi5wdXNoKFxuICAgICAgICBHSEFjdGlvblVzYWdlLkxhc3RTdGFydFRpbWVOYW1lLFxuICAgICAgICBgJHtzdGFydERhdGUudG9VVENTdHJpbmcoKX1gLFxuICAgICAgICB0cnVlXG4gICAgICApO1xuICAgICAgdGhpcy5kYi5zYXZlKHRydWUpO1xuXG4gICAgICBhd2FpdCB0aGlzLnNldHVwQ3Jvbih0aGlzLmFjdGlvblJvb3RQYXRoLCBsaW1pdHMucmVzZXQpO1xuXG4gICAgICB0aGlzLnByb2dyZXNzQmFycy5zdG9wKCk7XG4gICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tY29uc29sZVxuICAgICAgY29uc29sZS50aW1lTG9nKCdydW4oKScpO1xuICAgICAgdGhpcy5yZXBvcnRlci5kZWJ1ZyhgcnVuKCk+PmApO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBzZXRSZW1haW5pbmdDYWxscyhyZXN0QXBpPzogbnVtYmVyLCBzZWFyY2hBcGk/OiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLnByb2dyZXNzQmFycy51cGRhdGVBcGlRdW90YShyZXN0QXBpLCBzZWFyY2hBcGkpO1xuICB9XG5cbiAgLy8gSWRlbnRpZnkgdGhlIGxvY2F0aW9uIHdoZXJlIHRoZSBhY3Rpb24gaXMgY2hlY2tlZCBvdXQgYnkgc2Vla2luZyBmb3IgdGhlIHJ1bi55bWwgZmlsZS5cbiAgcHJpdmF0ZSBnZXRBY3Rpb25QYXRoKCk6IHN0cmluZyB7XG4gICAgbGV0IGFjdGlvblBhdGggPSBudWxsO1xuICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoYGdldEFjdGlvblBhdGgoKTw8YCk7XG4gICAgY29uc3QgZHMgPSBbXG4gICAgICBwcm9jZXNzLmN3ZCgpID8/ICcnLFxuICAgICAgR0hBY3Rpb25Vc2FnZS5nZXRXb3Jrc3BhY2VQYXRoKCkgPz8gJycsXG4gICAgICBgJHtfX2Rpcm5hbWUgKyBwYXRoLnNlcH0uLmAsXG4gICAgXTtcbiAgICBmb3IgKGNvbnN0IGQgb2YgZHMpIHtcbiAgICAgIGNvbnN0IHdmZnAgPSBwYXRoLmpvaW4oZCwgLi4uR0hBY3Rpb25Vc2FnZS5Xb3JrZmxvd0ZpbGVQYXRoKTtcbiAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoYGNoZWNraW5nIGZvciAnJHtkfScuLi5gKTtcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKHdmZnApKSB7XG4gICAgICAgIGFjdGlvblBhdGggPSBkO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKCFhY3Rpb25QYXRoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBpZGVudGlmeSB0aGUgYWN0aW9uIHJvb3QgZGlyZWN0b3J5LmApO1xuICAgIH1cbiAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKGBnZXRBY3Rpb25QYXRoKCk+Picke2FjdGlvblBhdGh9J2ApO1xuICAgIHJldHVybiBhY3Rpb25QYXRoO1xuICB9XG5cbiAgLy8gQ2hlY2sgd2hldGhlciBhbnkgd29ya2Zsb3cgaXMgYWxyZWFkeSBydW5uaW5nIGZvciB0aGlzIHJlcG9zaXRvcnkuXG4gIHByaXZhdGUgYXN5bmMgaXNBbHJlYWR5UnVubmluZygpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAoIWdpdGh1Yi5pc1J1bm5pbmdPbkdpdEh1YlJ1bm5lcigpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGNvbnN0IEdJVEhVQl9SRVBPU0lUT1JZID0gJ0dJVEhVQl9SRVBPU0lUT1JZJztcbiAgICBjb25zdCBvd25lcjogc3RyaW5nIHwgdW5kZWZpbmVkID0gcHJvY2Vzcy5lbnZbR0lUSFVCX1JFUE9TSVRPUlldPy5zcGxpdChcbiAgICAgICcvJ1xuICAgIClbMF07XG4gICAgY29uc3QgcmVwbzogc3RyaW5nIHwgdW5kZWZpbmVkID0gcHJvY2Vzcy5lbnZbR0lUSFVCX1JFUE9TSVRPUlldPy5zcGxpdChcbiAgICAgICcvJ1xuICAgIClbMV07XG4gICAgaWYgKCEob3duZXIgJiYgcmVwbykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYFRoZSBlbnYgdmFyIEdJVEhVQl9SRVBPU0lUT1JZIGlzIG5vdCBkZWZpbmVkOiAnJHtHSVRIVUJfUkVQT1NJVE9SWX0nLmBcbiAgICAgICk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIHR5cGUgcmVzcG9uc2VUeXBlID0gb2suUmVzdEVuZHBvaW50TWV0aG9kVHlwZXNbJ2FjdGlvbnMnXVsnbGlzdFdvcmtmbG93UnVuc0ZvclJlcG8nXVsncmVzcG9uc2UnXTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlOiByZXNwb25zZVR5cGUgPSBhd2FpdCB0aGlzLm9jdG9raXQucmVzdC5hY3Rpb25zLmxpc3RXb3JrZmxvd1J1bnNGb3JSZXBvKFxuICAgICAgICB7XG4gICAgICAgICAgb3duZXIsXG4gICAgICAgICAgcmVwbyxcbiAgICAgICAgfVxuICAgICAgKTtcbiAgICAgIHR5cGUgd29ya2Zsb3dSdW5UeXBlID0gQXJyYXk8Y29tcG9uZW50c1snc2NoZW1hcyddWyd3b3JrZmxvdy1ydW4nXT47XG4gICAgICBjb25zdCB3ZnM6IHdvcmtmbG93UnVuVHlwZSA9IHJlc3BvbnNlLmRhdGEud29ya2Zsb3dfcnVucztcbiAgICAgIGNvbnN0IHJ1bm5pbmdXZiA9IHdmcy5maWx0ZXIoXG4gICAgICAgIHdmID0+IHdmLnN0YXR1cyA9PT0gJ2luX3Byb2dyZXNzJyB8fCB3Zi5zdGF0dXMgPT09ICdxdWV1ZWQnXG4gICAgICApO1xuXG4gICAgICByZXR1cm4gcnVubmluZ1dmLmxlbmd0aCA+IDE7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnJlcG9ydGVyLmVycm9yKFxuICAgICAgICBgQ2Fubm90IGRldGVybWluZSBpZiBhbHJlYWR5IHJ1bm5pbmc6ICR7SlNPTi5zdHJpbmdpZnkoZXJyKX1gXG4gICAgICApO1xuICAgICAgdGhpcy5yZXBvcnRlci5lcnJvcihcbiAgICAgICAgYFByZXRlbmRpbmcgdG8gYmUgcnVubmluZyBhbHJlYWR5IHRvIGV4aXQgaW1tZWRpYXRlbHkgYW5kIGF2b2lkIHBvdGVudGlhbCByZWZ1c2VkICdnaXQgcHVzaCcuYFxuICAgICAgKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgb3BlbkRiKHJvb3RQYXRoOiBzdHJpbmcpOiBKc29uREIge1xuICAgIGxldCBkYjogSnNvbkRCO1xuICAgIGNvbnN0IGRiUGF0aCA9IHBhdGguam9pbihyb290UGF0aCwgJ2dyYXBoJywgR0hBY3Rpb25Vc2FnZS5Vc2FnZURiRmlsZU5hbWUpO1xuICAgIHRyeSB7XG4gICAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKGBPcGVuaW5nIERCIGF0ICcke2RiUGF0aH0nLi4uLmApO1xuICAgICAgZGIgPSBuZXcgSnNvbkRCKG5ldyBDb25maWcoZGJQYXRoLCB0cnVlLCB0cnVlLCAnLycpKTtcbiAgICAgIGRiLmdldERhdGEoR0hBY3Rpb25Vc2FnZS5MYXN0U3RhcnRUaW1lTmFtZSk7XG4gICAgICB0aGlzLnJlcG9ydGVyLmRlYnVnKGBEQiBvcGVuZWQgYXQgJyR7ZGJQYXRofScuYCk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnJlcG9ydGVyLndhcm4oKGVyciBhcyBFcnJvcik/Lm1lc3NhZ2UpO1xuICAgICAgZnMudW5saW5rU3luYyhkYlBhdGgpO1xuICAgICAgZGIgPSBuZXcgSnNvbkRCKG5ldyBDb25maWcoZGJQYXRoLCB0cnVlLCB0cnVlLCAnLycpKTtcbiAgICAgIHRoaXMucmVwb3J0ZXIuaW5mbyhgREIgYXQgJyR7ZGJQYXRofScgcmUtb3BlbmVkIHN1Y2Nlc3NmdWxseS5gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZGI7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNldHVwQ3Jvbihyb290UGF0aDogc3RyaW5nLCBkYXRlOiBEYXRlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFJlYWQgY29udGVudCBvZiB3b3JrZmxvdyBmaWxlLlxuICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4ocm9vdFBhdGgsIC4uLkdIQWN0aW9uVXNhZ2UuV29ya2Zsb3dGaWxlUGF0aCk7XG4gICAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCB7XG4gICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgIGZsYWc6ICdyJyxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBQYXRjaCB0aGUgbmV4dCBleGVjdXRpb25cbiAgICAgIGNvbnN0IG5leHRDcm9uU2NoZWR1bGUgPSBgJyR7dG9Dcm9uU2NoZWR1bGUoZGF0ZSl9J2A7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQob3MuRU9MKTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKGxpbmVzW2ldLmluZGV4T2YoJzAgKiAqICogKicpICE9PSAtMSkge1xuICAgICAgICAgIGNvbnN0IG9sZENyb24gPSAnLSBjcm9uOiAnO1xuICAgICAgICAgIGNvbnN0IG9mZnNldCA9IGxpbmVzW2kgKyAxXS5pbmRleE9mKG9sZENyb24pO1xuICAgICAgICAgIGxpbmVzW2kgKyAxXSA9XG4gICAgICAgICAgICBsaW5lc1tpICsgMV0uc3Vic3RyaW5nKDAsIG9mZnNldCArIG9sZENyb24ubGVuZ3RoKSArXG4gICAgICAgICAgICBuZXh0Q3JvblNjaGVkdWxlO1xuICAgICAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcoYG5leHQgY3JvbiBzY2hlZHVsZSBzZXQgdG8gJyR7bGluZXNbaSArIDFdfSdgKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXRjaGVkQ29udGVudCA9IGxpbmVzLmpvaW4ob3MuRU9MKTtcbiAgICAgIHRoaXMucmVwb3J0ZXIuZGVidWcocGF0Y2hlZENvbnRlbnQpO1xuICAgICAgZnMud3JpdGVGaWxlU3luYyhmaWxlUGF0aCwgcGF0Y2hlZENvbnRlbnQpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhpcy5yZXBvcnRlci5lcnJvcihgc2V0dXBDcm9uKCkgZmFpbGVkOiAke2Vycn1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldFJlcG9MaXN0KFxuICAgIHJlcG9Qcm92aWRlcjogSVJlcG9zaXRvcmllc1Byb3ZpZGVyXG4gICk6IFByb21pc2U8SVJlcG9zaXRvcnlbXT4ge1xuICAgIHJldHVybiByZXBvUHJvdmlkZXIuZ2V0TmV4dFJlcG9zKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGl0ZXJhdGVUaW1lU2VnbWVudChcbiAgICByZXBvUHJvdmlkZXI6IElSZXBvc2l0b3JpZXNQcm92aWRlcixcbiAgICByZXBvczogSVJlcG9zaXRvcnlbXSxcbiAgICBzdzogU3RvcHdhdGNoXG4gICkge1xuICAgIHRyeSB7XG4gICAgICBsZXQgYmFyQ291bnRlciA9IDA7XG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBjb25zdCBwczogQXJyYXk8UHJvbWlzZTx2b2lkPj4gPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBhUmVwbyBvZiByZXBvcykge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0aGlzLnByb2dyZXNzQmFycy51cGRhdGVSZXBvKGJhckNvdW50ZXIsIHtcbiAgICAgICAgICAgICAgYWN0aW9uOiBiYXIuUHJvZ3Jlc3NCYXIuZ2V0QWN0aW9uU3RyaW5nKFxuICAgICAgICAgICAgICAgIGBjaGVja2luZyByZXBvLi4uICcke2FSZXBvLm93bmVyfS8ke2FSZXBvLm5hbWV9J2BcbiAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgY29uc3QgdGFzayA9IG5ldyBQcm9taXNlPHZvaWQ+KGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgICAgbGV0IG1hdGNoZXM6IElSZXBvc2l0b3J5TWF0Y2hbXTtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBtYXRjaGVzID0gYXdhaXQgdGhpcy5jaGVja1JlcG9zaXRvcnkoXG4gICAgICAgICAgICAgICAgICBhUmVwby5vd25lcixcbiAgICAgICAgICAgICAgICAgIGFSZXBvLm5hbWUsXG4gICAgICAgICAgICAgICAgICAnLmdpdGh1Yi93b3JrZmxvd3MnXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgQXBpUmF0ZUxpbWl0LmNoZWNrUmVzdEFwaUxpbWl0KFxuICAgICAgICAgICAgICAgICAgICAoZXJyb3IgYXMgYW55KT8ucmVzcG9uc2U/LmhlYWRlcnNcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjb25zdCBrZXkgPSBgLyR7YVJlcG8ub3duZXJ9LyR7YVJlcG8ubmFtZX1gO1xuICAgICAgICAgICAgICBpZiAobWF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5kYi5wdXNoKGtleSwgWy4uLm1hdGNoZXMsIGFSZXBvXSwgdHJ1ZSk7XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBiYXJDb3VudGVyKys7XG4gICAgICAgICAgICAgIHRoaXMudG90YWxSZXBvc2l0b3J5Q2hlY2tlZCsrO1xuXG4gICAgICAgICAgICAgIGNvbnN0IHRvdGFsVGltZU1pbGxpcyA9IHN3LmdldFRpbWUoKTtcblxuICAgICAgICAgICAgICB0aGlzLnByb2dyZXNzQmFycy51cGRhdGVSZXBvKGJhckNvdW50ZXIsIHtcbiAgICAgICAgICAgICAgICBhY3Rpb246IGJhci5Qcm9ncmVzc0Jhci5nZXRBY3Rpb25TdHJpbmcoXG4gICAgICAgICAgICAgICAgICBgY2hlY2tpbmcgcmVwby4uLiAnJHthUmVwby5vd25lcn0vJHthUmVwby5uYW1lfSdgXG4gICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICAgICBzcGVlZDogYCR7TFBGLm5leHQoXG4gICAgICAgICAgICAgICAgICB0aGlzLnRvdGFsUmVwb3NpdG9yeUNoZWNrZWQgLyAodG90YWxUaW1lTWlsbGlzIC8gNjAwMDAuMClcbiAgICAgICAgICAgICAgICApLnRvRml4ZWQoMSl9IHJlcG8vbWluYC5wYWRTdGFydCgzLCAnICcpLFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBwcy5wdXNoKHRhc2spO1xuICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgQXBpUmF0ZUxpbWl0LnRocm93SWZSYXRlTGltaXRFeGNlZWRlZChlcnIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHBzKTtcbiAgICAgICAgdGhpcy5wcm9ncmVzc0JhcnMudXBkYXRlUmVwbyhiYXJDb3VudGVyLCB7XG4gICAgICAgICAgYWN0aW9uOiBiYXIuUHJvZ3Jlc3NCYXIuZ2V0QWN0aW9uU3RyaW5nKGBsaXN0aW5nIHJlcG9zLi4uYCksXG4gICAgICAgIH0pO1xuICAgICAgICByZXBvcyA9IGF3YWl0IHRoaXMuZ2V0UmVwb0xpc3QocmVwb1Byb3ZpZGVyKTtcbiAgICAgICAgaWYgKHJlcG9zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBBcGlSYXRlTGltaXQudGhyb3dJZlJhdGVMaW1pdEV4Y2VlZGVkKGVycik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZXRSZXN0Q3VycmVudExpbWl0cygpOiBQcm9taXNlPHtcbiAgICByZW1haW5pbmc6IG51bWJlcjtcbiAgICByZXNldDogRGF0ZTtcbiAgfT4ge1xuICAgIHR5cGUgcmVzcG9uc2UgPSBvay5SZXN0RW5kcG9pbnRNZXRob2RUeXBlc1sncmF0ZUxpbWl0J11bJ2dldCddWydyZXNwb25zZSddO1xuICAgIGNvbnN0IGxpbWl0czogcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm9jdG9raXQucmVzdC5yYXRlTGltaXQuZ2V0KCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlbWFpbmluZzogbGltaXRzLmRhdGEucmVzb3VyY2VzLmNvcmUucmVtYWluaW5nLFxuICAgICAgcmVzZXQ6IG5ldyBEYXRlKGxpbWl0cy5kYXRhLnJlc291cmNlcy5jb3JlLnJlc2V0ICogMTAwMCksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0U3RhcnRpbmdEYXRlKCk6IERhdGUgfCBudWxsIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZGF0ZTogc3RyaW5nID0gdGhpcy5kYi5nZXREYXRhKEdIQWN0aW9uVXNhZ2UuTGFzdFN0YXJ0VGltZU5hbWUpO1xuICAgICAgY29uc3QgdGltZXN0YW1wID0gRGF0ZS5wYXJzZShkYXRlKTtcbiAgICAgIGlmIChpc05hTih0aW1lc3RhbXApID09PSBmYWxzZSkge1xuICAgICAgICBjb25zdCBzdGFydERhdGU6IERhdGUgPSBuZXcgRGF0ZSh0aW1lc3RhbXApO1xuICAgICAgICAvLyBJZiBzdGFydCBkYXRlIGlzIG1vcmUgcmVjZW50IHRoYW4gX25vd18sIHJlc3RhcnQgb3ZlciBieSByZXR1cm5pbmcgbnVsbC5cbiAgICAgICAgcmV0dXJuIHN0YXJ0RGF0ZSA8IG5ldyBEYXRlKCkgPyBzdGFydERhdGUgOiBudWxsO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhpcy5yZXBvcnRlci53YXJuKCcnLCBlcnIgYXMgRXJyb3IpO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY2hlY2tSZXBvc2l0b3J5KFxuICAgIG93bmVyOiBzdHJpbmcsXG4gICAgcmVwbzogc3RyaW5nLFxuICAgIGZpbGVQYXRoOiBzdHJpbmdcbiAgKTogUHJvbWlzZTxJUmVwb3NpdG9yeU1hdGNoW10+IHtcbiAgICBjb25zdCBtYXRjaGVzOiBJUmVwb3NpdG9yeU1hdGNoW10gPSBbXTtcbiAgICB0cnkge1xuICAgICAgdHlwZSB0ID0gb2suUmVzdEVuZHBvaW50TWV0aG9kVHlwZXNbJ3JlcG9zJ11bJ2dldENvbnRlbnQnXVsncmVzcG9uc2UnXTtcbiAgICAgIGNvbnN0IGRhdGE6IHQgPSBhd2FpdCB0aGlzLm9jdG9raXQucmVzdC5yZXBvcy5nZXRDb250ZW50KHtcbiAgICAgICAgb3duZXIsXG4gICAgICAgIHBhdGg6IGZpbGVQYXRoLFxuICAgICAgICByZXBvLFxuICAgICAgfSk7XG4gICAgICB0aGlzLnNldFJlbWFpbmluZ0NhbGxzKEFwaVJhdGVMaW1pdC5jaGVja1Jlc3RBcGlMaW1pdChkYXRhLmhlYWRlcnMpKTtcbiAgICAgIGNvbnN0IGZpbGVzOiBJRmlsZVtdID0gZGF0YS5kYXRhIGFzIElGaWxlW107XG4gICAgICBpZiAoZmlsZXMpIHtcbiAgICAgICAgdHlwZSBycCA9IG9rLlJlc3RFbmRwb2ludE1ldGhvZFR5cGVzWydyZXBvcyddWydnZXQnXVsncmVzcG9uc2UnXTtcbiAgICAgICAgY29uc3QgcmVwb1Jlc3BvbnNlOiBycCA9IGF3YWl0IHRoaXMub2N0b2tpdC5yZXN0LnJlcG9zLmdldCh7XG4gICAgICAgICAgb3duZXIsXG4gICAgICAgICAgcmVwbyxcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuc2V0UmVtYWluaW5nQ2FsbHMoXG4gICAgICAgICAgQXBpUmF0ZUxpbWl0LmNoZWNrUmVzdEFwaUxpbWl0KHJlcG9SZXNwb25zZS5oZWFkZXJzKVxuICAgICAgICApO1xuXG4gICAgICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAoZmlsZS5kb3dubG9hZF91cmwpIHtcbiAgICAgICAgICAgICAgdHlwZSByZXNwID0gb2suUmVzdEVuZHBvaW50TWV0aG9kVHlwZXNbJ3JlcG9zJ11bJ2dldENvbnRlbnQnXVsncmVzcG9uc2UnXTtcbiAgICAgICAgICAgICAgY29uc3QgZjogcmVzcCA9IGF3YWl0IHRoaXMub2N0b2tpdC5yZXN0LnJlcG9zLmdldENvbnRlbnQoe1xuICAgICAgICAgICAgICAgIG93bmVyLFxuICAgICAgICAgICAgICAgIHBhdGg6IGZpbGUucGF0aCxcbiAgICAgICAgICAgICAgICByZXBvLFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgdGhpcy5zZXRSZW1haW5pbmdDYWxscyhBcGlSYXRlTGltaXQuY2hlY2tSZXN0QXBpTGltaXQoZi5oZWFkZXJzKSk7XG4gICAgICAgICAgICAgIGNvbnN0IGZpbGVDb250ZW50ID0gQnVmZmVyLmZyb20oXG4gICAgICAgICAgICAgICAgKGYuZGF0YSBhcyBhbnkpLmNvbnRlbnQsXG4gICAgICAgICAgICAgICAgJ2Jhc2U2NCdcbiAgICAgICAgICAgICAgKS50b1N0cmluZygndXRmOCcpO1xuICAgICAgICAgICAgICBjb25zdCBsaW5lcyA9IGZpbGVDb250ZW50LnNwbGl0KG9zLkVPTCk7XG4gICAgICAgICAgICAgIGxldCBsaW5lTnVtYmVyID0gMDtcbiAgICAgICAgICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICAgICAgICAgICAgbGluZU51bWJlcisrO1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlZ0V4cCA9IG5ldyBSZWdFeHAoXG4gICAgICAgICAgICAgICAgICAnbHVra2EvKD88YWN0aW9uPig/OmdldC1jbWFrZSl8KD86cnVuLWNtYWtlKXwoPzpydW4tdmNwa2cpKUAoPzx2ZXJzaW9uPltcXFxcd1xcXFxkXFxcXC5dKyknLFxuICAgICAgICAgICAgICAgICAgJ2cnXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBjb25zdCBtYXRjaEFycmF5ID0gbGluZS5tYXRjaEFsbChyZWdFeHApO1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgbWF0Y2ggb2YgbWF0Y2hBcnJheSkge1xuICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG1hdGNoLmdyb3Vwcykge1xuICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGhpdCA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjdGlvbk5hbWU6IG1hdGNoLmdyb3Vwcy5hY3Rpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICBsaW5lOiBsaW5lTnVtYmVyLFxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBnaXRodWIuZ2V0SHRtbFVybChmaWxlLnVybCwgbGluZU51bWJlciksXG4gICAgICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uOiBtYXRjaC5ncm91cHMudmVyc2lvbixcbiAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgIHRoaXMucmVwb3J0ZXIuaW5mbyhcbiAgICAgICAgICAgICAgICAgICAgICAgIGBcXG4gRm91bmQgJyR7aGl0LmFjdGlvbk5hbWV9QCR7aGl0LnZlcnNpb259JyBpbiByZXBvOiAke293bmVyfS8ke3JlcG99ICR7cmVwb1Jlc3BvbnNlLmRhdGEuc3RhcmdhemVyc19jb3VudH3irZEgICR7cmVwb1Jlc3BvbnNlLmRhdGEud2F0Y2hlcnNfY291bnR98J+RgGBcbiAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgIG1hdGNoZXMucHVzaChoaXQpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgQXBpUmF0ZUxpbWl0LnRocm93SWZSYXRlTGltaXRFeGNlZWRlZChlcnIpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlcG9ydGVyLndhcm4oYGNoZWNrUmVwb3NpdG9yeSgpOmAsIGVyciBhcyBFcnJvcik7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICBBcGlSYXRlTGltaXQudGhyb3dJZlJhdGVMaW1pdEV4Y2VlZGVkKGVycik7XG4gICAgICAgICAgICB0aGlzLnJlcG9ydGVyLndhcm4oYGNoZWNrUmVwb3NpdG9yeSgpOmAsIGVyciBhcyBFcnJvcik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zdCBlcnJvciA9IGVyciBhcyBhbnk7XG4gICAgICBpZiAoZXJyb3I/LnN0YXR1cyA9PT0gNDA0KSB7XG4gICAgICAgIEFwaVJhdGVMaW1pdC50aHJvd0lmUmF0ZUxpbWl0RXhjZWVkZWQoZXJyKTtcbiAgICAgICAgdGhpcy5zZXRSZW1haW5pbmdDYWxscyhcbiAgICAgICAgICBBcGlSYXRlTGltaXQuY2hlY2tSZXN0QXBpTGltaXQoZXJyb3IucmVzcG9uc2UuaGVhZGVycylcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIEFwaVJhdGVMaW1pdC50aHJvd0lmUmF0ZUxpbWl0RXhjZWVkZWQoZXJyKTtcbiAgICAgICAgdGhpcy5yZXBvcnRlci53YXJuKGBjaGVja1JlcG9zaXRvcnkoKTpgLCBlcnIgYXMgRXJyb3IpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBtYXRjaGVzO1xuICB9XG59XG4iXX0=