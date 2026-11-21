# LyricsFlip TypeScript client

Install with `npm install @lyricsflip/api-client`. Pass the API origin as
`baseUrl`. The generated paths already include `/api/v1`.

```ts
import { createLyricsFlipClient } from '@lyricsflip/api-client';

const api = createLyricsFlipClient({ baseUrl: 'https://api.example.com' });
const login = await api.login({ email, password });
if (login.data) {
  const lyric = await api.getRandomLyric(undefined, login.data.accessToken);
  console.log(lyric.data?.lyricSnippet);
}
```

Use `api.client` for the full OpenAPI surface. CI generates the types from the
same OpenAPI document it uploads and compiles the consumer example before
packing the client.

The release package takes its version from the `vMAJOR.MINOR.PATCH` tag. The
npm package owner must configure `Stellar-songifi/Lyricsflip_server` and
`ci.yml` as the npm trusted publisher before the first release.
