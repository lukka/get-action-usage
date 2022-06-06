"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiRateLimit = void 0;
const apilimitsexception_1 = require("./apilimitsexception");
const os_1 = require("os");
class ApiRateLimit {
    static checkSearchApiLimit(headers) {
        return ApiRateLimit.checkApiLimit(headers, ApiRateLimit.SearchLimitThreshold, 'Search API');
    }
    static checkRestApiLimit(headers) {
        return ApiRateLimit.checkApiLimit(headers, ApiRateLimit.RestLimitThreshold, 'REST API');
    }
    static isRateLimitException(requestError) {
        if (requestError instanceof apilimitsexception_1.ApiLimitsException) {
            return true;
        }
        let errMsg = '';
        if (requestError instanceof Error) {
            errMsg = requestError.message;
        }
        else if (requestError.response) {
            errMsg = requestError.response.data.message;
        }
        return (errMsg.indexOf('rate limit') !== -1 && errMsg.indexOf('secondary') === -1);
    }
    static throwIfRateLimitExceeded(requestError) {
        if (ApiRateLimit.isRateLimitException(requestError)) {
            throw requestError;
        }
    }
    static checkApiLimit(headers, threshold, message) {
        var _a;
        try {
            const remaining = ApiRateLimit.getHeaderValue(headers, 'x-ratelimit-remaining');
            const quotaReset = ApiRateLimit.getHeaderValue(headers, 'x-ratelimit-reset');
            const used = ApiRateLimit.getHeaderValue(headers, 'x-ratelimit-used');
            const quotaResetDate = new Date(quotaReset * 1000);
            if (remaining >= 0 && remaining < threshold) {
                throw new apilimitsexception_1.ApiLimitsException(`Close to '${message}' quota/rate limit. Remaining calls are '${remaining}', ` +
                    `quota will reset at ${(_a = quotaResetDate.toUTCString()) !== null && _a !== void 0 ? _a : '<unknown>'}.`, remaining, quotaResetDate, used);
            }
            return remaining;
        }
        catch (err) {
            console.log(`checkApiLimit(): rethrowing error:${os_1.EOL}'${err}'`);
            throw err;
        }
    }
    static getHeaderValue(headers, name) {
        const nameField = name;
        const text = headers[nameField];
        if (text) {
            return parseInt(text, 10);
        }
        else {
            throw new Error(`Cannot get value for header '${name}'`);
        }
    }
}
exports.ApiRateLimit = ApiRateLimit;
ApiRateLimit.RestLimitThreshold = 20;
ApiRateLimit.SearchLimitThreshold = 2;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpbGltaXRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2FwaWxpbWl0cy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFLQSw2REFBMEQ7QUFDMUQsMkJBQXlCO0FBRXpCLE1BQWEsWUFBWTtJQUloQixNQUFNLENBQUMsbUJBQW1CLENBQUMsT0FBd0I7UUFDeEQsT0FBTyxZQUFZLENBQUMsYUFBYSxDQUMvQixPQUFPLEVBQ1AsWUFBWSxDQUFDLG9CQUFvQixFQUNqQyxZQUFZLENBQ2IsQ0FBQztJQUNKLENBQUM7SUFFTSxNQUFNLENBQUMsaUJBQWlCLENBQUMsT0FBd0I7UUFDdEQsT0FBTyxZQUFZLENBQUMsYUFBYSxDQUMvQixPQUFPLEVBQ1AsWUFBWSxDQUFDLGtCQUFrQixFQUMvQixVQUFVLENBQ1gsQ0FBQztJQUNKLENBQUM7SUFFTSxNQUFNLENBQUMsb0JBQW9CLENBQUMsWUFBaUI7UUFDbEQsSUFBSSxZQUFZLFlBQVksdUNBQWtCLEVBQUU7WUFDOUMsT0FBTyxJQUFJLENBQUM7U0FDYjtRQUVELElBQUksTUFBTSxHQUFHLEVBQUUsQ0FBQztRQUNoQixJQUFJLFlBQVksWUFBWSxLQUFLLEVBQUU7WUFDakMsTUFBTSxHQUFHLFlBQVksQ0FBQyxPQUFPLENBQUM7U0FDL0I7YUFBTSxJQUFJLFlBQVksQ0FBQyxRQUFRLEVBQUU7WUFDaEMsTUFBTSxHQUFHLFlBQVksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQztTQUM3QztRQUVELE9BQU8sQ0FDTCxNQUFNLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQzFFLENBQUM7SUFDSixDQUFDO0lBRU0sTUFBTSxDQUFDLHdCQUF3QixDQUFDLFlBQWlCO1FBQ3RELElBQUksWUFBWSxDQUFDLG9CQUFvQixDQUFDLFlBQVksQ0FBQyxFQUFFO1lBQ25ELE1BQU0sWUFBWSxDQUFDO1NBQ3BCO0lBQ0gsQ0FBQztJQUVPLE1BQU0sQ0FBQyxhQUFhLENBQzFCLE9BQXdCLEVBQ3hCLFNBQWlCLEVBQ2pCLE9BQWU7O1FBRWYsSUFBSTtZQUNGLE1BQU0sU0FBUyxHQUFXLFlBQVksQ0FBQyxjQUFjLENBQ25ELE9BQU8sRUFDUCx1QkFBdUIsQ0FDeEIsQ0FBQztZQUNGLE1BQU0sVUFBVSxHQUFXLFlBQVksQ0FBQyxjQUFjLENBQ3BELE9BQU8sRUFDUCxtQkFBbUIsQ0FDcEIsQ0FBQztZQUNGLE1BQU0sSUFBSSxHQUFXLFlBQVksQ0FBQyxjQUFjLENBQzlDLE9BQU8sRUFDUCxrQkFBa0IsQ0FDbkIsQ0FBQztZQUVGLE1BQU0sY0FBYyxHQUFHLElBQUksSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUMsQ0FBQztZQUduRCxJQUFJLFNBQVMsSUFBSSxDQUFDLElBQUksU0FBUyxHQUFHLFNBQVMsRUFBRTtnQkFDM0MsTUFBTSxJQUFJLHVDQUFrQixDQUMxQixhQUFhLE9BQU8sNENBQTRDLFNBQVMsS0FBSztvQkFDNUUsdUJBQXVCLE1BQUEsY0FBYyxDQUFDLFdBQVcsRUFBRSxtQ0FDakQsV0FBVyxHQUFHLEVBQ2xCLFNBQVMsRUFDVCxjQUFjLEVBQ2QsSUFBSSxDQUNMLENBQUM7YUFDSDtZQUNELE9BQU8sU0FBUyxDQUFDO1NBQ2xCO1FBQUMsT0FBTyxHQUFHLEVBQUU7WUFFWixPQUFPLENBQUMsR0FBRyxDQUFDLHFDQUFxQyxRQUFHLElBQUksR0FBRyxHQUFHLENBQUMsQ0FBQztZQUNoRSxNQUFNLEdBQUcsQ0FBQztTQUNYO0lBQ0gsQ0FBQztJQUVPLE1BQU0sQ0FBQyxjQUFjLENBQzNCLE9BQXdCLEVBQ3hCLElBQVk7UUFFWixNQUFNLFNBQVMsR0FBRyxJQUE2QixDQUFDO1FBQ2hELE1BQU0sSUFBSSxHQUFXLE9BQU8sQ0FBQyxTQUFTLENBQVcsQ0FBQztRQUNsRCxJQUFJLElBQUksRUFBRTtZQUNSLE9BQU8sUUFBUSxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQztTQUMzQjthQUFNO1lBQ0wsTUFBTSxJQUFJLEtBQUssQ0FBQyxnQ0FBZ0MsSUFBSSxHQUFHLENBQUMsQ0FBQztTQUMxRDtJQUNILENBQUM7O0FBOUZILG9DQStGQztBQTlGd0IsK0JBQWtCLEdBQUcsRUFBRSxDQUFDO0FBQ3hCLGlDQUFvQixHQUFHLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCDCqSAyMDIyIGJ5IEx1Y2EgQ2FwcGEgbGNhcHBhQGdtYWlsLmNvbVxuLy8gQWxsIGNvbnRlbnQgb2YgdGhpcyByZXBvc2l0b3J5IGlzIGxpY2Vuc2VkIHVuZGVyIHRoZSBDQyBCWS1TQSBMaWNlbnNlLlxuLy8gU2VlIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3QgZm9yIGxpY2Vuc2UgaW5mb3JtYXRpb24uXG5cbmltcG9ydCB7IFJlc3BvbnNlSGVhZGVycyB9IGZyb20gJ0BvY3Rva2l0L3R5cGVzJztcbmltcG9ydCB7IEFwaUxpbWl0c0V4Y2VwdGlvbiB9IGZyb20gJy4vYXBpbGltaXRzZXhjZXB0aW9uJztcbmltcG9ydCB7IEVPTCB9IGZyb20gJ29zJztcblxuZXhwb3J0IGNsYXNzIEFwaVJhdGVMaW1pdCB7XG4gIHB1YmxpYyBzdGF0aWMgcmVhZG9ubHkgUmVzdExpbWl0VGhyZXNob2xkID0gMjA7XG4gIHB1YmxpYyBzdGF0aWMgcmVhZG9ubHkgU2VhcmNoTGltaXRUaHJlc2hvbGQgPSAyO1xuXG4gIHB1YmxpYyBzdGF0aWMgY2hlY2tTZWFyY2hBcGlMaW1pdChoZWFkZXJzOiBSZXNwb25zZUhlYWRlcnMpOiBudW1iZXIge1xuICAgIHJldHVybiBBcGlSYXRlTGltaXQuY2hlY2tBcGlMaW1pdChcbiAgICAgIGhlYWRlcnMsXG4gICAgICBBcGlSYXRlTGltaXQuU2VhcmNoTGltaXRUaHJlc2hvbGQsXG4gICAgICAnU2VhcmNoIEFQSSdcbiAgICApO1xuICB9XG5cbiAgcHVibGljIHN0YXRpYyBjaGVja1Jlc3RBcGlMaW1pdChoZWFkZXJzOiBSZXNwb25zZUhlYWRlcnMpOiBudW1iZXIge1xuICAgIHJldHVybiBBcGlSYXRlTGltaXQuY2hlY2tBcGlMaW1pdChcbiAgICAgIGhlYWRlcnMsXG4gICAgICBBcGlSYXRlTGltaXQuUmVzdExpbWl0VGhyZXNob2xkLFxuICAgICAgJ1JFU1QgQVBJJ1xuICAgICk7XG4gIH1cblxuICBwdWJsaWMgc3RhdGljIGlzUmF0ZUxpbWl0RXhjZXB0aW9uKHJlcXVlc3RFcnJvcjogYW55KTogYm9vbGVhbiB7XG4gICAgaWYgKHJlcXVlc3RFcnJvciBpbnN0YW5jZW9mIEFwaUxpbWl0c0V4Y2VwdGlvbikge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgbGV0IGVyck1zZyA9ICcnO1xuICAgIGlmIChyZXF1ZXN0RXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgZXJyTXNnID0gcmVxdWVzdEVycm9yLm1lc3NhZ2U7XG4gICAgfSBlbHNlIGlmIChyZXF1ZXN0RXJyb3IucmVzcG9uc2UpIHtcbiAgICAgIGVyck1zZyA9IHJlcXVlc3RFcnJvci5yZXNwb25zZS5kYXRhLm1lc3NhZ2U7XG4gICAgfVxuXG4gICAgcmV0dXJuIChcbiAgICAgIGVyck1zZy5pbmRleE9mKCdyYXRlIGxpbWl0JykgIT09IC0xICYmIGVyck1zZy5pbmRleE9mKCdzZWNvbmRhcnknKSA9PT0gLTFcbiAgICApO1xuICB9XG5cbiAgcHVibGljIHN0YXRpYyB0aHJvd0lmUmF0ZUxpbWl0RXhjZWVkZWQocmVxdWVzdEVycm9yOiBhbnkpIHtcbiAgICBpZiAoQXBpUmF0ZUxpbWl0LmlzUmF0ZUxpbWl0RXhjZXB0aW9uKHJlcXVlc3RFcnJvcikpIHtcbiAgICAgIHRocm93IHJlcXVlc3RFcnJvcjtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHN0YXRpYyBjaGVja0FwaUxpbWl0KFxuICAgIGhlYWRlcnM6IFJlc3BvbnNlSGVhZGVycyxcbiAgICB0aHJlc2hvbGQ6IG51bWJlcixcbiAgICBtZXNzYWdlOiBzdHJpbmdcbiAgKTogbnVtYmVyIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVtYWluaW5nOiBudW1iZXIgPSBBcGlSYXRlTGltaXQuZ2V0SGVhZGVyVmFsdWUoXG4gICAgICAgIGhlYWRlcnMsXG4gICAgICAgICd4LXJhdGVsaW1pdC1yZW1haW5pbmcnXG4gICAgICApO1xuICAgICAgY29uc3QgcXVvdGFSZXNldDogbnVtYmVyID0gQXBpUmF0ZUxpbWl0LmdldEhlYWRlclZhbHVlKFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgICAneC1yYXRlbGltaXQtcmVzZXQnXG4gICAgICApO1xuICAgICAgY29uc3QgdXNlZDogbnVtYmVyID0gQXBpUmF0ZUxpbWl0LmdldEhlYWRlclZhbHVlKFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgICAneC1yYXRlbGltaXQtdXNlZCdcbiAgICAgICk7XG5cbiAgICAgIGNvbnN0IHF1b3RhUmVzZXREYXRlID0gbmV3IERhdGUocXVvdGFSZXNldCAqIDEwMDApO1xuXG4gICAgICAvLyBFeGNsdWRlIE5hTiBvciBuZWdhdGl2ZXMuXG4gICAgICBpZiAocmVtYWluaW5nID49IDAgJiYgcmVtYWluaW5nIDwgdGhyZXNob2xkKSB7XG4gICAgICAgIHRocm93IG5ldyBBcGlMaW1pdHNFeGNlcHRpb24oXG4gICAgICAgICAgYENsb3NlIHRvICcke21lc3NhZ2V9JyBxdW90YS9yYXRlIGxpbWl0LiBSZW1haW5pbmcgY2FsbHMgYXJlICcke3JlbWFpbmluZ30nLCBgICtcbiAgICAgICAgICAgIGBxdW90YSB3aWxsIHJlc2V0IGF0ICR7cXVvdGFSZXNldERhdGUudG9VVENTdHJpbmcoKSA/P1xuICAgICAgICAgICAgICAnPHVua25vd24+J30uYCxcbiAgICAgICAgICByZW1haW5pbmcsXG4gICAgICAgICAgcXVvdGFSZXNldERhdGUsXG4gICAgICAgICAgdXNlZFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlbWFpbmluZztcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1jb25zb2xlXG4gICAgICBjb25zb2xlLmxvZyhgY2hlY2tBcGlMaW1pdCgpOiByZXRocm93aW5nIGVycm9yOiR7RU9MfScke2Vycn0nYCk7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBzdGF0aWMgZ2V0SGVhZGVyVmFsdWUoXG4gICAgaGVhZGVyczogUmVzcG9uc2VIZWFkZXJzLFxuICAgIG5hbWU6IHN0cmluZ1xuICApOiBudW1iZXIge1xuICAgIGNvbnN0IG5hbWVGaWVsZCA9IG5hbWUgYXMga2V5b2YgUmVzcG9uc2VIZWFkZXJzO1xuICAgIGNvbnN0IHRleHQ6IHN0cmluZyA9IGhlYWRlcnNbbmFtZUZpZWxkXSBhcyBzdHJpbmc7XG4gICAgaWYgKHRleHQpIHtcbiAgICAgIHJldHVybiBwYXJzZUludCh0ZXh0LCAxMCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGdldCB2YWx1ZSBmb3IgaGVhZGVyICcke25hbWV9J2ApO1xuICAgIH1cbiAgfVxufVxuIl19