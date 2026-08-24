/**
 * Reads a trimmed text value from a form.
 *
 * `FormData.get` can also return a `File`, so the value is narrowed rather than stringified.
 */
export function formValue(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}
