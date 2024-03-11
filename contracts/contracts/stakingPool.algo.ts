import { Contract } from '@algorandfoundation/tealscript';
// eslint-disable-next-line import/no-cycle
import { ValidatorRegistry } from './validatorRegistry.algo';
import {
    ALGORAND_ACCOUNT_MIN_BALANCE,
    APPLICATION_BASE_FEE,
    ASSET_HOLDING_FEE,
    MAX_ALGO_PER_POOL,
    MAX_STAKERS_PER_POOL,
    MIN_ALGO_STAKE_PER_POOL,
    SSC_VALUE_BYTES,
    SSC_VALUE_UINT,
} from './constants.algo';

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

    MinEntryStake = GlobalStateKey<uint64>({ key: 'minEntryStake' });

    MaxStakeAllowed = GlobalStateKey<uint64>({ key: 'maxStake' });

    // Last timestamp of a payout - used to ensure payout call isn't cheated and called prior to agreed upon schedule
    LastPayout = GlobalStateKey<uint64>({ key: 'lastPayout' });

    // Version of algod this pool is connected to - should be updated regularly
    AlgodVer = GlobalStateKey<bytes>({ key: 'algodVer' });

    // Our 'ledger' of stakers, tracking each staker account and its balance, total rewards, and last entry time
    Stakers = BoxKey<StaticArray<StakedInfo, typeof MAX_STAKERS_PER_POOL>>({ key: 'stakers' });

    /**
     * Initialize the staking pool w/ owner and manager, but can only be created by the validator contract.
     * @param creatingContractID - id of contract that constructed us - the validator application (single global instance)
     * @param validatorID - id of validator we're a staking pool of
     * @param poolID - which pool id are we
     * @param minEntryStake - minimum amount to be in pool, but also minimum amount balance can't go below (without removing all!)
     * @param maxStakeAllowed - maximum algo allowed in this staking pool
     */
    createApplication(
        creatingContractID: uint64,
        validatorID: uint64,
        poolID: uint64,
        minEntryStake: uint64,
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
        assert(minEntryStake >= MIN_ALGO_STAKE_PER_POOL);
        assert(maxStakeAllowed <= MAX_ALGO_PER_POOL); // this should have already been checked by validator but... still
        this.CreatingValidatorContractAppID.value = creatingContractID;
        this.ValidatorID.value = validatorID;
        this.PoolID.value = poolID;
        this.NumStakers.value = 0;
        this.TotalAlgoStaked.value = 0;
        this.MinEntryStake.value = minEntryStake;
        this.MaxStakeAllowed.value = maxStakeAllowed;
        this.LastPayout.value = globals.latestTimestamp; // set 'last payout' to init time of pool to establish baseline
    }

    /**
     * gas is a dummy no-op call that can be used to pool-up resource references and opcode cost
     */
    gas(): void {}

    private minBalanceForAccount(
        contracts: number,
        extraPages: number,
        assets: number,
        localInts: number,
        localBytes: number,
        globalInts: number,
        globalBytes: number
    ): uint64 {
        let minBal = ALGORAND_ACCOUNT_MIN_BALANCE;
        minBal += contracts * APPLICATION_BASE_FEE;
        minBal += extraPages * APPLICATION_BASE_FEE;
        minBal += assets * ASSET_HOLDING_FEE;
        minBal += localInts * SSC_VALUE_UINT;
        minBal += globalInts * SSC_VALUE_UINT;
        minBal += localBytes * SSC_VALUE_BYTES;
        minBal += globalBytes * SSC_VALUE_BYTES;
        return minBal;
    }

    private costForBoxStorage(totalNumBytes: number): uint64 {
        const SCBOX_PERBOX = 2500;
        const SCBOX_PERBYTE = 400;

        return SCBOX_PERBOX + totalNumBytes * SCBOX_PERBYTE;
    }

    /**
     * Called after we're created and then funded so we can create our large stakers ledger storage
     * Caller has to get MBR amounts from ValidatorRegistry to know how much to fund us to cover the box storage cost
     * @param mbrPayment payment from caller which covers mbr increase of new staking pools' storage
     */
    initStorage(mbrPayment: PayTxn): void {
        const PoolInitMbr =
            ALGORAND_ACCOUNT_MIN_BALANCE +
            this.costForBoxStorage(7 /* 'stakers' name */ + len<StakedInfo>() * MAX_STAKERS_PER_POOL);

        verifyPayTxn(mbrPayment, { amount: PoolInitMbr });

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
        assert(this.txn.sender === AppID.fromUint64(this.CreatingValidatorContractAppID.value).address);
        assert(staker !== globals.zeroAddress);

        // Now, is the required amount actually being paid to US (this contract account - the staking pool)
        // Sender doesn't matter - but it 'technically' should be coming from the Validator contract address
        verifyPayTxn(stakedAmountPayment, {
            sender: AppID.fromUint64(this.CreatingValidatorContractAppID.value).address,
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
        for (let i = 0; i < this.Stakers.value.length; i += 1) {
            if (globals.opcodeBudget < 300) {
                increaseOpcodeBudget();
            }
            const cmpStaker = clone(this.Stakers.value[i]);
            if (cmpStaker.Account === staker) {
                cmpStaker.Balance += stakedAmountPayment.amount;
                cmpStaker.EntryTime = entryTime;

                // Update the box w/ the new data
                this.Stakers.value[i] = cmpStaker;

                this.TotalAlgoStaked.value += stakedAmountPayment.amount;
                return entryTime;
            }
            if (cmpStaker.Account === globals.zeroAddress) {
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
        assert(stakedAmountPayment.amount >= this.MinEntryStake.value, 'must stake at least the minimum for this pool');

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

        for (let i = 0; i < this.Stakers.value.length; i += 1) {
            if (globals.opcodeBudget < 300) {
                increaseOpcodeBudget();
            }
            const cmpStaker = clone(this.Stakers.value[i]);
            if (cmpStaker.Account === staker) {
                if (amountToUnstake === 0) {
                    // specifying 0 for unstake amount is requesting to UNSTAKE ALL
                    amountToUnstake = cmpStaker.Balance;
                }
                if (cmpStaker.Balance < amountToUnstake) {
                    throw Error('Insufficient balance');
                }
                cmpStaker.Balance -= amountToUnstake;
                this.TotalAlgoStaked.value -= amountToUnstake;

                // don't let them reduce their balance below the MinEntryStake UNLESS they're removing it all!
                assert(
                    cmpStaker.Balance === 0 || cmpStaker.Balance >= this.MinEntryStake.value,
                    'cannot reduce balance below minimum allowed stake unless all is removed'
                );

                // Pay the staker back
                sendPayment({
                    amount: amountToUnstake,
                    receiver: staker,
                    note: 'unstaked',
                });
                let stakerRemoved = false;
                if (cmpStaker.Balance === 0) {
                    // Staker has been 'removed' - zero out record
                    this.NumStakers.value -= 1;
                    cmpStaker.Account = globals.zeroAddress;
                    cmpStaker.TotalRewarded = 0;
                    cmpStaker.RewardTokenBalance = 0;
                    stakerRemoved = true;
                }
                // Update the box w/ the new staker data
                this.Stakers.value[i] = cmpStaker;

                // Call the validator contract and tell it we're removing stake
                // It'll verify we're a valid staking pool id and update it
                // stakeRemoved(poolKey: ValidatorPoolKey, staker: Address, amountRemoved: uint64, stakerRemoved: boolean): void
                // ABI: stakeRemoved((uint64,uint64,uint64),address,uint64,bool)void
                sendMethodCall<typeof ValidatorRegistry.prototype.stakeRemoved>({
                    applicationID: AppID.fromUint64(this.CreatingValidatorContractAppID.value),
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
     * Remove a specified amount of 'community token' rewards for a staker.
     * Anyone can call on behalf of the staker, but the tokens are only sent to the staker.
     * This is so projects can call this on behalf of the staker and cause the staker to be airdropped their
     * rewarded amount.
     * @param {Address} staker - the staker account to send rewards to
     * @param {uint64} amountToRemove - The amount of community tokens to be removed.  Specify 0 to remove all rewarded.
     */
    removeTokenReward(staker: Address, amountToRemove: uint64): void {
        // TODO - fetch reward token from validator config
        const rewardToken = 1;
        for (let i = 0; i < this.Stakers.value.length; i += 1) {
            if (globals.opcodeBudget < 300) {
                increaseOpcodeBudget();
            }
            const cmpStaker = clone(this.Stakers.value[i]);
            if (cmpStaker.Account === staker) {
                if (amountToRemove === 0) {
                    // specifying 0 for unstake amount is requesting to UNSTAKE ALL
                    amountToRemove = cmpStaker.RewardTokenBalance;
                }
                if (cmpStaker.RewardTokenBalance < amountToRemove) {
                    throw Error('Insufficient reward token balance');
                }
                cmpStaker.RewardTokenBalance -= amountToRemove;

                // Send the reward tokens to the staker
                sendAssetTransfer({
                    xferAsset: AssetID.fromUint64(rewardToken),
                    assetReceiver: staker,
                    assetAmount: amountToRemove,
                });

                // Update the box w/ the new staker data
                this.Stakers.value[i] = cmpStaker;
                return;
            }
        }
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
        for (let i = 0; i < this.Stakers.value.length; i += 1) {
            if (globals.opcodeBudget < 200) {
                increaseOpcodeBudget();
            }
            if (this.Stakers.value[i].Account === staker) {
                return this.Stakers.value[i];
            }
        }
        throw Error('Account not found');
    }

    private isOwnerOrManagerCaller(): boolean {
        const OwnerAndManager = sendMethodCall<typeof ValidatorRegistry.prototype.getValidatorOwnerAndManager>({
            applicationID: AppID.fromUint64(this.CreatingValidatorContractAppID.value),
            methodArgs: [this.ValidatorID.value],
        });
        return this.txn.sender === OwnerAndManager[0] || this.txn.sender === OwnerAndManager[1];
    }

    /**
     * Update the (honor system) algod version for the node associated to this pool.  The node management daemon
     * should compare its current nodes version to the version stored in global state, updating when different.
     * The reti node daemon composes its own version string using format:
     * {major}.{minor}.{build} {branch} [{commit hash}],
     * ie: 3.22.0 rel/stable [6b508975]
     * @param {string} algodVer - string representing the algorand node daemon version (reti node daemon composes its own meta version)
     */
    updateAlgodVer(algodVer: string): void {
        assert(this.isOwnerOrManagerCaller());
        this.AlgodVer.value = algodVer;
    }

    /**
     * Updates the balance of stakers in the pool based on the received 'rewards' (current balance vs known staked balance)
     * Stakers outstanding balance is adjusted based on their % of stake and time in the current epoch - so that balance
     * compounds over time and staker can remove that amount at will.
     * The validator is paid their percentage each epoch payout.
     *
     * Note: ANYONE can call this.
     */
    epochBalanceUpdate(): void {
        // call the validator contract to get our payout data
        const payoutConfig = sendMethodCall<typeof ValidatorRegistry.prototype.getValidatorConfig>({
            applicationID: AppID.fromUint64(this.CreatingValidatorContractAppID.value),
            methodArgs: [this.ValidatorID.value],
        });
        const payoutMins = payoutConfig.PayoutEveryXMins as uint64;

        // total reward available is current balance - amount staked (so if 100 was staked but balance is 120 - reward is 20)
        // [not counting MBR which should never be counted as a reward - it's not payable]
        let rewardAvailable = this.app.address.balance - this.TotalAlgoStaked.value - this.app.address.minBalance;

        // Reward available needs to be at lest 1 algo.
        assert(rewardAvailable > 1_000_000, 'Reward to payout not high enough');

        log(concat('reward avail: %i', itob(rewardAvailable)));

        if (payoutConfig.PercentToValidator !== 0) {
            // determine the % that goes to validator...
            // ie: 100[algo] * 50_000 (5% w/4 decimals) / 1_000_000 == 5 [algo]
            const validatorPay = wideRatio([rewardAvailable, payoutConfig.PercentToValidator as uint64], [1_000_000]);

            // and adjust reward for entire pool accordingly
            rewardAvailable -= validatorPay;

            // ---
            // pay the validator their cut...
            if (validatorPay > 0) {
                log(concat('paying validator: %i', itob(validatorPay)));
                sendPayment({
                    amount: validatorPay,
                    receiver: payoutConfig.ValidatorCommissionAddress,
                    note: 'validator reward',
                });
                log(concat('remaining reward: %i', itob(rewardAvailable)));
            }
        }

        if (rewardAvailable === 0) {
            // likely a personal validator node - probably had validator % at 1000 and we just issued the entire reward
            // to them - we're done
            return;
        }

        // Now we "pay" (but really just update their tracked balance) the stakers the remainder based on their % of
        // pool and time in this epoch.

        // Since we're being told to payout, we're at epoch 'end' presumably - or close enough
        // but what if we're told to pay really early?  we need to verify that as well.
        const curTime = globals.latestTimestamp;

        // Get configured epoch as seconds since we're block time comparisons will be in seconds
        const epochInSecs = payoutMins * 60;
        if (this.LastPayout.exists) {
            const secsSinceLastPayout = curTime - this.LastPayout.value;
            log(concat('secs since last payout: %i', itob(secsSinceLastPayout)));

            // We've had one payout - so we need to be at least one epoch past the last payout.
            assert(secsSinceLastPayout >= epochInSecs, "Can't payout earlier than last payout + epoch time");
        }
        // We'll track the amount of stake we add to stakers based on payouts
        // If any dust is remaining in account it'll be considered part of reward in next epoch.

        let increasedStake = 0;
        /**
         * assume A)lice and B)ob have equal stake... and there is a reward of 100 to divide
         * |------|-------|...
         * A  B
         *        ^ B gets 50% (or 25 of the 50)
         *        at end - we now have 75 'left' - which gets divided across the people at >=100% of epoch time
         *         *        intended result for 100 reward:
         *        if A and B have equal stake... they're each 50% of the 'pool' - call that PP (pool percent)
         *        Time in the epoch - TIE (100% would mean entire epoch - 50% TIE means entered halfway in)
         *        So, we first pay all partials (<100 TIE)
         *        B gets 25....  (100 REWARD * 50 PP (.5) * 50 TIE (.5)) or 25.
         *        -- keep total of stake from each of partial - adding into PartialStake value.
         *        --  we then see that 25 got paid out - so 25 'excess' needs distributed to the 100 TIE stakers on top of their reward.
         *        - reward available is now 75 ALGO to distribute - and PP value is based on percent against new total (TotalStaked-PartialStake)
         *        - so A's PP is now 100% not 50% because their stake is equal to the new reduced stake amount
         *        so A gets 75 (75 REWARD * 100 PP (1) * 100 TIE (1)) or 75
         *        next epoch if nothing else changes - each would get 50% of reward.
         */
        // Iterate all stakers - determine which haven't been for entire epoch - pay them proportionally less for having
        // less time in pool.  We keep track of their stake and then will later reduce the effective 'total staked' amount
        // by that so that the remaining stakers get the remaining reward + excess based on their % of stake against
        // remaining participants.
        let partialStakersTotalStake: uint64 = 0;
        for (let i = 0; i < this.Stakers.value.length; i += 1) {
            if (globals.opcodeBudget < 400) {
                increaseOpcodeBudget();
            }
            const cmpStaker = clone(this.Stakers.value[i]);
            if (cmpStaker.Account !== globals.zeroAddress) {
                if (cmpStaker.EntryTime > curTime) {
                    // due to 'forward dating' entry time this could be possible
                    // in this case it definitely means they get 0%
                    partialStakersTotalStake += cmpStaker.Balance;
                } else {
                    // Reward is % of users stake in pool,
                    // but we deduct based on time away from our payout time
                    const timeInPool = curTime - cmpStaker.EntryTime;
                    let timePercentage: uint64;
                    // get % of time in pool (in tenths precision)
                    // ie: 34.7% becomes 347
                    if (timeInPool < epochInSecs) {
                        partialStakersTotalStake += cmpStaker.Balance;
                        timePercentage = (timeInPool * 1000) / epochInSecs;

                        // calc: (balance * avail reward * percent in tenths) / (total staked * 1000)
                        const stakerReward = wideRatio(
                            [cmpStaker.Balance, rewardAvailable, timePercentage],
                            [this.TotalAlgoStaked.value, 1000]
                        );

                        // reduce the reward available (that we're accounting for) so that the subsequent
                        // 'full' pays are based on what's left
                        rewardAvailable -= stakerReward;
                        // instead of sending them algo now - just increase their ledger balance, so they can claim
                        // it at any time.
                        cmpStaker.Balance += stakerReward;
                        cmpStaker.TotalRewarded += stakerReward;
                        increasedStake += stakerReward;

                        // Update the box w/ the new data
                        this.Stakers.value[i] = cmpStaker;
                    }
                }
            }
        }
        log(concat('partial staker total stake: %i', itob(partialStakersTotalStake)));

        // Reduce the virtual 'total staked in pool' amount based on removing the totals of the stakers we just paid
        // partial amounts.  This is so that all that remains is the stake of the 100% 'time in epoch' people.
        const newPoolTotalStake = this.TotalAlgoStaked.value - partialStakersTotalStake;

        // It's technically possible for newPoolTotalStake to be 0, if EVERY staker is new then there'll be nothing to
        // hand out this epoch because we'll have reduced the amount to 'count' towards stake by the entire stake
        if (newPoolTotalStake > 0) {
            // Now go back through the list AGAIN and pay out the full-timers their rewards + excess
            for (let i = 0; i < this.Stakers.value.length; i += 1) {
                if (globals.opcodeBudget < 200) {
                    increaseOpcodeBudget();
                }
                const cmpStaker = clone(this.Stakers.value[i]);
                if (cmpStaker.Account !== globals.zeroAddress && cmpStaker.EntryTime < curTime) {
                    const timeInPool = curTime - cmpStaker.EntryTime;
                    // We're now only paying out people who've been in pool an entire epoch.
                    if (timeInPool >= epochInSecs) {
                        // we're in for 100%, so it's just % of stakers balance vs 'new total' for their
                        // payment
                        const stakerReward = wideRatio([cmpStaker.Balance, rewardAvailable], [newPoolTotalStake]);
                        // instead of sending them algo now - just increase their ledger balance, so they can claim
                        // it at any time.
                        cmpStaker.Balance += stakerReward;
                        cmpStaker.TotalRewarded += stakerReward;
                        increasedStake += stakerReward;
                    }
                    // Update the box w/ the new data
                    this.Stakers.value[i] = cmpStaker;
                }
            }
        }
        // We've paid out the validator and updated the stakers new balances to reflect the rewards, now update
        // our 'total staked' value as well based on what we paid to validator and updated in staker balances as we
        // determined stake increases
        this.TotalAlgoStaked.value += increasedStake;

        log(concat('increased stake: %i', itob(increasedStake)));

        // Call the validator contract and tell it we've got new stake added
        // It'll verify we're a valid staking pool id and update it
        // stakeUpdatedViaRewards((uint64,uint64,uint64),uint64)void
        sendMethodCall<typeof ValidatorRegistry.prototype.stakeUpdatedViaRewards>({
            applicationID: AppID.fromUint64(this.CreatingValidatorContractAppID.value),
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
        // we can be called by validator contract if we're being moved (which in turn only is allowed to be called
        // by validator owner or manager), but if not - must be owner or manager
        if (this.txn.sender !== AppID.fromUint64(this.CreatingValidatorContractAppID.value).address) {
            assert(this.isOwnerOrManagerCaller());
        }

        sendOfflineKeyRegistration({});
    }

    // Links the staking pool's account address to an NFD
    // can only be called by owner or manager.
    // the contract account address must already be set into the NFD's u.cav.algo.a field pending verification
    linkToNFD(nfdAppID: uint64, nfdName: string): void {
        assert(this.isOwnerOrManagerCaller());

        const registryID = sendMethodCall<typeof ValidatorRegistry.prototype.getNFDRegistryID>({
            applicationID: AppID.fromUint64(this.CreatingValidatorContractAppID.value),
            methodArgs: [],
        });

        sendAppCall({
            applicationID: AppID.fromUint64(registryID),
            applicationArgs: ['verify_nfd_addr', nfdName, itob(nfdAppID), rawBytes(this.app.address)],
        });
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
