#![no_std]

//! Escrow contract for LyricsFlip wagered matches.
//!
//! One "pot" exists per game session. Both players stake an equal amount into
//! the contract, and a single authorised `resolver` account — held by the
//! LyricsFlip backend — later releases the pot to the winner or refunds it.
//!
//! The contract deliberately does *not* let the resolver move funds anywhere
//! else: `resolve` can only pay a player of that pot, and `refund` can only
//! return each stake to the player who made it. That bounds what a compromised
//! backend key can do to picking the wrong winner, rather than draining escrow.
//!
//! ## Platform fee
//!
//! `resolve` takes a basis-point platform fee out of the pot before paying the
//! winner: `fee = payout * fee_bps / 10_000`, sent to `fee_receiver`, with the
//! remainder paid to the winner. The fee is capped at `MAX_FEE_BPS` (10%) and
//! is set by the admin via `set_fee`. Refunds and draws never take a fee.
//!
//! ## Events
//!
//! Every state-changing call publishes an event so indexers, explorers and
//! the backend can follow pot activity without polling `get_pot`:
//!
//! | Function       | Topics                       | Data                              |
//! |----------------|-------------------------------|------------------------------------|
//! | `open_pot`     | `("open", session_id)`        | `(player_a, player_b, stake)`      |
//! | `stake`        | `("stake", session_id)`       | `(player, is_player_a)`            |
//! | `resolve`      | `("resolve", session_id)`     | `(winner, payout)`                 |
//! | `resolve`      | `("fee", session_id)`         | `(receiver, fee)`                  |
//! | `refund`       | `("refund", session_id)`      | `(player_a, player_b)`             |
//! | `set_resolver` | `("resolver", ())`            | `(old_resolver, new_resolver)`     |
//! | `set_fee`      | `("fee", ())`                 | `(fee_bps, receiver)`              |
//! | `claim_refund` | `("claim", session_id)`       | `(player, amount)`                 |
//! | `set_admin`    | `("admin", ())`               | `(old_admin, new_admin)`           |
//! | `upgrade`      | `("upgrade", ())`             | `new_wasm_hash`                    |
//!
//! ## Admin rotation and upgrades
//!
//! The admin can rotate itself via `set_admin`, and can upgrade the
//! contract's WASM in place via `upgrade` (using
//! `env.deployer().update_current_contract_wasm`), so fixing a bug no
//! longer requires a redeploy to a new contract ID that strands in-flight
//! pots. Storage carries a version key, bumped by the `migrate` hook, which
//! an operator calls after `upgrade` to run any storage transformation the
//! new WASM needs — see the deploy/upgrade procedure below.
//!
//! ### Upgrade procedure
//!
//! 1. `stellar contract build` the new WASM and `stellar contract upload`
//!    it to get its hash.
//! 2. Call `upgrade(new_wasm_hash)`, authorised by the admin.
//! 3. Call `migrate()`, authorised by the admin, so any storage
//!    transformation the new version needs runs exactly once.
//! 4. Confirm `get_version` reports `CURRENT_VERSION` and `get_pot` still
//!    reads existing pots correctly.
//!
//! ## Reclaiming a stuck stake
//!
//! If the resolver key is lost, or the backend that holds it is shut down,
//! staked funds would otherwise be locked forever — rotating the resolver
//! needs the admin, who may also be unavailable. Every pot therefore carries
//! a `deadline_ledger`, set by `open_pot` to `CLAIM_WINDOW_LEDGERS` ledgers in
//! the future. Once that deadline has passed, each player may call
//! `claim_refund` themselves to recover their own stake, with no resolver or
//! admin involved. `resolve` remains available up until a player claims;
//! once any player has claimed, `resolve` is permanently blocked for that
//! pot, since it no longer holds both stakes.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, BytesN,
    Env,
};

/// Ledgers per day at ~5s per ledger.
const DAY_IN_LEDGERS: u32 = 17_280;
/// Expected maximum match length plus a generous margin: 30 days.
pub const TTL_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
/// Refresh whenever remaining life drops below this: 15 days.
pub const TTL_THRESHOLD: u32 = TTL_EXTEND_TO / 2;
/// The current storage layout version. Bumped whenever `migrate` needs to
/// transform existing storage after an `upgrade`.
pub const CURRENT_VERSION: u32 = 2;

/// The maximum platform fee, in basis points (1000 = 10%).
pub const MAX_FEE_BPS: u32 = 1_000;
/// Basis-point denominator: 10_000 bps = 100%.
const BPS_DENOMINATOR: u32 = 10_000;

/// A game session ID: the 16 bytes of the backend's session UUID.
pub type SessionId = BytesN<16>;

/// How many ledgers after `open_pot` a pot's claim deadline falls. Roughly a
/// week, assuming a five second average ledger close time. After this many
/// ledgers have passed, players may reclaim their own stake themselves via
/// `claim_refund`, even if the resolver never calls `resolve` or `refund`.
pub const CLAIM_WINDOW_LEDGERS: u32 = 120_960;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Contract-wide configuration, written once at initialisation.
    Config,
    /// The pot for one game session.
    Pot(SessionId),
    /// The storage layout version, checked and updated by `migrate`.
    Version,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PotStatus {
    /// Created, awaiting stakes from one or both players.
    Open,
    /// Both players have staked; the pot is ready to be resolved.
    Funded,
    /// Paid out to the winner.
    Resolved,
    /// Returned to whichever players had staked.
    Refunded,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    /// May rotate the resolver. Intended to be a multisig or DAO account.
    pub admin: Address,
    /// The token players stake — a Soroban token or a classic asset's SAC.
    pub token: Address,
    /// The only address allowed to open, resolve or refund pots.
    pub resolver: Address,
    /// Platform fee taken from the pot on `resolve`, in basis points.
    pub fee_bps: u32,
    /// Where the platform fee is sent. Required whenever `fee_bps` is non-zero.
    pub fee_receiver: Option<Address>,
}

#[contracttype]
#[derive(Clone)]
pub struct Pot {
    pub player_a: Address,
    pub player_b: Address,
    /// Amount each player stakes, in token base units.
    pub stake: i128,
    pub funded_a: bool,
    pub funded_b: bool,
    pub status: PotStatus,
    /// The ledger sequence after which either player may reclaim their own
    /// stake themselves via `claim_refund`, regardless of the resolver.
    pub deadline_ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    PotAlreadyExists = 3,
    PotNotFound = 4,
    PotNotOpen = 5,
    PotNotFunded = 6,
    AlreadyStaked = 7,
    NotAPlayer = 8,
    InvalidStake = 9,
    SamePlayer = 10,
    /// `claim_refund` was called before the pot's claim deadline.
    DeadlineNotReached = 11,
    /// The calling player has no stake left in the pot to reclaim — either
    /// they never staked, or they already claimed it back.
    NothingToClaim = 12,
    /// `set_fee` was called with a fee above `MAX_FEE_BPS`.
    FeeTooHigh = 13,
    /// `set_fee` was called with a non-zero fee but no receiver.
    FeeReceiverRequired = 14,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Sets the admin, the staking token and the resolver.
    ///
    /// This runs atomically as part of deployment (`stellar contract
    /// deploy --wasm ... -- --admin ... --token ... --resolver ...`), so
    /// there is no window between deploy and initialization for an attacker
    /// to front-run: the contract is never live with unset, or someone
    /// else's, configuration. There is deliberately no separate
    /// `initialize` entry point.
    pub fn __constructor(env: Env, admin: Address, token: Address, resolver: Address) {
        let config = Config {
            admin,
            token,
            resolver,
            fee_bps: 0,
            fee_receiver: None,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage()
            .instance()
            .set(&DataKey::Version, &CURRENT_VERSION);
    }

    /// Rotates the admin. Only the current admin may call this.
    pub fn set_admin(env: Env, new_admin: Address) {
        let mut config = Self::load_config(&env);
        config.admin.require_auth();
        let old_admin = config.admin.clone();
        config.admin = new_admin.clone();
        Self::save_config(&env, &config);
        env.events().publish(
            (symbol_short!("admin"),),
            (old_admin, new_admin),
        );
    }

    /// Rotates the resolver. Only the admin may call this.
    pub fn set_resolver(env: Env, new_resolver: Address) {
        let mut config = Self::load_config(&env);
        config.admin.require_auth();
        let old_resolver = config.resolver.clone();
        config.resolver = new_resolver.clone();
        Self::save_config(&env, &config);
        env.events().publish(
            (symbol_short!("resolver"),),
            (old_resolver, new_resolver),
        );
    }

    /// Sets the platform fee (in basis points) and its receiver. Only the
    /// admin may call this. The fee is capped at `MAX_FEE_BPS`, and a
    /// non-zero fee requires a receiver.
    pub fn set_fee(env: Env, fee_bps: u32, fee_receiver: Option<Address>) {
        let mut config = Self::load_config(&env);
        config.admin.require_auth();
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, Error::FeeTooHigh);
        }
        if fee_bps > 0 && fee_receiver.is_none() {
            panic_with_error!(&env, Error::FeeReceiverRequired);
        }
        config.fee_bps = fee_bps;
        config.fee_receiver = fee_receiver.clone();
        Self::save_config(&env, &config);
        env.events()
            .publish((symbol_short!("fee"),), (fee_bps, fee_receiver));
    }

    /// Returns the current contract configuration.
    pub fn get_config(env: Env) -> Config {
        Self::load_config(&env)
    }

    /// Opens a pot for a game session. Only the resolver may call this.
    ///
    /// `stake` is the amount each player will stake, in token base units.
    /// The pot's claim deadline is set to `CLAIM_WINDOW_LEDGERS` ledgers in
    /// the future.
    pub fn open_pot(
        env: Env,
        session_id: SessionId,
        player_a: Address,
        player_b: Address,
        stake: i128,
    ) {
        let config = Self::load_config(&env);
        config.resolver.require_auth();

        if player_a == player_b {
            panic_with_error!(&env, Error::SamePlayer);
        }
        if stake <= 0 {
            panic_with_error!(&env, Error::InvalidStake);
        }

        let key = DataKey::Pot(session_id.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::PotAlreadyExists);
        }

        let pot = Pot {
            player_a: player_a.clone(),
            player_b: player_b.clone(),
            stake,
            funded_a: false,
            funded_b: false,
            status: PotStatus::Open,
            deadline_ledger: env.ledger().sequence() + CLAIM_WINDOW_LEDGERS,
        };
        env.storage().persistent().set(&key, &pot);
        Self::bump_pot_ttl(&env, &key);

        env.events().publish(
            (symbol_short!("open"), session_id),
            (player_a, player_b, stake),
        );
    }

    /// Stakes the caller's share into an open pot. Either player may call
    /// this, and each may only stake once.
    pub fn stake(env: Env, session_id: SessionId, player: Address) {
        player.require_auth();

        let key = DataKey::Pot(session_id.clone());
        let mut pot = Self::load_pot(&env, &key);

        if pot.status != PotStatus::Open {
            panic_with_error!(&env, Error::PotNotOpen);
        }

        let is_player_a = if player == pot.player_a {
            if pot.funded_a {
                panic_with_error!(&env, Error::AlreadyStaked);
            }
            pot.funded_a = true;
            true
        } else if player == pot.player_b {
            if pot.funded_b {
                panic_with_error!(&env, Error::AlreadyStaked);
            }
            pot.funded_b = true;
            false
        } else {
            panic_with_error!(&env, Error::NotAPlayer);
        };

        let config = Self::load_config(&env);
        let token_client = token::Client::new(&env, &config.token);
        token_client.transfer(&player, &env.current_contract_address(), &pot.stake);

        if pot.funded_a && pot.funded_b {
            pot.status = PotStatus::Funded;
        }
        env.storage().persistent().set(&key, &pot);
        Self::bump_pot_ttl(&env, &key);

        env.events().publish(
            (symbol_short!("stake"), session_id),
            (player, is_player_a),
        );
    }

    /// Returns the pot for a session, if it exists.
    pub fn get_pot(env: Env, session_id: SessionId) -> Pot {
        Self::load_pot(&env, &DataKey::Pot(session_id))
    }

    /// Resolves a funded pot, paying the winner (minus the platform fee).
    /// Only the resolver may call this. Blocked once a player has claimed.
    pub fn resolve(env: Env, session_id: SessionId, winner: Address) {
        let config = Self::load_config(&env);
        config.resolver.require_auth();

        let key = DataKey::Pot(session_id.clone());
        let mut pot = Self::load_pot(&env, &key);

        if pot.status != PotStatus::Funded {
            panic_with_error!(&env, Error::PotNotFunded);
        }
        if winner != pot.player_a && winner != pot.player_b {
            panic_with_error!(&env, Error::NotAPlayer);
        }

        let total = pot.stake * 2;
        let fee = if config.fee_bps > 0 {
            (total * (config.fee_bps as i128)) / (BPS_DENOMINATOR as i128)
        } else {
            0
        };
        let payout = total - fee;

        let token_client = token::Client::new(&env, &config.token);
        if fee > 0 {
            if let Some(receiver) = config.fee_receiver.clone() {
                token_client.transfer(&env.current_contract_address(), &receiver, &fee);
                env.events()
                    .publish((symbol_short!("fee"), session_id.clone()), (receiver, fee));
            }
        }
        token_client.transfer(&env.current_contract_address(), &winner, &payout);

        pot.status = PotStatus::Resolved;
        env.storage().persistent().set(&key, &pot);
        Self::bump_pot_ttl(&env, &key);

        env.events().publish(
            (symbol_short!("resolve"), session_id),
            (winner, payout),
        );
    }

    /// Refunds a pot to whichever players had staked. Only the resolver may
    /// call this. No fee is taken. Blocked once a player has claimed.
    pub fn refund(env: Env, session_id: SessionId) {
        let config = Self::load_config(&env);
        config.resolver.require_auth();

        let key = DataKey::Pot(session_id.clone());
        let mut pot = Self::load_pot(&env, &key);

        if pot.status != PotStatus::Open && pot.status != PotStatus::Funded {
            panic_with_error!(&env, Error::PotNotOpen);
        }

        let token_client = token::Client::new(&env, &config.token);
        if pot.funded_a {
            token_client.transfer(&env.current_contract_address(), &pot.player_a, &pot.stake);
        }
        if pot.funded_b {
            token_client.transfer(&env.current_contract_address(), &pot.player_b, &pot.stake);
        }

        pot.status = PotStatus::Refunded;
        env.storage().persistent().set(&key, &pot);
        Self::bump_pot_ttl(&env, &key);

        env.events().publish(
            (symbol_short!("refund"), session_id),
            (pot.player_a, pot.player_b),
        );
    }

    /// Lets a player reclaim their own stake after the pot's claim deadline.
    /// No resolver or admin is involved. Once any player claims, the pot is
    /// marked `Refunded` so `resolve` and `refund` are permanently blocked.
    pub fn claim_refund(env: Env, session_id: SessionId, player: Address) {
        player.require_auth();

        let key = DataKey::Pot(session_id.clone());
        let mut pot = Self::load_pot(&env, &key);

        if pot.status != PotStatus::Open && pot.status != PotStatus::Funded {
            panic_with_error!(&env, Error::PotNotOpen);
        }
        if env.ledger().sequence() < pot.deadline_ledger {
            panic_with_error!(&env, Error::DeadlineNotReached);
        }

        let is_player_a = if player == pot.player_a {
            if !pot.funded_a {
                panic_with_error!(&env, Error::NothingToClaim);
            }
            pot.funded_a = false;
            true
        } else if player == pot.player_b {
            if !pot.funded_b {
                panic_with_error!(&env, Error::NothingToClaim);
            }
            pot.funded_b = false;
            false
        } else {
            panic_with_error!(&env, Error::NotAPlayer);
        };

        let config = Self::load_config(&env);
        let token_client = token::Client::new(&env, &config.token);
        token_client.transfer(&env.current_contract_address(), &player, &pot.stake);

        // Once any player has claimed, the pot no longer holds both stakes, so
        // mark it Refunded to permanently block `resolve` and `refund`.
        pot.status = PotStatus::Refunded;
        env.storage().persistent().set(&key, &pot);
        Self::bump_pot_ttl(&env, &key);

        let _ = is_player_a;
        env.events().publish(
            (symbol_short!("claim"), session_id),
            (player, pot.stake),
        );
    }

    /// Upgrades the contract's WASM in place. Only the admin may call this.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let config = Self::load_config(&env);
        config.admin.require_auth();
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        env.events()
            .publish((symbol_short!("upgrade"),), new_wasm_hash);
    }

    /// Runs any storage transformation the current WASM needs after an
    /// `upgrade`. Only the admin may call this. Idempotent.
    pub fn migrate(env: Env) {
        let config = Self::load_config(&env);
        config.admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Version, &CURRENT_VERSION);
    }

    /// Returns the current storage layout version.
    pub fn get_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Version)
            .unwrap_or(0)
    }

    fn load_config(env: &Env) -> Config {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    fn save_config(env: &Env, config: &Config) {
        env.storage().instance().set(&DataKey::Config, config);
    }

    fn load_pot(env: &Env, key: &DataKey) -> Pot {
        env.storage()
            .persistent()
            .get(key)
            .unwrap_or_else(|| panic_with_error!(env, Error::PotNotFound))
    }

    fn bump_pot_ttl(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

#[cfg(test)]
mod test;
