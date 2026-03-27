/**
 * Normalizes a raw URL string:
 * - Trims whitespace
 * - Auto-prefixes https:// for bare domains
 * - Validates scheme (http/https only)
 * - Validates host (must contain a dot or be "localhost")
 * - Validates host parts (non-empty, alphanumeric + hyphens)
 *
 * Returns the normalized URL string, or null if invalid.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withScheme = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const host = parsed.hostname;
  if (!host) return null;

  if (host !== "localhost" && !host.includes(".")) {
    return null;
  }

  if (host !== "localhost") {
    const parts = host.split(".");
    const valid = parts.every((part) => part.length > 0 && /^[a-zA-Z0-9-]+$/.test(part));
    if (!valid) return null;
  }

  return parsed.toString();
}

/**
 * Quick check if a string looks like a URL worth auto-saving from clipboard.
 * Checks for http://, https://, or domain-like patterns (contains a dot).
 */
export function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return trimmed.startsWith("http://") || trimmed.startsWith("https://") || /^[a-zA-Z0-9-]+\.[a-zA-Z]/.test(trimmed);
}
