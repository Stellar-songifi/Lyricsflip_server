import { allowedOrigins, allowsWebSocketOrigin } from './cors';

describe('CORS origin policy', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalAllowNoOrigin = process.env.WS_ALLOW_NO_ORIGIN;

  afterEach(() => {
    if (originalFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = originalFrontendUrl;
    }

    if (originalAllowNoOrigin === undefined) {
      delete process.env.WS_ALLOW_NO_ORIGIN;
    } else {
      process.env.WS_ALLOW_NO_ORIGIN = originalAllowNoOrigin;
    }
  });

  it('uses each configured origin for HTTP and WebSocket requests', () => {
    process.env.FRONTEND_URL =
      'https://app.example.com, https://admin.example.com';

    expect(allowedOrigins()).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
    expect(allowsWebSocketOrigin('https://app.example.com')).toBe(true);
    expect(allowsWebSocketOrigin('https://admin.example.com')).toBe(true);
    expect(allowsWebSocketOrigin('https://other.example.com')).toBe(false);
  });

  it('allows requests without Origin by default and can explicitly reject them', () => {
    delete process.env.WS_ALLOW_NO_ORIGIN;
    expect(allowsWebSocketOrigin()).toBe(true);

    process.env.WS_ALLOW_NO_ORIGIN = 'false';
    expect(allowsWebSocketOrigin()).toBe(false);
  });
});
