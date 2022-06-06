// Copyright © 2022 by Luca Cappa lcappa@gmail.com
// All content of this repository is licensed under the CC BY-SA License.
// See the LICENSE file in the root for license information.

import { ResponseHeaders } from '@octokit/types';
import { ApiLimitsException } from './apilimitsexception';
import { EOL } from 'os';

export class ApiRateLimit {
  public static readonly RestLimitThreshold = 20;
  public static readonly SearchLimitThreshold = 2;

  public static checkSearchApiLimit(headers: ResponseHeaders): number {
    return ApiRateLimit.checkApiLimit(
      headers,
      ApiRateLimit.SearchLimitThreshold,
      'Search API'
    );
  }

  public static checkRestApiLimit(headers: ResponseHeaders): number {
    return ApiRateLimit.checkApiLimit(
      headers,
      ApiRateLimit.RestLimitThreshold,
      'REST API'
    );
  }

  public static isRateLimitException(requestError: any): boolean {
    if (requestError instanceof ApiLimitsException) {
      return true;
    }

    let errMsg = '';
    if (requestError instanceof Error) {
      errMsg = requestError.message;
    } else if (requestError.response) {
      errMsg = requestError.response.data.message;
    }

    return (
      errMsg.indexOf('rate limit') !== -1 && errMsg.indexOf('secondary') === -1
    );
  }

  public static throwIfRateLimitExceeded(requestError: any) {
    if (ApiRateLimit.isRateLimitException(requestError)) {
      throw requestError;
    }
  }

  private static checkApiLimit(
    headers: ResponseHeaders,
    threshold: number,
    message: string
  ): number {
    try {
      const remaining: number = ApiRateLimit.getHeaderValue(
        headers,
        'x-ratelimit-remaining'
      );
      const quotaReset: number = ApiRateLimit.getHeaderValue(
        headers,
        'x-ratelimit-reset'
      );
      const used: number = ApiRateLimit.getHeaderValue(
        headers,
        'x-ratelimit-used'
      );

      const quotaResetDate = new Date(quotaReset * 1000);

      // Exclude NaN or negatives.
      if (remaining >= 0 && remaining < threshold) {
        throw new ApiLimitsException(
          `Close to '${message}' quota/rate limit. Remaining calls are '${remaining}', ` +
            `quota will reset at ${quotaResetDate.toUTCString() ??
              '<unknown>'}.`,
          remaining,
          quotaResetDate,
          used
        );
      }
      return remaining;
    } catch (err) {
      // tslint:disable-next-line:no-console
      console.log(`checkApiLimit(): rethrowing error:${EOL}'${err}'`);
      throw err;
    }
  }

  private static getHeaderValue(
    headers: ResponseHeaders,
    name: string
  ): number {
    const nameField = name as keyof ResponseHeaders;
    const text: string = headers[nameField] as string;
    if (text) {
      return parseInt(text, 10);
    } else {
      throw new Error(`Cannot get value for header '${name}'`);
    }
  }
}
