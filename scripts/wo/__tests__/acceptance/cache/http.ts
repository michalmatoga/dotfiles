import { http, HttpResponse, bypass } from "msw";
import { setupServer } from "msw/node";
import {
  generateCacheKey,
  hasCachedResponse,
  readCachedResponse,
  writeCachedResponse,
  isNoCache,
  findMatchingFixture,
} from "./index";

type CachedHttpResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
};

/**
 * Parse URL query params into object.
 */
const parseQueryParams = (url: string): Record<string, string> => {
  const parsed = new URL(url);
  const params: Record<string, string> = {};
  for (const [key, value] of parsed.searchParams) {
    params[key] = value;
  }
  return params;
};

/**
 * MSW handler that implements VCR-style caching for Trello API.
 * - Default mode: cache-only, uses fuzzy matching for POST/PUT/DELETE
 * - NO_CACHE mode: hits real API and records fixtures
 */
const trelloHandler = http.all("https://api.trello.com/*", async ({ request }) => {
  const method = request.method;
  const url = request.url;
  const body = request.body ? await request.clone().text() : undefined;

  const cacheKey = generateCacheKey("trello", method, url, body);

  // Check exact cache match first
  if (hasCachedResponse("trello", cacheKey)) {
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

  // For mutations in non-recording mode, return synthetic responses
  if (!isNoCache()) {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const queryParams = parseQueryParams(url);
    
    // POST /1/cards - create card
    if (method === "POST" && pathParts[0] === "1" && pathParts[1] === "cards") {
      console.log(`[cache] MOCK: ${method} ${url.slice(0, 80)}...`);
      return HttpResponse.json({
        id: `mock-card-${Date.now()}`,
        name: queryParams.name || "[TEST] Mock Card",
        desc: queryParams.desc || "",
        idList: queryParams.idList || "mock-list-id",
        idLabels: queryParams.idLabels?.split(",") || [],
        url: "https://trello.com/c/mock/mock-card",
        shortUrl: "https://trello.com/c/mock",
      });
    }
    
    // PUT /1/cards/{id} - update card
    if (method === "PUT" && pathParts[0] === "1" && pathParts[1] === "cards" && pathParts[2]) {
      console.log(`[cache] MOCK: ${method} ${url.slice(0, 80)}...`);
      return HttpResponse.json({
        id: pathParts[2],
        name: queryParams.name || "[TEST] Updated Card",
        desc: queryParams.desc || "",
        idList: queryParams.idList || "mock-list-id",
        idLabels: queryParams.idLabels?.split(",") || [],
      });
    }
    
    // DELETE /1/cards/{id} - delete card
    if (method === "DELETE" && pathParts[0] === "1" && pathParts[1] === "cards" && pathParts[2]) {
      console.log(`[cache] MOCK: ${method} ${url.slice(0, 80)}...`);
      return HttpResponse.json({ _value: null });
    }
    
    // For GET requests, try fuzzy match
    const fuzzyMatch = findMatchingFixture("trello", method, url);
    if (fuzzyMatch) {
      console.log(`[cache] HIT (fuzzy): ${method} ${url.slice(0, 80)}...`);
      return HttpResponse.json(fuzzyMatch.body, {
        status: fuzzyMatch.status,
        statusText: fuzzyMatch.statusText,
        headers: fuzzyMatch.headers,
      });
    }

    console.error(`[cache] MISS (no fixture): ${method} ${url.slice(0, 80)}...`);
    return HttpResponse.json(
      { error: "Test fixture not found. Run with NO_CACHE=true to record." },
      { status: 599, statusText: "Fixture Missing" }
    );
  }

  // NO_CACHE mode: hit real API and record fixture
  console.log(`[cache] RECORDING: ${method} ${url.slice(0, 80)}...`);
  
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
