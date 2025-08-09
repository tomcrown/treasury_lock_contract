module lock_contract::lock;


use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::clock::{timestamp_ms, Clock};
use sui::event;


// Error codes
const EInvalidDuration: u64 = 0; // Duration cannot be zero
const EUnauthorized: u64 = 1;    // Sender is not the original lender
const ETooEarly: u64 = 2;        // Withdrawal attempted before unlock time


// Conversion constant: milliseconds per minute
const MS_PER_MINUTE: u64 = 60000;


// Stores locked tokens with time-based access control
public struct Locker<phantom CoinType> has key, store {
    id: UID,
    balance: Balance<CoinType>,
    lender: address,
    start_time: u64,
    duration: u64
}


// Event emitted when a loan (lock) is created
public struct LoanCreated<phantom CoinType> has copy, drop, store {
    lender: address,
    amount: u64,
    start_time: u64,
    duration: u64
}


// Event emitted when locked tokens are withdrawn
public struct LoanWithdrawn<phantom CoinType> has copy, drop, store {
    lender: address,
    withdraw_time: u64,
    amount_withdrawn: u64,
}


/// Locks tokens for a specified duration (in minutes).
/// Creates a `Locker` object holding the balance and associated metadata.
#[allow(lint(self_transfer))]
public entry fun lend<CoinType>(
    coin: Coin<CoinType>,
    duration_minutes: u64,
    clock: &Clock,
    ctx: &mut TxContext
) {
    assert!(duration_minutes > 0, EInvalidDuration);

    let duration_ms = duration_minutes * MS_PER_MINUTE;
    let now = clock.timestamp_ms();
    let lender = tx_context::sender(ctx);
    let balance = coin::into_balance(coin);
    let amount = balance.value();

    let locker = Locker {
        id: object::new(ctx),
        balance,
        lender,
        start_time: now,
        duration: duration_ms,
    };

    // Transfer the Locker object back to the lender
    transfer::public_transfer(locker, lender);

    // Emit creation event for tracking
    event::emit(LoanCreated<CoinType> {
        lender,
        amount,
        start_time: now,
        duration: duration_minutes,
    });
}


/// Withdraws locked tokens after the lock period ends.
/// Destroys the Locker object after returning funds to the lender.
#[lint_allow(self_transfer)]
public entry fun withdraw_loan<CoinType>(
    locker: Locker<CoinType>,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let now = clock.timestamp_ms();
    let unlock_time = locker.start_time + locker.duration;
    let sender = tx_context::sender(ctx);

    assert!(sender == locker.lender, EUnauthorized);
    assert!(now >= unlock_time, ETooEarly);

    let Locker { id, mut balance, lender: _, start_time: _, duration: _ } = locker;

    let amount = balance.value();
    let coin = coin::take(&mut balance, amount, ctx);

    transfer::public_transfer(coin, sender);

    // Emit withdrawal event
    event::emit(LoanWithdrawn<CoinType> {
        lender: sender,
        withdraw_time: now,
        amount_withdrawn: amount
    });

    balance::destroy_zero(balance);
    object::delete(id);
}


/// Returns Locker metadata: (lender, amount, start_time, duration)
public entry fun get_locker_info<CoinType>(
    locker: &Locker<CoinType>
): (address, u64, u64, u64) {
    (
        locker.lender,
        locker.balance.value(),
        locker.start_time,
        locker.duration
    )
}
