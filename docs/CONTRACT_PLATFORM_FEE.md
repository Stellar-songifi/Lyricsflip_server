# Contract Platform Fee Policy

The escrow contract supports an optional platform fee, expressed in basis points, taken from the winner payout before it is transferred.

Implemented rules:

- `Config` carries `fee_bps: u32`, `max_fee_bps: u32` (a constant cap, `1000` = 10%) and `fee_receiver: Option<Address>`.
- Default fee is `0` and the default receiver is `None`.
- The fee is capped by `max_fee_bps`; `set_fee` rejects any `fee_bps` above the cap.
- A non-zero fee requires a configured receiver; `set_fee` rejects a non-zero fee without one.
- `set_fee(fee_bps, receiver)` is admin-only.
- On `resolve`, the fee is `fee = payout * fee_bps / 10_000` (integer division, rounded down) and is transferred to the receiver; the remainder goes to the winner. With a 2.5% fee, a 10 + 10 pot pays 19.5 to the winner and 0.5 to the receiver.
- Draws and refunds are never charged a fee.
- A `fee` event is emitted when a fee is taken.
- The configured fee and receiver are surfaced by `get_config` and by the backend `GET /stellar/info` health check.

## Escrow Entry Points

The fee logic is layered on top of the full escrow interface. The contract exports:

- `__constructor` — initializes `Config` (admin, fee, receiver).
- `open_pot` — creates a pot for a match and records the expected stake.
- `stake` — deposits a player's stake into an open pot.
- `resolve` — settles a funded pot to the winner, deducting the platform fee (see above).
- `refund` — returns each stake on a drawn match, with no fee.
- `claim_refund` — lets a player reclaim a stuck stake from an unfunded or abandoned pot.
- `get_pot` — reads the current pot state.
- `set_resolver` — rotates the resolver address (admin-only).
- `set_admin` — rotates the admin address.
- `set_fee` — updates the fee and receiver (admin-only).
- `get_config` — reads the current `Config`.
- `upgrade` — upgrades the contract WASM (admin-only).
- `migrate` — runs storage migration after an upgrade.
- `get_version` — reads the stored contract version.

## Settlement Invariants

- `claim_refund` and `refund` share the same record of what has already been returned, so a stake can never be returned twice.
- Once a player has claimed a refund, `resolve` is blocked for that pot; a settled pot cannot be refunded and a refunded pot cannot be settled.
- Draws and refunds are never charged a fee; only a winning `resolve` deducts the platform fee.

## Testing

The contract test suite (`contracts/lyricsflip-escrow/src/test.rs`) is compiled via `#[cfg(test)] mod test;` in `lib.rs` and covers the fee rules, including:

- zero fee (winner receives the full pot, no `fee` event),
- maximum fee (exactly `max_fee_bps`),
- rounding (integer division rounds down, remainder to the winner),
- the receiver payout (fee transferred to `fee_receiver`).

## Proposed Platform Fee Architecture (Future Enhancement)

When platform monetization is enabled, fee deduction should follow these guidelines:

1. **Basis Points Representation**: Platform fees must be expressed in basis points (`1 bps = 0.01%`).
2. **Hard Ceiling**: Fee percentage must be capped on-chain (e.g., maximum 500 bps / 5%).
3. **Explicit Fee Receiver**: A dedicated fee collector address must be registered before any non-zero fee rate can be activated.
4. **Transparent Emitted Events**: Payout events emitted by the contract must explicitly split `payout_amount` and `fee_amount` so off-chain indexers and user explorers can verify calculations.
