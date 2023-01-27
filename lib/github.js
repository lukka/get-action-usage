"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Reporter = exports.getHtmlUrl = exports.isRunningOnGitHubRunner = void 0;
const core = require("@actions/core");
function isRunningOnGitHubRunner() {
    return 'GITHUB_ACTIONS' in process.env;
}
exports.isRunningOnGitHubRunner = isRunningOnGitHubRunner;
function getHtmlUrl(url, line) {
    var _a, _b, _c;
    const branchRegExp = new RegExp('\\?ref=(?<branch>[\\w\\d]+)');
    const branch = (_c = (_b = (_a = url.match(branchRegExp)) === null || _a === void 0 ? void 0 : _a.groups) === null || _b === void 0 ? void 0 : _b.branch) !== null && _c !== void 0 ? _c : 'main';
    return (url
        .replace(`?ref=${branch}`, '')
        .replace(`/repos/`, '/')
        .replace('api.github.com', 'github.com')
        .replace('/contents/.github', `/blob/${branch}/.github`) + `#L${line}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2l0aHViLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2dpdGh1Yi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFLQSxzQ0FBc0M7QUFFdEMsU0FBZ0IsdUJBQXVCO0lBQ3JDLE9BQU8sZ0JBQWdCLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQztBQUN6QyxDQUFDO0FBRkQsMERBRUM7QUFFRCxTQUFnQixVQUFVLENBQUMsR0FBVyxFQUFFLElBQVk7O0lBRWxELE1BQU0sWUFBWSxHQUFHLElBQUksTUFBTSxDQUFDLDZCQUE2QixDQUFDLENBQUM7SUFDL0QsTUFBTSxNQUFNLEdBQUcsTUFBQSxNQUFBLE1BQUEsR0FBRyxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsMENBQUUsTUFBTSwwQ0FBRSxNQUFNLG1DQUFJLE1BQU0sQ0FBQztJQUNqRSxPQUFPLENBQ0wsR0FBRztTQUNBLE9BQU8sQ0FBQyxRQUFRLE1BQU0sRUFBRSxFQUFFLEVBQUUsQ0FBQztTQUM3QixPQUFPLENBQUMsU0FBUyxFQUFFLEdBQUcsQ0FBQztTQUN2QixPQUFPLENBQUMsZ0JBQWdCLEVBQUUsWUFBWSxDQUFDO1NBQ3ZDLE9BQU8sQ0FBQyxtQkFBbUIsRUFBRSxTQUFTLE1BQU0sVUFBVSxDQUFDLEdBQUcsS0FBSyxJQUFJLEVBQUUsQ0FDekUsQ0FBQztBQUNKLENBQUM7QUFYRCxnQ0FXQztBQUVELE1BQWEsUUFBUTtJQUNaLElBQUksQ0FBQyxPQUFlLEVBQUUsS0FBYTtRQUN4QyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ25CLElBQUksS0FBSyxFQUFFO1lBQ1QsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxPQUFPLElBQUksS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7U0FDL0M7SUFDSCxDQUFDO0lBQ00sSUFBSSxDQUFDLE9BQWUsRUFBRSxLQUFhO1FBQ3hDLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDdEIsSUFBSSxLQUFLLEVBQUU7WUFDVCxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsS0FBSyxDQUFDLE9BQU8sSUFBSSxLQUFLLGFBQUwsS0FBSyx1QkFBTCxLQUFLLENBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztTQUNsRDtJQUNILENBQUM7SUFDTSxLQUFLLENBQUMsT0FBZSxFQUFFLEtBQWE7UUFDekMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUNwQixJQUFJLEtBQUssRUFBRTtZQUNULElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxLQUFLLENBQUMsT0FBTyxJQUFJLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1NBQ2hEO0lBQ0gsQ0FBQztJQUNNLEtBQUssQ0FBQyxPQUFlLEVBQUUsS0FBYTtRQUN6QyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3BCLElBQUksS0FBSyxFQUFFO1lBQ1QsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEtBQUssQ0FBQyxPQUFPLElBQUksS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7U0FDaEQ7SUFDSCxDQUFDO0NBQ0Y7QUF6QkQsNEJBeUJDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQ29weXJpZ2h0IMKpIDIwMjIgYnkgTHVjYSBDYXBwYSBsY2FwcGFAZ21haWwuY29tXG4vLyBBbGwgY29udGVudCBvZiB0aGlzIHJlcG9zaXRvcnkgaXMgbGljZW5zZWQgdW5kZXIgdGhlIENDIEJZLVNBIExpY2Vuc2UuXG4vLyBTZWUgdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBmb3IgbGljZW5zZSBpbmZvcm1hdGlvbi5cblxuaW1wb3J0IHsgSVJlcG9ydGVyIH0gZnJvbSAnLi9pbnRlcmZhY2VzJztcbmltcG9ydCAqIGFzIGNvcmUgZnJvbSAnQGFjdGlvbnMvY29yZSc7XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1J1bm5pbmdPbkdpdEh1YlJ1bm5lcigpOiBib29sZWFuIHtcbiAgcmV0dXJuICdHSVRIVUJfQUNUSU9OUycgaW4gcHJvY2Vzcy5lbnY7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRIdG1sVXJsKHVybDogc3RyaW5nLCBsaW5lOiBudW1iZXIpIHtcbiAgLy8gU2F2ZSBzb21lIEhUVFAgcmVxdWVzdHMgdG8gc2F0aXNmeSB0aHJvdHRsaW5nIGFuZCByYXRlIGxpbWl0cy5cbiAgY29uc3QgYnJhbmNoUmVnRXhwID0gbmV3IFJlZ0V4cCgnXFxcXD9yZWY9KD88YnJhbmNoPltcXFxcd1xcXFxkXSspJyk7XG4gIGNvbnN0IGJyYW5jaCA9IHVybC5tYXRjaChicmFuY2hSZWdFeHApPy5ncm91cHM/LmJyYW5jaCA/PyAnbWFpbic7XG4gIHJldHVybiAoXG4gICAgdXJsXG4gICAgICAucmVwbGFjZShgP3JlZj0ke2JyYW5jaH1gLCAnJylcbiAgICAgIC5yZXBsYWNlKGAvcmVwb3MvYCwgJy8nKVxuICAgICAgLnJlcGxhY2UoJ2FwaS5naXRodWIuY29tJywgJ2dpdGh1Yi5jb20nKVxuICAgICAgLnJlcGxhY2UoJy9jb250ZW50cy8uZ2l0aHViJywgYC9ibG9iLyR7YnJhbmNofS8uZ2l0aHViYCkgKyBgI0wke2xpbmV9YFxuICApO1xufVxuXG5leHBvcnQgY2xhc3MgUmVwb3J0ZXIgaW1wbGVtZW50cyBJUmVwb3J0ZXIge1xuICBwdWJsaWMgaW5mbyhtZXNzYWdlOiBzdHJpbmcsIGVycm9yPzogRXJyb3IpOiB2b2lkIHtcbiAgICBjb3JlLmluZm8obWVzc2FnZSk7XG4gICAgaWYgKGVycm9yKSB7XG4gICAgICBjb3JlLmluZm8oYCR7ZXJyb3IubWVzc2FnZX0gJHtlcnJvcj8uc3RhY2t9YCk7XG4gICAgfVxuICB9XG4gIHB1YmxpYyB3YXJuKG1lc3NhZ2U6IHN0cmluZywgZXJyb3I/OiBFcnJvcik6IHZvaWQge1xuICAgIGNvcmUud2FybmluZyhtZXNzYWdlKTtcbiAgICBpZiAoZXJyb3IpIHtcbiAgICAgIGNvcmUud2FybmluZyhgJHtlcnJvci5tZXNzYWdlfSAke2Vycm9yPy5zdGFja31gKTtcbiAgICB9XG4gIH1cbiAgcHVibGljIGVycm9yKG1lc3NhZ2U6IHN0cmluZywgZXJyb3I/OiBFcnJvcik6IHZvaWQge1xuICAgIGNvcmUuZXJyb3IobWVzc2FnZSk7XG4gICAgaWYgKGVycm9yKSB7XG4gICAgICBjb3JlLmVycm9yKGAke2Vycm9yLm1lc3NhZ2V9ICR7ZXJyb3I/LnN0YWNrfWApO1xuICAgIH1cbiAgfVxuICBwdWJsaWMgZGVidWcobWVzc2FnZTogc3RyaW5nLCBlcnJvcj86IEVycm9yKTogdm9pZCB7XG4gICAgY29yZS5kZWJ1ZyhtZXNzYWdlKTtcbiAgICBpZiAoZXJyb3IpIHtcbiAgICAgIGNvcmUuZGVidWcoYCR7ZXJyb3IubWVzc2FnZX0gJHtlcnJvcj8uc3RhY2t9YCk7XG4gICAgfVxuICB9XG59XG4iXX0=