// Copyright © 2022 by Luca Cappa lcappa@gmail.com
// All content of this repository is licensed under the CC BY-SA License.
// See the LICENSE file in the root for license information.

export class DateHelper {
  public static toString(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  public static toTimeRangeString(date1: Date, date2: Date): string {
    return `${DateHelper.toString(date1)}..${DateHelper.toString(date2)}`;
  }

  public static addDays(aDate: Date, days: number): Date {
    const date = new Date(aDate);
    date.setDate(date.getDate() + days);
    return date;
  }

  public static addMinutes(aDate: Date, minutes: number): Date {
    return new Date(aDate.getTime() + minutes * 60000);
  }
}
