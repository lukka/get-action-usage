import * as ok from '@octokit/rest';
import { IApiCallNotification, IRepositoriesProviderFactory } from './interfaces';
import { SearchPublic } from './providers';
export declare class SearchPublicFactory implements IRepositoriesProviderFactory {
    create(octokit: ok.Octokit, startDate: Date, endDate: Date, notification: IApiCallNotification): Promise<SearchPublic>;
}
