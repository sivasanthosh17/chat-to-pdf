import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Approved HTTPS hostnames for AI shared conversation links.
 *
 * `fetchHosts` are the only hosts the server itself may contact for that
 * platform (direct HTTP fetches and redirect hops). `browserHostSuffixes`
 * are the only hosts a headless browser may load sub-resources from while
 * rendering a share page — see services/browser.service.js.
 */
export const ALLOWED_PLATFORMS = {
  chatgpt: {
    id: 'chatgpt',
    displayName: 'ChatGPT',
    hostnames: ['chatgpt.com', 'chat.openai.com'],
    // Matches /share/<id> or /share/e/<id> — IDs may be UUIDs (hex + dashes) or short alphanumeric strings
    sharePathRegex: /^\/share\/(e\/)?[a-zA-Z0-9_-]+$/,
    fetchHosts: ['chatgpt.com', 'chat.openai.com'],
    browserHostSuffixes: ['chatgpt.com', 'chat.openai.com', 'oaistatic.com', 'oaiusercontent.com']
  },
  gemini: {
    id: 'gemini',
    displayName: 'Google Gemini',
    hostnames: ['gemini.google.com'],
    sharePathRegex: /^\/share\/[a-zA-Z0-9_-]+$/,
    fetchHosts: ['gemini.google.com'],
    // Verified on a live share page: the app shell, its scripts and the
    // conversation RPC are served from these hosts. Analytics/ads hosts are
    // intentionally not allowed.
    browserHostSuffixes: ['gemini.google.com', 'gstatic.com']
  },
  claude: {
    id: 'claude',
    displayName: 'Claude',
    hostnames: ['claude.ai'],
    // Claude share URLs: /share/<uuid> where uuid may contain dashes
    sharePathRegex: /^\/share\/[a-zA-Z0-9_-]+$/,
    fetchHosts: ['claude.ai'],
    browserHostSuffixes: ['claude.ai']
  }
};

/**
 * Official short-link formats that map deterministically onto a canonical
 * share URL. They are rewritten locally — the short-link host is never
 * contacted, so no unvalidated redirect is followed.
 *
 * g.co/gemini/share/<id> is the link Gemini copies to the clipboard; it
 * redirects to gemini.google.com/share/<id> with the same identifier
 * (verified against a live public share).
 */
const SHORT_LINK_ALIASES = [
  {
    hostname: 'g.co',
    pathRegex: /^\/gemini\/share\/([a-zA-Z0-9_-]+)$/,
    toCanonical: (id) => `https://gemini.google.com/share/${id}`
  }
];

/**
 * Checks if an IPv4 address is in a private, loopback, or reserved range (SSRF guard).
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateOrReservedIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IPv4 treated as unsafe
  }

  const [a, b, c] = parts;

  // 0.0.0.0/8 (Broadcast/Current)
  if (a === 0) return true;

  // 10.0.0.0/8 (Private)
  if (a === 10) return true;

  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 169.254.0.0/16 (Link-local / Cloud Metadata: AWS/GCP/Azure)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12 (Private 172.16 - 172.31)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.0.0.0/24 (IETF protocol assignments) and 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;

  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;

  // 198.18.0.0/15 (Benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2) and 203.0.113.0/24 (TEST-NET-3)
  if ((a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return true;

  // 224.0.0.0/4 (Multicast)
  if (a >= 224 && a <= 239) return true;

  // 240.0.0.0/4 (Reserved)
  if (a >= 240) return true;

  return false;
}

/**
 * Checks if an IPv6 address is loopback, unspecified, unique-local, link-local,
 * or an IPv4-mapped address pointing at a restricted IPv4 range.
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateOrReservedIPv6(ip) {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === '::1' || lower === '::') return true;

  // fe80::/10 link-local (fe80 – febf)
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;

  // fc00::/7 unique-local (fc00 – fdff)
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;

  // IPv4-mapped IPv6, dotted form (::ffff:127.0.0.1)
  const mappedDotted = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedDotted) return isPrivateOrReservedIPv4(mappedDotted[1]);

  // IPv4-mapped IPv6, hex form (::ffff:7f00:1)
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateOrReservedIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }

  return false;
}

/**
 * Resolves a hostname and rejects it if ANY resolved address is private,
 * loopback, link-local or reserved. Used for the submitted URL and again
 * for every redirect hop in safeFetch.
 *
 * @param {string} hostname
 * @param {Function} [lookupImpl] - injectable for tests
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function checkHostResolvesPublic(hostname, lookupImpl = lookup) {
  let entries;
  try {
    entries = await lookupImpl(hostname, { all: true });
  } catch (dnsErr) {
    return { ok: false, error: `DNS resolution failed for hostname "${hostname}": ${dnsErr.code || dnsErr.message}` };
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, error: `DNS resolution returned no addresses for "${hostname}".` };
  }

  for (const entry of entries) {
    if (entry.family === 4 && isPrivateOrReservedIPv4(entry.address)) {
      return { ok: false, error: `Security violation: Domain resolves to private or reserved IP range (${entry.address}).` };
    }
    if (entry.family === 6 && isPrivateOrReservedIPv6(entry.address)) {
      return { ok: false, error: `Security violation: Domain resolves to restricted IPv6 range (${entry.address}).` };
    }
  }
  return { ok: true };
}

/**
 * Validates a user-supplied URL against strict security criteria and platform rules.
 * @param {string} urlString
 * @param {object} [options]
 * @param {boolean} [options.skipDns=false] - For offline testing
 * @param {Function} [options.lookupImpl]   - Injectable DNS lookup for tests
 * @returns {Promise<{ isValid: boolean, error?: string, platform?: string, platformName?: string, shareId?: string, parsedUrl?: URL, canonicalUrl?: string }>}
 */
export async function validateConversationUrl(urlString, options = {}) {
  const { skipDns = false, lookupImpl } = options;

  if (!urlString || typeof urlString !== 'string') {
    return { isValid: false, error: 'A valid URL string is required.' };
  }

  // Trim and de-duplicate accidentally doubled pastes (e.g. user pastes URL twice)
  let cleaned = urlString.trim();

  if (cleaned.length > 2048) {
    return { isValid: false, error: 'URL is too long.' };
  }

  // If the string contains "https://" more than once, take only the first URL
  const secondHttpsIndex = cleaned.indexOf('https://', 8);
  if (secondHttpsIndex !== -1) {
    cleaned = cleaned.substring(0, secondHttpsIndex).trim();
  }

  let parsed;
  try {
    parsed = new URL(cleaned);
  } catch {
    return { isValid: false, error: 'Malformed URL format. Please provide a valid HTTPS link.' };
  }

  // 1. Enforce HTTPS only
  if (parsed.protocol !== 'https:') {
    return {
      isValid: false,
      error: `Insecure protocol "${parsed.protocol}". Only HTTPS URLs are permitted.`
    };
  }

  // Credentials and non-default ports have no place in a public share link
  if (parsed.username || parsed.password) {
    return { isValid: false, error: 'URLs containing credentials are not allowed.' };
  }
  if (parsed.port && parsed.port !== '443') {
    return { isValid: false, error: 'Non-standard ports are not allowed.' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. Reject IP-literal hosts outright (SSRF protection)
  if (isIP(hostname.replace(/^\[|\]$/g, '')) !== 0 || hostname.startsWith('[') || /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    return {
      isValid: false,
      error: 'Direct IP address access is disallowed. Only verified domain hostnames are supported.'
    };
  }

  // 3. Rewrite official short links onto their canonical share URL (no network access)
  const alias = SHORT_LINK_ALIASES.find((a) => a.hostname === hostname);
  if (alias) {
    const m = parsed.pathname.replace(/\/$/, '').match(alias.pathRegex);
    if (!m) {
      return { isValid: false, error: `Invalid short-link path "${parsed.pathname}" for ${hostname}.` };
    }
    return validateConversationUrl(alias.toCanonical(m[1]), options);
  }

  // 4. Match against allowed platforms
  let matchedPlatform = null;
  let matchedConfig = null;

  for (const [key, config] of Object.entries(ALLOWED_PLATFORMS)) {
    if (config.hostnames.includes(hostname)) {
      matchedPlatform = key;
      matchedConfig = config;
      break;
    }
  }

  if (!matchedPlatform) {
    return {
      isValid: false,
      error: `Unsupported hostname "${hostname}". Supported platforms: ChatGPT (chatgpt.com), Google Gemini (gemini.google.com, g.co/gemini/share), and Claude (claude.ai).`
    };
  }

  // 5. Validate share path format
  const pathname = parsed.pathname.replace(/\/$/, ''); // Remove trailing slash
  if (!matchedConfig.sharePathRegex.test(pathname)) {
    return {
      isValid: false,
      error: `Invalid path "${parsed.pathname}" for ${matchedConfig.displayName}. Expected a public shared URL like "${matchedConfig.hostnames[0]}/share/<id>".`
    };
  }

  // The share identifier is always the last path segment (/share/<id> or /share/e/<id>)
  const shareId = pathname.split('/').pop();
  if (!shareId) {
    return {
      isValid: false,
      error: `Could not extract share identifier from URL.`
    };
  }

  // 6. DNS verification to prevent SSRF via DNS records pointing at internal ranges
  if (!skipDns) {
    const dns = await checkHostResolvesPublic(hostname, lookupImpl);
    if (!dns.ok) {
      return { isValid: false, error: dns.error };
    }
  }

  // Canonical form drops query strings and fragments (tracking parameters such
  // as ?ogimg=plain are irrelevant to the conversation content).
  const canonicalUrl = `https://${hostname}${pathname}`;

  return {
    isValid: true,
    platform: matchedPlatform,
    platformName: matchedConfig.displayName,
    shareId,
    parsedUrl: new URL(canonicalUrl),
    canonicalUrl
  };
}
