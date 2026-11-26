import createClient, { type ClientOptions } from 'openapi-fetch';
import type { paths } from './schema';

export type { components, operations, paths } from './schema';

export function createLyricsFlipClient(options: ClientOptions) {
  const client = createClient<paths>(options);

  return {
    client,
    login: (
      body: NonNullable<
        paths['/api/v1/auth/login']['post']['requestBody']
      >['content']['application/json'],
    ) => client.POST('/api/v1/auth/login', { body }),
    getRandomLyric: (
      query?: paths['/api/v1/game/lyric']['get']['parameters']['query'],
      accessToken?: string,
    ) =>
      client.GET('/api/v1/game/lyric', {
        params: { query },
        headers: accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined,
      }),
  };
}
