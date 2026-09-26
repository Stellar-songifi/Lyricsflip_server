# Contract TypeScript Bindings

Generate TypeScript bindings from the deployed Soroban contract instead of manually building ScVals.

```bash
soroban contract bindings typescript \
  --contract-id "$ESCROW_CONTRACT_ID" \
  --network "$SOROBAN_NETWORK" \
  --output-dir src/stellar/bindings/lyricsflip-escrow
```

Keep generated files reviewed in PRs so API drift is visible.
