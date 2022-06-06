// Copyright © 2022 by Luca Cappa lcappa@gmail.com
// All content of this repository is licensed under the CC BY-SA License.
// See the LICENSE file in the root for license information.

import * as ok from '@octokit/rest';
import { ApiRateLimit } from './apilimits';
import { DateHelper } from './datehelper';
import {
  IApiCallNotification,
  IRepositoriesProvider,
  IRepository,
} from './interfaces';
import * as httpError from 'http-errors';

export class SearchPublic implements IRepositoriesProvider {
  private next: IRepository[] = [];
  private totalCount: number = -1;
  private page: number = 0;
  private readonly stars: number = 25;
  public constructor(
    private readonly octokit: ok.Octokit,
    private readonly startDate: Date,
    private readonly endDate: Date,
    private readonly notification: IApiCallNotification
  ) {
    // Intentionally void.
  }

  public get count() {
    return this.totalCount;
  }

  public async init(): Promise<boolean> {
    type resp = ok.RestEndpointMethodTypes['search']['repos']['response'];
    const n: resp = await this.octokit.rest.search.repos({
      order: 'asc',
      per_page: 100,
      q: `stars:>=${
        this.stars
      } language:cpp fork:false created:${DateHelper.toTimeRangeString(
        this.startDate,
        this.endDate
      )}`,
      sort: 'stars',
    });

    this.notification.setRemainingCalls(
      undefined,
      n?.headers ? ApiRateLimit.checkSearchApiLimit(n.headers) : undefined
    );

    this.totalCount = n.data.total_count;
    this.setNext(n);
    this.page = 2;
    return true;
  }

  // Using Search API for repositories: https://octokit.github.io/octokit.js/v18/#repos
  public async getNextRepos(): Promise<IRepository[]> {
    let ret: IRepository[] = [];
    try {
      if (this.totalCount === -1) {
        throw Error('init() was not called or it failed.');
      }

      type resp = ok.RestEndpointMethodTypes['search']['repos']['response'];
      let response: resp;
      ret = this.next;
      response = await this.octokit.rest.search.repos({
        order: 'asc',
        page: this.page,
        per_page: 100,
        q: `stars:>=${
          this.stars
        } language:cpp fork:false created:${DateHelper.toTimeRangeString(
          this.startDate,
          this.endDate
        )}`,
        sort: 'stars',
      });

      this.notification.setRemainingCalls(
        undefined,
        response?.headers
          ? ApiRateLimit.checkSearchApiLimit(response.headers)
          : undefined
      );

      this.setNext(response);
      this.page++;

      return ret;
    } catch (err) {
      ApiRateLimit.throwIfRateLimitExceeded(err);

      // Swallow 422 responses.
      if (err instanceof httpError.HttpError) {
        const httpErr = err as httpError.HttpError;
        if (httpErr.status === 422) {
          // tslint:disable-next-line:no-console
          console.warn(httpErr.message);
        } else {
          throw err;
        }
      }
      return ret;
    }
  }

  private setNext(response: any) {
    this.next = [];
    if (response.data?.items) {
      for (const idx in response.data.items) {
        if (response.data.items.hasOwnProperty(idx)) {
          const repo: any = response.data.items[idx];

          const aRepo: IRepository = {
            name: repo.name,
            owner: repo.owner.login,
            repo_orig: repo,
            stars: repo.stargazers_count,
            url: repo.url,
            watchers: repo.watchers,
          };
          this.next.push(aRepo);
        }
      }
    }
  }
}

/*
// @ts-ignore
class ListPublic implements IRepositoriesProvider {
  public static async create(octokit: ok.Octokit): Promise<ListPublic> {
    const provider: ListPublic = new ListPublic(octokit);
    if (!(await provider.init())) {
      throw new Error('ListPublic.init() failed');
    }
    return provider;
  }

  private next: IRepository[] = [];
  private totalCount: number = -1;
  private nextUrl: parselink.Links | null = null;
  private constructor(private octokit: ok.Octokit) { }

  public get count(): number {
    return this.totalCount;
  }

  public async getNextRepos(): Promise<IRepository[]> {
    if (this.totalCount === -1) {
      throw Error('init() was not called or it failed.');
    }

    if (this.nextUrl) {
      const response = await this.octokit.request(`GET ${this.nextUrl}`);
      this.setNext(response);
    }

    return this.next;
  }

  private async init(): Promise<boolean> {
    const n = await this.octokit.request(`GET /repositories`);
    this.totalCount = n.data.length;
    this.setNext(n.data);

    this.nextUrl = parselink(n.headers.link);
    return true;
  }

  private setNext(response: any) {
    this.next = [];
    for (const repo of response.Response.data) {
      const aRepo: IRepository = {
        name: repo.name,
        owner: repo.owner.login,
        repo_orig: repo,
        stars: repo.stargazers_count,
        url: repo.url,
        watchers: repo.watchers,
      };
      this.next.push(aRepo);
    }
  }
}*/
