import { Contract } from '@algorandfoundation/tealscript';
// import { ValidatorConfig } from "./validatorRegistry.algo";
import { MAX_ALGO_PER_POOL } from './constants.algo';

const MAX_STAKERS_PER_POOL = 80; // 3,840
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

    CreatingValidatorContractAppID = GlobalStateKey<uint64>({ key: 'creatorApp' });

    ValidatorID = GlobalStateKey<uint64>({ key: 'validatorID' });

    PoolID = GlobalStateKey<uint64>({ key: 'poolID' });

    Owner = GlobalStateKey<Address>({ key: 'owner' });

    Manager = GlobalStateKey<Address>({ key: 'manager' });

    NumStakers = GlobalStateKey<uint64>({ key: 'numStakers' });

    TotalAlgoStaked = GlobalStateKey<uint64>({ key: 'staked' });

    MaxAlgo = GlobalStateKey<uint64>({ key: 'maxStake' });

    Stakers = BoxKey<StaticArray<StakedInfo, typeof MAX_STAKERS_PER_POOL>>({ key: 'stakers' });

    /**
     * Initialize the staking pool w/ owner and manager, but can only be created by the validator contract.
     * @param creatingContractID - id of contract that constructed us - the validator application (single global instance)
     * @param validatorID - id of validator we're a staking pool of
     * @param poolID - which pool id are we
     * @param owner
     * @param manager
     */
    createApplication(
        creatingContractID: uint64,
        validatorID: uint64,
        poolID: uint64,
        owner: Address,
        manager: Address
    ): void {
        this.CreatingValidatorContractAppID.value = creatingContractID;
        this.ValidatorID.value = validatorID; // Which valida
        this.PoolID.value = poolID;
        this.Owner.value = owner;
        this.Manager.value = manager;
        this.NumStakers.value = 0;
        this.TotalAlgoStaked.value = 0;
        this.MaxAlgo.value = MAX_ALGO_PER_POOL;
    }

    /**
     * Adds stake to the given account.
     * Can ONLY be called by the validator contract that created us
     * Must receive payment from the validator contract for amount being staked.
     *
     * @param {Address} account - The account adding new stake
     * @param {uint64} amountToStake - The amount to stake.
     * @throws {Error} - Throws an error if the staking pool is full.
     * @returns {uint64,} new 'entry time' in seconds of stake add.
     */
    addStake(account: Address, amountToStake: uint64): uint64 {
        if (!this.Stakers.exists) {
            this.Stakers.create();
        }
        // account calling us has to be our creating validator contract
        assert(account !== Account.zeroAddress);
        assert(this.txn.sender === Application.fromID(this.CreatingValidatorContractAppID.value).address);

        // Now, is the required amount actually being paid to US (this contract account - the staking pool)
        // Sender doesn't matter - but it 'technically' should be coming from the Validator contract address
        verifyPayTxn(this.txnGroup[this.txn.groupIndex - 1], {
            sender: Application.fromID(this.CreatingValidatorContractAppID.value).address,
            receiver: this.app.address,
            amount: amountToStake,
        });
        // See if the account staking is already in our ledger of Stakers - if so, they're just adding to their stake
        // track first empty slot as we go along as well.
        const entryTime = this.getEntryTime();
        let firstEmpty = 0;

        // firstEmpty should represent 1-based index to first empty slot we find - 0 means none were found
        const stakers = clone(this.Stakers.value);
        for (let i = 0; i < stakers.length; i+=1) {
            if (stakers[i].Account === account) {
                stakers[i].Balance += amountToStake;
                stakers[i].EntryTime = entryTime;
                // Update the box w/ the new data
                this.Stakers.value[i] = stakers[i];
                this.TotalAlgoStaked.value += amountToStake;
                return entryTime;
            }
            if (firstEmpty !== 0 && stakers[i].Account === Address.zeroAddress) {
                firstEmpty = i + 1;
                break;
            }
            i += 1;
        }

        if (firstEmpty === 0) {
            // nothing was found - pool is full and this staker can't fit
            throw Error('Staking pool full');
        }
        assert(this.Stakers.value[firstEmpty - 1].Account == Address.zeroAddress);
        this.Stakers.value[firstEmpty - 1] = {
            Account: account,
            Balance: amountToStake,
            TotalRewarded: 0,
            EntryTime: entryTime,
        };
        this.NumStakers.value += 1;
        this.TotalAlgoStaked.value += amountToStake;
        return entryTime;
    }

    /**
     * Removes stake on behalf of a particular staker.  Also notifies the validator contract for this pools
     * validaotr of the staker / balance changes.
     *
     * @param {Address} account - The address of the account removing stake.
     * @param {uint64} amountToUnstake - The amount of stake to be removed.
     * @throws {Error} If the account has insufficient balance or if the account is not found.
     */
    removeStake(account: Address, amountToUnstake: uint64): void {
        // We want to preserve the sanctity that the ONLY account that can call us is the staking account
        // It makes it a bit awkward this way to update the state in the validator but it's safer
        // account calling us has to be account removing stake
        assert(account !== Account.zeroAddress);
        assert(this.txn.sender === account);

        let i = 0;
        this.Stakers.value.forEach((staker) => {
            if (staker.Account === account) {
                if (staker.Balance < amountToUnstake) {
                    throw Error('Insufficient balance');
                }
                staker.Balance -= amountToUnstake;
                this.TotalAlgoStaked.value -= amountToUnstake;

                // Pay the staker back
                sendPayment({
                    amount: amountToUnstake,
                    receiver: account,
                    note: 'unstaked',
                });
                let stakerRemoved = false;
                if (staker.Balance === 0) {
                    // Staker has been 'removed' - zero out record
                    this.NumStakers.value -= 1;
                    staker.Account = Address.zeroAddress;
                    staker.TotalRewarded = 0;
                    stakerRemoved = true;
                }
                // Update the box w/ the new staker data
                this.Stakers.value[i] = staker;

                // Call the validator contract and tell it we're removing stake
                // It'll verify we're a valid staking pool id and update it
                // stakeRemoved((uint64,uint64),address,uint64,bool)void
                sendMethodCall<[[uint64, uint64], Address, uint64, boolean], void>({
                    applicationID: Application.fromID(this.CreatingValidatorContractAppID.value),
                    name: 'stakeRemoved',
                    methodArgs: [[this.ValidatorID.value, this.PoolID.value], account, amountToUnstake, stakerRemoved],
                });
            }
            i += 1;
        });
        throw Error('Account not found');
    }

    payStakers(): void {
        // we should only be callable by owner or manager of validator.
        assert(this.txn.sender == this.Owner.value || this.txn.sender === this.Manager.value);

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
        // but what if we're told to pay really early?  it should just mean
        // the reward is smaller.  It shouldn't be an issue.
        const curTime = globals.latestTimestamp;
        // How many seconds in an epoch..
        const payoutDaysInSecs = payoutDays * 24 * 60 * 60;

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
            if (staker.Account !== Address.zeroAddress) {
                if (staker.EntryTime > curTime) {
                    // due to 'forward dating' entry time this could be possible
                    // in this case it definitely means they get 0...
                    partialStakersTotalStake += staker.Balance;
                } else {
                    // Reward is % of users stake in pool
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
                        // instead of sending them algo now - just increase their ledger balance so they can claim
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
            if (staker.Account !== Address.zeroAddress && staker.EntryTime < curTime) {
                const timeInPool = curTime - staker.EntryTime;
                // We're now only paying out peoeple who've been in pool an entire epoch.
                if (timeInPool < payoutDaysInSecs) {
                    return;
                }
                // we're in for 100% so it's just % of stakers balance vs 'new total' for their
                // payment
                const stakerReward = wideRatio([staker.Balance, rewardAvailable], [newPoolTotalStake]);
                // instead of sending them algo now - just increase their ledger balance so they can claim
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
        sendMethodCall<[[uint64, uint64], uint64], void>({
            applicationID: Application.fromID(this.CreatingValidatorContractAppID.value),
            name: 'stakeUpdatedViaRewards',
            methodArgs: [[this.ValidatorID.value, this.PoolID.value], increasedStake],
        });
    }

    GoOnline(
        votePK: bytes,
        selectionPK: bytes,
        stateProofPK: bytes,
        voteFirst: uint64,
        voteLast: uint64,
        voteKeyDilution: uint64
    ): void {
        assert(this.txn.sender == this.Owner.value || this.txn.sender === this.Manager.value);
        sendOnlineKeyRegistration({
            votePK: votePK,
            selectionPK: selectionPK,
            stateProofPK: stateProofPK,
            voteFirst: voteFirst,
            voteLast: voteLast,
            voteKeyDilution: voteKeyDilution,
        });
    }

    GoOffline(): void {
        assert(this.txn.sender == this.Owner.value || this.txn.sender === this.Manager.value);
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
