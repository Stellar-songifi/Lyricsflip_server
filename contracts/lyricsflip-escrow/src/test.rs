#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _},
    token, Address, Env, IntoVal,
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
fn open_pot_emits_an_open_event() {
    let s = setup(1_000);
    let id = session(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);

    let events = s.env.events().all();
    let (contract_id, topics, _data) = events.last().unwrap();
    assert_eq!(contract_id, &s.contract_id);
    assert_eq!(
        topics.get_unchecked(0),
        soroban_sdk::symbol_short!("open").into_val(&s.env)
    );
}

#[test]
fn full_pot_lifecycle_emits_the_documented_events() {
    let s = setup(1_000);
    let id = session(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);
    s.client.stake(&id, &s.player_a);
    s.client.stake(&id, &s.player_b);
    s.client.resolve(&id, &s.player_a);

    let events = s.env.events().all();
    let topic_names: std::vec::Vec<_> = events
        .iter()
        .map(|(_, topics, _)| topics.get_unchecked(0))
        .collect();

    assert!(topic_names.contains(&soroban_sdk::symbol_short!("open").into_val(&s.env)));
    assert!(topic_names.contains(&soroban_sdk::symbol_short!("stake").into_val(&s.env)));
    assert!(topic_names.contains(&soroban_sdk::symbol_short!("resolve").into_val(&s.env)));
}

#[test]
fn refund_emits_a_refund_event() {
    let s = setup(1_000);
    let id = session(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);
    s.client.stake(&id, &s.player_a);
    s.client.refund(&id);

    let events = s.env.events().all();
    let (_, topics, _) = events.last().unwrap();
    assert_eq!(
        topics.get_unchecked(0),
        soroban_sdk::symbol_short!("refund").into_val(&s.env)
    );
}

fn pass_the_claim_deadline(s: &Setup) {
    s.env.ledger().with_mut(|li| {
        li.sequence_number += CLAIM_WINDOW_LEDGERS + 1;
    });
}

#[test]
fn claim_before_the_deadline_fails() {
    let s = setup(1_000);
    let id = session(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);
    s.client.stake(&id, &s.player_a);

    assert_eq!(
        s.client.try_claim_refund(&id, &s.player_a),
        Err(Ok(Error::DeadlineNotReached))
    );
}

#[test]
fn each_player_can_claim_their_own_stake_after_the_deadline() {
    let s = setup(1_000);
    let id = session(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);
    s.client.stake(&id, &s.player_a);
    s.client.stake(&id, &s.player_b);

    pass_the_claim_deadline(&s);

    let amount_a = s.client.claim_refund(&id, &s.player_a);
    assert_eq!(amount_a, 100);
    assert_eq!(s.token.balance(&s.player_a), 1_000);

    let amount_b = s.client.claim_refund(&id, &s.player_b);
    assert_eq!(amount_b, 100);
    assert_eq!(s.token.balance(&s.player_b), 1_000);

    assert_eq!(s.client.get_pot(&id).status, PotStatus::Refunded);
}

#[test]
fn a_player_cannot_claim_another_players_stake() {
    let s = setup(1_000);
    let id = session(&s.env);
    let stranger = Address::generate(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);
    s.client.stake(&id, &s.player_a);

    pass_the_claim_deadline(&s);

    assert_eq!(
        s.client.try_claim_refund(&id, &stranger),
        Err(Ok(Error::NotAPlayer))
    );
}

#[test]
fn a_player_cannot_claim_twice() {
    let s = setup(1_000);
    let id = session(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);
    s.client.stake(&id, &s.player_a);

    pass_the_claim_deadline(&s);

    s.client.claim_refund(&id, &s.player_a);

    assert_eq!(
        s.client.try_claim_refund(&id, &s.player_a),
        Err(Ok(Error::NothingToClaim))
    );
}

#[test]
fn resolve_is_blocked_once_a_player_has_claimed() {
    let s = setup(1_000);
    let id = session(&s.env);

    s.client.open_pot(&id, &s.player_a, &s.player_b, &100);
    s.client.stake(&id, &s.player_a);
    s.client.stake(&id, &s.player_b);

    pass_the_claim_deadline(&s);

    s.client.claim_refund(&id, &s.player_a);

    assert_eq!(
        s.client.try_resolve(&id, &s.player_b),
        Err(Ok(Error::PotNotFunded))
    );
}

#[test]
fn set_resolver_emits_a_resolver_event() {
    let s = setup(1_000);
    let new_resolver = Address::generate(&s.env);

    s.client.set_resolver(&new_resolver);

    let events = s.env.events().all();
    let (_, topics, _) = events.last().unwrap();
    assert_eq!(
        topics.get_unchecked(0),
        soroban_sdk::symbol_short!("resolver").into_val(&s.env)
    );
}
