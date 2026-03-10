import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

export function loadCSV(filePath: string): Record<string, string>[] {
  const raw = readFileSync(join(DATA_DIR, filePath), "utf-8");
  const lines = raw.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = values[i] ?? "";
    });
    return record;
  });
}

export function loadTXT(filePath: string): Record<string, string> {
  const raw = readFileSync(join(DATA_DIR, filePath), "utf-8");
  const sections: Record<string, string> = {};

  const sectionRegex = /={3,}\s*(.+?)\s*={3,}/g;
  let match: RegExpExecArray | null;
  const names: string[] = [];

  while ((match = sectionRegex.exec(raw)) !== null) {
    names.push(match[1].trim());
  }

  const contentParts = raw.split(/={3,}\s*.+?\s*={3,}/);
  for (let i = 0; i < names.length; i++) {
    sections[names[i].toLowerCase()] = (contentParts[i + 1] ?? "").trim();
  }

  return sections;
}

export interface SearchResult {
  data: Record<string, string>;
  source: string;
}

let mallDirectoryCache: Record<string, string>[] | null = null;
let mallEventsCache: Record<string, string>[] | null = null;
let mallProductsCache: Record<string, string>[] | null = null;
let mallInfoCache: Record<string, string> | null = null;
let propertyListingsCache: Record<string, string>[] | null = null;
let propertyAmenitiesCache: Record<string, string> | null = null;

function getMallDirectory(): Record<string, string>[] {
  if (!mallDirectoryCache) mallDirectoryCache = loadCSV("mall_directory.csv");
  return mallDirectoryCache;
}

function getMallEvents(): Record<string, string>[] {
  if (!mallEventsCache) mallEventsCache = loadCSV("mall_events.csv");
  return mallEventsCache;
}

function getMallProducts(): Record<string, string>[] {
  if (!mallProductsCache) mallProductsCache = loadCSV("mall_products.csv");
  return mallProductsCache;
}

function getMallInfoData(): Record<string, string> {
  if (!mallInfoCache) mallInfoCache = loadTXT("mall_info.txt");
  return mallInfoCache;
}

function getPropertyListings(): Record<string, string>[] {
  if (!propertyListingsCache) propertyListingsCache = loadCSV("property_listings.csv");
  return propertyListingsCache;
}

function getPropertyAmenitiesData(): Record<string, string> {
  if (!propertyAmenitiesCache) propertyAmenitiesCache = loadTXT("property_amenities.txt");
  return propertyAmenitiesCache;
}

function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function matchesKeywords(record: Record<string, string>, keywords: string[]): boolean {
  const text = Object.values(record).join(" ").toLowerCase();
  return keywords.some((kw) => text.includes(kw));
}

export function searchMallDirectory(
  query: string,
  mallName?: string,
  category?: string
): SearchResult[] {
  const data = getMallDirectory();
  const keywords = extractKeywords(query);

  return data
    .filter((row) => {
      if (mallName && !row.mall_name.toLowerCase().includes(mallName.toLowerCase())) {
        return false;
      }
      if (category && !row.category.toLowerCase().includes(category.toLowerCase())) {
        return false;
      }
      return matchesKeywords(row, keywords);
    })
    .map((row) => ({
      data: row,
      source: `mall_directory.csv:${row.store_name}@${row.mall_name}`,
    }));
}

export function searchMallEvents(query: string, mallName?: string): SearchResult[] {
  const data = getMallEvents();
  const keywords = extractKeywords(query);

  return data
    .filter((row) => {
      if (mallName && !row.mall_name.toLowerCase().includes(mallName.toLowerCase())) {
        return false;
      }
      return matchesKeywords(row, keywords);
    })
    .map((row) => ({
      data: row,
      source: `mall_events.csv:${row.event_name}@${row.mall_name}`,
    }));
}

export function searchMallProducts(
  query: string,
  mallName?: string,
  category?: string
): SearchResult[] {
  const data = getMallProducts();
  const keywords = extractKeywords(query);

  return data
    .filter((row) => {
      if (mallName && !row.mall_name.toLowerCase().includes(mallName.toLowerCase())) {
        return false;
      }
      if (category && !row.category.toLowerCase().includes(category.toLowerCase())) {
        return false;
      }
      return matchesKeywords(row, keywords);
    })
    .map((row) => ({
      data: row,
      source: `mall_products.csv:${row.product_name}@${row.store_name}`,
    }));
}

export function getMallInfo(mallName: string): SearchResult[] {
  const sections = getMallInfoData();
  const results: SearchResult[] = [];

  for (const [key, content] of Object.entries(sections)) {
    if (
      key.toLowerCase().includes(mallName.toLowerCase()) ||
      mallName.toLowerCase().includes(key.toLowerCase())
    ) {
      results.push({
        data: { mall_name: key, info: content },
        source: `mall_info.txt:${key}`,
      });
    }
  }

  return results;
}

export function searchProperties(
  query: string,
  development?: string,
  bedrooms?: number,
  maxPrice?: number
): SearchResult[] {
  const data = getPropertyListings();
  const keywords = extractKeywords(query);

  return data
    .filter((row) => {
      if (development && !row.development.toLowerCase().includes(development.toLowerCase())) {
        return false;
      }
      if (bedrooms !== undefined && parseInt(row.bedrooms) !== bedrooms) {
        return false;
      }
      if (maxPrice !== undefined) {
        const priceMatch = row.price_range_php.match(/(\d+)$/);
        if (priceMatch && parseInt(priceMatch[1]) > maxPrice) {
          return false;
        }
      }
      return matchesKeywords(row, keywords);
    })
    .map((row) => ({
      data: row,
      source: `property_listings.csv:${row.unit_type}@${row.development}/${row.tower}`,
    }));
}

export function getPropertyAmenities(development: string): SearchResult[] {
  const sections = getPropertyAmenitiesData();
  const results: SearchResult[] = [];

  for (const [key, content] of Object.entries(sections)) {
    if (
      key.toLowerCase().includes(development.toLowerCase()) ||
      development.toLowerCase().includes(key.toLowerCase())
    ) {
      results.push({
        data: { development: key, info: content },
        source: `property_amenities.txt:${key}`,
      });
    }
  }

  return results;
}

const MALL_NAMES = ["solana mall", "parkview shopping center", "mercado village", "the atrium"];

function detectMallName(query: string): string | undefined {
  const q = query.toLowerCase();
  return MALL_NAMES.find((m) => q.includes(m));
}

const DEV_NAMES = [
  "central park towers",
  "the pinnacle",
  "verde gardens",
  "willow grove",
  "skyline residences",
];

function detectDevelopment(query: string): string | undefined {
  const q = query.toLowerCase();
  return DEV_NAMES.find((d) => q.includes(d));
}

export function searchAllMallData(query: string): SearchResult[] {
  const results: SearchResult[] = [];
  const detectedMall = detectMallName(query);

  results.push(...searchMallDirectory(query, detectedMall));
  results.push(...searchMallEvents(query, detectedMall));
  results.push(...searchMallProducts(query, detectedMall));

  if (detectedMall) {
    results.push(...getMallInfo(detectedMall));
  }

  if (detectedMall && results.length <= 2) {
    const allDir = getMallDirectory().filter((r) =>
      r.mall_name.toLowerCase().includes(detectedMall)
    );
    for (const row of allDir) {
      const source = `mall_directory.csv:${row.store_name}@${row.mall_name}`;
      if (!results.some((r) => r.source === source)) {
        results.push({ data: row, source });
      }
    }
    const allEvents = getMallEvents().filter((r) =>
      r.mall_name.toLowerCase().includes(detectedMall)
    );
    for (const row of allEvents) {
      const source = `mall_events.csv:${row.event_name}@${row.mall_name}`;
      if (!results.some((r) => r.source === source)) {
        results.push({ data: row, source });
      }
    }
  }

  return results;
}

export function searchAllPropertyData(query: string): SearchResult[] {
  const results: SearchResult[] = [];
  const detectedDev = detectDevelopment(query);

  results.push(...searchProperties(query, detectedDev));

  if (detectedDev) {
    results.push(...getPropertyAmenities(detectedDev));
  }

  if (!detectedDev) {
    const amenitySections = getPropertyAmenitiesData();
    const keywords = extractKeywords(query);
    for (const [key, content] of Object.entries(amenitySections)) {
      const text = (key + " " + content).toLowerCase();
      if (keywords.some((kw) => text.includes(kw))) {
        results.push({
          data: { development: key, info: content },
          source: `property_amenities.txt:${key}`,
        });
      }
    }
  }

  return results;
}
