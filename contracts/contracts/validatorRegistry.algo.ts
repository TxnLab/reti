import { Contract } from '@algorandfoundation/tealscript';

import { MAX_ALGO_PER_POOL } from './constants.algo';

const MAX_NODES = 12; // need to be careful of max size of ValidatorList and embedded PoolInfo
const MAX_POOLS_PER_NODE = 4; // max number of pools per node - more than 4 gets dicey - preference is 3(!)
const MAX_POOLS = MAX_NODES * MAX_POOLS_PER_NODE;
const MIN_PAYOUT_DAYS = 1;
const MAX_PAYOUT_DAYS = 30;
const MIN_PCT_TO_VALIDATOR = 10000; // 1% w/ four decimals - (this allows .0001%)
const MAX_PCT_TO_VALIDATOR = 100000; // 10% w/ four decimals

type ValidatorID = uint64;
type ValidatorPoolKey = {
    ID: ValidatorID;
    PoolID: uint64; // 0 means INVALID ! - so 1 is index, technically of [0]
};

type ValidatorPoolSlotKey = {
    PoolKey: ValidatorPoolKey;
    // Slot inside stakers array for an accounts stake - so don't have to iterate array can just directly access
    Slot: uint8;
};

export type ValidatorConfig = {
    PayoutEveryXDays: uint16; // Payout frequency - ie: 7, 30, etc.
    PercentToValidator: uint32; // Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -
    ValidatorCommissionAddress: Address; // account that receives the validation commission each epoch payout
    PoolsPerNode: uint8; // Number of pools to allow per node (max of 4 is recommended)
    MaxNodes: uint16; // Maximum number of nodes the validator is stating they'll allow
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

type NodeInfo = {
    ID: uint16; // just sequentially assigned... can only be a few anyway..
    Name: StaticArray<byte, 32>;
};

type ValidatorInfo = {
    ID: ValidatorID; // ID of this validator (sequentially assigned)
    Owner: Address; // Account that controls config - presumably cold-wallet
    Manager: Address; // Account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign for the transactions
    NFDForInfo: uint64; // Optional NFD App ID which the validator uses for describe their validator pool
    Config: ValidatorConfig;
    State: ValidatorCurState;
    Nodes: StaticArray<NodeInfo, typeof MAX_NODES>;
    Pools: StaticArray<PoolInfo, typeof MAX_POOLS>;
};

// eslint-disable-next-line no-unused-vars
class ValidatorRegistry extends Contract {
    programVersion = 9;

    // globalState = GlobalStateMap<bytes, bytes>({ maxKeys: 3 });
    numValidators = GlobalStateKey<uint64>({ key: 'numV' });

    // Validator list - simply incremental id - direct access to info for validator
    // and also contains all pool information (but not user-account ledger per pool)
    ValidatorList = BoxMap<ValidatorID, ValidatorInfo>({ prefix: 'v' });

    // For given user staker address, which of up to 4 validator/pools are they in
    StakerPoolSet = BoxMap<Address, StaticArray<ValidatorPoolKey, 4>>({ prefix: 'sps' });

    // The app id of a staking pool contract instance to use as template for newly created pools
    StakingPoolTemplateAppID = TemplateVar<uint64>();

    createApplication(): void {
        this.numValidators.value = 0;
    }

    /**
     * Returns the current number of validators
     */
    //@abi.readonly
    getNumValidators(): uint64 {
        return this.numValidators.value;
    }

    //@abi.readonly
    getValidatorInfo(validatorID: ValidatorID): ValidatorInfo {
        return this.ValidatorList(validatorID).value;
    }

    //@abi.readonly
    getValidatorConfig(validatorID: ValidatorID): ValidatorConfig {
        return this.ValidatorList(validatorID).value.Config;
    }

    /** Adds a new validator
     * @param owner The account (presumably cold-wallet) that owns the validator set
     * @param manager The account that manages the pool part. keys and triggers payouts.  Normally a hot-wallet as node sidecar needs the keys
     * @param nfdAppID Optional NFD App ID linking to information about the validator being added - where information about the validator and their pools can be found.
     * @param config ValidatorConfig struct
     */
    addValidator(owner: Address, manager: Address, nfdAppID: uint64, config: ValidatorConfig): uint64 {
        assert(owner !== Address.zeroAddress);
        assert(manager !== Address.zeroAddress);

        this.validateConfig(config);

        // We're adding a new validator - same owner might have multiple - we don't care.
        const validatorID = this.numValidators.value + 1;
        this.numValidators.value = validatorID;

        this.ValidatorList(validatorID).create();
        this.ValidatorList(validatorID).value.ID = validatorID;
        this.ValidatorList(validatorID).value.Owner = owner;
        this.ValidatorList(validatorID).value.Manager = manager;
        this.ValidatorList(validatorID).value.NFDForInfo = nfdAppID;
        this.ValidatorList(validatorID).value.Config = config;
        // TODO - what about nodes ?
        this.ValidatorList(validatorID).value.Nodes[0].Name = 'foo';
        return validatorID;
    }

    /** Adds a new pool to a validator's pool set, returning the 'key' to reference the pool in the future for staking, etc.
     */
    addPool(validatorID: ValidatorID): ValidatorPoolKey {
        assert(this.ValidatorList(validatorID).exists);

        const owner = this.ValidatorList(validatorID).value.Owner;
        const manager = this.ValidatorList(validatorID).value.Manager;

        // Must be called by the owner or manager of the validator.
        assert(this.txn.sender === owner || this.txn.sender === manager);

        let numPools = this.ValidatorList(validatorID).value.State.NumPools;
        if ((numPools as uint64) >= MAX_POOLS) {
            throw Error('already at max pool size');
        }
        numPools += 1;

        // Create the actual staker pool contract instance
        sendAppCall({
            onCompletion: OnCompletion.NoOp,
            approvalProgram: Application.fromID(this.StakingPoolTemplateAppID).approvalProgram,
            clearStateProgram: Application.fromID(this.StakingPoolTemplateAppID).clearStateProgram,
            globalNumUint: Application.fromID(this.StakingPoolTemplateAppID).globalNumUint,
            globalNumByteSlice: Application.fromID(this.StakingPoolTemplateAppID).globalNumByteSlice,
            extraProgramPages: Application.fromID(this.StakingPoolTemplateAppID).extraProgramPages,
            applicationArgs: [
                method("createApplication(uint64,uint64,uint64,address,address)void"),
                itob(this.app.id),
                itob(validatorID),
                itob(numPools as uint64),
                rawBytes(this.ValidatorList(validatorID).value.Owner),
                rawBytes(this.ValidatorList(validatorID).value.Manager),
            ],
        });

        this.ValidatorList(validatorID).value.State.NumPools = numPools;
        // We don't need to manipulate anything in the Pools array as the '0' values are all correct for PoolInfo
        // No stakers, no algo staked
        this.ValidatorList(validatorID).value.Pools[numPools - 1].PoolAppID = this.itxn.createdApplicationID.id;

        // PoolID is 1-based, 0 is invalid id
        return { ID: validatorID, PoolID: numPools as uint64 };
    }

    /**
     * Adds stake to a validator pool.
     *
     * @param {ValidatorID} validatorID - The ID of the validator.
     * @param {uint64} amountToStake - The amount to stake.
     * @returns {ValidatorPoolKey} - The key of the validator pool.
     */
    addStake(validatorID: ValidatorID, amountToStake: uint64): ValidatorPoolKey {
        const staker = this.txn.sender;
        // The prior transaction should be a payment to this pool for the amount specified
        // plus enough in fees to cover our itxn fee to send to the staking pool (not our problem to figure out)
        verifyPayTxn(this.txnGroup[this.txn.groupIndex - 1], {
            sender: staker,
            receiver: this.app.address,
            amount: amountToStake,
        });

        let poolKey: ValidatorPoolKey;
        poolKey = this.findPoolForStaker(validatorID, staker, amountToStake);
        if (poolKey.PoolID == 0) {
            throw Error('No pool available with free stake.  Validator needs to add another pool');
            // need to create pool if not already at max
            // poolKey = this.addPool(validatorID);
        }
        // Update StakerPoolList for this found pool (new or existing)
        this.updateStakerPoolSet(staker, poolKey);
        this.callPoolAddStake(poolKey, staker, amountToStake);
        return poolKey;
    }

    /**
     * stakeUpdatedViaRewards is called by Staking Pools to inform the validator (us) that a particular amount of total stake has been removed
     * from the specified pool.  This is used to update the stats we have in our PoolInfo storage.
     * The calling App ID is validated against our pool list as well.
     * @param poolKey - ValidatorPoolKey type - [validatorID, PoolID] compound type
     * @param amountToAdd
     */
    stakeUpdatedViaRewards(poolKey: ValidatorPoolKey, amountToAdd: uint64): void {
        assert(this.ValidatorList(poolKey.ID).exists);
        assert((poolKey.PoolID as uint64) < 2 ** 16); // since we limit max pools but keep the interface broad
        assert(poolKey.PoolID > 0 && (poolKey.PoolID as uint16) <= this.ValidatorList(poolKey.ID).value.State.NumPools);
        // validator id and pool id might still be kind of spoofed but they can't spoof us verifying they called us from
        // the contract address of the pool app id they represent.
        const poolAppID = this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].PoolAppID;
        // Sender has to match the pool app id passed in.
        assert(this.txn.sender == Application.fromID(poolAppID).address);
        // verify its state is right as well
        assert(poolKey.ID === (Application.fromID(poolAppID).globalState('validatorID') as uint64));
        assert(poolKey.PoolID === (Application.fromID(poolAppID).globalState('poolID') as uint64));

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
        assert(this.ValidatorList(poolKey.ID).exists);
        assert((poolKey.PoolID as uint64) < 2 ** 16); // since we limit max pools but keep the interface broad
        assert(poolKey.PoolID > 0 && (poolKey.PoolID as uint16) <= this.ValidatorList(poolKey.ID).value.State.NumPools);
        // validator id and pool id might still be kind of spoofed but they can't spoof us verifying they called us from
        // the contract address of the pool app id they represent.
        const poolAppID = this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].PoolAppID;
        // Sender has to match the pool app id passed in.
        assert(this.txn.sender == Application.fromID(poolAppID).address);
        // verify its state is right as well
        assert(poolKey.ID === (Application.fromID(poolAppID).globalState('validatorID') as uint64));
        assert(poolKey.PoolID === (Application.fromID(poolAppID).globalState('poolID') as uint64));

        // Remove the specified amount of stake - update pool stats, then total validator stats
        this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].TotalAlgoStaked -= amountRemoved;
        this.ValidatorList(poolKey.ID).value.State.TotalAlgoStaked -= amountRemoved;
        if (stakerRemoved) {
            this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].TotalStakers -= 1;
            this.ValidatorList(poolKey.ID).value.State.TotalStakers -= 1;
            this.removeFromStakerPoolSet(staker, <ValidatorPoolKey>{ ID: poolKey.ID, PoolID: poolKey.PoolID });
        }
    }

    private findPoolForStaker(validatorID: ValidatorID, staker: Address, amountToStake: uint64): ValidatorPoolKey {
        // If there's already a stake list for this account, walk that first, so if the staker is already in this
        // validator, then go to the stakers existing pool(s) w/ that validator first.
        if (this.StakerPoolSet(staker).exists) {
            this.StakerPoolSet(staker).value.forEach((pool) => {
                if (pool.ID == validatorID) {
                    // This staker already has stake with this validator - if room left, start there first
                    if (
                        this.ValidatorList(validatorID).value.Pools[pool.PoolID - 1].TotalAlgoStaked + amountToStake <
                        MAX_ALGO_PER_POOL
                    ) {
                        return pool;
                    }
                }
            });
        }

        let i = 1;
        this.ValidatorList(validatorID).value.Pools.forEach((pool) => {
            if (pool.TotalAlgoStaked + amountToStake < MAX_ALGO_PER_POOL) {
                return <ValidatorPoolKey>{ ID: validatorID, PoolID: i };
            }
            i += 1;
        });
        // Not found is poolID 0
        return { ID: validatorID, PoolID: 0 };
    }

    // private canAddToPool(validatorID: ValidatorID, amountToStake: uint64): uint64 {
    //     Iterate through this validators pools - does it have any free pools to add to or can one be added?
    // this.ValidatorPools(validatorID)

    // }

    // private findSlotFor;

    // ===========

    private validateConfig(config: ValidatorConfig): void {
        // Verify all the value in the ValidatorConfig are correct
        assert(config.PayoutEveryXDays >= MIN_PAYOUT_DAYS && config.PayoutEveryXDays <= MAX_PAYOUT_DAYS);
        assert(config.PercentToValidator >= MIN_PCT_TO_VALIDATOR && config.PercentToValidator <= MAX_PCT_TO_VALIDATOR);
        assert(config.ValidatorCommissionAddress !== Address.zeroAddress);
        assert(config.PoolsPerNode > 0 && config.PoolsPerNode <= MAX_POOLS_PER_NODE);
        assert(config.MaxNodes > 0 && config.MaxNodes <= MAX_NODES);
    }

    /**
     * Adds a stakers amount of algo to a validator pool, transfering the algo we received from them (already verified
     * by our caller) to the staking pool account, and then telling it about the amount being add for the specified
     * staker.
     *
     * @param {ValidatorPoolKey} poolKey - The key of the validator pool.
     * @param {Address} staker - The address of the staker.
     * @param {uint64} amountToStake - The amount to stake.
     * @returns {void}
     */
    private callPoolAddStake(poolKey: ValidatorPoolKey, staker: Address, amountToStake: uint64) {
        const poolAppID = this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].PoolAppID;
        // forward the payment on to the pool
        sendPayment({
            amount: amountToStake,
            receiver: Application.fromID(poolAppID).address,
        });

        const priorStakers = Application.fromID(poolAppID).globalState('numStakers') as uint64;
        const priorStaked = Application.fromID(poolAppID).globalState('staked') as uint64;

        // now tell the pool to add the stake
        sendMethodCall<[Address, uint64], uint64>({
            applicationID: Application.fromID(poolAppID),
            name: 'addStake',
            methodArgs: [staker, amountToStake],
        });

        this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].TotalStakers = Application.fromID(
            poolAppID
        ).globalState('numStakers') as uint64;
        this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].TotalAlgoStaked = Application.fromID(
            poolAppID
        ).globalState('staked') as uint64;
        // now update our global totals based on delta (if new staker was added, new amount - can only have gone up or stayed same)
        this.ValidatorList(poolKey.ID).value.State.TotalStakers +=
            (Application.fromID(poolAppID).globalState('numStakers') as uint64) - priorStakers;
        this.ValidatorList(poolKey.ID).value.State.TotalAlgoStaked += amountToStake;
    }

    private updateStakerPoolSet(staker: Address, poolKey: ValidatorPoolKey) {
        if (!this.StakerPoolSet(staker).exists) {
            this.StakerPoolSet(staker).create();
        }
        let i = 0;
        this.StakerPoolSet(staker).value.forEach((pool) => {
            if (pool == poolKey) {
                return;
            }
            if (pool.ID === 0) {
                this.StakerPoolSet(staker).value[i] = poolKey;
                return;
            }
            i += 1;
        });
        throw Error('No empty slot available in the staker pool set');
    }

    private removeFromStakerPoolSet(staker: Address, poolKey: ValidatorPoolKey) {
        let i = 0;
        this.StakerPoolSet(staker).value.forEach((pool) => {
            if (pool == poolKey) {
                // Zero out this slot
                this.StakerPoolSet(staker).value[i] = { ID: 0, PoolID: 0 };
                return;
            }
            i += 1;
        });
    }
}
