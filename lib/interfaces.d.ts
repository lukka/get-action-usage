import * as ok from '@octokit/rest';
export interface IFile {
    size: number;
    path: string;
    url: string;
    download_url: string;
}
export interface IRepository {
    owner: string;
    name: string;
    url: string;
    stars: number;
    watchers: number;
    repo_orig: any;
}
export interface IRepositoriesProvider {
    readonly count: number;
    getNextRepos(): Promise<IRepository[]>;
}
export interface IRepositoryMatch {
    actionName: string;
    version: string;
    url: string;
    line: number;
}
export interface IRepositoriesProviderFactory {
    create(octokit: ok.Octokit, startDate: Date, endDate: Date, apiCallNotification: IApiCallNotification): Promise<IRepositoriesProvider>;
}
export interface IReporter {
    info(message: string, error?: Error): void;
    warn(message: string, error?: Error): void;
    error(message: string, error?: Error): void;
    debug(message: string, error?: Error): void;
}
export interface IApiCallNotification {
    setRemainingCalls(restApi?: number, searchApi?: number): void;
}
