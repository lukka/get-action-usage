// Copyright © 2022-2023-2024-2025 by Luca Cappa lcappa@gmail.com
// All content of this repository is licensed under the CC BY-SA License.
// See the LICENSE file in the root for license information.

export function toCronSchedule(date: Date) {
  const months = date.getMonth() + 1;
  const dayOfWeek = date.getDay();
  const days = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return `${minutes} ${hours} ${days} ${months} ${dayOfWeek}`;
}
