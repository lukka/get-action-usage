// Copyright © 2022 by Luca Cappa lcappa@gmail.com
// All content of this repository is licensed under the CC BY-SA License.
// See the LICENSE file in the root for license information.

import * as dotenv from 'dotenv';
import * as github from './github';

import { SearchPublicFactory } from './factories';
import { IReporter } from './interfaces';
import { GHActionUsage } from './actionusage';
import { Octokit } from '@octokit/core';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';

const localReporter: IReporter = {
  debug: (a: string, b: Error) => log(a, b),
  error: (a: string, b: Error) => log(a, b),
  info: (a: string, b: Error) => log(a, b),
  warn: (a: string, b: Error) => log(a, b),
};

export async function main(): Promise<void> {
  if (!process.env.GITHUB_TOKEN) {
    const result = dotenv.config();
    if (result.error) {
      throw result.error;
    }
  }

  const reporter: IReporter = github.isRunningOnGitHubRunner()
    ? new github.Reporter()
    : localReporter;

  const octokit = createSmartOctokit(process.env.GITHUB_TOKEN!, reporter);
  if (!octokit) {
    throw new Error('cannot get Octokit client');
  }

  const usageScanner = new GHActionUsage(
    octokit,
    new SearchPublicFactory(),
    reporter
  );

  await usageScanner.run();
}

const MyOctokit = Octokit.plugin(throttling, retry, restEndpointMethods);

function createSmartOctokit(token: string, reporter: IReporter): any {
  const octokitTh: Octokit = new MyOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter: number, options: any): boolean => {
        reporter.warn(
          `Request quota exhausted for request ${options.method} ${options.url}`
        );

        if (options.request.retryCount === 0) {
          // only retries once
          reporter.info(`Retrying after ${retryAfter} seconds!`);
          return true;
        }

        return false;
      },
      onSecondaryRateLimit: (retryAfter: number, options: any): boolean => {
        reporter.warn(
          `SecondaryRateLimit detected for request ${options.method} ${options.url}.`
        );
        reporter.info(`Retrying after ${retryAfter} seconds.`);
        return true;
      },
    },
  });
  return octokitTh;
}

// Main entry-point
main()
  .then(() => process.exit(0))
  .catch(err => {
    const error: Error = err as Error;
    /* tslint:disable-next-line */
    console.log(`main(): fatal error: ${error}\n${error?.stack}`);
    process.exit(-1);
  });

// local reporter
function log(a: string, b?: Error) {
  /* tslint:disable-next-line */
  console.log(a);
  /* tslint:disable-next-line */
  console.log(b?.toString() || '');
}
