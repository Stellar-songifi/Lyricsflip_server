# Contract Platform Fee

The escrow contract should support an optional platform fee, expressed in basis points, before winner payout.

Recommended rules:

- Default fee is `0`.
- Maximum fee is capped by contract config.
- Fee receiver must be configured before non-zero fee activation.
- Health checks should surface configured fee and receiver.
