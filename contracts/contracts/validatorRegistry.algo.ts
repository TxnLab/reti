import { Contract } from '@algorandfoundation/tealscript';

const MAX_POOLS: uint16 = 100;  // need to be careful of max size of ValidatorList and embedded PoolInfo
const MAX_POOLS_PER_NODE: uint8 = 8; // max number of pools per node - more than 4 gets dicey, but let them push it?
const MIN_PAYOUT_DAYS: uint16 = 1;
const MAX_PAYOUT_DAYS: uint16 = 30;
const MIN_PCT_TO_VALIDATOR: uint16 = 100; // 1% w/ two decimals - MUST
const MAX_PCT_TO_VALIDATOR: uint16 = 1000; // 10% w/ two decimals
const MAX_NODES_PER_VALIDATOR: uint16 = 100;
const MAX_ALGO_PER_POOL = 100000000 * 1000000; // 100m (micro)Algo

type ValidatorID = uint64;
type ValidatorPoolKey = {
    ID: ValidatorID;
    PoolID: uint16; // 0 means INVALID ! - so 1 is index, technically of [0]
};

type ValidatorPoolSlotKey = {
    PoolKey: ValidatorPoolKey;
    // Slot inside stakers array for an accounts stake - so don't have to iterate array can just directly access
    Slot: uint8;
};

type ValidatorConfig = {
    PayoutEveryXDays: uint16; // Payout frequency - ie: 7, 30, etc.
    PercentToValidator: uint16; // Payout percentage expressed w/ two decimals - ie: 500 = 5% -> .05 -
    PoolsPerNode: uint8; // Number of pools to allow per node (max of 4 is recommended)
    MaxNodes: uint16; // Maximum number of nodes the validator is stating they'll allow
};

type ValidatorCurState = {
    NumPools: uint16; // current number of pools this validator has - capped at MaxPools
    TotalStakers: uint64; // total number of stakers across all pools
    TotalAlgoStaked: uint64; // total amount staked to this validator across ALL of its pools
};

type ValidatorInfo = {
    ID: ValidatorID; // ID of this validator (sequentially assigned)
    Owner: Address; // Account that controls config - presumably cold-wallet
    Manager: Address; // Account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign for the transactions
    NFDForInfo: uint64; // Optional NFD App ID which the validator uses for describe their validator pool
    Config: ValidatorConfig;
    State: ValidatorCurState;
    Pools: StaticArray<PoolInfo, 100>;
};

type PoolInfo = {
    PoolAppID: uint64; // The App ID of this staking pool contract instance
    TotalStakers: uint16;
    TotalAlgoStaked: uint64;
    // The index into StakedPoolInfo with next free slot - set when a user unstakes everything and their slot
    // is cleared, or when adding and all slots were taken - FreeSlot would be end index.
    // FreeSlot: uint8;
    // Stakers is the list of accounts that have staked into this pool
    // It's treated like a fixed-size set - where a ZeroAddress account is an 'empty' slot
    // This list is iterated to do payouts so ALL have to be accessible from one box.
    // The list is also iterated to find a 'free' slot.
    // Stakers: StaticArray<StakedInfo, 100>;
};

// eslint-disable-next-line no-unused-vars
class ValidatorRegistry extends Contract {
    programVersion = 9;

    // globalState = GlobalStateMap<bytes, bytes>({ maxKeys: 3 });
    numValidators = GlobalStateKey<uint64>({key: 'numV'});

    // Validator list - simply incremental id - direct access to info for validator
    // and also contains all pool information (but not user-account ledger per pool)
    ValidatorList = BoxMap<ValidatorID, ValidatorInfo>({prefix: 'v'});

    // For given user staker address, which of up to 4 validator/pools are they in
    StakerPoolList = BoxMap<Address, StaticArray<ValidatorPoolKey, 4>>({prefix: 'spl'});

    createApplication(): void {
        this.numValidators.value = 0;
    }

    /**
     * Returns the current number of validators
     */
    @abi.readonly
    getNumValidators(): uint64 {
        return this.numValidators.value;
    }

    @abi.readonly
    getValidatorInfo(validatorID: ValidatorID): ValidatorInfo {
        return this.ValidatorList(validatorID).value;
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

        // this.ValidatorList(validatorID).value = {
        //     ID: validatorID,
        //     Owner: owner,
        //     Manager: manager,
        //     NFDForInfo: nfdAppID,
        //     Config: config,
        //     State: {
        //         NumPools: 0,
        //         TotalAlgoStaked: 0,
        //         TotalStakers: 0,
        //     },
        //     Pools: [],
        // };
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
        if (numPools >= MAX_POOLS) {
            throw Error('already at max pool size');
        }
        numPools += 1;

        this.ValidatorList(validatorID).value.State.NumPools = numPools;
        // We don't need to manipulate anything in the Pools array as the '0' values are all correct for PoolInfo
        // No stakers, no algo staked

        // PoolID is 1-based, 0 is invalid id
        return {ID: validatorID, PoolID: numPools};
    }

    addStake(validatorID: ValidatorID, amountToStake: uint64): ValidatorPoolSlotKey {
        // The prior transaction should be a payment to this pool for the amount specified
        // plus enough to cover our itxn fee to send to the staking pool
        verifyPayTxn(this.txnGroup[this.txn.groupIndex - 1], {
            sender: this.txn.sender,
            receiver: this.app.address,
            amount: amountToStake + 1000,
        });
        let poolKey: ValidatorPoolKey;
        // see if user is already staked to this validator?
        // but first - see if they've staked - ever...
        const neverStaked = this.StakerPoolList(this.txn.sender).exists;
        const slot: uint8 = 0;
        if (neverStaked) {
            // this is first time - just find first free pool for stake
            poolKey = this.findPoolForStake(validatorID, amountToStake)
            if (poolKey.PoolID == 0) {
                // need to create pool if not already at max
                // this.addStake(validatorID, poolKey);
            }
            // TODO - implement
            //     this.canAddToPool(validatorID, amountToStake);
            poolKey = {ID: validatorID, PoolID: 0};
        } else {
        }
        // return {PoolKey: poolKey,  Slot: slot} as ValidatorPoolSlotKey;
        return {PoolKey: {ID: 0, PoolID: 0}, Slot: slot};
        // return { PoolKey: poolKey, Slot: slot };
    }

    private findPoolForStake(validatorID: ValidatorID, amountToStake: uint64): ValidatorPoolKey {
        const pools = clone(this.ValidatorList(validatorID).value.Pools);
        const numPools = this.ValidatorList(validatorID).value.State.NumPools;
        for (let i: uint16 = 0; i < numPools; i += 1) {
            if (pools[i].TotalAlgoStaked + amountToStake < MAX_ALGO_PER_POOL) {
                return {ID: validatorID, PoolID: i + 1};
            }
        }
        this.ValidatorList(validatorID).value.Pools = pools;
        // Not found is poolID 0
        return {ID: validatorID, PoolID: 0};
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
        // Percent has two decimals, so 100 = 1.00% - min is 1%, max is 10%
        assert(config.PercentToValidator >= MIN_PCT_TO_VALIDATOR && config.PercentToValidator <= MAX_PCT_TO_VALIDATOR);
        assert(config.PoolsPerNode > 0 && config.PoolsPerNode <= MAX_POOLS_PER_NODE);
        assert(config.MaxNodes > 0 && config.MaxNodes <= MAX_NODES_PER_VALIDATOR);
    }
}
