import { Contract } from '@algorandfoundation/tealscript';
// eslint-disable-next-line import/no-cycle
import { StakedInfo, StakingPool } from './stakingPool.algo';
import {
    MAX_ALGO_PER_POOL,
    MAX_PCT_TO_VALIDATOR,
    MAX_STAKERS_PER_POOL,
    MIN_ALGO_STAKE_PER_POOL,
    MIN_PCT_TO_VALIDATOR,
} from './constants.algo';

const MAX_NODES = 12; // more just as a reasonable limit and cap on contract storage
const MAX_POOLS_PER_NODE = 6; // max number of pools per node - more than 4 gets dicey - preference is 3(!)
const MAX_POOLS = MAX_NODES * MAX_POOLS_PER_NODE;
const MIN_PAYOUT_DAYS = 1;
const MAX_PAYOUT_DAYS = 30;
const MAX_POOLS_PER_STAKER = 6;

type ValidatorID = uint64;
export type ValidatorPoolKey = {
    ID: ValidatorID; // 0 is invalid - should start at 1 (but is direct key in box)
    PoolID: uint64; // 0 means INVALID ! - so 1 is index, technically of [0]
    PoolAppID: uint64;
};

export type ValidatorConfig = {
    ID: ValidatorID; // ID of this validator (sequentially assigned)
    Owner: Address; // Account that controls config - presumably cold-wallet
    Manager: Address; // Account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign for the transactions
    // Optional NFD AppID which the validator uses to describe their validator pool
    // NFD must be currently OWNED by address that adds the validator
    NFDForInfo: uint64;
    /**
     * TODO:
     * Add config for
     * MustHoldCreatorNFT: Address
     * CreatorNFTMinBalance: uint64
     *  NFTs by Creator and min amount(Optional): A project running a validator can set a creator account such that all stakers must hold an ASA created
     *  by this account (w/ optional minimum amount [for tokens].  This can be used to restrict validator pools to members of a particular community.
     * RewardToken: uint64
     * RewardPerPayout: uint64
     * Reward token and reward rate (Optional): A validator can define a token that users are awarded in addition to the ALGO they receive for being in the pool.
     * This will allow projects to allow rewarding members their own token for eg.  Hold at least 5000 VEST to enter a Vestige staking pool, they have 1 day epochs
     * and all stakers get X amount of VEST as daily rewards (added to stakers ‘available’ balance) for removal at any time.
     */

    PayoutEveryXDays: uint16; // Payout frequency - ie: 7, 30, etc.
    PercentToValidator: uint32; // Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -
    ValidatorCommissionAddress: Address; // account that receives the validation commission each epoch payout (can be ZeroAddress)
    MinEntryStake: uint64; // minimum stake required to enter pool - but must withdraw all if they want to go below this amount as well(!)
    MaxAlgoPerPool: uint64; // maximum stake allowed per pool (to keep under incentive limits)
    PoolsPerNode: uint8; // Number of pools to allow per node (max of 3 is recommended)
};

type ValidatorCurState = {
    NumPools: uint16; // current number of pools this validator has - capped at MaxPools
    TotalStakers: uint64; // total number of stakers across all pools
    TotalAlgoStaked: uint64; // total amount staked to this validator across ALL of its pools
};

type PoolInfo = {
    NodeID: uint16;
    PoolAppID: uint64; // The App ID of this staking pool contract instance
    TotalStakers: uint16;
    TotalAlgoStaked: uint64;
};

type ValidatorInfo = {
    Config: ValidatorConfig;
    State: ValidatorCurState;
    Pools: StaticArray<PoolInfo, typeof MAX_POOLS>;
};

type MbrAmounts = {
    AddValidatorMbr: uint64;
    AddPoolMbr: uint64;
    PoolInitMbr: uint64;
    AddStakerMbr: uint64;
};

const ALGORAND_ACCOUNT_MIN_BALANCE = 100000;

// values taken from: https://developer.algorand.org/docs/features/asc1/stateful/#minimum-balance-requirement-for-a-smart-contract
const APPLICATION_BASE_FEE = 100000; // base fee for creating or opt-in to application
const ASSET_HOLDING_FEE = 100000; // creation fee for asset
const SSC_VALUE_UINT = 28500; // cost for value as uint64
const SSC_VALUE_BYTES = 50000; // cost for value as bytes

// eslint-disable-next-line no-unused-vars
export class ValidatorRegistry extends Contract {
    programVersion = 10;

    numValidators = GlobalStateKey<uint64>({ key: 'numV' });

    // Validator list - simply incremental id - direct access to info for validator
    // and also contains all pool information (but not user-account ledger per pool)
    ValidatorList = BoxMap<ValidatorID, ValidatorInfo>({ prefix: 'v' });

    // For given user staker address, which of up to 4 validator/pools are they in
    // We use this to find a particular addresses deposits (in up to 4 independent pools w/ any validators)
    StakerPoolSet = BoxMap<Address, StaticArray<ValidatorPoolKey, typeof MAX_POOLS_PER_STAKER>>({ prefix: 'sps' });

    // The app id of a staking pool contract instance to use as template for newly created pools
    StakingPoolTemplateAppID = GlobalStateKey<uint64>({ key: 'poolTemplateAppID' });

    NFDRegistryAppID = TemplateVar<uint64>();

    createApplication(poolTemplateAppID: uint64): void {
        this.numValidators.value = 0;
        this.StakingPoolTemplateAppID.value = poolTemplateAppID;
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

    // Cost for creator of validator contract itself is (but not really our problem - it's a bootstrap issue only)
    // this.minBalanceForAccount(0, 0, 0, 0, 0, 2, 0)

    getMbrAmounts(): MbrAmounts {
        return {
            AddValidatorMbr: this.costForBoxStorage(1 /* v prefix */ + len<ValidatorID>() + len<ValidatorInfo>()),
            AddPoolMbr: this.minBalanceForAccount(1, 0, 0, 0, 0, StakingPool.schema.global.numUint, 0),
            PoolInitMbr:
                ALGORAND_ACCOUNT_MIN_BALANCE +
                this.costForBoxStorage(7 /* 'stakers' name */ + len<StakedInfo>() * MAX_STAKERS_PER_POOL),
            AddStakerMbr:
                // how much to charge for first time a staker adds stake - since we add a tracking box per staker
                this.costForBoxStorage(
                    3 /* 'sps' prefix */ + len<Address>() + len<ValidatorPoolKey>() * MAX_POOLS_PER_STAKER
                ), // size of key + all values
        };
    }

    /**
     * Returns the current number of validators
     */
    // @abi.readonly
    getNumValidators(): uint64 {
        return this.numValidators.value;
    }

    // @abi.readonly
    // getValidatorInfo(validatorID: ValidatorID): ValidatorInfo {
    //     return this.ValidatorList(validatorID).value;
    // }

    // @abi.readonly
    getValidatorConfig(validatorID: ValidatorID): ValidatorConfig {
        return this.ValidatorList(validatorID).value.Config;
    }

    // @abi.readonly
    getValidatorState(validatorID: ValidatorID): ValidatorCurState {
        return this.ValidatorList(validatorID).value.State;
    }

    // @abi.readonly
    getValidatorOwnerAndManager(validatorID: ValidatorID): [Address, Address] {
        return [
            this.ValidatorList(validatorID).value.Config.Owner,
            this.ValidatorList(validatorID).value.Config.Manager,
        ];
    }

    // @abi.readonly
    // getPoolAppID is more of a sanity check than anything as the app id is already encoded in ValidatorPoolKey
    getPoolAppID(poolKey: ValidatorPoolKey): uint64 {
        return this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].PoolAppID;
    }

    // @abi.readonly
    getPoolInfo(poolKey: ValidatorPoolKey): PoolInfo {
        return this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1];
    }

    /**
     * Retrieves the staked pools for an account.
     *
     * @param {Account} staker - The account to retrieve staked pools for.
     * @return {ValidatorPoolKey[]} - The array of staked pools for the account.
     */
    getStakedPoolsForAccount(staker: AccountReference): ValidatorPoolKey[] {
        if (!this.StakerPoolSet(staker).exists) {
            return [];
        }
        const retData: ValidatorPoolKey[] = [];
        const poolSet = clone(this.StakerPoolSet(staker).value);
        for (let i = 0; i < poolSet.length; i += 1) {
            if (poolSet[i].ID !== 0) {
                retData.push(poolSet[i]);
            }
        }
        return retData;
    }

    /** Adds a new validator
     * @param mbrPayment payment from caller which covers mbr increase of new validator storage
     * @param nfdName (Optional) Name of nfd (used as double-check against id specified in config)
     * @param config ValidatorConfig struct
     * @returns validator ID
     */
    addValidator(mbrPayment: PayTxn, nfdName: string, config: ValidatorConfig): uint64 {
        this.validateConfig(config);
        assert(config.Owner !== Address.zeroAddress);
        assert(config.Manager !== Address.zeroAddress);
        assert(this.txn.sender === config.Owner, 'sender must be owner to add new validator');

        verifyPayTxn(mbrPayment, { amount: this.getMbrAmounts().AddValidatorMbr });

        // We're adding a new validator - same owner might have multiple - we don't care.
        const validatorID = this.numValidators.value + 1;
        this.numValidators.value = validatorID;

        this.ValidatorList(validatorID).create();
        this.ValidatorList(validatorID).value.Config = config;
        this.ValidatorList(validatorID).value.Config.ID = validatorID;

        if (config.NFDForInfo !== 0) {
            // verify nfd is real, and owned by sender
            sendAppCall({
                applicationID: AppID.fromUint64(this.NFDRegistryAppID),
                applicationArgs: ['is_valid_nfd_appid', nfdName, itob(config.NFDForInfo)],
            });
            // Verify the NFDs owner is same as our sender (presumably either owner or manager)
            assert(
                this.txn.sender === (AppID.fromUint64(config.NFDForInfo).globalState('i.owner.a') as Address),
                'If specifying NFD, account adding validator must be owner'
            );
        }
        return validatorID;
    }

    changeValidatorManager(validatorID: ValidatorID, manager: Address): void {
        assert(this.txn.sender === this.ValidatorList(validatorID).value.Config.Owner);
        this.ValidatorList(validatorID).value.Config.Manager = manager;
    }

    changeValidatorNFD(validatorID: ValidatorID, nfdAppID: uint64, nfdName: string): void {
        assert(
            this.txn.sender === this.ValidatorList(validatorID).value.Config.Owner ||
                this.txn.sender === this.ValidatorList(validatorID).value.Config.Manager
        );
        // verify nfd is real, and owned by owner or manager..
        sendAppCall({
            applicationID: AppID.fromUint64(this.NFDRegistryAppID),
            applicationArgs: ['is_valid_nfd_appid', nfdName, itob(nfdAppID)],
        });
        // we know sender is owner or manager - so if sender is owner of nfd - we're fine.
        assert(
            this.txn.sender === (AppID.fromUint64(nfdAppID).globalState('i.owner.a') as Address),
            'If specifying NFD, account adding validator must be owner'
        );
        this.ValidatorList(validatorID).value.Config.NFDForInfo = nfdAppID;
    }

    changeValidatorCommissionAddress(validatorID: ValidatorID, commissionAddress: Address): void {
        assert(
            this.txn.sender === this.ValidatorList(validatorID).value.Config.Owner ||
                this.txn.sender === this.ValidatorList(validatorID).value.Config.Manager
        );
        this.ValidatorList(validatorID).value.Config.ValidatorCommissionAddress = commissionAddress;
    }

    /** Adds a new pool to a validator's pool set, returning the 'key' to reference the pool in the future for staking, etc.
     * The caller must pay the cost of the validators MBR increase as well as the MBR that will be needed for the pool itself.
     * @param {PayTxn} mbrPayment payment from caller which covers mbr increase of adding a new pool
     * @param {uint64} validatorID is ID of validator to pool to (must be owner or manager)
     * @returns {ValidatorPoolKey} pool key to created pool
     *
     */
    addPool(mbrPayment: PayTxn, validatorID: ValidatorID): ValidatorPoolKey {
        verifyPayTxn(mbrPayment, { amount: this.getMbrAmounts().AddPoolMbr, receiver: this.app.address });

        assert(this.ValidatorList(validatorID).exists);

        // Must be called by the owner or manager of the validator.
        assert(
            this.txn.sender === this.ValidatorList(validatorID).value.Config.Owner ||
                this.txn.sender === this.ValidatorList(validatorID).value.Config.Manager
        );

        let numPools = this.ValidatorList(validatorID).value.State.NumPools;
        if ((numPools as uint64) >= MAX_POOLS) {
            throw Error('already at max pool size');
        }
        numPools += 1;

        // Create the actual staker pool contract instance
        sendAppCall({
            onCompletion: OnCompletion.NoOp,
            approvalProgram: AppID.fromUint64(this.StakingPoolTemplateAppID.value).approvalProgram,
            clearStateProgram: AppID.fromUint64(this.StakingPoolTemplateAppID.value).clearStateProgram,
            globalNumUint: AppID.fromUint64(this.StakingPoolTemplateAppID.value).globalNumUint,
            globalNumByteSlice: AppID.fromUint64(this.StakingPoolTemplateAppID.value).globalNumByteSlice,
            extraProgramPages: AppID.fromUint64(this.StakingPoolTemplateAppID.value).extraProgramPages,
            applicationArgs: [
                // creatingContractID, validatorID, poolID, minEntryStake, maxStakeAllowed
                method('createApplication(uint64,uint64,uint64,uint64,uint64)void'),
                itob(this.app.id),
                itob(validatorID),
                itob(numPools as uint64),
                itob(this.ValidatorList(validatorID).value.Config.MinEntryStake),
                itob(this.ValidatorList(validatorID).value.Config.MaxAlgoPerPool),
            ],
        });

        this.ValidatorList(validatorID).value.State.NumPools = numPools;
        // We don't need to manipulate anything in the Pools array as the '0' values are all correct for PoolInfo
        // No stakers, no algo staked
        this.ValidatorList(validatorID).value.Pools[numPools - 1].PoolAppID = this.itxn.createdApplicationID.id;

        // PoolID is 1-based, 0 is invalid id
        return { ID: validatorID, PoolID: numPools as uint64, PoolAppID: this.itxn!.createdApplicationID.id };
    }

    /**
     * Adds stake to a validator pool.
     *
     * @param {PayTxn} stakedAmountPayment - payment coming from staker to place into a pool
     * @param {ValidatorID} validatorID - The ID of the validator.
     * @returns {ValidatorPoolKey} - The key of the validator pool.
     */
    addStake(stakedAmountPayment: PayTxn, validatorID: ValidatorID): ValidatorPoolKey {
        assert(this.ValidatorList(validatorID).exists);
        increaseOpcodeBudget();

        const staker = this.txn.sender;
        // The prior transaction should be a payment to this pool for the amount specified
        // plus enough in fees to cover our itxn fee to send to the staking pool (not our problem to figure out)
        verifyPayTxn(stakedAmountPayment, {
            sender: staker,
            receiver: this.app.address,
        });

        let realAmount = stakedAmountPayment.amount;
        let mbrAmtLeftBehind: uint64 = 0;
        // determine if this is FIRST time this user has ever staked - they need to pay MBR
        if (!this.StakerPoolSet(staker).exists) {
            // We'll deduct the required MBR from what the user is depositing by telling callPoolAddState to leave
            // that amount behind and subtract from their depositing stake.
            mbrAmtLeftBehind = this.getMbrAmounts().AddStakerMbr;
            realAmount -= mbrAmtLeftBehind;
            this.StakerPoolSet(staker).create();
        }
        // find existing slot where staker is already in a pool w/ this validator, or if none found, then ensure they're
        // putting in minimum amount for this validator.
        const findRet = this.findPoolForStaker(validatorID, staker, realAmount);
        const poolKey = findRet[0];
        const isNewStaker = findRet[1];
        if (poolKey.PoolID === 0) {
            throw Error('No pool available with free stake.  Validator needs to add another pool');
        }

        // Update StakerPoolList for this found pool (new or existing)
        this.updateStakerPoolSet(staker, poolKey);
        // Send the callers algo amount (- mbrAmtLeftBehind) to the specified staking pool, and it then updates
        // the staker data.
        this.callPoolAddStake(stakedAmountPayment, poolKey, mbrAmtLeftBehind, isNewStaker);
        return poolKey;
    }

    // verifyPoolKeyCaller verifies the passed in key (from a staking pool calling us to update metrics) is valid
    // and matches the information we have in our state.  'Fake' pools could call us to update our data, but they
    // can't fake the ids and most importantly application id(!) of the caller that has to match.
    private verifyPoolKeyCaller(poolKey: ValidatorPoolKey): void {
        assert(this.ValidatorList(poolKey.ID).exists);
        assert((poolKey.PoolID as uint64) < 2 ** 16); // since we limit max pools but keep the interface broad
        assert(poolKey.PoolID > 0 && (poolKey.PoolID as uint16) <= this.ValidatorList(poolKey.ID).value.State.NumPools);
        // validator id, pool id, pool app id might still be kind of spoofed, but they can't spoof us verifying they called us from
        // the contract address of the pool app id they represent.
        assert(
            poolKey.PoolAppID === this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].PoolAppID,
            "The passed in app id doesn't match the passed in ids"
        );
        // Sender has to match the pool app id passed in as well.
        assert(this.txn.sender === AppID.fromUint64(poolKey.PoolAppID).address);
        // verify the state of the specified app (the staking pool itself) state matches as well !
        assert(poolKey.ID === (AppID.fromUint64(poolKey.PoolAppID).globalState('validatorID') as uint64));
        assert(poolKey.PoolID === (AppID.fromUint64(poolKey.PoolAppID).globalState('poolID') as uint64));
    }

    /**
     * stakeUpdatedViaRewards is called by Staking Pools to inform the validator (us) that a particular amount of total
     * stake has been added to the specified pool.  This is used to update the stats we have in our PoolInfo storage.
     * The calling App ID is validated against our pool list as well.
     * @param poolKey - ValidatorPoolKey type
     * @param amountToAdd - amount this validator's total stake increased via rewards
     */
    stakeUpdatedViaRewards(poolKey: ValidatorPoolKey, amountToAdd: uint64): void {
        this.verifyPoolKeyCaller(poolKey);

        // Remove the specified amount of stake - update pool stats, then total validator stats
        this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].TotalAlgoStaked += amountToAdd;
        this.ValidatorList(poolKey.ID).value.State.TotalAlgoStaked += amountToAdd;
    }

    /**
     * stakerRemoved is called by Staking Pools to inform the validator (us) that a particular amount of total stake has been removed
     * from the specified pool.  This is used to update the stats we have in our PoolInfo storage.
     * The calling App ID is validated against our pool list as well.
     * @param poolKey - ValidatorPoolKey type - [validatorID, PoolID] compound type
     * @param staker
     * @param amountRemoved
     * @param stakerRemoved
     */
    stakeRemoved(poolKey: ValidatorPoolKey, staker: Address, amountRemoved: uint64, stakerRemoved: boolean): void {
        increaseOpcodeBudget();

        this.verifyPoolKeyCaller(poolKey);

        // Yup - we've been called by an official staking pool telling us about stake that was removed from it,
        // so we can update our validator's staking stats.
        assert(amountRemoved > 0);

        // Remove the specified amount of stake - update pool stats, then total validator stats
        this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].TotalAlgoStaked -= amountRemoved;
        this.ValidatorList(poolKey.ID).value.State.TotalAlgoStaked -= amountRemoved;
        if (stakerRemoved) {
            // remove form that pool
            this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].TotalStakers -= 1;
            // . then update the staker set.
            const stakerOutOfThisValidator = this.removeFromStakerPoolSet(staker, <ValidatorPoolKey>{
                ID: poolKey.ID,
                PoolID: poolKey.PoolID,
                PoolAppID: poolKey.PoolAppID,
            });
            // . and remove as a staker in protocol stats if they're completely 'out'
            if (stakerOutOfThisValidator) {
                this.ValidatorList(poolKey.ID).value.State.TotalStakers -= 1;
            }
        }
    }

    /**
     * Finds the pool for a staker based on the provided validator ID, staker address, and amount to stake.
     * First checks the stakers 'already staked list' for the validator preferring those (adding if possible) then adds
     * to new pool if necessary.
     *
     * @param {ValidatorID} validatorID - The ID of the validator.
     * @param {Address} staker - The address of the staker.
     * @param {uint64} amountToStake - The amount to stake.
     * @returns {ValidatorPoolKey, boolean} - The pool for the staker and true/false on whether the staker is 'new' to this validator
     */
    findPoolForStaker(validatorID: ValidatorID, staker: Address, amountToStake: uint64): [ValidatorPoolKey, boolean] {
        // expensive loops - buy it up right now
        increaseOpcodeBudget();

        let isBrandNewStaker = true;
        // We have max per pool per validator - this value is stored in the pools as well, and they enforce it on their
        // addStake calls but the values should be the same, and we shouldn't even try to add stake if it won't even
        // be accepted.
        const maxPerPool = this.ValidatorList(validatorID).value.Config.MaxAlgoPerPool;
        // If there's already a stake list for this account, walk that first, so if the staker is already in THIS
        // validator, then go to the stakers existing pool(s) w/ this validator first.
        if (this.StakerPoolSet(staker).exists) {
            const poolSet = clone(this.StakerPoolSet(staker).value);
            assert(validatorID !== 0);
            for (let i = 0; i < poolSet.length; i += 1) {
                if (poolSet[i].ID === validatorID) {
                    // Not new to this validator - but might still be out of room in this slot.
                    log('found validator id entry for this staker');
                    // log(this.itoa(validatorID));
                    isBrandNewStaker = false;
                    if (
                        this.ValidatorList(validatorID).value.Pools[poolSet[i].PoolID - 1].TotalAlgoStaked +
                            amountToStake <=
                        maxPerPool
                    ) {
                        return [poolSet[i], isBrandNewStaker];
                    }
                }
            }
        }
        if (isBrandNewStaker) {
            log('in findPoolForStaker will return true for isBrandNewStaker');
        }

        // No existing stake found or that we fit in to, so ensure the stake meets the 'minimum entry' amount
        assert(
            amountToStake >= this.ValidatorList(validatorID).value.Config.MinEntryStake,
            'must stake at least the minimum for this pool'
        );

        // Walk their desired validators pools and find free space
        const pools = clone(this.ValidatorList(validatorID).value.Pools);
        const curNumPools = this.ValidatorList(validatorID).value.State.NumPools as uint64;
        for (let i = 0; i < curNumPools; i += 1) {
            if (pools[i].TotalAlgoStaked + amountToStake <= maxPerPool) {
                return [{ ID: validatorID, PoolID: i + 1, PoolAppID: pools[i].PoolAppID }, isBrandNewStaker];
            }
        }
        // Not found is poolID 0
        return [{ ID: validatorID, PoolID: 0, PoolAppID: 0 }, isBrandNewStaker];
    }

    private validateConfig(config: ValidatorConfig): void {
        // Verify all the value in the ValidatorConfig are correct
        assert(config.PayoutEveryXDays >= MIN_PAYOUT_DAYS && config.PayoutEveryXDays <= MAX_PAYOUT_DAYS);
        assert(config.PercentToValidator >= MIN_PCT_TO_VALIDATOR && config.PercentToValidator <= MAX_PCT_TO_VALIDATOR);
        if (config.PercentToValidator !== 0) {
            assert(
                config.ValidatorCommissionAddress !== Address.zeroAddress,
                'ValidatorCommissionAddress must be set if percent to validator is not 0'
            );
        }
        assert(config.MinEntryStake >= MIN_ALGO_STAKE_PER_POOL);
        assert(config.MaxAlgoPerPool <= MAX_ALGO_PER_POOL, 'enforce hard constraint to be safe to the network');
        assert(config.PoolsPerNode > 0 && config.PoolsPerNode <= MAX_POOLS_PER_NODE);
    }

    /**
     * Adds a stakers amount of algo to a validator pool, transferring the algo we received from them (already verified
     * by our caller) to the staking pool account, and then telling it about the amount being added for the specified
     * staker.
     *
     * @param {PayTxn} stakedAmountPayment - payment coming from staker to place into a pool
     * @param {ValidatorPoolKey} poolKey - The key of the validator pool.
     * @param {uint64} mbrAmtPaid - Amount the user is leaving behind in the validator to pay for their Staker MBR cost
     * @param {boolean} isNewStaker - if this is a new, first-time staker to the validator
     */
    private callPoolAddStake(
        stakedAmountPayment: PayTxn,
        poolKey: ValidatorPoolKey,
        mbrAmtPaid: uint64,
        isNewStaker: boolean
    ): void {
        const poolAppID = this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].PoolAppID;

        // forward the payment on to the pool via 2 txns
        // payment + 'add stake' call
        sendMethodCall<typeof StakingPool.prototype.addStake>({
            applicationID: AppID.fromUint64(poolAppID),
            methodArgs: [
                // =======
                // THIS IS A SEND of the amount received right back out and into the staking pool contract account.
                { amount: stakedAmountPayment.amount - mbrAmtPaid, receiver: AppID.fromUint64(poolAppID).address },
                // =======
                stakedAmountPayment.sender,
            ],
        });

        // Stake has been added to the pool - get its new totals and add to our own tracking data
        const poolNumStakers = AppID.fromUint64(poolAppID).globalState('numStakers') as uint64;
        const poolAlgoStaked = AppID.fromUint64(poolAppID).globalState('staked') as uint64;
        this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].TotalStakers = poolNumStakers as uint16;
        this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].TotalAlgoStaked = poolAlgoStaked;

        // now update our global totals based on delta (if new staker was added, new amount - can only have gone up or stayed same)
        if (isNewStaker) {
            this.ValidatorList(poolKey.ID).value.State.TotalStakers += 1;
        }
        this.ValidatorList(poolKey.ID).value.State.TotalAlgoStaked += stakedAmountPayment.amount - mbrAmtPaid;
    }

    private updateStakerPoolSet(staker: Address, poolKey: ValidatorPoolKey) {
        assert(this.StakerPoolSet(staker).exists);

        const poolSet = clone(this.StakerPoolSet(staker).value);
        for (let i = 0; i < this.StakerPoolSet(staker).value.length; i += 1) {
            if (poolSet[i] === poolKey) {
                // already in pool set
                return;
            }
            if (poolSet[i].ID === 0) {
                this.StakerPoolSet(staker).value[i] = poolKey;
                return;
            }
        }
        throw Error('No empty slot available in the staker pool set');
    }

    /**
     * Removes a pool key from the staker's active pool set - fails if not found (!)
     *
     * @param {Address} staker - The address of the staker.
     * @param {ValidatorPoolKey} poolKey - The pool key they should be stored in
     *
     * @return {boolean} is the staker gone from ALL pools of the given validator
     */
    private removeFromStakerPoolSet(staker: Address, poolKey: ValidatorPoolKey): boolean {
        // track how many pools staker is in, so we  can know if they remove all stake from all pools of this validator
        let inXPools = 0;
        let found = false;

        const poolSet = clone(this.StakerPoolSet(staker).value);
        for (let i = 0; i < this.StakerPoolSet(staker).value.length; i += 1) {
            if (poolSet[i].ID === poolKey.ID) {
                if (poolSet[i] === poolKey) {
                    found = true;
                    // 'zero' it out
                    this.StakerPoolSet(staker).value[i] = { ID: 0, PoolID: 0, PoolAppID: 0 };
                } else {
                    inXPools += 1;
                }
            }
        }
        if (!found) {
            throw Error('No matching slot found when told to remove a pool from the stakers set');
        }
        // Are they completely out of the staking pool ?
        return inXPools === 0;
    }
}
