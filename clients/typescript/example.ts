import { createLyricsFlipClient } from './src';

export async function play(email: string, password: string): Promise<string> {
  const api = createLyricsFlipClient({ baseUrl: 'https://api.example.com' });
  const login = await api.login({ email, password });
  if (!login.data) throw new Error('Login failed');

  const lyric = await api.getRandomLyric(undefined, login.data.accessToken);
  if (!lyric.data) throw new Error('Could not fetch a lyric');
  return lyric.data.lyricSnippet;
}
