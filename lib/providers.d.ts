import * as ok from '@octokit/rest';
import { IApiCallNotification, IRepositoriesProvider, IRepository } from './interfaces';
export declare class SearchPublic implements IRepositoriesProvider {
    private readonly octokit;
    private readonly startDate;
    private readonly endDate;
    private readonly notification;
    private next;
    private totalCount;
    private page;
    private readonly stars;
    constructor(octokit: ok.Octokit, startDate: Date, endDate: Date, notification: IApiCallNotification);
    get count(): number;
    init(): Promise<boolean>;
    getNextRepos(): Promise<IRepository[]>;
    private setNext;
}
