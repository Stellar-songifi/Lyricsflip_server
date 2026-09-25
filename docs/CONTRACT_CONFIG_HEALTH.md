# Contract Config Health

Boot and health checks should verify:

- Escrow contract ID is configured.
- LYRIC token contract ID is configured.
- Platform fee receiver is set when fee basis points are non-zero.
- Contract network matches the configured Stellar network.
