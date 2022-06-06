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
exports.main = void 0;
const dotenv = require("dotenv");
const github = require("./github");
const factories_1 = require("./factories");
const actionusage_1 = require("./actionusage");
const core_1 = require("@octokit/core");
const plugin_throttling_1 = require("@octokit/plugin-throttling");
const plugin_retry_1 = require("@octokit/plugin-retry");
const plugin_rest_endpoint_methods_1 = require("@octokit/plugin-rest-endpoint-methods");
const localReporter = {
    debug: (a, b) => log(a, b),
    error: (a, b) => log(a, b),
    info: (a, b) => log(a, b),
    warn: (a, b) => log(a, b),
};
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!process.env.GITHUB_TOKEN) {
            const result = dotenv.config();
            if (result.error) {
                throw result.error;
            }
        }
        const reporter = github.isRunningOnGitHubRunner()
            ? new github.Reporter()
            : localReporter;
        const octokit = createSmartOctokit(process.env.GITHUB_TOKEN, reporter);
        if (!octokit) {
            throw new Error('cannot get Octokit client');
        }
        const usageScanner = new actionusage_1.GHActionUsage(octokit, new factories_1.SearchPublicFactory(), reporter);
        yield usageScanner.run();
    });
}
exports.main = main;
const MyOctokit = core_1.Octokit.plugin(plugin_throttling_1.throttling, plugin_retry_1.retry, plugin_rest_endpoint_methods_1.restEndpointMethods);
function createSmartOctokit(token, reporter) {
    const octokitTh = new MyOctokit({
        auth: token,
        throttle: {
            onRateLimit: (retryAfter, options) => {
                reporter.warn(`Request quota exhausted for request ${options.method} ${options.url}`);
                if (options.request.retryCount === 0) {
                    reporter.info(`Retrying after ${retryAfter} seconds!`);
                    return true;
                }
                return false;
            },
            onSecondaryRateLimit: (retryAfter, options) => {
                reporter.warn(`SecondaryRateLimit detected for request ${options.method} ${options.url}.`);
                reporter.info(`Retrying after ${retryAfter} seconds.`);
                return true;
            },
        },
    });
    return octokitTh;
}
main()
    .then(() => process.exit(0))
    .catch(err => {
    const error = err;
    console.log(`main(): fatal error: ${error}\n${error === null || error === void 0 ? void 0 : error.stack}`);
    process.exit(-1);
});
function log(a, b) {
    console.log(a);
    console.log((b === null || b === void 0 ? void 0 : b.toString()) || '');
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7OztBQUlBLGlDQUFpQztBQUNqQyxtQ0FBbUM7QUFFbkMsMkNBQWtEO0FBRWxELCtDQUE4QztBQUM5Qyx3Q0FBd0M7QUFDeEMsa0VBQXdEO0FBQ3hELHdEQUE4QztBQUM5Qyx3RkFBNEU7QUFFNUUsTUFBTSxhQUFhLEdBQWM7SUFDL0IsS0FBSyxFQUFFLENBQUMsQ0FBUyxFQUFFLENBQVEsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDekMsS0FBSyxFQUFFLENBQUMsQ0FBUyxFQUFFLENBQVEsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDekMsSUFBSSxFQUFFLENBQUMsQ0FBUyxFQUFFLENBQVEsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDeEMsSUFBSSxFQUFFLENBQUMsQ0FBUyxFQUFFLENBQVEsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7Q0FDekMsQ0FBQztBQUVGLFNBQXNCLElBQUk7O1FBQ3hCLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLFlBQVksRUFBRTtZQUM3QixNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDL0IsSUFBSSxNQUFNLENBQUMsS0FBSyxFQUFFO2dCQUNoQixNQUFNLE1BQU0sQ0FBQyxLQUFLLENBQUM7YUFDcEI7U0FDRjtRQUVELE1BQU0sUUFBUSxHQUFjLE1BQU0sQ0FBQyx1QkFBdUIsRUFBRTtZQUMxRCxDQUFDLENBQUMsSUFBSSxNQUFNLENBQUMsUUFBUSxFQUFFO1lBQ3ZCLENBQUMsQ0FBQyxhQUFhLENBQUM7UUFFbEIsTUFBTSxPQUFPLEdBQUcsa0JBQWtCLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFhLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDeEUsSUFBSSxDQUFDLE9BQU8sRUFBRTtZQUNaLE1BQU0sSUFBSSxLQUFLLENBQUMsMkJBQTJCLENBQUMsQ0FBQztTQUM5QztRQUVELE1BQU0sWUFBWSxHQUFHLElBQUksMkJBQWEsQ0FDcEMsT0FBTyxFQUNQLElBQUksK0JBQW1CLEVBQUUsRUFDekIsUUFBUSxDQUNULENBQUM7UUFFRixNQUFNLFlBQVksQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUMzQixDQUFDO0NBQUE7QUF4QkQsb0JBd0JDO0FBRUQsTUFBTSxTQUFTLEdBQUcsY0FBTyxDQUFDLE1BQU0sQ0FBQyw4QkFBVSxFQUFFLG9CQUFLLEVBQUUsa0RBQW1CLENBQUMsQ0FBQztBQUV6RSxTQUFTLGtCQUFrQixDQUFDLEtBQWEsRUFBRSxRQUFtQjtJQUM1RCxNQUFNLFNBQVMsR0FBWSxJQUFJLFNBQVMsQ0FBQztRQUN2QyxJQUFJLEVBQUUsS0FBSztRQUNYLFFBQVEsRUFBRTtZQUNSLFdBQVcsRUFBRSxDQUFDLFVBQWtCLEVBQUUsT0FBWSxFQUFXLEVBQUU7Z0JBQ3pELFFBQVEsQ0FBQyxJQUFJLENBQ1gsdUNBQXVDLE9BQU8sQ0FBQyxNQUFNLElBQUksT0FBTyxDQUFDLEdBQUcsRUFBRSxDQUN2RSxDQUFDO2dCQUVGLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxVQUFVLEtBQUssQ0FBQyxFQUFFO29CQUVwQyxRQUFRLENBQUMsSUFBSSxDQUFDLGtCQUFrQixVQUFVLFdBQVcsQ0FBQyxDQUFDO29CQUN2RCxPQUFPLElBQUksQ0FBQztpQkFDYjtnQkFFRCxPQUFPLEtBQUssQ0FBQztZQUNmLENBQUM7WUFDRCxvQkFBb0IsRUFBRSxDQUFDLFVBQWtCLEVBQUUsT0FBWSxFQUFXLEVBQUU7Z0JBQ2xFLFFBQVEsQ0FBQyxJQUFJLENBQ1gsMkNBQTJDLE9BQU8sQ0FBQyxNQUFNLElBQUksT0FBTyxDQUFDLEdBQUcsR0FBRyxDQUM1RSxDQUFDO2dCQUNGLFFBQVEsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLFVBQVUsV0FBVyxDQUFDLENBQUM7Z0JBQ3ZELE9BQU8sSUFBSSxDQUFDO1lBQ2QsQ0FBQztTQUNGO0tBQ0YsQ0FBQyxDQUFDO0lBQ0gsT0FBTyxTQUFTLENBQUM7QUFDbkIsQ0FBQztBQUdELElBQUksRUFBRTtLQUNILElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0tBQzNCLEtBQUssQ0FBQyxHQUFHLENBQUMsRUFBRTtJQUNYLE1BQU0sS0FBSyxHQUFVLEdBQVksQ0FBQztJQUVsQyxPQUFPLENBQUMsR0FBRyxDQUFDLHdCQUF3QixLQUFLLEtBQUssS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7SUFDOUQsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ25CLENBQUMsQ0FBQyxDQUFDO0FBR0wsU0FBUyxHQUFHLENBQUMsQ0FBUyxFQUFFLENBQVM7SUFFL0IsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUVmLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSxDQUFDLGFBQUQsQ0FBQyx1QkFBRCxDQUFDLENBQUUsUUFBUSxFQUFFLEtBQUksRUFBRSxDQUFDLENBQUM7QUFDbkMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCDCqSAyMDIyIGJ5IEx1Y2EgQ2FwcGEgbGNhcHBhQGdtYWlsLmNvbVxuLy8gQWxsIGNvbnRlbnQgb2YgdGhpcyByZXBvc2l0b3J5IGlzIGxpY2Vuc2VkIHVuZGVyIHRoZSBDQyBCWS1TQSBMaWNlbnNlLlxuLy8gU2VlIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3QgZm9yIGxpY2Vuc2UgaW5mb3JtYXRpb24uXG5cbmltcG9ydCAqIGFzIGRvdGVudiBmcm9tICdkb3RlbnYnO1xuaW1wb3J0ICogYXMgZ2l0aHViIGZyb20gJy4vZ2l0aHViJztcblxuaW1wb3J0IHsgU2VhcmNoUHVibGljRmFjdG9yeSB9IGZyb20gJy4vZmFjdG9yaWVzJztcbmltcG9ydCB7IElSZXBvcnRlciB9IGZyb20gJy4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBHSEFjdGlvblVzYWdlIH0gZnJvbSAnLi9hY3Rpb251c2FnZSc7XG5pbXBvcnQgeyBPY3Rva2l0IH0gZnJvbSAnQG9jdG9raXQvY29yZSc7XG5pbXBvcnQgeyB0aHJvdHRsaW5nIH0gZnJvbSAnQG9jdG9raXQvcGx1Z2luLXRocm90dGxpbmcnO1xuaW1wb3J0IHsgcmV0cnkgfSBmcm9tICdAb2N0b2tpdC9wbHVnaW4tcmV0cnknO1xuaW1wb3J0IHsgcmVzdEVuZHBvaW50TWV0aG9kcyB9IGZyb20gJ0BvY3Rva2l0L3BsdWdpbi1yZXN0LWVuZHBvaW50LW1ldGhvZHMnO1xuXG5jb25zdCBsb2NhbFJlcG9ydGVyOiBJUmVwb3J0ZXIgPSB7XG4gIGRlYnVnOiAoYTogc3RyaW5nLCBiOiBFcnJvcikgPT4gbG9nKGEsIGIpLFxuICBlcnJvcjogKGE6IHN0cmluZywgYjogRXJyb3IpID0+IGxvZyhhLCBiKSxcbiAgaW5mbzogKGE6IHN0cmluZywgYjogRXJyb3IpID0+IGxvZyhhLCBiKSxcbiAgd2FybjogKGE6IHN0cmluZywgYjogRXJyb3IpID0+IGxvZyhhLCBiKSxcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtYWluKCk6IFByb21pc2U8dm9pZD4ge1xuICBpZiAoIXByb2Nlc3MuZW52LkdJVEhVQl9UT0tFTikge1xuICAgIGNvbnN0IHJlc3VsdCA9IGRvdGVudi5jb25maWcoKTtcbiAgICBpZiAocmVzdWx0LmVycm9yKSB7XG4gICAgICB0aHJvdyByZXN1bHQuZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgcmVwb3J0ZXI6IElSZXBvcnRlciA9IGdpdGh1Yi5pc1J1bm5pbmdPbkdpdEh1YlJ1bm5lcigpXG4gICAgPyBuZXcgZ2l0aHViLlJlcG9ydGVyKClcbiAgICA6IGxvY2FsUmVwb3J0ZXI7XG5cbiAgY29uc3Qgb2N0b2tpdCA9IGNyZWF0ZVNtYXJ0T2N0b2tpdChwcm9jZXNzLmVudi5HSVRIVUJfVE9LRU4hLCByZXBvcnRlcik7XG4gIGlmICghb2N0b2tpdCkge1xuICAgIHRocm93IG5ldyBFcnJvcignY2Fubm90IGdldCBPY3Rva2l0IGNsaWVudCcpO1xuICB9XG5cbiAgY29uc3QgdXNhZ2VTY2FubmVyID0gbmV3IEdIQWN0aW9uVXNhZ2UoXG4gICAgb2N0b2tpdCxcbiAgICBuZXcgU2VhcmNoUHVibGljRmFjdG9yeSgpLFxuICAgIHJlcG9ydGVyXG4gICk7XG5cbiAgYXdhaXQgdXNhZ2VTY2FubmVyLnJ1bigpO1xufVxuXG5jb25zdCBNeU9jdG9raXQgPSBPY3Rva2l0LnBsdWdpbih0aHJvdHRsaW5nLCByZXRyeSwgcmVzdEVuZHBvaW50TWV0aG9kcyk7XG5cbmZ1bmN0aW9uIGNyZWF0ZVNtYXJ0T2N0b2tpdCh0b2tlbjogc3RyaW5nLCByZXBvcnRlcjogSVJlcG9ydGVyKTogYW55IHtcbiAgY29uc3Qgb2N0b2tpdFRoOiBPY3Rva2l0ID0gbmV3IE15T2N0b2tpdCh7XG4gICAgYXV0aDogdG9rZW4sXG4gICAgdGhyb3R0bGU6IHtcbiAgICAgIG9uUmF0ZUxpbWl0OiAocmV0cnlBZnRlcjogbnVtYmVyLCBvcHRpb25zOiBhbnkpOiBib29sZWFuID0+IHtcbiAgICAgICAgcmVwb3J0ZXIud2FybihcbiAgICAgICAgICBgUmVxdWVzdCBxdW90YSBleGhhdXN0ZWQgZm9yIHJlcXVlc3QgJHtvcHRpb25zLm1ldGhvZH0gJHtvcHRpb25zLnVybH1gXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKG9wdGlvbnMucmVxdWVzdC5yZXRyeUNvdW50ID09PSAwKSB7XG4gICAgICAgICAgLy8gb25seSByZXRyaWVzIG9uY2VcbiAgICAgICAgICByZXBvcnRlci5pbmZvKGBSZXRyeWluZyBhZnRlciAke3JldHJ5QWZ0ZXJ9IHNlY29uZHMhYCk7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9LFxuICAgICAgb25TZWNvbmRhcnlSYXRlTGltaXQ6IChyZXRyeUFmdGVyOiBudW1iZXIsIG9wdGlvbnM6IGFueSk6IGJvb2xlYW4gPT4ge1xuICAgICAgICByZXBvcnRlci53YXJuKFxuICAgICAgICAgIGBTZWNvbmRhcnlSYXRlTGltaXQgZGV0ZWN0ZWQgZm9yIHJlcXVlc3QgJHtvcHRpb25zLm1ldGhvZH0gJHtvcHRpb25zLnVybH0uYFxuICAgICAgICApO1xuICAgICAgICByZXBvcnRlci5pbmZvKGBSZXRyeWluZyBhZnRlciAke3JldHJ5QWZ0ZXJ9IHNlY29uZHMuYCk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSxcbiAgICB9LFxuICB9KTtcbiAgcmV0dXJuIG9jdG9raXRUaDtcbn1cblxuLy8gTWFpbiBlbnRyeS1wb2ludFxubWFpbigpXG4gIC50aGVuKCgpID0+IHByb2Nlc3MuZXhpdCgwKSlcbiAgLmNhdGNoKGVyciA9PiB7XG4gICAgY29uc3QgZXJyb3I6IEVycm9yID0gZXJyIGFzIEVycm9yO1xuICAgIC8qIHRzbGludDpkaXNhYmxlLW5leHQtbGluZSAqL1xuICAgIGNvbnNvbGUubG9nKGBtYWluKCk6IGZhdGFsIGVycm9yOiAke2Vycm9yfVxcbiR7ZXJyb3I/LnN0YWNrfWApO1xuICAgIHByb2Nlc3MuZXhpdCgtMSk7XG4gIH0pO1xuXG4vLyBsb2NhbCByZXBvcnRlclxuZnVuY3Rpb24gbG9nKGE6IHN0cmluZywgYj86IEVycm9yKSB7XG4gIC8qIHRzbGludDpkaXNhYmxlLW5leHQtbGluZSAqL1xuICBjb25zb2xlLmxvZyhhKTtcbiAgLyogdHNsaW50OmRpc2FibGUtbmV4dC1saW5lICovXG4gIGNvbnNvbGUubG9nKGI/LnRvU3RyaW5nKCkgfHwgJycpO1xufVxuIl19