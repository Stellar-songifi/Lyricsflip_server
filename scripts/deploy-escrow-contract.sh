#!/usr/bin/env bash
set -euo pipefail

NETWORK="${SOROBAN_NETWORK:-testnet}"
CONTRACT_DIR="${CONTRACT_DIR:-contracts/lyricsflip-escrow}"

cargo build --manifest-path "$CONTRACT_DIR/Cargo.toml" --target wasm32-unknown-unknown --release
soroban contract deploy \
  --network "$NETWORK" \
  --wasm "$CONTRACT_DIR/target/wasm32-unknown-unknown/release/lyricsflip_escrow.wasm"
