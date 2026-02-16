import { http, HttpResponse, bypass } from "msw";
import { setupServer } from "msw/node";
import {
  generateCacheKey,
  hasCachedResponse,
  readCachedResponse,
  writeCachedResponse,
  isNoCache,
} from "./index";

type CachedHttpResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
};

/**
 * MSW handler that implements VCR-style caching for Trello API.
 * - Cache hit: returns cached response
 * - Cache miss: passes through to real API via bypass(), caches response
 */
const trelloHandler = http.all("https://api.trello.com/*", async ({ request }) => {
  const method = request.method;
  const url = request.url;
  const body = request.body ? await request.clone().text() : undefined;

  const cacheKey = generateCacheKey("trello", method, url, body);

  // Check cache first (unless --no-cache)
  if (!isNoCache() && hasCachedResponse("trello", cacheKey)) {
    const cached = readCachedResponse<CachedHttpResponse>("trello", cacheKey);
    if (cached) {
      console.log(`[cache] HIT: ${method} ${url.slice(0, 80)}...`);
      return HttpResponse.json(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: cached.headers,
      });
    }
  }

  // Cache miss or --no-cache: hit real API using bypass()
  console.log(`[cache] MISS: ${method} ${url.slice(0, 80)}...`);
  
  // Use bypass() to make the real request without MSW intercepting it
  const response = await fetch(bypass(request));
  const responseBody = await response.clone().json().catch(() => response.clone().text());

  // Cache the response (exclude content-encoding to avoid decompression issues)
  const headers = Object.fromEntries(response.headers.entries());
  delete headers["content-encoding"];
  delete headers["content-length"];
  
  const toCache: CachedHttpResponse = {
    status: response.status,
    statusText: response.statusText,
    headers,
    body: responseBody,
  };
  writeCachedResponse("trello", cacheKey, toCache);

  return HttpResponse.json(responseBody, {
    status: response.status,
    statusText: response.statusText,
  });
});

/**
 * MSW server with Trello caching handler.
 */
export const mswServer = setupServer(trelloHandler);

/**
 * Start the MSW server for intercepting HTTP requests.
 */
export const startHttpCache = () => {
  mswServer.listen({
    onUnhandledRequest: "bypass", // Let non-Trello requests through
  });
};

/**
 * Stop the MSW server.
 */
export const stopHttpCache = () => {
  mswServer.close();
};

/**
 * Reset handlers between tests.
 */
export const resetHttpCache = () => {
  mswServer.resetHandlers();
};
