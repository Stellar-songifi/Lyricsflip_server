import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  requestId: string;
}

/**
 * AsyncLocalStorage that carries the requestId through the full async call
 * chain of a single request, so every log line can include it without
 * explicitly threading it through every function argument.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();

/** Returns the requestId for the current async context, or undefined. */
export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
