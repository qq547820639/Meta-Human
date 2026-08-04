export function asText(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}