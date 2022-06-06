// Copyright © 2022 by Luca Cappa lcappa@gmail.com
// All content of this repository is licensed under the CC BY-SA License.
// See the LICENSE file in the root for license information.

import * as ok from '@octokit/rest';
import {
  IApiCallNotification,
  IRepositoriesProviderFactory,
} from './interfaces';
import { SearchPublic } from './providers';

export class SearchPublicFactory implements IRepositoriesProviderFactory {
  public async create(
    octokit: ok.Octokit,
    startDate: Date,
    endDate: Date,
    notification: IApiCallNotification
  ): Promise<SearchPublic> {
    const provider: SearchPublic = new SearchPublic(
      octokit,
      startDate,
      endDate,
      notification
    );
    if (!(await provider.init())) {
      throw new Error('SearchPublic.init() failed');
    }
    return provider;
  }
}
