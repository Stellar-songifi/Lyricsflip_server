#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _},
    token, Address, Env,
};

struct Setup {
    env: Env,
    contract_id: Address,
    client: EscrowContractClient<'static>,
    token: token::Client<'static>,
    resolver: Address,
    player_a: Address,
    player_b: Address,
}

fn setup(initial_balance: i128) -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let resolver = Address::generate(&env);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_contract.address());
    let token_admin_client =
        token::StellarAssetClient::new(&env, &token_contract.address());

    token_admin_client.mint(&player_a, &initial_balance);
    token_admin_client.mint(&player_b, &initial_balance);

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    client.initialize(&admin, &token_contract.address(), &resolver);

    Setup {
        env,
        contract_id,
        client,
        token,
        resolver,
        player_a,
        player_b,
    }
}

fn session(env: &Env) -> SessionId {
    BytesN::random(env)
}

#[test]
fn winner_takes_the_whole_pot() {
    let s = setup(1_000);
    let id = session(&s.env);

    s.client
        .open_pot(&id, &s.player_a, &s.player_b, &100);
    s.client.stake(&id, &s.player_a);
    s.client.stake(&id, &s.player_b);

    assert_eq!(s.client.get_pot(&id).status, PotStatus::Funded);
    assert_eq!(s.token.balance(&s.contract_id), 200);

    let payout = s.client.resolve(&id, &s.player_a);

    assert_eq!(payout, 200);
    assert_eq!(s.token.balance(&s.player_a), 1_100);
    assert_eq!(s.token.balance(&s.player_b), 900);
    assert_eq!(s.token.balance(&s.contract_id), 0);
    assert_eq!(s.client.get_pot(&id).status, PotStatus::Resolved);
}

#[test]
fn refund_returns_each_stake() {
    let s = setup(1_000);
    let id = session(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);
    s.client.stake(&id, &s.player_a);
    s.client.stake(&id, &s.player_b);

    s.client.refund(&id);

    assert_eq!(s.token.balance(&s.player_a), 1_000);
    assert_eq!(s.token.balance(&s.player_b), 1_000);
    assert_eq!(s.client.get_pot(&id).status, PotStatus::Refunded);
}

#[test]
fn refund_handles_a_pot_only_one_player_funded() {
    let s = setup(1_000);
    let id = session(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);
    s.client.stake(&id, &s.player_a);

    s.client.refund(&id);

    assert_eq!(s.token.balance(&s.player_a), 1_000);
    assert_eq!(s.token.balance(&s.player_b), 1_000);
    assert_eq!(s.token.balance(&s.contract_id), 0);
}

#[test]
fn a_player_cannot_stake_twice() {
    let s = setup(1_000);
    let id = session(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);
    s.client.stake(&id, &s.player_a);

    assert_eq!(
        s.client.try_stake(&id, &s.player_a),
        Err(Ok(Error::AlreadyStaked))
    );
}

#[test]
fn outsiders_cannot_stake() {
    let s = setup(1_000);
    let id = session(&s.env);
    let stranger = Address::generate(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);

    assert_eq!(
        s.client.try_stake(&id, &stranger),
        Err(Ok(Error::NotAPlayer))
    );
}

#[test]
fn the_pot_cannot_be_paid_to_a_non_player() {
    let s = setup(1_000);
    let id = session(&s.env);
    let stranger = Address::generate(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);
    s.client.stake(&id, &s.player_a);
    s.client.stake(&id, &s.player_b);

    assert_eq!(
        s.client.try_resolve(&id, &stranger),
        Err(Ok(Error::NotAPlayer))
    );
}

#[test]
fn an_underfunded_pot_cannot_be_resolved() {
    let s = setup(1_000);
    let id = session(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);
    s.client.stake(&id, &s.player_a);

    assert_eq!(
        s.client.try_resolve(&id, &s.player_a),
        Err(Ok(Error::PotNotFunded))
    );
}

#[test]
fn a_pot_cannot_be_resolved_twice() {
    let s = setup(1_000);
    let id = session(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);
    s.client.stake(&id, &s.player_a);
    s.client.stake(&id, &s.player_b);
    s.client.resolve(&id, &s.player_a);

    assert_eq!(
        s.client.try_resolve(&id, &s.player_a),
        Err(Ok(Error::PotNotFunded))
    );
}

#[test]
fn sessions_cannot_be_reused() {
    let s = setup(1_000);
    let id = session(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);

    assert_eq!(
        s.client
            .try_open_pot(&id, &s.player_a, &s.player_b, &100),
        Err(Ok(Error::PotAlreadyExists))
    );
}

#[test]
fn stakes_must_be_positive() {
    let s = setup(1_000);
    let id = session(&s.env);

    assert_eq!(
        s.client.try_open_pot(&id, &s.player_a, &s.player_b, &0),
        Err(Ok(Error::InvalidStake))
    );
}

#[test]
fn the_admin_can_rotate_the_resolver() {
    let s = setup(1_000);
    let new_resolver = Address::generate(&s.env);

    s.client.set_resolver(&new_resolver);

    assert_eq!(s.client.get_config().resolver, new_resolver);
    assert_ne!(s.client.get_config().resolver, s.resolver);
}

#[test]
fn pot_and_instance_survive_past_default_ttl() {
    use soroban_sdk::testutils::Ledger;
    let s = setup(1_000);
    let session = BytesN::<16>::random(&s.env);
    s.client
        .open_pot(&session, &s.player_a, &s.player_b, &100);

    // Advance beyond the extension window's midpoint, then touch the pot.
    let seq = s.env.ledger().sequence();
    s.env.ledger().set_sequence_number(seq + TTL_THRESHOLD + 1);
    assert_eq!(s.client.get_pot(&session).stake, 100);

    // The read refreshed the TTL, so another jump of the same size is fine.
    let seq = s.env.ledger().sequence();
    s.env.ledger().set_sequence_number(seq + TTL_THRESHOLD + 1);
    assert_eq!(s.client.get_pot(&session).stake, 100);
    s.client.get_config();

    s.env.as_contract(&s.contract_id, || {
        let ttl = s
            .env
            .storage()
            .persistent()
            .get_ttl(&DataKey::Pot(session.clone()));
        assert!(ttl >= TTL_THRESHOLD);
    });
}
