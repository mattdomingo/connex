/**
 * Parse RFC 5322 address headers into (email, displayName) pairs.
 * We handle:
 *   - "Alice Smith" <alice@example.com>
 *   - Alice Smith <alice@example.com>
 *   - alice@example.com
 *   - <alice@example.com>
 *   - comma-separated lists of any of the above
 *
 * Malformed entries (no recognizable email) are skipped.
 */

export interface ParsedAddress {
  email: string;
  displayName: string;
}

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

export function parseAddress(raw: string): ParsedAddress | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // "Name" <email> or Name <email>
  const angled = trimmed.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (angled) {
    const name = angled[1].trim().replace(/^["']|["']$/g, "");
    const email = angled[2].trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return null;
    return {
      email,
      displayName: name || deriveNameFromEmail(email),
    };
  }

  // Bare email
  const m = trimmed.match(EMAIL_RE);
  if (m) {
    const email = m[0].toLowerCase();
    return { email, displayName: deriveNameFromEmail(email) };
  }

  return null;
}

export function parseAddressList(header: string): ParsedAddress[] {
  if (!header) return [];
  // Split on commas that are NOT inside angle brackets or quotes.
  const parts = splitAddressList(header);
  const out: ParsedAddress[] = [];
  for (const p of parts) {
    const parsed = parseAddress(p);
    if (parsed) out.push(parsed);
  }
  return out;
}

function splitAddressList(header: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let depth = 0; // < > nesting (not technically nestable but be safe)
  let inQuote = false;
  for (const ch of header) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === "<" && !inQuote) depth++;
    else if (ch === ">" && !inQuote) depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0 && !inQuote) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  return parts;
}

/** Derive a human-ish name from the local-part when no display name is given. */
export function deriveNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  // Strip +tags, split on separators, capitalize
  const base = local.split("+")[0];
  const words = base.split(/[._\-]+/).filter(Boolean);
  if (words.length === 0) return email;
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
