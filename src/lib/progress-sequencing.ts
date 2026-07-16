/** Return true only for a strictly newer client progress event. */
export function isNewerProgressSequence(current: number, incoming: number) {
  return Number.isSafeInteger(incoming) && incoming >= 0 && incoming > current;
}
