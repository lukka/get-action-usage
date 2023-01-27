// Copyright © 2022 by Luca Cappa lcappa@gmail.com
// All content of this repository is licensed under the CC BY-SA License.
// See the LICENSE file in the root for license information.

import { IReporter } from './interfaces';
import * as core from '@actions/core';

export function isRunningOnGitHubRunner(): boolean {
  return 'GITHUB_ACTIONS' in process.env;
}

export function getHtmlUrl(url: string, line: number) {
  // Save some HTTP requests to satisfy throttling and rate limits.
  const branchRegExp = new RegExp('\\?ref=(?<branch>[\\w\\d]+)');
  const branch = url.match(branchRegExp)?.groups?.branch ?? 'main';
  return (
    url
      .replace(`?ref=${branch}`, '')
      .replace(`/repos/`, '/')
      .replace('api.github.com', 'github.com')
      .replace('/contents/.github', `/blob/${branch}/.github`) + `#L${line}`
  );
}

export class Reporter implements IReporter {
  public info(message: string, error?: Error): void {
    core.info(message);
    if (error) {
      core.info(`${error.message} ${error?.stack}`);
    }
  }
  public warn(message: string, error?: Error): void {
    core.warning(message);
    if (error) {
      core.warning(`${error.message} ${error?.stack}`);
    }
  }
  public error(message: string, error?: Error): void {
    core.error(message);
    if (error) {
      core.error(`${error.message} ${error?.stack}`);
    }
  }
  public debug(message: string, error?: Error): void {
    core.debug(message);
    if (error) {
      core.debug(`${error.message} ${error?.stack}`);
    }
  }
}
