/**
 * Strips control characters — including CR/LF — from a user-controlled
 * string before it is written to a log line or interpolated into a
 * human-readable message.
 *
 * Usernames, lyric text and guesses all come from players and are echoed back
 * in log lines (`stellar-token.service`, `wager.service`) and in messages sent
 * to clients (`completeWageredGame`). Without this, a username containing a
 * newline can forge extra log lines, and control characters can render as
 * spoofed or confusing text in a client that displays the message verbatim.
 *
 * Only control characters are removed; the value is otherwise left intact so
 * a legitimate username still reads correctly.
 */
export function sanitizeForDisplay(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
}
