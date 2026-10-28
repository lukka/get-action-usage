// Copyright © 2022 by Luca Cappa lcappa@gmail.com
// All content of this repository is licensed under the CC BY-SA License.
// See the LICENSE file in the root for license information.

import { IFile, IReporter } from './interfaces';
import * as core from '@actions/core';

export function isRunningOnGitHubRunner(): boolean {
  return 'GITHUB_ACTIONS' in process.env;
}

export function getHtmlUrl(
  file: Pick<IFile, 'html_url'>,
  line: number
): string {
  if (!file.html_url) {
    throw new Error('GitHub did not provide a workflow HTML URL.');
  }
  const url = new URL(file.html_url);
  if (
    url.origin !== 'https://github.com' ||
    url.username ||
    url.password ||
    !/^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)
  ) {
    throw new Error('Expected a GitHub workflow HTML URL.');
  }
  if (!Number.isSafeInteger(line) || line < 1) {
    throw new Error('Workflow line must be a positive integer.');
  }
  url.hash = `L${line}`;
  return url.href;
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
