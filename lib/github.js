"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Reporter = exports.getHtmlUrl = exports.isRunningOnGitHubRunner = void 0;
const core = require("@actions/core");
function isRunningOnGitHubRunner() {
    return 'GITHUB_ACTIONS' in process.env;
}
exports.isRunningOnGitHubRunner = isRunningOnGitHubRunner;
function getHtmlUrl(file, line) {
    if (!file.html_url) {
        throw new Error('GitHub did not provide a workflow HTML URL.');
    }
    const url = new URL(file.html_url);
    if (url.origin !== 'https://github.com' ||
        url.username ||
        url.password ||
        !/^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)) {
        throw new Error('Expected a GitHub workflow HTML URL.');
    }
    if (!Number.isSafeInteger(line) || line < 1) {
        throw new Error('Workflow line must be a positive integer.');
    }
    url.hash = `L${line}`;
    return url.href;
}
exports.getHtmlUrl = getHtmlUrl;
class Reporter {
    info(message, error) {
        core.info(message);
        if (error) {
            core.info(`${error.message} ${error === null || error === void 0 ? void 0 : error.stack}`);
        }
    }
    warn(message, error) {
        core.warning(message);
        if (error) {
            core.warning(`${error.message} ${error === null || error === void 0 ? void 0 : error.stack}`);
        }
    }
    error(message, error) {
        core.error(message);
        if (error) {
            core.error(`${error.message} ${error === null || error === void 0 ? void 0 : error.stack}`);
        }
    }
    debug(message, error) {
        core.debug(message);
        if (error) {
            core.debug(`${error.message} ${error === null || error === void 0 ? void 0 : error.stack}`);
        }
    }
}
exports.Reporter = Reporter;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2l0aHViLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2dpdGh1Yi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFLQSxzQ0FBc0M7QUFFdEMsU0FBZ0IsdUJBQXVCO0lBQ3JDLE9BQU8sZ0JBQWdCLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQztBQUN6QyxDQUFDO0FBRkQsMERBRUM7QUFFRCxTQUFnQixVQUFVLENBQ3hCLElBQTZCLEVBQzdCLElBQVk7SUFFWixJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRTtRQUNsQixNQUFNLElBQUksS0FBSyxDQUFDLDZDQUE2QyxDQUFDLENBQUM7S0FDaEU7SUFDRCxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDbkMsSUFDRSxHQUFHLENBQUMsTUFBTSxLQUFLLG9CQUFvQjtRQUNuQyxHQUFHLENBQUMsUUFBUTtRQUNaLEdBQUcsQ0FBQyxRQUFRO1FBQ1osQ0FBQyx5QkFBeUIsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxFQUM3QztRQUNBLE1BQU0sSUFBSSxLQUFLLENBQUMsc0NBQXNDLENBQUMsQ0FBQztLQUN6RDtJQUNELElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLElBQUksR0FBRyxDQUFDLEVBQUU7UUFDM0MsTUFBTSxJQUFJLEtBQUssQ0FBQywyQ0FBMkMsQ0FBQyxDQUFDO0tBQzlEO0lBQ0QsR0FBRyxDQUFDLElBQUksR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO0lBQ3RCLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQztBQUNsQixDQUFDO0FBckJELGdDQXFCQztBQUVELE1BQWEsUUFBUTtJQUNaLElBQUksQ0FBQyxPQUFlLEVBQUUsS0FBYTtRQUN4QyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ25CLElBQUksS0FBSyxFQUFFO1lBQ1QsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxPQUFPLElBQUksS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7U0FDL0M7SUFDSCxDQUFDO0lBQ00sSUFBSSxDQUFDLE9BQWUsRUFBRSxLQUFhO1FBQ3hDLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDdEIsSUFBSSxLQUFLLEVBQUU7WUFDVCxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsS0FBSyxDQUFDLE9BQU8sSUFBSSxLQUFLLGFBQUwsS0FBSyx1QkFBTCxLQUFLLENBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztTQUNsRDtJQUNILENBQUM7SUFDTSxLQUFLLENBQUMsT0FBZSxFQUFFLEtBQWE7UUFDekMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUNwQixJQUFJLEtBQUssRUFBRTtZQUNULElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxLQUFLLENBQUMsT0FBTyxJQUFJLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1NBQ2hEO0lBQ0gsQ0FBQztJQUNNLEtBQUssQ0FBQyxPQUFlLEVBQUUsS0FBYTtRQUN6QyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3BCLElBQUksS0FBSyxFQUFFO1lBQ1QsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEtBQUssQ0FBQyxPQUFPLElBQUksS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7U0FDaEQ7SUFDSCxDQUFDO0NBQ0Y7QUF6QkQsNEJBeUJDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQ29weXJpZ2h0IMKpIDIwMjIgYnkgTHVjYSBDYXBwYSBsY2FwcGFAZ21haWwuY29tXG4vLyBBbGwgY29udGVudCBvZiB0aGlzIHJlcG9zaXRvcnkgaXMgbGljZW5zZWQgdW5kZXIgdGhlIENDIEJZLVNBIExpY2Vuc2UuXG4vLyBTZWUgdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBmb3IgbGljZW5zZSBpbmZvcm1hdGlvbi5cblxuaW1wb3J0IHsgSUZpbGUsIElSZXBvcnRlciB9IGZyb20gJy4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgKiBhcyBjb3JlIGZyb20gJ0BhY3Rpb25zL2NvcmUnO1xuXG5leHBvcnQgZnVuY3Rpb24gaXNSdW5uaW5nT25HaXRIdWJSdW5uZXIoKTogYm9vbGVhbiB7XG4gIHJldHVybiAnR0lUSFVCX0FDVElPTlMnIGluIHByb2Nlc3MuZW52O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0SHRtbFVybChcbiAgZmlsZTogUGljazxJRmlsZSwgJ2h0bWxfdXJsJz4sXG4gIGxpbmU6IG51bWJlclxuKTogc3RyaW5nIHtcbiAgaWYgKCFmaWxlLmh0bWxfdXJsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdHaXRIdWIgZGlkIG5vdCBwcm92aWRlIGEgd29ya2Zsb3cgSFRNTCBVUkwuJyk7XG4gIH1cbiAgY29uc3QgdXJsID0gbmV3IFVSTChmaWxlLmh0bWxfdXJsKTtcbiAgaWYgKFxuICAgIHVybC5vcmlnaW4gIT09ICdodHRwczovL2dpdGh1Yi5jb20nIHx8XG4gICAgdXJsLnVzZXJuYW1lIHx8XG4gICAgdXJsLnBhc3N3b3JkIHx8XG4gICAgIS9eXFwvW14vXStcXC9bXi9dK1xcL2Jsb2JcXC8vLnRlc3QodXJsLnBhdGhuYW1lKVxuICApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4cGVjdGVkIGEgR2l0SHViIHdvcmtmbG93IEhUTUwgVVJMLicpO1xuICB9XG4gIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIobGluZSkgfHwgbGluZSA8IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1dvcmtmbG93IGxpbmUgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXIuJyk7XG4gIH1cbiAgdXJsLmhhc2ggPSBgTCR7bGluZX1gO1xuICByZXR1cm4gdXJsLmhyZWY7XG59XG5cbmV4cG9ydCBjbGFzcyBSZXBvcnRlciBpbXBsZW1lbnRzIElSZXBvcnRlciB7XG4gIHB1YmxpYyBpbmZvKG1lc3NhZ2U6IHN0cmluZywgZXJyb3I/OiBFcnJvcik6IHZvaWQge1xuICAgIGNvcmUuaW5mbyhtZXNzYWdlKTtcbiAgICBpZiAoZXJyb3IpIHtcbiAgICAgIGNvcmUuaW5mbyhgJHtlcnJvci5tZXNzYWdlfSAke2Vycm9yPy5zdGFja31gKTtcbiAgICB9XG4gIH1cbiAgcHVibGljIHdhcm4obWVzc2FnZTogc3RyaW5nLCBlcnJvcj86IEVycm9yKTogdm9pZCB7XG4gICAgY29yZS53YXJuaW5nKG1lc3NhZ2UpO1xuICAgIGlmIChlcnJvcikge1xuICAgICAgY29yZS53YXJuaW5nKGAke2Vycm9yLm1lc3NhZ2V9ICR7ZXJyb3I/LnN0YWNrfWApO1xuICAgIH1cbiAgfVxuICBwdWJsaWMgZXJyb3IobWVzc2FnZTogc3RyaW5nLCBlcnJvcj86IEVycm9yKTogdm9pZCB7XG4gICAgY29yZS5lcnJvcihtZXNzYWdlKTtcbiAgICBpZiAoZXJyb3IpIHtcbiAgICAgIGNvcmUuZXJyb3IoYCR7ZXJyb3IubWVzc2FnZX0gJHtlcnJvcj8uc3RhY2t9YCk7XG4gICAgfVxuICB9XG4gIHB1YmxpYyBkZWJ1ZyhtZXNzYWdlOiBzdHJpbmcsIGVycm9yPzogRXJyb3IpOiB2b2lkIHtcbiAgICBjb3JlLmRlYnVnKG1lc3NhZ2UpO1xuICAgIGlmIChlcnJvcikge1xuICAgICAgY29yZS5kZWJ1ZyhgJHtlcnJvci5tZXNzYWdlfSAke2Vycm9yPy5zdGFja31gKTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==