import { Contract } from '@algorandfoundation/tealscript';
// import { ValidatorConfig } from "./validatorRegistry.algo";
import { MAX_ALGO_PER_POOL, MIN_ALGO_STAKE_PER_POOL } from './constants.algo';

const MAX_STAKERS_PER_POOL = 73; // *56 (size of StakeInfo) = 4,088 bytes
const ALGORAND_STAKING_BLOCK_DELAY = 320; // # of blocks until algorand sees online balance changes in staking
const AVG_BLOCK_TIME_SECS = 30; // in tenths - 30 = 3.0

type StakedInfo = {
    Account: Address;
    Balance: uint64;
    TotalRewarded: uint64;
    EntryTime: uint64;
};

// eslint-disable-next-line no-unused-vars
class StakingPool extends Contract {
    programVersion = 9;

    // When created, we track our creating validator contract so that only this contract can call us.  Independent
    // copies of this contract could be created but only the 'official' validator contract would be considered valid
    // and official.  Calls from these pools back to the validator contract are also validated, ensuring the pool
    // calling the validator is one of the pools it created.
    CreatingValidatorContractAppID = GlobalStateKey<uint64>({ key: 'creatorApp' });

    // The 'id' of the validator our pool belongs to
    ValidatorID = GlobalStateKey<uint64>({ key: 'validatorID' });

    // The pool ID we were assigned by the validator contract - sequential id per validator
    PoolID = GlobalStateKey<uint64>({ key: 'poolID' });

    // Owner of our pool (validator owner)
    Owner = GlobalStateKey<Address>({ key: 'owner' });

    // Manager of our pool (validator manager)
    Manager = GlobalStateKey<Address>({ key: 'manager' });

    NumStakers = GlobalStateKey<uint64>({ key: 'numStakers' });

    TotalAlgoStaked = GlobalStateKey<uint64>({ key: 'staked' });

    MinAllowedStake = GlobalStateKey<uint64>({ key: 'minAllowedStake' });

    MaxStakeAllowed = GlobalStateKey<uint64>({ key: 'maxStake' });

    // Last timestamp of a payout - used to ensure payout call isn't cheated and called prior to agreed upon schedule
    LastPayout = GlobalStateKey<uint64>({ key: 'lastPayout' });

    Stakers = BoxKey<StaticArray<StakedInfo, typeof MAX_STAKERS_PER_POOL>>({ key: 'stakers' });

    /**
     * Initialize the staking pool w/ owner and manager, but can only be created by the validator contract.
     * @param creatingContractID - id of contract that constructed us - the validator application (single global instance)
     * @param validatorID - id of validator we're a staking pool of
     * @param poolID - which pool id are we
     * @param owner - owner of pool
     * @param manager - manager of pool (can issue payouts and online txns)
     * @param minAllowedStake - minimum amount to be in pool, but also minimum amount balance can't go below (without removing all!)
     * @param maxStakeAllowed - maximum algo allowed in this staking pool
     */
    createApplication(
        creatingContractID: uint64,
        validatorID: uint64,
        poolID: uint64,
        owner: Address,
        manager: Address,
        minAllowedStake: uint64,
        maxStakeAllowed: uint64
    ): void {
        if (owner === globals.zeroAddress || manager === globals.zeroAddress) {
            // this is likely initial template setup - everything should basically be zero...
            assert(owner === globals.zeroAddress);
            assert(manager === globals.zeroAddress);
            assert(creatingContractID === 0);
            assert(validatorID === 0);
            assert(poolID === 0);
        } else {
            assert(creatingContractID !== 0);
            assert(validatorID !== 0);
            assert(poolID !== 0);
        }
        assert(minAllowedStake >= MIN_ALGO_STAKE_PER_POOL);
        assert(maxStakeAllowed < MAX_ALGO_PER_POOL); // this should have already been checked by validator but... still
        this.CreatingValidatorContractAppID.value = creatingContractID;
        this.ValidatorID.value = validatorID;
        this.PoolID.value = poolID;
        this.Owner.value = owner;
        this.Manager.value = manager;
        this.NumStakers.value = 0;
        this.TotalAlgoStaked.value = 0;
        this.MinAllowedStake.value = minAllowedStake;
        this.MaxStakeAllowed.value = maxStakeAllowed;
    }

    /**
     * gas is a dummy no-op call that can be used to pool-up resource references and opcode cost
     */
    gas(): void {}

    /**
     * Adds stake to the given account.
     * Can ONLY be called by the validator contract that created us
     * Must receive payment from the validator contract for amount being staked.
     *
     * @param {PayTxn} stakedAmountPayment prior payment coming from validator contract to us on behalf of staker.
     * @param {Address} staker - The account adding new stake
     * @throws {Error} - Throws an error if the staking pool is full.
     * @returns {uint64} new 'entry time' in seconds of stake add.
     */
    addStake(stakedAmountPayment: PayTxn, staker: Address): uint64 {
        if (!this.Stakers.exists) {
            this.Stakers.create();
        }
        // account calling us has to be our creating validator contract
        assert(this.txn.sender === Application.fromID(this.CreatingValidatorContractAppID.value).address);
        assert(staker !== globals.zeroAddress);

        // Now, is the required amount actually being paid to US (this contract account - the staking pool)
        // Sender doesn't matter - but it 'technically' should be coming from the Validator contract address
        verifyPayTxn(stakedAmountPayment, {
            sender: Application.fromID(this.CreatingValidatorContractAppID.value).address,
            receiver: this.app.address,
            amount: stakedAmountPayment.amount,
        });
        assert(
            stakedAmountPayment.amount + this.TotalAlgoStaked.value <= this.MaxStakeAllowed.value,
            'adding this stake amount will exceed the max allowed in this pool'
        );
        // See if the account staking is already in our ledger of Stakers - if so, they're just adding to their stake
        // track first empty slot as we go along as well.
        const entryTime = this.getEntryTime();
        let firstEmpty = 0;

        // firstEmpty should represent 1-based index to first empty slot we find - 0 means none were found
        const stakers = clone(this.Stakers.value);
        for (let i = 0; i < stakers.length; i += 1) {
            if (stakers[i].Account === staker) {
                stakers[i].Balance += stakedAmountPayment.amount;
                stakers[i].EntryTime = entryTime;
                // Update the box w/ the new data
                this.Stakers.value[i] = stakers[i];
                this.TotalAlgoStaked.value += stakedAmountPayment.amount;
                return entryTime;
            }
            if (stakers[i].Account === globals.zeroAddress) {
                firstEmpty = i + 1;
                break;
            }
        }

        if (firstEmpty === 0) {
            // nothing was found - pool is full and this staker can't fit
            throw Error('Staking pool full');
        }
        // This is a new staker to the pool, so first ensure they're adding required minimum, then
        // initialize slot and add to the stakers.
        // our caller will see stakers increase in state and increase in their state as well.
        assert(
            stakedAmountPayment.amount >= this.MinAllowedStake.value,
            'must stake at least the minimum for this pool'
        );

        assert(this.Stakers.value[firstEmpty - 1].Account === globals.zeroAddress);
        this.Stakers.value[firstEmpty - 1] = {
            Account: staker,
            Balance: stakedAmountPayment.amount,
            TotalRewarded: 0,
            EntryTime: entryTime,
        };
        this.NumStakers.value += 1;
        this.TotalAlgoStaked.value += stakedAmountPayment.amount;
        return entryTime;
    }

    /**
     * Removes stake on behalf of a particular staker.  Also notifies the validator contract for this pools
     * validator of the staker / balance changes.
     *
     * @param {Address} staker - The address of the account removing stake.
     * @param {uint64} amountToUnstake - The amount of stake to be removed.
     * @throws {Error} If the account has insufficient balance or if the account is not found.
     */
    removeStake(staker: Address, amountToUnstake: uint64): void {
        // We want to preserve the sanctity that the ONLY account that can call us is the staking account
        // It makes it a bit awkward this way to update the state in the validator, but it's safer
        // account calling us has to be account removing stake
        assert(staker !== globals.zeroAddress);
        assert(this.txn.sender === staker);
        assert(amountToUnstake !== 0);

        const stakers = clone(this.Stakers.value);
        for (let i = 0; i < stakers.length; i += 1) {
            if (stakers[i].Account === staker) {
                if (stakers[i].Balance < amountToUnstake) {
                    throw Error('Insufficient balance');
                }
                stakers[i].Balance -= amountToUnstake;
                this.TotalAlgoStaked.value -= amountToUnstake;

                // don't let them reduce their balance below the MinAllowedStake UNLESS they're removing it all!
                assert(
                    stakers[i].Balance === 0 || stakers[i].Balance >= this.MinAllowedStake.value,
                    'cannot reduce balance below minimum allowed stake unless all is removed'
                );

                // Pay the staker back
                sendPayment({
                    amount: amountToUnstake,
                    receiver: staker,
                    note: 'unstaked',
                });
                let stakerRemoved = false;
                if (stakers[i].Balance === 0) {
                    // Staker has been 'removed' - zero out record
                    this.NumStakers.value -= 1;
                    stakers[i].Account = globals.zeroAddress;
                    stakers[i].TotalRewarded = 0;
                    stakerRemoved = true;
                }
                // Update the box w/ the new staker data
                this.Stakers.value[i] = stakers[i];

                // Call the validator contract and tell it we're removing stake
                // It'll verify we're a valid staking pool id and update it
                // stakeRemoved(poolKey: ValidatorPoolKey, staker: Address, amountRemoved: uint64, stakerRemoved: boolean): void
                // ABI: stakeRemoved((uint64,uint64,uint64),address,uint64,bool)void
                sendMethodCall<[[uint64, uint64, uint64], Address, uint64, boolean], void>({
                    applicationID: Application.fromID(this.CreatingValidatorContractAppID.value),
                    name: 'stakeRemoved',
                    methodArgs: [
                        [this.ValidatorID.value, this.PoolID.value, this.app.id],
                        staker,
                        amountToUnstake,
                        stakerRemoved,
                    ],
                });
                return;
            }
        }
        throw Error('Account not found');
    }

    /**
     * Retrieves the staked information for a given staker.
     *
     * @param {Address} staker - The address of the staker.
     * @returns {StakedInfo} - The staked information for the given staker.
     * @throws {Error} - If the staker's account is not found.
     */
    getStakerInfo(staker: Address): StakedInfo {
        const stakers = clone(this.Stakers.value);
        for (let i = 0; i < stakers.length; i += 1) {
            if (stakers[i].Account === staker) {
                return stakers[i];
            }
        }
        throw Error('Account not found');
    }

    payStakers(): void {
        // we should only be callable by owner or manager of validator.
        assert(this.txn.sender === this.Owner.value || this.txn.sender === this.Manager.value);

        // call the validator contract to get our payout data
        const payoutConfig = sendMethodCall<[uint64], [uint16, uint32, Address, uint8, uint16]>({
            applicationID: Application.fromID(this.CreatingValidatorContractAppID.value),
            name: 'getValidatorConfig',
            methodArgs: [this.ValidatorID.value],
        });
        // first two members of the return value is:
        //  PayoutEveryXDays - Payout frequency - ie: 7, 30, etc.
        //  PercentToValidator- Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005
        const payoutDays = payoutConfig[0] as uint64;
        const pctToValidator = payoutConfig[1] as uint64;
        const validatorCommissionAddress = payoutConfig[2];

        // total reward available is current balance - amount staked (so if 100 was staked but balance is 120 - reward is 20)
        // [not counting MBR which would be included in base balance anyway but - have to be safe...]
        const origBalance = this.app.address.balance;
        let rewardAvailable = origBalance - this.TotalAlgoStaked.value - this.app.address.minBalance;

        // Reward available needs to be high enough to cover our various txns
        assert(
            rewardAvailable > globals.minTxnFee * 2,
            'Reward to payout not high enough to cover txn costs of paying it out'
        );

        // determine the % that goes to validator...
        const validatorPay = wideRatio([rewardAvailable, pctToValidator], [1000000]);
        // and adjust reward for entire pool accordingly
        rewardAvailable -= validatorPay;

        // ---
        // pay the validator their cut...
        sendPayment({
            amount: validatorPay,
            receiver: validatorCommissionAddress,
            note: 'validator reward',
        });

        // Now we "pay" (but really just update their tracked balance) the stakers the remainder based on their % of
        // pool and time in this epoch.

        // Since we're being told to payout - treat this as epoch end
        // We're at epoch 'end' presumably - or close enough
        // but what if we're told to pay really early?  we need to verify that as well.
        const curTime = globals.latestTimestamp;
        // How many seconds in the 'configured' epoch.
        const payoutDaysInSecs = payoutDays * 24 * 60 * 60;
        if (this.LastPayout.exists) {
            const secsSinceLastPayout = curTime - this.LastPayout.value;
            // We've had one payout - so we need to be at least one epoch past the last payout (allowing 10 minutes
            // early to account for script/clock issues)
            assert(
                secsSinceLastPayout >= payoutDaysInSecs - 10 * 60,  /* 10 minutes in seconds 'fudge' allowed */
                "Can't payout earlier than last payout + epoch time"
            );
        }

        /**
         * assume 1 and 2 have equal stake...
         * |------|-------|...
         * 2  1
         *        ^ 1 gets 50% (or 25 of the 50)
         *        at end - we now have 75 'left' - which gets divided across the people at >=100% of epoch time
         *         *        intended result for 100 reward:
         *        if 1 and 2 have equal stake... they're each 50% of the 'pool' - call that PP (pool percent)
         *        Time in the epoch - TIE (100% would mean entire epoch - 50% TIE means entered halfway in)
         *        So, we first pay all partials (<100 TIE)
         *        1 gets 25....  (100 REWARD * 50 PP (.5) * 50 TIE (.5)) or 25.
         *        -- keep total of stake from each of partial - adding into PartialStake value.
         *        --  we then see that 25 got paid out - so 25 excess needs distributed to the 100 TIE stakers on top of their reward.
         *        - reward available is now 75 ALGO to distribute - and PP value is based on percent against new total (TotalStaked-PartialStake)
         *        - so #2's PP is now 100% not 50% because their stake is equal to the new reduced stake amount
         *        so 2 gets 75 (75 REWARD * 100 PP (1) * 100 TIE (1)) or 75
         *        next epoch if nothing else changes - each would get 50% of reward.
         */
        // Iterate all stakers - determine which haven't been for entire epoch - pay them proportionally less for having
        // less time in pool.  We keep track of their stake and then will later reduce the effective 'total staked' amount
        // by that so that the remaining stakers get the remaining reward + excess based on their % of stake against
        // remaining participants.
        let partialStakersTotalStake = 0;
        let i = 0;
        this.Stakers.value.forEach((staker) => {
            if (staker.Account !== globals.zeroAddress) {
                if (staker.EntryTime > curTime) {
                    // due to 'forward dating' entry time this could be possible
                    // in this case it definitely means they get 0...
                    partialStakersTotalStake += staker.Balance;
                } else {
                    // Reward is % of users stake in pool,
                    // but we deduct based on time in pool
                    const timeInPool = curTime - staker.EntryTime;
                    let timePercentage: uint64;
                    // get % of time in pool (in tenths precision - 1000 not 100)
                    if (timeInPool < payoutDaysInSecs) {
                        partialStakersTotalStake += staker.Balance;
                        timePercentage = (timeInPool * 1000) / payoutDaysInSecs;

                        const stakerReward = wideRatio(
                            [staker.Balance, rewardAvailable, timePercentage],
                            [this.TotalAlgoStaked.value / 1000]
                        );
                        // reduce the reward available (that we're accounting for) so that the subsequent
                        // 'full' pays are based on what's left
                        rewardAvailable -= stakerReward;
                        // instead of sending them algo now - just increase their ledger balance, so they can claim
                        // it at any time.
                        staker.Balance += stakerReward;
                        staker.TotalRewarded += stakerReward;

                        // Update the box w/ the new data
                        this.Stakers.value[i] = staker;
                    }
                }
            }
            i += 1;
        });

        // Reduce the virtual 'total staked in pool' amount based on removing the totals of the stakers we just paid
        // partial amounts.  This is so that all that remains is the stake of the 100% 'time in epoch' people.
        const newPoolTotalStake = this.TotalAlgoStaked.value - partialStakersTotalStake;
        // Now go back through the list AGAIN and pay out the full-timers their rewards + excess
        i = 0;
        this.Stakers.value.forEach((staker) => {
            if (staker.Account !== globals.zeroAddress && staker.EntryTime < curTime) {
                const timeInPool = curTime - staker.EntryTime;
                // We're now only paying out people who've been in pool an entire epoch.
                if (timeInPool < payoutDaysInSecs) {
                    return;
                }
                // we're in for 100%, so it's just % of stakers balance vs 'new total' for their
                // payment
                const stakerReward = wideRatio([staker.Balance, rewardAvailable], [newPoolTotalStake]);
                // instead of sending them algo now - just increase their ledger balance, so they can claim
                // it at any time.
                staker.Balance += stakerReward;
                staker.TotalRewarded += stakerReward;

                // Update the box w/ the new data
                this.Stakers.value[i] = staker;
            }
            i += 1;
        });

        // We've paid out the validator and updated the stakers new balances to reflect the rewards, now update
        // our 'total staked' value as well (in our pool and in the validator)
        const increasedStake = this.app.address.balance - this.TotalAlgoStaked.value - this.app.address.minBalance;
        this.TotalAlgoStaked.value += increasedStake;

        // Call the validator contract and tell it we've got new stake added
        // It'll verify we're a valid staking pool id and update it
        // stakeUpdatedViaRewards((uint64,uint64),uint64)void
        sendMethodCall<[[uint64, uint64, uint64], uint64], void>({
            applicationID: Application.fromID(this.CreatingValidatorContractAppID.value),
            name: 'stakeUpdatedViaRewards',
            methodArgs: [[this.ValidatorID.value, this.PoolID.value, this.app.id], increasedStake],
        });
        this.LastPayout.value = curTime;
    }

    goOnline(
        votePK: bytes,
        selectionPK: bytes,
        stateProofPK: bytes,
        voteFirst: uint64,
        voteLast: uint64,
        voteKeyDilution: uint64
    ): void {
        assert(this.txn.sender === this.Owner.value || this.txn.sender === this.Manager.value);
        sendOnlineKeyRegistration({
            votePK: votePK,
            selectionPK: selectionPK,
            stateProofPK: stateProofPK,
            voteFirst: voteFirst,
            voteLast: voteLast,
            voteKeyDilution: voteKeyDilution,
        });
    }

    goOffline(): void {
        assert(this.txn.sender === this.Owner.value || this.txn.sender === this.Manager.value);
        sendOfflineKeyRegistration({});
    }

    /**
     * Calculate the entry time for counting a stake as entering the pool.
     * Algorand won't see the balance increase for ALGORAND_STAKING_BLOCK_DELAY rounds, so we approximate it.
     * The entry time is calculated by adding an approximate number of seconds based on current AVG block times
     * to the original entry time.  This means users don't get payouts based on time their balance wouldn't have
     * been seen by the network.
     *
     * @returns {uint64} - The updated entry time.
     */
    private getEntryTime(): uint64 {
        // entry time is the time we want to count this stake as entering the pool.  Algorand won't see the balance
        // increase for 320 rounds so approximate it as best we can
        const entryTime = globals.latestTimestamp;
        // we add 320 blocks * AVG_BLOCK_TIME_SECS (which is in tenths, where 30 represents 3 seconds)
        // adding that approximate number of seconds to the entry time.
        return entryTime + (ALGORAND_STAKING_BLOCK_DELAY * AVG_BLOCK_TIME_SECS) / 10;
    }
}
