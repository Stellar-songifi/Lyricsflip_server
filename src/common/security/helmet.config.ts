import type { HelmetOptions } from 'helmet';

/**
 * Helmet defaults, with a CSP that still lets Swagger UI (/api/docs) load its
 * inline scripts, styles and data-URI images.
 */
export const helmetOptions: HelmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
};
