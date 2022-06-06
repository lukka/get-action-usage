// Copyright © 2022 by Luca Cappa lcappa@gmail.com
// All content of this repository is licensed under the CC BY-SA License.
// See the LICENSE file in the root for license information.

export class ApiLimitsException extends Error {
  /// @ts-ignore
  protected __proto__ = Error;
  public constructor(
    readonly message: string,
    public readonly remaining: number,
    public readonly nextReset: Date,
    public readonly used: number
  ) {
    super(message);
    Object.setPrototypeOf(this, ApiLimitsException.prototype);
  }
}
