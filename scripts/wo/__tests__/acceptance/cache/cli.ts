import { vi } from "vitest";

/**
 * Reset CLI mocks between tests.
 * For now this is a no-op until we implement proper module mocking.
 */
export const resetCliCache = () => {
  // TODO: Implement proper CLI caching
  // The vi.mock approach needs to be at the module level, not inside functions
};
