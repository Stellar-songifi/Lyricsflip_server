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

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env,
};

/// Ledgers per day at ~5s per ledger.
const DAY_IN_LEDGERS: u32 = 17_280;
/// Expected maximum match length plus a generous margin: 30 days.
pub const TTL_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
/// Refresh whenever remaining life drops below this: 15 days.
pub const TTL_THRESHOLD: u32 = TTL_EXTEND_TO / 2;

/// A game session ID: the 16 bytes of the backend's session UUID.
pub type SessionId = BytesN<16>;

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
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Sets the admin, the staking token and the resolver. Callable once.
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        resolver: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();
        Self::extend_instance(&env);

        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                token,
                resolver,
            },
        );

        Ok(())
    }

    /// Rotates the resolver key. Only the admin may call this, which is what
    /// makes a leaked backend key recoverable without redeploying.
    pub fn set_resolver(env: Env, new_resolver: Address) -> Result<(), Error> {
        let mut config = Self::config(&env)?;
        config.admin.require_auth();
        config.resolver = new_resolver;
        env.storage().instance().set(&DataKey::Config, &config);
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

        Self::save_pot(
            &env,
            &session_id,
            &Pot {
                player_a,
                player_b,
                stake,
                funded_a: false,
                funded_b: false,
                status: PotStatus::Open,
            },
        );

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

        Self::save_pot(&env, &session_id, &pot);

        Ok(())
    }

    /// Pays the whole pot to the winner. The winner must be one of the two
    /// players, so the resolver cannot redirect funds to an arbitrary address.
    pub fn resolve(env: Env, session_id: SessionId, winner: Address) -> Result<i128, Error> {
        let config = Self::config(&env)?;
        config.resolver.require_auth();

        let mut pot = Self::pot(&env, &session_id)?;

        if pot.status != PotStatus::Funded {
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
        Self::save_pot(&env, &session_id, &pot);

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
        Self::save_pot(&env, &session_id, &pot);

        Ok(())
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

    /// Every entry point loads the config, so this keeps the instance alive.
    fn config(env: &Env) -> Result<Config, Error> {
        Self::extend_instance(env);
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    fn pot(env: &Env, session_id: &SessionId) -> Result<Pot, Error> {
        let key = DataKey::Pot(session_id.clone());
        let pot: Pot = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PotNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(pot)
    }

    fn save_pot(env: &Env, session_id: &SessionId, pot: &Pot) {
        let key = DataKey::Pot(session_id.clone());
        env.storage().persistent().set(&key, pot);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn extend_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

mod test;
