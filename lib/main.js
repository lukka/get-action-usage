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
const core = require("@actions/core");
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
        const collectionRan = yield usageScanner.run();
        if (github.isRunningOnGitHubRunner()) {
            core.setOutput('collection-ran', collectionRan);
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7OztBQUlBLGlDQUFpQztBQUNqQyxtQ0FBbUM7QUFFbkMsMkNBQWtEO0FBRWxELCtDQUE4QztBQUM5Qyx3Q0FBd0M7QUFDeEMsa0VBQXdEO0FBQ3hELHdEQUE4QztBQUM5Qyx3RkFBNEU7QUFDNUUsc0NBQXNDO0FBRXRDLE1BQU0sYUFBYSxHQUFjO0lBQy9CLEtBQUssRUFBRSxDQUFDLENBQVMsRUFBRSxDQUFRLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ3pDLEtBQUssRUFBRSxDQUFDLENBQVMsRUFBRSxDQUFRLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ3pDLElBQUksRUFBRSxDQUFDLENBQVMsRUFBRSxDQUFRLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ3hDLElBQUksRUFBRSxDQUFDLENBQVMsRUFBRSxDQUFRLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0NBQ3pDLENBQUM7QUFFRixTQUFzQixJQUFJOztRQUN4QixJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFZLEVBQUU7WUFDN0IsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQy9CLElBQUksTUFBTSxDQUFDLEtBQUssRUFBRTtnQkFDaEIsTUFBTSxNQUFNLENBQUMsS0FBSyxDQUFDO2FBQ3BCO1NBQ0Y7UUFFRCxNQUFNLFFBQVEsR0FBYyxNQUFNLENBQUMsdUJBQXVCLEVBQUU7WUFDMUQsQ0FBQyxDQUFDLElBQUksTUFBTSxDQUFDLFFBQVEsRUFBRTtZQUN2QixDQUFDLENBQUMsYUFBYSxDQUFDO1FBRWxCLE1BQU0sT0FBTyxHQUFHLGtCQUFrQixDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsWUFBYSxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQ3hFLElBQUksQ0FBQyxPQUFPLEVBQUU7WUFDWixNQUFNLElBQUksS0FBSyxDQUFDLDJCQUEyQixDQUFDLENBQUM7U0FDOUM7UUFFRCxNQUFNLFlBQVksR0FBRyxJQUFJLDJCQUFhLENBQ3BDLE9BQU8sRUFDUCxJQUFJLCtCQUFtQixFQUFFLEVBQ3pCLFFBQVEsQ0FDVCxDQUFDO1FBRUYsTUFBTSxhQUFhLEdBQUcsTUFBTSxZQUFZLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDL0MsSUFBSSxNQUFNLENBQUMsdUJBQXVCLEVBQUUsRUFBRTtZQUNwQyxJQUFJLENBQUMsU0FBUyxDQUFDLGdCQUFnQixFQUFFLGFBQWEsQ0FBQyxDQUFDO1NBQ2pEO0lBQ0gsQ0FBQztDQUFBO0FBM0JELG9CQTJCQztBQUVELE1BQU0sU0FBUyxHQUFHLGNBQU8sQ0FBQyxNQUFNLENBQUMsOEJBQVUsRUFBRSxvQkFBSyxFQUFFLGtEQUFtQixDQUFDLENBQUM7QUFFekUsU0FBUyxrQkFBa0IsQ0FBQyxLQUFhLEVBQUUsUUFBbUI7SUFDNUQsTUFBTSxTQUFTLEdBQVksSUFBSSxTQUFTLENBQUM7UUFDdkMsSUFBSSxFQUFFLEtBQUs7UUFDWCxRQUFRLEVBQUU7WUFDUixXQUFXLEVBQUUsQ0FBQyxVQUFrQixFQUFFLE9BQVksRUFBVyxFQUFFO2dCQUN6RCxRQUFRLENBQUMsSUFBSSxDQUNYLHVDQUF1QyxPQUFPLENBQUMsTUFBTSxJQUFJLE9BQU8sQ0FBQyxHQUFHLEVBQUUsQ0FDdkUsQ0FBQztnQkFFRixJQUFJLE9BQU8sQ0FBQyxPQUFPLENBQUMsVUFBVSxLQUFLLENBQUMsRUFBRTtvQkFFcEMsUUFBUSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsVUFBVSxXQUFXLENBQUMsQ0FBQztvQkFDdkQsT0FBTyxJQUFJLENBQUM7aUJBQ2I7Z0JBRUQsT0FBTyxLQUFLLENBQUM7WUFDZixDQUFDO1lBQ0Qsb0JBQW9CLEVBQUUsQ0FBQyxVQUFrQixFQUFFLE9BQVksRUFBVyxFQUFFO2dCQUNsRSxRQUFRLENBQUMsSUFBSSxDQUNYLDJDQUEyQyxPQUFPLENBQUMsTUFBTSxJQUFJLE9BQU8sQ0FBQyxHQUFHLEdBQUcsQ0FDNUUsQ0FBQztnQkFDRixRQUFRLENBQUMsSUFBSSxDQUFDLGtCQUFrQixVQUFVLFdBQVcsQ0FBQyxDQUFDO2dCQUN2RCxPQUFPLElBQUksQ0FBQztZQUNkLENBQUM7U0FDRjtLQUNGLENBQUMsQ0FBQztJQUNILE9BQU8sU0FBUyxDQUFDO0FBQ25CLENBQUM7QUFHRCxJQUFJLEVBQUU7S0FDSCxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztLQUMzQixLQUFLLENBQUMsR0FBRyxDQUFDLEVBQUU7SUFDWCxNQUFNLEtBQUssR0FBVSxHQUFZLENBQUM7SUFFbEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3QkFBd0IsS0FBSyxLQUFLLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO0lBQzlELE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNuQixDQUFDLENBQUMsQ0FBQztBQUdMLFNBQVMsR0FBRyxDQUFDLENBQVMsRUFBRSxDQUFTO0lBRS9CLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFZixPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsQ0FBQyxhQUFELENBQUMsdUJBQUQsQ0FBQyxDQUFFLFFBQVEsRUFBRSxLQUFJLEVBQUUsQ0FBQyxDQUFDO0FBQ25DLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgwqkgMjAyMiBieSBMdWNhIENhcHBhIGxjYXBwYUBnbWFpbC5jb21cbi8vIEFsbCBjb250ZW50IG9mIHRoaXMgcmVwb3NpdG9yeSBpcyBsaWNlbnNlZCB1bmRlciB0aGUgQ0MgQlktU0EgTGljZW5zZS5cbi8vIFNlZSB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IGZvciBsaWNlbnNlIGluZm9ybWF0aW9uLlxuXG5pbXBvcnQgKiBhcyBkb3RlbnYgZnJvbSAnZG90ZW52JztcbmltcG9ydCAqIGFzIGdpdGh1YiBmcm9tICcuL2dpdGh1Yic7XG5cbmltcG9ydCB7IFNlYXJjaFB1YmxpY0ZhY3RvcnkgfSBmcm9tICcuL2ZhY3Rvcmllcyc7XG5pbXBvcnQgeyBJUmVwb3J0ZXIgfSBmcm9tICcuL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgR0hBY3Rpb25Vc2FnZSB9IGZyb20gJy4vYWN0aW9udXNhZ2UnO1xuaW1wb3J0IHsgT2N0b2tpdCB9IGZyb20gJ0BvY3Rva2l0L2NvcmUnO1xuaW1wb3J0IHsgdGhyb3R0bGluZyB9IGZyb20gJ0BvY3Rva2l0L3BsdWdpbi10aHJvdHRsaW5nJztcbmltcG9ydCB7IHJldHJ5IH0gZnJvbSAnQG9jdG9raXQvcGx1Z2luLXJldHJ5JztcbmltcG9ydCB7IHJlc3RFbmRwb2ludE1ldGhvZHMgfSBmcm9tICdAb2N0b2tpdC9wbHVnaW4tcmVzdC1lbmRwb2ludC1tZXRob2RzJztcbmltcG9ydCAqIGFzIGNvcmUgZnJvbSAnQGFjdGlvbnMvY29yZSc7XG5cbmNvbnN0IGxvY2FsUmVwb3J0ZXI6IElSZXBvcnRlciA9IHtcbiAgZGVidWc6IChhOiBzdHJpbmcsIGI6IEVycm9yKSA9PiBsb2coYSwgYiksXG4gIGVycm9yOiAoYTogc3RyaW5nLCBiOiBFcnJvcikgPT4gbG9nKGEsIGIpLFxuICBpbmZvOiAoYTogc3RyaW5nLCBiOiBFcnJvcikgPT4gbG9nKGEsIGIpLFxuICB3YXJuOiAoYTogc3RyaW5nLCBiOiBFcnJvcikgPT4gbG9nKGEsIGIpLFxufTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG1haW4oKTogUHJvbWlzZTx2b2lkPiB7XG4gIGlmICghcHJvY2Vzcy5lbnYuR0lUSFVCX1RPS0VOKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gZG90ZW52LmNvbmZpZygpO1xuICAgIGlmIChyZXN1bHQuZXJyb3IpIHtcbiAgICAgIHRocm93IHJlc3VsdC5lcnJvcjtcbiAgICB9XG4gIH1cblxuICBjb25zdCByZXBvcnRlcjogSVJlcG9ydGVyID0gZ2l0aHViLmlzUnVubmluZ09uR2l0SHViUnVubmVyKClcbiAgICA/IG5ldyBnaXRodWIuUmVwb3J0ZXIoKVxuICAgIDogbG9jYWxSZXBvcnRlcjtcblxuICBjb25zdCBvY3Rva2l0ID0gY3JlYXRlU21hcnRPY3Rva2l0KHByb2Nlc3MuZW52LkdJVEhVQl9UT0tFTiEsIHJlcG9ydGVyKTtcbiAgaWYgKCFvY3Rva2l0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdjYW5ub3QgZ2V0IE9jdG9raXQgY2xpZW50Jyk7XG4gIH1cblxuICBjb25zdCB1c2FnZVNjYW5uZXIgPSBuZXcgR0hBY3Rpb25Vc2FnZShcbiAgICBvY3Rva2l0LFxuICAgIG5ldyBTZWFyY2hQdWJsaWNGYWN0b3J5KCksXG4gICAgcmVwb3J0ZXJcbiAgKTtcblxuICBjb25zdCBjb2xsZWN0aW9uUmFuID0gYXdhaXQgdXNhZ2VTY2FubmVyLnJ1bigpO1xuICBpZiAoZ2l0aHViLmlzUnVubmluZ09uR2l0SHViUnVubmVyKCkpIHtcbiAgICBjb3JlLnNldE91dHB1dCgnY29sbGVjdGlvbi1yYW4nLCBjb2xsZWN0aW9uUmFuKTtcbiAgfVxufVxuXG5jb25zdCBNeU9jdG9raXQgPSBPY3Rva2l0LnBsdWdpbih0aHJvdHRsaW5nLCByZXRyeSwgcmVzdEVuZHBvaW50TWV0aG9kcyk7XG5cbmZ1bmN0aW9uIGNyZWF0ZVNtYXJ0T2N0b2tpdCh0b2tlbjogc3RyaW5nLCByZXBvcnRlcjogSVJlcG9ydGVyKTogYW55IHtcbiAgY29uc3Qgb2N0b2tpdFRoOiBPY3Rva2l0ID0gbmV3IE15T2N0b2tpdCh7XG4gICAgYXV0aDogdG9rZW4sXG4gICAgdGhyb3R0bGU6IHtcbiAgICAgIG9uUmF0ZUxpbWl0OiAocmV0cnlBZnRlcjogbnVtYmVyLCBvcHRpb25zOiBhbnkpOiBib29sZWFuID0+IHtcbiAgICAgICAgcmVwb3J0ZXIud2FybihcbiAgICAgICAgICBgUmVxdWVzdCBxdW90YSBleGhhdXN0ZWQgZm9yIHJlcXVlc3QgJHtvcHRpb25zLm1ldGhvZH0gJHtvcHRpb25zLnVybH1gXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKG9wdGlvbnMucmVxdWVzdC5yZXRyeUNvdW50ID09PSAwKSB7XG4gICAgICAgICAgLy8gb25seSByZXRyaWVzIG9uY2VcbiAgICAgICAgICByZXBvcnRlci5pbmZvKGBSZXRyeWluZyBhZnRlciAke3JldHJ5QWZ0ZXJ9IHNlY29uZHMhYCk7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9LFxuICAgICAgb25TZWNvbmRhcnlSYXRlTGltaXQ6IChyZXRyeUFmdGVyOiBudW1iZXIsIG9wdGlvbnM6IGFueSk6IGJvb2xlYW4gPT4ge1xuICAgICAgICByZXBvcnRlci53YXJuKFxuICAgICAgICAgIGBTZWNvbmRhcnlSYXRlTGltaXQgZGV0ZWN0ZWQgZm9yIHJlcXVlc3QgJHtvcHRpb25zLm1ldGhvZH0gJHtvcHRpb25zLnVybH0uYFxuICAgICAgICApO1xuICAgICAgICByZXBvcnRlci5pbmZvKGBSZXRyeWluZyBhZnRlciAke3JldHJ5QWZ0ZXJ9IHNlY29uZHMuYCk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSxcbiAgICB9LFxuICB9KTtcbiAgcmV0dXJuIG9jdG9raXRUaDtcbn1cblxuLy8gTWFpbiBlbnRyeS1wb2ludFxubWFpbigpXG4gIC50aGVuKCgpID0+IHByb2Nlc3MuZXhpdCgwKSlcbiAgLmNhdGNoKGVyciA9PiB7XG4gICAgY29uc3QgZXJyb3I6IEVycm9yID0gZXJyIGFzIEVycm9yO1xuICAgIC8qIHRzbGludDpkaXNhYmxlLW5leHQtbGluZSAqL1xuICAgIGNvbnNvbGUubG9nKGBtYWluKCk6IGZhdGFsIGVycm9yOiAke2Vycm9yfVxcbiR7ZXJyb3I/LnN0YWNrfWApO1xuICAgIHByb2Nlc3MuZXhpdCgtMSk7XG4gIH0pO1xuXG4vLyBsb2NhbCByZXBvcnRlclxuZnVuY3Rpb24gbG9nKGE6IHN0cmluZywgYj86IEVycm9yKSB7XG4gIC8qIHRzbGludDpkaXNhYmxlLW5leHQtbGluZSAqL1xuICBjb25zb2xlLmxvZyhhKTtcbiAgLyogdHNsaW50OmRpc2FibGUtbmV4dC1saW5lICovXG4gIGNvbnNvbGUubG9nKGI/LnRvU3RyaW5nKCkgfHwgJycpO1xufVxuIl19