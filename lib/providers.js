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
exports.SearchPublic = void 0;
const apilimits_1 = require("./apilimits");
const datehelper_1 = require("./datehelper");
const httpError = require("http-errors");
class SearchPublic {
    constructor(octokit, startDate, endDate, notification) {
        this.octokit = octokit;
        this.startDate = startDate;
        this.endDate = endDate;
        this.notification = notification;
        this.next = [];
        this.totalCount = -1;
        this.page = 0;
        this.stars = 25;
    }
    get count() {
        return this.totalCount;
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            const n = yield this.octokit.rest.search.repos({
                order: 'asc',
                per_page: 100,
                q: `stars:>=${this.stars} language:cpp fork:false created:${datehelper_1.DateHelper.toTimeRangeString(this.startDate, this.endDate)}`,
                sort: 'stars',
            });
            this.notification.setRemainingCalls(undefined, (n === null || n === void 0 ? void 0 : n.headers) ? apilimits_1.ApiRateLimit.checkSearchApiLimit(n.headers) : undefined);
            this.totalCount = n.data.total_count;
            this.setNext(n);
            this.page = 2;
            return true;
        });
    }
    getNextRepos() {
        return __awaiter(this, void 0, void 0, function* () {
            let ret = [];
            try {
                if (this.totalCount === -1) {
                    throw Error('init() was not called or it failed.');
                }
                let response;
                ret = this.next;
                response = yield this.octokit.rest.search.repos({
                    order: 'asc',
                    page: this.page,
                    per_page: 100,
                    q: `stars:>=${this.stars} language:cpp fork:false created:${datehelper_1.DateHelper.toTimeRangeString(this.startDate, this.endDate)}`,
                    sort: 'stars',
                });
                this.notification.setRemainingCalls(undefined, (response === null || response === void 0 ? void 0 : response.headers)
                    ? apilimits_1.ApiRateLimit.checkSearchApiLimit(response.headers)
                    : undefined);
                this.setNext(response);
                this.page++;
                return ret;
            }
            catch (err) {
                apilimits_1.ApiRateLimit.throwIfRateLimitExceeded(err);
                if (err instanceof httpError.HttpError) {
                    const httpErr = err;
                    if (httpErr.status === 422) {
                        console.warn(httpErr.message);
                    }
                    else {
                        throw err;
                    }
                }
                return ret;
            }
        });
    }
    setNext(response) {
        var _a;
        this.next = [];
        if ((_a = response.data) === null || _a === void 0 ? void 0 : _a.items) {
            for (const idx in response.data.items) {
                if (response.data.items.hasOwnProperty(idx)) {
                    const repo = response.data.items[idx];
                    const aRepo = {
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
exports.SearchPublic = SearchPublic;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvdmlkZXJzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3Byb3ZpZGVycy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFLQSwyQ0FBMkM7QUFDM0MsNkNBQTBDO0FBTTFDLHlDQUF5QztBQUV6QyxNQUFhLFlBQVk7SUFLdkIsWUFDbUIsT0FBbUIsRUFDbkIsU0FBZSxFQUNmLE9BQWEsRUFDYixZQUFrQztRQUhsQyxZQUFPLEdBQVAsT0FBTyxDQUFZO1FBQ25CLGNBQVMsR0FBVCxTQUFTLENBQU07UUFDZixZQUFPLEdBQVAsT0FBTyxDQUFNO1FBQ2IsaUJBQVksR0FBWixZQUFZLENBQXNCO1FBUjdDLFNBQUksR0FBa0IsRUFBRSxDQUFDO1FBQ3pCLGVBQVUsR0FBVyxDQUFDLENBQUMsQ0FBQztRQUN4QixTQUFJLEdBQVcsQ0FBQyxDQUFDO1FBQ1IsVUFBSyxHQUFXLEVBQUUsQ0FBQztJQVFwQyxDQUFDO0lBRUQsSUFBVyxLQUFLO1FBQ2QsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFDO0lBQ3pCLENBQUM7SUFFWSxJQUFJOztZQUVmLE1BQU0sQ0FBQyxHQUFTLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQztnQkFDbkQsS0FBSyxFQUFFLEtBQUs7Z0JBQ1osUUFBUSxFQUFFLEdBQUc7Z0JBQ2IsQ0FBQyxFQUFFLFdBQ0QsSUFBSSxDQUFDLEtBQ1Asb0NBQW9DLHVCQUFVLENBQUMsaUJBQWlCLENBQzlELElBQUksQ0FBQyxTQUFTLEVBQ2QsSUFBSSxDQUFDLE9BQU8sQ0FDYixFQUFFO2dCQUNILElBQUksRUFBRSxPQUFPO2FBQ2QsQ0FBQyxDQUFDO1lBRUgsSUFBSSxDQUFDLFlBQVksQ0FBQyxpQkFBaUIsQ0FDakMsU0FBUyxFQUNULENBQUEsQ0FBQyxhQUFELENBQUMsdUJBQUQsQ0FBQyxDQUFFLE9BQU8sRUFBQyxDQUFDLENBQUMsd0JBQVksQ0FBQyxtQkFB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O3dCQUNiLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtxQkFDeEIsQ0FBQztvQkFDRixJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztpQkFDdkI7YUFDRjtTQUNGO0lBQ0gsQ0FBQztDQUNGO0FBbkhELG9DQW1IQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCDCqSAyMDIyIGJ5IEx1Y2EgQ2FwcGEgbGNhcHBhQGdtYWlsLmNvbVxuLy8gQWxsIGNvbnRlbnQgb2YgdGhpcyByZXBvc2l0b3J5IGlzIGxpY2Vuc2VkIHVuZGVyIHRoZSBDQyBCWS1TQSBMaWNlbnNlLlxuLy8gU2VlIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3QgZm9yIGxpY2Vuc2UgaW5mb3JtYXRpb24uXG5cbmltcG9ydCAqIGFzIG9rIGZyb20gJ0BvY3Rva2l0L3Jlc3QnO1xuaW1wb3J0IHsgQXBpUmF0ZUxpbWl0IH0gZnJvbSAnLi9hcGlsaW1pdHMnO1xuaW1wb3J0IHsgRGF0ZUhlbHBlciB9IGZyb20gJy4vZGF0ZWhlbHBlcic7XG5pbXBvcnQge1xuICBJQXBpQ2FsbE5vdGlmaWNhdGlvbixcbiAgSVJlcG9zaXRvcmllc1Byb3ZpZGVyLFxuICBJUmVwb3NpdG9yeSxcbn0gZnJvbSAnLi9pbnRlcmZhY2VzJztcbmltcG9ydCAqIGFzIGh0dHBFcnJvciBmcm9tICdodHRwLWVycm9ycyc7XG5cbmV4cG9ydCBjbGFzcyBTZWFyY2hQdWJsaWMgaW1wbGVtZW50cyBJUmVwb3NpdG9yaWVzUHJvdmlkZXIge1xuICBwcml2YXRlIG5leHQ6IElSZXBvc2l0b3J5W10gPSBbXTtcbiAgcHJpdmF0ZSB0b3RhbENvdW50OiBudW1iZXIgPSAtMTtcbiAgcHJpdmF0ZSBwYWdlOiBudW1iZXIgPSAwO1xuICBwcml2YXRlIHJlYWRvbmx5IHN0YXJzOiBudW1iZXIgPSAyNTtcbiAgcHVibGljIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb2N0b2tpdDogb2suT2N0b2tpdCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHN0YXJ0RGF0ZTogRGF0ZSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGVuZERhdGU6IERhdGUsXG4gICAgcHJpdmF0ZSByZWFkb25seSBub3RpZmljYXRpb246IElBcGlDYWxsTm90aWZpY2F0aW9uXG4gICkge1xuICAgIC8vIEludGVudGlvbmFsbHkgdm9pZC5cbiAgfVxuXG4gIHB1YmxpYyBnZXQgY291bnQoKSB7XG4gICAgcmV0dXJuIHRoaXMudG90YWxDb3VudDtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBpbml0KCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHR5cGUgcmVzcCA9IG9rLlJlc3RFbmRwb2ludE1ldGhvZFR5cGVzWydzZWFyY2gnXVsncmVwb3MnXVsncmVzcG9uc2UnXTtcbiAgICBjb25zdCBuOiByZXNwID0gYXdhaXQgdGhpcy5vY3Rva2l0LnJlc3Quc2VhcmNoLnJlcG9zKHtcbiAgICAgIG9yZGVyOiAnYXNjJyxcbiAgICAgIHBlcl9wYWdlOiAxMDAsXG4gICAgICBxOiBgc3RhcnM6Pj0ke1xuICAgICAgICB0aGlzLnN0YXJzXG4gICAgICB9IGxhbmd1YWdlOmNwcCBmb3JrOmZhbHNlIGNyZWF0ZWQ6JHtEYXRlSGVscGVyLnRvVGltZVJhbmdlU3RyaW5nKFxuICAgICAgICB0aGlzLnN0YXJ0RGF0ZSxcbiAgICAgICAgdGhpcy5lbmREYXRlXG4gICAgICApfWAsXG4gICAgICBzb3J0OiAnc3RhcnMnLFxuICAgIH0pO1xuXG4gICAgdGhpcy5ub3RpZmljYXRpb24uc2V0UmVtYWluaW5nQ2FsbHMoXG4gICAgICB1bmRlZmluZWQsXG4gICAgICBuPy5oZWFkZXJzID8gQXBpUmF0ZUxpbWl0LmNoZWNrU2VhcmNoQXBpTGltaXQobi5oZWFkZXJzKSA6IHVuZGVmaW5lZFxuICAgICk7XG5cbiAgICB0aGlzLnRvdGFsQ291bnQgPSBuLmRhdGEudG90YWxfY291bnQ7XG4gICAgdGhpcy5zZXROZXh0KG4pO1xuICAgIHRoaXMucGFnZSA9IDI7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyBVc2luZyBTZWFyY2ggQVBJIGZvciByZXBvc2l0b3JpZXM6IGh0dHBzOi8vb2N0b2tpdC5naXRodWIuaW8vb2N0b2tpdC5qcy92MTgvI3JlcG9zXG4gIHB1YmxpYyBhc3luYyBnZXROZXh0UmVwb3MoKTogUHJvbWlzZTxJUmVwb3NpdG9yeVtdPiB7XG4gICAgbGV0IHJldDogSVJlcG9zaXRvcnlbXSA9IFtdO1xuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy50b3RhbENvdW50ID09PSAtMSkge1xuICAgICAgICB0aHJvdyBFcnJvcignaW5pdCgpIHdhcyBub3QgY2FsbGVkIG9yIGl0IGZhaWxlZC4nKTtcbiAgICAgIH1cblxuICAgICAgdHlwZSByZXNwID0gb2suUmVzdEVuZHBvaW50TWV0aG9kVHlwZXNbJ3NlYXJjaCddWydyZXBvcyddWydyZXNwb25zZSddO1xuICAgICAgbGV0IHJlc3BvbnNlOiByZXNwO1xuICAgICAgcmV0ID0gdGhpcy5uZXh0O1xuICAgICAgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm9jdG9raXQucmVzdC5zZWFyY2gucmVwb3Moe1xuICAgICAgICBvcmRlcjogJ2FzYycsXG4gICAgICAgIHBhZ2U6IHRoaXMucGFnZSxcbiAgICAgICAgcGVyX3BhZ2U6IDEwMCxcbiAgICAgICAgcTogYHN0YXJzOj49JHtcbiAgICAgICAgICB0aGlzLnN0YXJzXG4gICAgICAgIH0gbGFuZ3VhZ2U6Y3BwIGZvcms6ZmFsc2UgY3JlYXRlZDoke0RhdGVIZWxwZXIudG9UaW1lUmFuZ2VTdHJpbmcoXG4gICAgICAgICAgdGhpcy5zdGFydERhdGUsXG4gICAgICAgICAgdGhpcy5lbmREYXRlXG4gICAgICAgICl9YCxcbiAgICAgICAgc29ydDogJ3N0YXJzJyxcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLm5vdGlmaWNhdGlvbi5zZXRSZW1haW5pbmdDYWxscyhcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICByZXNwb25zZT8uaGVhZGVyc1xuICAgICAgICAgID8gQXBpUmF0ZUxpbWl0LmNoZWNrU2VhcmNoQXBpTGltaXQocmVzcG9uc2UuaGVhZGVycylcbiAgICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgKTtcblxuICAgICAgdGhpcy5zZXROZXh0KHJlc3BvbnNlKTtcbiAgICAgIHRoaXMucGFnZSsrO1xuXG4gICAgICByZXR1cm4gcmV0O1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgQXBpUmF0ZUxpbWl0LnRocm93SWZSYXRlTGltaXRFeGNlZWRlZChlcnIpO1xuXG4gICAgICAvLyBTd2FsbG93IDQyMiByZXNwb25zZXMuXG4gICAgICBpZiAoZXJyIGluc3RhbmNlb2YgaHR0cEVycm9yLkh0dHBFcnJvcikge1xuICAgICAgICBjb25zdCBodHRwRXJyID0gZXJyIGFzIGh0dHBFcnJvci5IdHRwRXJyb3I7XG4gICAgICAgIGlmIChodHRwRXJyLnN0YXR1cyA9PT0gNDIyKSB7XG4gICAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWNvbnNvbGVcbiAgICAgICAgICBjb25zb2xlLndhcm4oaHR0cEVyci5tZXNzYWdlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiByZXQ7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBzZXROZXh0KHJlc3BvbnNlOiBhbnkpIHtcbiAgICB0aGlzLm5leHQgPSBbXTtcbiAgICBpZiAocmVzcG9uc2UuZGF0YT8uaXRlbXMpIHtcbiAgICAgIGZvciAoY29uc3QgaWR4IGluIHJlc3BvbnNlLmRhdGEuaXRlbXMpIHtcbiAgICAgICAgaWYgKHJlc3BvbnNlLmRhdGEuaXRlbXMuaGFzT3duUHJvcGVydHkoaWR4KSkge1xuICAgICAgICAgIGNvbnN0IHJlcG86IGFueSA9IHJlc3BvbnNlLmRhdGEuaXRlbXNbaWR4XTtcblxuICAgICAgICAgIGNvbnN0IGFSZXBvOiBJUmVwb3NpdG9yeSA9IHtcbiAgICAgICAgICAgIG5hbWU6IHJlcG8ubmFtZSxcbiAgICAgICAgICAgIG93bmVyOiByZXBvLm93bmVyLmxvZ2luLFxuICAgICAgICAgICAgcmVwb19vcmlnOiByZXBvLFxuICAgICAgICAgICAgc3RhcnM6IHJlcG8uc3RhcmdhemVyc19jb3VudCxcbiAgICAgICAgICAgIHVybDogcmVwby51cmwsXG4gICAgICAgICAgICB3YXRjaGVyczogcmVwby53YXRjaGVycyxcbiAgICAgICAgICB9O1xuICAgICAgICAgIHRoaXMubmV4dC5wdXNoKGFSZXBvKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG4vKlxuLy8gQHRzLWlnbm9yZVxuY2xhc3MgTGlzdFB1YmxpYyBpbXBsZW1lbnRzIElSZXBvc2l0b3JpZXNQcm92aWRlciB7XG4gIHB1YmxpYyBzdGF0aWMgYXN5bmMgY3JlYXRlKG9jdG9raXQ6IG9rLk9jdG9raXQpOiBQcm9taXNlPExpc3RQdWJsaWM+IHtcbiAgICBjb25zdCBwcm92aWRlcjogTGlzdFB1YmxpYyA9IG5ldyBMaXN0UHVibGljKG9jdG9raXQpO1xuICAgIGlmICghKGF3YWl0IHByb3ZpZGVyLmluaXQoKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTGlzdFB1YmxpYy5pbml0KCkgZmFpbGVkJyk7XG4gICAgfVxuICAgIHJldHVybiBwcm92aWRlcjtcbiAgfVxuXG4gIHByaXZhdGUgbmV4dDogSVJlcG9zaXRvcnlbXSA9IFtdO1xuICBwcml2YXRlIHRvdGFsQ291bnQ6IG51bWJlciA9IC0xO1xuICBwcml2YXRlIG5leHRVcmw6IHBhcnNlbGluay5MaW5rcyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNvbnN0cnVjdG9yKHByaXZhdGUgb2N0b2tpdDogb2suT2N0b2tpdCkgeyB9XG5cbiAgcHVibGljIGdldCBjb3VudCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnRvdGFsQ291bnQ7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgZ2V0TmV4dFJlcG9zKCk6IFByb21pc2U8SVJlcG9zaXRvcnlbXT4ge1xuICAgIGlmICh0aGlzLnRvdGFsQ291bnQgPT09IC0xKSB7XG4gICAgICB0aHJvdyBFcnJvcignaW5pdCgpIHdhcyBub3QgY2FsbGVkIG9yIGl0IGZhaWxlZC4nKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5uZXh0VXJsKSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMub2N0b2tpdC5yZXF1ZXN0KGBHRVQgJHt0aGlzLm5leHRVcmx9YCk7XG4gICAgICB0aGlzLnNldE5leHQocmVzcG9uc2UpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLm5leHQ7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGluaXQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgbiA9IGF3YWl0IHRoaXMub2N0b2tpdC5yZXF1ZXN0KGBHRVQgL3JlcG9zaXRvcmllc2ApO1xuICAgIHRoaXMudG90YWxDb3VudCA9IG4uZGF0YS5sZW5ndGg7XG4gICAgdGhpcy5zZXROZXh0KG4uZGF0YSk7XG5cbiAgICB0aGlzLm5leHRVcmwgPSBwYXJzZWxpbmsobi5oZWFkZXJzLmxpbmspO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXROZXh0KHJlc3BvbnNlOiBhbnkpIHtcbiAgICB0aGlzLm5leHQgPSBbXTtcbiAgICBmb3IgKGNvbnN0IHJlcG8gb2YgcmVzcG9uc2UuUmVzcG9uc2UuZGF0YSkge1xuICAgICAgY29uc3QgYVJlcG86IElSZXBvc2l0b3J5ID0ge1xuICAgICAgICBuYW1lOiByZXBvLm5hbWUsXG4gICAgICAgIG93bmVyOiByZXBvLm93bmVyLmxvZ2luLFxuICAgICAgICByZXBvX29yaWc6IHJlcG8sXG4gICAgICAgIHN0YXJzOiByZXBvLnN0YXJnYXplcnNfY291bnQsXG4gICAgICAgIHVybDogcmVwby51cmwsXG4gICAgICAgIHdhdGNoZXJzOiByZXBvLndhdGNoZXJzLFxuICAgICAgfTtcbiAgICAgIHRoaXMubmV4dC5wdXNoKGFSZXBvKTtcbiAgICB9XG4gIH1cbn0qL1xuIl19