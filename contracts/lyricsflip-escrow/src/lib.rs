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
//! | `refund`       | `("refund", session_id)`      | `(player_a, player_b)`             |
//! | `set_resolver` | `("resolver", ())`            | `(old_resolver, new_resolver)`     |
//! | `claim_refund` | `("claim", session_id)`       | `(player, amount)`                 |
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
    /// else's, configuration. There is deliberately no separate `initialize`
    /// entrypoint any more, so this can never be called a second time.
    pub fn __constructor(env: Env, admin: Address, token: Address, resolver: Address) {
        admin.require_auth();

        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                token,
                resolver,
            },
        );
    }

    /// Rotates the resolver key. Only the admin may call this, which is what
    /// makes a leaked backend key recoverable without redeploying.
    pub fn set_resolver(env: Env, new_resolver: Address) -> Result<(), Error> {
        let mut config = Self::config(&env)?;
        config.admin.require_auth();
        let old_resolver = config.resolver.clone();
        config.resolver = new_resolver.clone();
        env.storage().instance().set(&DataKey::Config, &config);

        env.events()
            .publish((symbol_short!("resolver"), ()), (old_resolver, new_resolver));

        Ok(())
    }

    /// Creates the pot for a session. Called by the resolver when a wagered
    /// match is set up, before either player has staked.
    pub fn open_pot(
        env: Env,
        session_id: SessionId,
        player_a: Address,
        player_b: Address,
        stake: i128,
    ) -> Result<(), Error> {
        let config = Self::config(&env)?;
        config.resolver.require_auth();

        if stake <= 0 {
            return Err(Error::InvalidStake);
        }

        if player_a == player_b {
            return Err(Error::SamePlayer);
        }

        if env.storage().persistent().has(&DataKey::Pot(session_id.clone())) {
            return Err(Error::PotAlreadyExists);
        }

        let deadline_ledger = env.ledger().sequence() + CLAIM_WINDOW_LEDGERS;

        env.storage().persistent().set(
            &DataKey::Pot(session_id.clone()),
            &Pot {
                player_a: player_a.clone(),
                player_b: player_b.clone(),
                stake,
                funded_a: false,
                funded_b: false,
                status: PotStatus::Open,
                deadline_ledger,
            },
        );

        env.events()
            .publish((symbol_short!("open"), session_id), (player_a, player_b, stake));

        Ok(())
    }

    /// Moves one player's stake into the contract.
    ///
    /// The player authorises this call themselves, so the resolver can never
    /// stake on a player's behalf without their signature.
    pub fn stake(env: Env, session_id: SessionId, player: Address) -> Result<(), Error> {
        player.require_auth();

        let config = Self::config(&env)?;
        let mut pot = Self::pot(&env, &session_id)?;

        if pot.status != PotStatus::Open {
            return Err(Error::PotNotOpen);
        }

        let is_a = player == pot.player_a;
        let is_b = player == pot.player_b;

        if !is_a && !is_b {
            return Err(Error::NotAPlayer);
        }

        if (is_a && pot.funded_a) || (is_b && pot.funded_b) {
            return Err(Error::AlreadyStaked);
        }

        token::Client::new(&env, &config.token).transfer(
            &player,
            &env.current_contract_address(),
            &pot.stake,
        );

        if is_a {
            pot.funded_a = true;
        } else {
            pot.funded_b = true;
        }

        if pot.funded_a && pot.funded_b {
            pot.status = PotStatus::Funded;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Pot(session_id.clone()), &pot);

        env.events()
            .publish((symbol_short!("stake"), session_id), (player, is_a));

        Ok(())
    }

    /// Pays the whole pot to the winner. The winner must be one of the two
    /// players, so the resolver cannot redirect funds to an arbitrary address.
    pub fn resolve(env: Env, session_id: SessionId, winner: Address) -> Result<i128, Error> {
        let config = Self::config(&env)?;
        config.resolver.require_auth();

        let mut pot = Self::pot(&env, &session_id)?;

        // `funded_a`/`funded_b` are also checked (not just `status`) because a
        // player may have already reclaimed their stake via `claim_refund`
        // after the deadline passed, which clears their funded flag but
        // leaves `status` at `Funded` if the other player hasn't claimed.
        if pot.status != PotStatus::Funded || !pot.funded_a || !pot.funded_b {
            return Err(Error::PotNotFunded);
        }

        if winner != pot.player_a && winner != pot.player_b {
            return Err(Error::NotAPlayer);
        }

        let payout = pot.stake * 2;

        token::Client::new(&env, &config.token).transfer(
            &env.current_contract_address(),
            &winner,
            &payout,
        );

        pot.status = PotStatus::Resolved;
        env.storage()
            .persistent()
            .set(&DataKey::Pot(session_id.clone()), &pot);

        env.events()
            .publish((symbol_short!("resolve"), session_id), (winner, payout));

        Ok(payout)
    }

    /// Returns each staked amount to the player who staked it — used for draws
    /// and for abandoned matches. Safe to call on a partially funded pot.
    pub fn refund(env: Env, session_id: SessionId) -> Result<(), Error> {
        let config = Self::config(&env)?;
        config.resolver.require_auth();

        let mut pot = Self::pot(&env, &session_id)?;

        if pot.status == PotStatus::Resolved || pot.status == PotStatus::Refunded {
            return Err(Error::PotNotFunded);
        }

        let token_client = token::Client::new(&env, &config.token);
        let contract = env.current_contract_address();

        if pot.funded_a {
            token_client.transfer(&contract, &pot.player_a, &pot.stake);
            pot.funded_a = false;
        }

        if pot.funded_b {
            token_client.transfer(&contract, &pot.player_b, &pot.stake);
            pot.funded_b = false;
        }

        pot.status = PotStatus::Refunded;
        env.storage()
            .persistent()
            .set(&DataKey::Pot(session_id.clone()), &pot);

        env.events().publish(
            (symbol_short!("refund"), session_id),
            (pot.player_a.clone(), pot.player_b.clone()),
        );

        Ok(())
    }

    /// Lets a player reclaim their own stake once a pot's claim deadline has
    /// passed, without needing the resolver at all. This is the player's
    /// self-service escape hatch if the resolver key is lost or the backend
    /// is shut down — see `CLAIM_WINDOW_LEDGERS`.
    ///
    /// Only the calling player's own stake is ever moved: `claim_refund`
    /// authorises against the `player` argument, and only pays out (and
    /// clears) that player's own `funded_a`/`funded_b` flag. A player can
    /// never claim another player's stake, and cannot claim twice — the
    /// second call fails with `NothingToClaim` because the flag is already
    /// cleared.
    ///
    /// Once any player has claimed, `resolve` can no longer be called on
    /// this pot (see the comment in `resolve`), so the resolver cannot pay
    /// out a pot that no longer holds both stakes.
    pub fn claim_refund(env: Env, session_id: SessionId, player: Address) -> Result<i128, Error> {
        player.require_auth();

        let config = Self::config(&env)?;
        let mut pot = Self::pot(&env, &session_id)?;

        if pot.status == PotStatus::Resolved || pot.status == PotStatus::Refunded {
            return Err(Error::PotNotFunded);
        }

        if env.ledger().sequence() <= pot.deadline_ledger {
            return Err(Error::DeadlineNotReached);
        }

        let is_a = player == pot.player_a;
        let is_b = player == pot.player_b;

        if !is_a && !is_b {
            return Err(Error::NotAPlayer);
        }

        let has_stake = if is_a { pot.funded_a } else { pot.funded_b };
        if !has_stake {
            return Err(Error::NothingToClaim);
        }

        token::Client::new(&env, &config.token).transfer(
            &env.current_contract_address(),
            &player,
            &pot.stake,
        );

        if is_a {
            pot.funded_a = false;
        } else {
            pot.funded_b = false;
        }

        if !pot.funded_a && !pot.funded_b {
            pot.status = PotStatus::Refunded;
        }

        let amount = pot.stake;
        env.storage()
            .persistent()
            .set(&DataKey::Pot(session_id.clone()), &pot);

        env.events()
            .publish((symbol_short!("claim"), session_id), (player, amount));

        Ok(amount)
    }

    /// Reads a pot. Used by the backend to reconcile its database against the
    /// chain after an ambiguous submission.
    pub fn get_pot(env: Env, session_id: SessionId) -> Result<Pot, Error> {
        Self::pot(&env, &session_id)
    }

    /// Reads the contract configuration.
    pub fn get_config(env: Env) -> Result<Config, Error> {
        Self::config(&env)
    }

    fn config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    fn pot(env: &Env, session_id: &SessionId) -> Result<Pot, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Pot(session_id.clone()))
            .ok_or(Error::PotNotFound)
    }
}

mod test;
