#[test_only]
module lock_contract::lock_tests;

use sui::test_scenario as ts;
use sui::test_utils::assert_eq;
use sui::clock::{
    Clock,
    create_for_testing, share_for_testing,
    increment_for_testing
};
use sui::coin::{Self, Coin};
use lock_contract::lock::{
    Locker, lend, withdraw_loan, get_locker_info,
    EInvalidDuration, EUnauthorized, ETooEarly
};

const CREATOR: address = @0xA;
const CALLER: address = @0xB;

const MS_PER_MINUTE: u64 = 60000;

#[test]
fun test_lend_creates_locker_and_event() {
    let mut scenario = ts::begin(CREATOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, CREATOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(100, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        lend<u64>(coin, 2, &clock, scenario.ctx()); // loan duration = 2 minutes
        share_for_testing(clock);
    };

    let effects = ts::next_tx(&mut scenario, CREATOR);
    assert_eq(effects.num_user_events(), 1); // Expect exactly one LoanCreated event
    scenario.end();
}

#[test]
fun test_withdraw_after_duration() {
    let mut scenario = ts::begin(CREATOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, CREATOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(50, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        lend<u64>(coin, 1, &clock, scenario.ctx()); // 1 minute lock
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, CREATOR);

    {
        let mut clock = ts::take_shared<Clock>(&scenario);
        increment_for_testing(&mut clock, MS_PER_MINUTE); // Simulate passage of 1 minute
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, CREATOR);

    {
        let locker: Locker<u64> = ts::take_from_address<Locker<u64>>(&scenario, CREATOR);
        let clock = ts::take_shared<Clock>(&scenario);
        withdraw_loan<u64>(locker, &clock, scenario.ctx()); // Should succeed after duration
        ts::return_shared<Clock>(clock);
    };

    let effects = ts::next_tx(&mut scenario, CREATOR);
    assert_eq(effects.num_user_events(), 1); // Expect LoanWithdrawn event
    scenario.end();
}

#[test]
fun test_get_locker_info_returns_correct_data() {
    let mut scenario = ts::begin(CREATOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, CREATOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(42, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        lend<u64>(coin, 5, &clock, scenario.ctx()); // duration = 5 minutes
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, CREATOR);

    {
        let locker: Locker<u64> = ts::take_from_address<Locker<u64>>(&scenario, CREATOR);

        // Validate that get_locker_info returns expected tuple structure and values
        let (_lender, _balance, _start_time, _duration): (address, u64, u64, u64)
            = get_locker_info<u64>(&locker);

        ts::return_to_address<Locker<u64>>(CREATOR, locker);
    };

    scenario.end();
}

#[test, expected_failure(abort_code = EInvalidDuration)]
fun test_lend_fails_zero_duration() {
    let mut scenario = ts::begin(CREATOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };
    ts::next_tx(&mut scenario, CREATOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(10, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        lend<u64>(coin, 0, &clock, scenario.ctx()); // invalid: 0 mins
        ts::return_shared<Clock>(clock);
    };

    scenario.end();
}

#[test, expected_failure(abort_code = ETooEarly)]
fun test_withdraw_fails_if_too_early() {
    let mut scenario = ts::begin(CREATOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, CREATOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(25, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        lend<u64>(coin, 3, &clock, scenario.ctx()); // 3 minutes lock
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, CREATOR);

    {
        let locker: Locker<u64> = ts::take_from_address<Locker<u64>>(&scenario, CREATOR);
        let clock = ts::take_shared<Clock>(&scenario);
        withdraw_loan<u64>(locker, &clock, scenario.ctx()); // too early to withdraw
        ts::return_shared<Clock>(clock);
    };

    scenario.end();
}

#[test, expected_failure(abort_code = EUnauthorized)]
fun test_withdraw_fails_if_not_lender() {
    let mut scenario = ts::begin(CREATOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, CREATOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(70, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        lend<u64>(coin, 1, &clock, scenario.ctx()); // lender = CREATOR
        share_for_testing(clock);
    };
    
    ts::next_tx(&mut scenario, CREATOR);

    {
        let mut clock = ts::take_shared<Clock>(&scenario);
        increment_for_testing(&mut clock, MS_PER_MINUTE); // enough time passed
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, CALLER); // Different account attempts withdrawal

    {
        let locker: Locker<u64> = ts::take_from_address<Locker<u64>>(&scenario, CREATOR);
        let clock = ts::take_shared<Clock>(&scenario);
        withdraw_loan<u64>(locker, &clock, scenario.ctx()); // should fail: caller not lender
        ts::return_shared<Clock>(clock);
    };

    scenario.end();
}
