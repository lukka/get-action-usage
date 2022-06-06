import { ResponseHeaders } from '@octokit/types';
export declare class ApiRateLimit {
    static readonly RestLimitThreshold = 20;
    static readonly SearchLimitThreshold = 2;
    static checkSearchApiLimit(headers: ResponseHeaders): number;
    static checkRestApiLimit(headers: ResponseHeaders): number;
    static isRateLimitException(requestError: any): boolean;
    static throwIfRateLimitExceeded(requestError: any): void;
    private static checkApiLimit;
    private static getHeaderValue;
}
