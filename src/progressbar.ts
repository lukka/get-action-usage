// Copyright © 2022 by Luca Cappa lcappa@gmail.com
// All content of this repository is licensed under the CC BY-SA License.
// See the LICENSE file in the root for license information.

import * as cliprogress from 'cli-progress';
import { DateHelper } from './datehelper';
import * as github from './github';

export class ProgressBar {
  public static getActionString(msg: string): string {
    return msg.substring(0, 48).padEnd(55, ' ');
  }

  private readonly multiBar: cliprogress.MultiBar;
  private readonly timeBar: cliprogress.Bar;
  private readonly repoBar: cliprogress.Bar;

  public constructor() {
    this.multiBar = new cliprogress.MultiBar(
      {
        autopadding: true,
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        clearOnComplete: false,
        emptyOnZero: true,
        format:
          '{action}' +
          ' | {bar}' +
          ' | {percentage}% | {value}/{total} | {speed} {speed2}',
        hideCursor: true,
        noTTYOutput: github.isRunningOnGitHubRunner(),
        stopOnComplete: true,
      },
      cliprogress.Presets.shades_grey
    );
    this.timeBar = this.multiBar.create(0, 0, {
      action: ProgressBar.getActionString(`check range ...`),
      total: 0,
      value: 0,
    });
    this.repoBar = this.multiBar.create(0, 0, {});
  }

  public init(startDate: Date, timeRangeDays: number) {
    const now = new Date();
    // Compute the total time-segments of 'timeRange' days each.
    const totalTimeSegments: number = Math.ceil(
      (now.getTime() - startDate.getTime()) / (timeRangeDays * 1000 * 3600 * 24)
    );
    this.timeBar.start(totalTimeSegments, 1, {
      action: ProgressBar.getActionString(`checking range..`),
      speed: 'API',
      speed2: '',
      total: totalTimeSegments,
      value: 1,
    });
    this.repoBar.start(0, 0, {
      action: ProgressBar.getActionString('starting...'),
      repo: 'N/A',
      speed: 'N/A',
      speed2: '',
    });
  }

  public update(
    startDate: Date,
    nextDate: Date,
    totalRepoCount: number,
    timeSegment: number
  ): void {
    this.repoBar.setTotal(totalRepoCount);
    this.repoBar.start(totalRepoCount, 0, {
      action: ProgressBar.getActionString('starting...'),
      speed: 'N/A',
      speed2: '',
    });
    this.timeBar.update(timeSegment, {
      action: ProgressBar.getActionString(
        `checking range.. ${DateHelper.toTimeRangeString(startDate, nextDate)}`
      ),
      value: timeSegment.toString().padStart(3, ' '),
    });
  }

  public updateRepo(barCounter: number, payload: any): void {
    this.repoBar.update(barCounter, payload);
  }

  public updateApiQuota(restApi?: number, searchApi?: number): void {
    if (restApi) {
      this.timeBar.update({
        speed: `API: REST:${restApi.toString()},`,
      });
    }
    if (searchApi) {
      this.timeBar.update({
        speed2: `Search:${searchApi.toString()}`,
      });
    }
  }

  public stop(): void {
    this.repoBar.stop();
    this.timeBar.stop();
    this.multiBar.stop();
  }
}
