/**
 * A record's own entry for a key, or undefined. A plain object literal answers inherited names too
 * ("constructor", "toString", "__proto__", "hasOwnProperty"), so a card, header or search word with one of
 * those names would otherwise read a function out of Object.prototype.
 */
export function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
