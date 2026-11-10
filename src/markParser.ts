import * as fs from 'fs';
import { MarkMetadata } from './types';
import { md5 } from './utils';

/**
 * Regular expressions for parsing mark HTML comment headers.
 *
 * Mark supports two metadata formats:
 * 1. HTML comments: <!-- Space: DOCS -->
 * 2. YAML frontmatter (when --features=frontmatter is used)
 */
const HEADER_REGEX = {
  space: /<!--\s*Space:\s*(.+?)\s*-->/i,
  title: /<!--\s*Title:\s*(.+?)\s*-->/i,
  parent: /<!--\s*Parent:\s*(.+?)\s*-->/gi,
  label: /<!--\s*Label:\s*(.+?)\s*-->/gi,
};

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---/;

/**
 * Parse mark metadata from HTML comment headers.
 */
function parseHtmlHeaders(content: string): MarkMetadata | null {
  const spaceMatch = content.match(HEADER_REGEX.space);
  const titleMatch = content.match(HEADER_REGEX.title);

  if (!spaceMatch && !titleMatch) {
    return null;
  }

  const metadata: MarkMetadata = {};

  if (spaceMatch) {
    metadata.space = spaceMatch[1].trim();
  }
  if (titleMatch) {
    metadata.title = titleMatch[1].trim();
  }

  // Collect all Parent headers (mark supports multiple)
  const parents: string[] = [];
  let parentMatch;
  const parentRegex = /<!--\s*Parent:\s*(.+?)\s*-->/gi;
  while ((parentMatch = parentRegex.exec(content)) !== null) {
    parents.push(parentMatch[1].trim());
  }
  if (parents.length > 0) {
    metadata.parents = parents;
  }

  // Collect all Label headers
  const labels: string[] = [];
  let labelMatch;
  const labelRegex = /<!--\s*Label:\s*(.+?)\s*-->/gi;
  while ((labelMatch = labelRegex.exec(content)) !== null) {
    labels.push(labelMatch[1].trim());
  }
  if (labels.length > 0) {
    metadata.labels = labels;
  }

  return metadata;
}

/**
 * Parse mark metadata from YAML frontmatter.
 * Handles the plural key format used by mark's frontmatter feature.
 */
function parseFrontmatter(content: string): MarkMetadata | null {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return null;
  }

  const yaml = match[1];
  const metadata: MarkMetadata = {};

  // Simple YAML parsing (we don't want to add a yaml dependency)
  const lines = yaml.split('\n');
  let currentKey = '';
  let currentList: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Key: value pair
    const kvMatch = trimmed.match(/^(\w+):\s*(.+)$/);
    if (kvMatch) {
      // Flush previous list
      if (currentKey && currentList.length > 0) {
        assignMetadata(metadata, currentKey, currentList);
        currentList = [];
      }

      const key = kvMatch[1].toLowerCase();
      const value = kvMatch[2].trim();

      // Check for inline list: key: [a, b, c]
      const inlineListMatch = value.match(/^\[(.+)\]$/);
      if (inlineListMatch) {
        const items = inlineListMatch[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
        assignMetadata(metadata, key, items);
        currentKey = '';
      } else {
        // Simple value
        assignMetadata(metadata, key, [value.replace(/^["']|["']$/g, '')]);
        currentKey = key;
        currentList = [];
      }
      continue;
    }

    // Key with no inline value (list follows)
    const keyOnlyMatch = trimmed.match(/^(\w+):\s*$/);
    if (keyOnlyMatch) {
      if (currentKey && currentList.length > 0) {
        assignMetadata(metadata, currentKey, currentList);
        currentList = [];
      }
      currentKey = keyOnlyMatch[1].toLowerCase();
      continue;
    }

    // List item: - value
    const listItemMatch = trimmed.match(/^-\s+(.+)$/);
    if (listItemMatch) {
      currentList.push(listItemMatch[1].trim().replace(/^["']|["']$/g, ''));
    }
  }

  // Flush last list
  if (currentKey && currentList.length > 0) {
    assignMetadata(metadata, currentKey, currentList);
  }

  // Must have at least space or title
  if (!metadata.space && !metadata.title) {
    return null;
  }

  return metadata;
}

function assignMetadata(metadata: MarkMetadata, key: string, values: string[]): void {
  switch (key) {
    case 'space':
      metadata.space = values[0];
      break;
    case 'title':
      metadata.title = values[0];
      break;
    case 'parent':
    case 'parents':
      metadata.parents = values;
      break;
    case 'label':
    case 'labels':
      metadata.labels = values;
      break;
  }
}

/**
 * Parse mark metadata from a Markdown file's content.
 * Tries HTML comment headers first, then falls back to YAML frontmatter.
 */
export function parseMarkMetadata(content: string): MarkMetadata | null {
  // Try HTML comment headers first (more common, no feature flag needed)
  const htmlMeta = parseHtmlHeaders(content);
  if (htmlMeta) {
    return htmlMeta;
  }

  // Fall back to YAML frontmatter
  return parseFrontmatter(content);
}

/**
 * Parse metadata from a file on disk.
 */
export async function parseFile(filePath: string): Promise<{
  metadata: MarkMetadata | null;
  hash: string;
  content: string;
}> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const metadata = parseMarkMetadata(content);
  const hash = md5(content);
  return { metadata, hash, content };
}

/**
 * Check if a file has mark metadata.
 */
export function hasMarkMetadata(content: string): boolean {
  return parseMarkMetadata(content) !== null;
}
