// From the Banglalink Call Broadcast Panel Apps Script: company names are compared
// across all three agency tabs. Lowercase, "&" = "and", keep only letters, digits
// and Bangla. A match only warns, it never blocks.

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9ঀ-৿]/g, "");
}

export interface NameRecord {
  name: string;
  agency: string;
  row?: number | string;
}

export function findDuplicateNames(name: string, existing: NameRecord[]): NameRecord[] {
  const key = normalizeCompanyName(name);
  if (!key) return [];
  return existing.filter((r) => normalizeCompanyName(r.name) === key);
}
