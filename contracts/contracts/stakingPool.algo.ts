import { Contract } from '@algorandfoundation/tealscript';
// eslint-disable-next-line import/no-cycle
import { ValidatorRegistry } from './validatorRegistry.algo';
import { MAX_STAKERS_PER_POOL, MAX_ALGO_PER_POOL, MIN_ALGO_STAKE_PER_POOL } from './constants.algo';

const ALGORAND_STAKING_BLOCK_DELAY = 320; // # of blocks until algorand sees online balance changes in staking
const AVG_BLOCK_TIME_SECS = 28; // in tenths - 28 = 2.8

export type StakedInfo = {
    Account: Address;
    Balance: uint64;
    TotalRewarded: uint64;
    RewardTokenBalance: uint64;
    EntryTime: uint64;
};

// eslint-disable-next-line no-unused-vars
export class StakingPool extends Contract {
    programVersion = 10;

    // When created, we track our creating validator contract so that only this contract can call us.  Independent
    // copies of this contract could be created but only the 'official' validator contract would be considered valid
    // and official.  Calls from these pools back to the validator contract are also validated, ensuring the pool
    // calling the validator is one of the pools it created.
    CreatingValidatorContractAppID = GlobalStateKey<uint64>({ key: 'creatorApp' });

    // The 'id' of the validator our pool belongs to
    ValidatorID = GlobalStateKey<uint64>({ key: 'validatorID' });

    // The pool ID we were assigned by the validator contract - sequential id per validator
    PoolID = GlobalStateKey<uint64>({ key: 'poolID' });

    NumStakers = GlobalStateKey<uint64>({ key: 'numStakers' });

    TotalAlgoStaked = GlobalStateKey<uint64>({ key: 'staked' });

    MinAllowedStake = GlobalStateKey<uint64>({ key: 'minAllowedStake' });

    MaxStakeAllowed = GlobalStateKey<uint64>({ key: 'maxStake' });

    // Last timestamp of a payout - used to ensure payout call isn't cheated and called prior to agreed upon schedule
    LastPayout = GlobalStateKey<uint64>({ key: 'lastPayout' });

    // Our 'ledger' of stakers, tracking each staker account and its balance, total rewards, and last entry time
    Stakers = BoxKey<StaticArray<StakedInfo, typeof MAX_STAKERS_PER_POOL>>({ key: 'stakers' });

    /**
     * Initialize the staking pool w/ owner and manager, but can only be created by the validator contract.
     * @param creatingContractID - id of contract that constructed us - the validator application (single global instance)
     * @param validatorID - id of validator we're a staking pool of
     * @param poolID - which pool id are we
     * @param minAllowedStake - minimum amount to be in pool, but also minimum amount balance can't go below (without removing all!)
     * @param maxStakeAllowed - maximum algo allowed in this staking pool
     */
    createApplication(
        creatingContractID: uint64,
        validatorID: uint64,
        poolID: uint64,
        minAllowedStake: uint64,
        maxStakeAllowed: uint64
    ): void {
        if (creatingContractID === 0) {
            // this is likely initial template setup - everything should basically be zero...
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
     * Called after we're created and then funded so we can create our large stakers ledger storage
     * Caller has to get MBR amounts from ValidatorRegistry to know how much to fund us to cover the box storage cost
     */
    initStorage(): void {
        if (!this.Stakers.exists) {
            this.Stakers.create();
        }
    }

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
        assert(this.Stakers.exists);

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
        // const stakers = clone(this.Stakers.value);
        for (let i = 0; i < this.Stakers.value.length; i += 1) {
            // const cmpStaker = this.Stakers.value[i];
            if (this.Stakers.value[i].Account === staker) {
                this.Stakers.value[i].Balance += stakedAmountPayment.amount;
                this.Stakers.value[i].EntryTime = entryTime;
                // Update the box w/ the new data
                // this.Stakers.value[i] = cmpStaker;
                this.TotalAlgoStaked.value += stakedAmountPayment.amount;
                return entryTime;
            }
            if (this.Stakers.value[i].Account === globals.zeroAddress) {
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
            RewardTokenBalance: 0,
            EntryTime: entryTime,
        };
        this.NumStakers.value += 1;
        this.TotalAlgoStaked.value += stakedAmountPayment.amount;
        return entryTime;
    }

    /**
     * Removes stake on behalf of caller (removing own stake).  Also notifies the validator contract for this pools
     * validator of the staker / balance changes.
     *
     * @param {uint64} amountToUnstake - The amount of stake to be removed.  Specify 0 to remove all stake.
     * @throws {Error} If the account has insufficient balance or if the account is not found.
     */
    removeStake(amountToUnstake: uint64): void {
        // We want to preserve the sanctity that the ONLY account that can call us is the staking account
        // It makes it a bit awkward this way to update the state in the validator, but it's safer
        // account calling us has to be account removing stake
        const staker = this.txn.sender;

        // const stakers = clone(this.Stakers.value);
        for (let i = 0; i < this.Stakers.value.length; i += 1) {
            if (this.Stakers.value[i].Account === staker) {
                if (amountToUnstake === 0) {
                    // specifying 0 for unstake amount is requesting to UNSTAKE ALL
                    amountToUnstake = this.Stakers.value[i].Balance;
                }
                if (this.Stakers.value[i].Balance < amountToUnstake) {
                    throw Error('Insufficient balance');
                }
                this.Stakers.value[i].Balance -= amountToUnstake;
                this.TotalAlgoStaked.value -= amountToUnstake;

                // don't let them reduce their balance below the MinAllowedStake UNLESS they're removing it all!
                assert(
                    this.Stakers.value[i].Balance === 0 || this.Stakers.value[i].Balance >= this.MinAllowedStake.value,
                    'cannot reduce balance below minimum allowed stake unless all is removed'
                );

                // Pay the staker back
                sendPayment({
                    amount: amountToUnstake,
                    receiver: staker,
                    note: 'unstaked',
                });
                let stakerRemoved = false;
                if (this.Stakers.value[i].Balance === 0) {
                    // Staker has been 'removed' - zero out record
                    this.NumStakers.value -= 1;
                    this.Stakers.value[i].Account = globals.zeroAddress;
                    this.Stakers.value[i].TotalRewarded = 0;
                    this.Stakers.value[i].RewardTokenBalance = 0;
                    stakerRemoved = true;
                }
                // Update the box w/ the new staker data
                // this.Stakers.value[i] = this.Stakers.value[i];

                // Call the validator contract and tell it we're removing stake
                // It'll verify we're a valid staking pool id and update it
                // stakeRemoved(poolKey: ValidatorPoolKey, staker: Address, amountRemoved: uint64, stakerRemoved: boolean): void
                // ABI: stakeRemoved((uint64,uint64,uint64),address,uint64,bool)void
                sendMethodCall<typeof ValidatorRegistry.prototype.stakeRemoved>({
                    applicationID: Application.fromID(this.CreatingValidatorContractAppID.value),
                    methodArgs: [
                        { ID: this.ValidatorID.value, PoolID: this.PoolID.value, PoolAppID: this.app.id },
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
    // @abi.readonly
    getStakerInfo(staker: Address): StakedInfo {
        // const stakers = clone(this.Stakers.value);
        for (let i = 0; i < this.Stakers.value.length; i += 1) {
            if (this.Stakers.value[i].Account === staker) {
                return this.Stakers.value[i];
            }
        }
        throw Error('Account not found');
    }

    private isOwnerOrManagerCaller(): boolean {
        const OwnerAndManager = sendMethodCall<typeof ValidatorRegistry.prototype.getValidatorOwnerAndManager>({
            applicationID: Application.fromID(this.CreatingValidatorContractAppID.value),
            methodArgs: [this.ValidatorID.value],
        });
        return this.txn.sender === OwnerAndManager[0] || this.txn.sender === OwnerAndManager[1];
    }

    /**
     * Updates the balance of stakers in the pool based on the received 'rewards' (current balance vs known staked balance)
     * Stakers outstanding balance is adjusted based on their % of stake and time in the current epoch - so that balance
     * compounds over time and staker can remove that amount at will.
     * The validator is paid their percentage each epoch payout.
     *
     * @returns {void} or asserts.
     */
    epochBalanceUpdate(): void {
        assert(this.isOwnerOrManagerCaller());
        increaseOpcodeBudget();

        // call the validator contract to get our payout data
        const payoutConfig = sendMethodCall<typeof ValidatorRegistry.prototype.getValidatorConfig>({
            applicationID: Application.fromID(this.CreatingValidatorContractAppID.value),
            methodArgs: [this.ValidatorID.value],
        });
        const payoutDays = payoutConfig.PayoutEveryXDays as uint64;

        // total reward available is current balance - amount staked (so if 100 was staked but balance is 120 - reward is 20)
        // [not counting MBR which would be included in base balance anyway but - have to be safe...]
        const origBalance = this.app.address.balance;
        let rewardAvailable = origBalance - this.TotalAlgoStaked.value - this.app.address.minBalance;

        // Reward available needs to be high enough to cover our various txns
        assert(
            rewardAvailable > globals.minTxnFee * 2,
            'Reward to payout not high enough to cover txn costs of paying it out'
        );

        log(concat('reward avail is: ', this.itoa(rewardAvailable)));

        // determine the % that goes to validator...
        const validatorPay = wideRatio([rewardAvailable, payoutConfig.PercentToValidator], [1000000]);
        // and adjust reward for entire pool accordingly
        rewardAvailable -= validatorPay;

        // log(concat('validator pay is: ', validatorPay.toString()));
        // log(concat('remaining reward avail is: ', rewardAvailable.toString()));
        // ---
        // pay the validator their cut...
        if (validatorPay > 0) {
            log(concat('paying validator: ', this.itoa(rewardAvailable)));
            sendPayment({
                amount: validatorPay,
                receiver: payoutConfig.ValidatorCommissionAddress,
                note: 'validator reward',
            });
        }

        if (rewardAvailable === 0) {
            // likely a personal validator node - we just issued the entire reward to them - we're done
            return;
        }

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
            log(concat('secs since last payout: ', this.itoa(secsSinceLastPayout)));

            // We've had one payout - so we need to be at least one epoch past the last payout (allowing 10 minutes
            // early to account for script/clock issues)
            assert(
                secsSinceLastPayout >= payoutDaysInSecs - 10 * 60 /* 10 minutes in seconds 'fudge' allowed */,
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
        let partialStakersTotalStake: number = 0;
        log(concat('cur time: ', this.itoa(curTime)));
        for (let i = 0; i < this.Stakers.value.length; i += 1) {
            if (globals.opcodeBudget < 120) {
                increaseOpcodeBudget();
            }
            // const staker = this.Stakers.value[i];
            if (this.Stakers.value[i].Account !== globals.zeroAddress) {
                log(concat('entry time: ', this.itoa(this.Stakers.value[i].EntryTime)));
                if (this.Stakers.value[i].EntryTime > curTime) {
                    log(concat('staker past epoch', this.itoa(i)));
                    // due to 'forward dating' entry time this could be possible
                    // in this case it definitely means they get 0...
                    partialStakersTotalStake += this.Stakers.value[i].Balance;
                } else {
                    // Reward is % of users stake in pool,
                    // but we deduct based on time in pool
                    const timeInPool = curTime - this.Stakers.value[i].EntryTime;
                    let timePercentage: uint64;
                    // get % of time in pool (in tenths precision - 1000 not 100)
                    if (timeInPool < payoutDaysInSecs) {
                        partialStakersTotalStake += this.Stakers.value[i].Balance;
                        timePercentage = (timeInPool * 1000) / payoutDaysInSecs;

                        const stakerReward = wideRatio(
                            [this.Stakers.value[i].Balance, rewardAvailable, timePercentage],
                            [this.TotalAlgoStaked.value / 1000]
                        );
                        // reduce the reward available (that we're accounting for) so that the subsequent
                        // 'full' pays are based on what's left
                        rewardAvailable -= stakerReward;
                        // instead of sending them algo now - just increase their ledger balance, so they can claim
                        // it at any time.
                        this.Stakers.value[i].Balance += stakerReward;
                        this.Stakers.value[i].TotalRewarded += stakerReward;

                        // Update the box w/ the new data
                        // this.Stakers.value[i] = this.Stakers.value[i];
                    }
                }
            }
        }
        log(concat('partial staker total stake: ', this.itoa(partialStakersTotalStake)));
        // partialStakersTotalStake = 0;

        // Reduce the virtual 'total staked in pool' amount based on removing the totals of the stakers we just paid
        // partial amounts.  This is so that all that remains is the stake of the 100% 'time in epoch' people.
        const newPoolTotalStake = this.TotalAlgoStaked.value - partialStakersTotalStake;

        // It's technically possible for newPoolTotalStake to be 0, if EVERY staker is new then there'll be nothing to
        // hand out this epoch because we'll have reduced the amount to 'count' towards stake by the entire stake
        if (newPoolTotalStake > 0) {
            // Now go back through the list AGAIN and pay out the full-timers their rewards + excess
            for (let i = 0; i < this.Stakers.value.length; i += 1) {
                if (globals.opcodeBudget < 120) {
                    increaseOpcodeBudget();
                }
                // const staker = this.Stakers.value[i];
                if (this.Stakers.value[i].Account !== globals.zeroAddress && this.Stakers.value[i].EntryTime < curTime) {
                    const timeInPool = curTime - this.Stakers.value[i].EntryTime;
                    // We're now only paying out people who've been in pool an entire epoch.
                    if (timeInPool >= payoutDaysInSecs) {
                        // we're in for 100%, so it's just % of stakers balance vs 'new total' for their
                        // payment
                        const stakerReward = wideRatio([this.Stakers.value[i].Balance, rewardAvailable], [newPoolTotalStake]);
                        // instead of sending them algo now - just increase their ledger balance, so they can claim
                        // it at any time.
                        this.Stakers.value[i].Balance += stakerReward;
                        this.Stakers.value[i].TotalRewarded += stakerReward;
                        log(concat('staker rewarded: ', this.itoa(stakerReward)));
                    }
                    // Update the box w/ the new data
                    // this.Stakers.value[i] = staker;
                }
            }
        }
        // We've paid out the validator and updated the stakers new balances to reflect the rewards, now update
        // our 'total staked' value as well (in our pool and in the validator)
        const increasedStake = this.app.address.balance - this.TotalAlgoStaked.value - this.app.address.minBalance;
        this.TotalAlgoStaked.value += increasedStake;

        log(concat('increased stake: ', this.itoa(increasedStake)))

        // Call the validator contract and tell it we've got new stake added
        // It'll verify we're a valid staking pool id and update it
        // stakeUpdatedViaRewards((uint64,uint64),uint64)void
        sendMethodCall<typeof ValidatorRegistry.prototype.stakeUpdatedViaRewards>({
            applicationID: Application.fromID(this.CreatingValidatorContractAppID.value),
            methodArgs: [
                { ID: this.ValidatorID.value, PoolID: this.PoolID.value, PoolAppID: this.app.id },
                increasedStake,
            ],
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
        assert(this.isOwnerOrManagerCaller());
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
        assert(this.isOwnerOrManagerCaller());
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

    private int_to_ascii(arg: number): string {
        const bytes = '0123456789';
        return bytes[arg];
    }

    private itoa(i: number): string {
        if (i === 0) {
            return '0';
        }
        const quotient = i / 10;
        const remainder = i % 10;

        return (quotient > 0 ? this.itoa(quotient) : '') + this.int_to_ascii(remainder);
    }
}
