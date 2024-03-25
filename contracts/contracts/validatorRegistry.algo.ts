import { Contract } from '@algorandfoundation/tealscript';
// eslint-disable-next-line import/no-cycle
import { StakedInfo, StakingPool } from './stakingPool.algo';
import {
    ALGORAND_ACCOUNT_MIN_BALANCE,
    APPLICATION_BASE_FEE,
    ASSET_HOLDING_FEE,
    GATING_TYPE_NONE,
    GATING_TYPE_ASSETS_CREATED_BY,
    GATING_TYPE_ASSET_ID,
    GATING_TYPE_CREATED_BY_NFD_ADDRESSES,
    GATING_TYPE_SEGMENT_OF_NFD,
    GATING_TYPE_CONST_MAX,
    MAX_ALGO_PER_POOL,
    MAX_PCT_TO_VALIDATOR,
    MAX_STAKERS_PER_POOL,
    MIN_ALGO_STAKE_PER_POOL,
    MIN_PCT_TO_VALIDATOR,
    SSC_VALUE_BYTES,
    SSC_VALUE_UINT,
    MAX_VALIDATOR_PCT_OF_ONLINE,
} from './constants.algo';

const MAX_NODES = 4; // more just as a reasonable limit and cap on contract storage
const MAX_POOLS_PER_NODE = 3; // max number of pools per node
// This MAX_POOLS constant has to be explicitly specified in ValidatorInfo.Pools[ xxx ] StaticArray!
// if this constant is changed, the calculated value must be put in manually into the StaticArray definition.
const MAX_POOLS = MAX_NODES * MAX_POOLS_PER_NODE;

const MIN_PAYOUT_MINS = 1;
const MAX_PAYOUT_MINS = 10080; // 7 days in minutes
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

    // [CHANGEABLE] Account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign
    // for the transactions
    Manager: Address;

    // [CHANGEABLE] Optional NFD AppID which the validator uses to describe their validator pool
    // NFD must be currently OWNED by address that adds the validator
    NFDForInfo: uint64;

    // [CHANGEABLE] EntryGatingType / EntryGatingValue specifies an optional gating mechanism - whose criteria
    // the staker must meet.
    // It will be the responsibility of the staker (txn composer really) to pick the right thing to check (as argument
    // to adding stake) that meets the criteria if this is set.
    // Allowed types:
    // 1: assets created by address X (val is address of creator)
    // 2: specific asset id (val is asset id)
    // 3: asset in nfd linked addresses (value is nfd appid)
    // 4: segment of a particular NFD (value is root appid)
    EntryGatingType: uint8;
    EntryGatingValue: bytes32;

    // [CHANGEABLE] GatingAssetMinBalance specifies a minimum token base units amount needed of an asset owned by the specified
    // creator (if defined).  If 0, then they need to hold at lest 1 unit, but its assumed this is for tokens, ie: hold
    // 10000[.000000] of token
    GatingAssetMinBalance: uint64;

    // Optional reward token info
    // Reward token ASA ID: A validator can define a token that users are awarded in addition to
    // the ALGO they receive for being in the pool. This will allow projects to allow rewarding members their own
    // token.  Hold at least 5000 VEST to enter a Vestige staking pool, they have 1 day epochs and all
    // stakers get X amount of VEST as daily rewards (added to stakers ‘available’ balance) for removal at any time.
    RewardTokenID: uint64;
    // [CHANGEABLE] Reward rate : Defines the amount of RewardTokenID that is rewarded per epoch across all pools
    // (by their % stake of the validators total)
    RewardPerPayout: uint64;

    PayoutEveryXMins: uint16; // Payout frequency in minutes (can be no shorter than this)
    PercentToValidator: uint32; // Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -

    ValidatorCommissionAddress: Address; // [CHANGEABLE] account that receives the validation commission each epoch payout (can be ZeroAddress)
    MinEntryStake: uint64; // minimum stake required to enter pool - but must withdraw all if they want to go below this amount as well(!)
    MaxAlgoPerPool: uint64; // maximum stake allowed per pool (to keep under incentive limits)
    PoolsPerNode: uint8; // Number of pools to allow per node (max of 3 is recommended)

    SunsettingOn: uint64; // [CHANGEABLE] timestamp when validator will sunset (if != 0)
    SunsettingTo: ValidatorID; // [CHANGEABLE] validator ID that validator is 'moving' to (if known)
};

type ValidatorCurState = {
    NumPools: uint16; // current number of pools this validator has - capped at MaxPools
    TotalStakers: uint64; // total number of stakers across all pools of THIS validator
    TotalAlgoStaked: uint64; // total amount staked to this validator across ALL of its pools
    // amount of the reward token held back in pool 1 for paying out stakers their rewards.
    // as reward tokens are assigned to stakers - the amount as part of each epoch will be updated
    // in this value and this amount has to be assumed 'spent' - only reducing this number as the token
    // is actually sent out by request of the validator itself
    RewardTokenHeldBack: uint64;
};

type PoolInfo = {
    PoolAppID: uint64; // The App ID of this staking pool contract instance
    TotalStakers: uint16;
    TotalAlgoStaked: uint64;
};

type NodeConfig = {
    PoolAppIDs: StaticArray<uint64, typeof MAX_POOLS_PER_NODE>;
};

type NodePoolAssignmentConfig = {
    Nodes: StaticArray<NodeConfig, typeof MAX_NODES>;
};

export type PoolTokenPayoutRatio = {
    // MUST TRACK THE MAX_POOLS CONSTANT (MAX_POOLS_PER_NODE * MAX_NODES) !
    PoolPctOfWhole: StaticArray<uint64, 12>;
    // epoch timestmap when set - only pool 1 caller can trigger/calculate this and only once per epoch
    // set and compared against pool 1's LastPayout property.
    UpdatedForPayout: uint64;
};

type ValidatorInfo = {
    Config: ValidatorConfig;
    State: ValidatorCurState;
    // MUST TRACK THE MAX_POOLS CONSTANT (MAX_POOLS_PER_NODE * MAX_NODES) !
    Pools: StaticArray<PoolInfo, 12>;
    TokenPayoutRatio: PoolTokenPayoutRatio;
    NodePoolAssignments: NodePoolAssignmentConfig;
};

type MbrAmounts = {
    AddValidatorMbr: uint64;
    AddPoolMbr: uint64;
    PoolInitMbr: uint64;
    AddStakerMbr: uint64;
};

type Constraints = {
    EpochPayoutMinsMin: uint64;
    EpochPayoutMinsMax: uint64;
    MinPctToValidatorWFourDecimals: uint64;
    MaxPctToValidatorWFourDecimals: uint64;
    MinEntryStake: uint64; // in microAlgo
    MaxAlgoPerPool: uint64; // in microAlgo
    MaxAlgoPerValidator: uint64; // in microAlgo
    MaxNodes: uint64;
    MaxPoolsPerNode: uint64;
    MaxStakersPerPool: uint64;
};

// eslint-disable-next-line no-unused-vars
/**
 * ValidatorRegistry is the 'master contract' for the reti pooling protocol.
 * A single immutable instance of this is deployed.  All state for all validators including information about their
 * pools and nodes is stored via this contract in global state and box storage.  Data in the pools themselves is stored
 * within the StakingPool contract instance, also in global state and box storage.
 * See the StakingPool contract comments for details on how this contract creates new instances of them.
 */
export class ValidatorRegistry extends Contract {
    programVersion = 10;

    NumValidators = GlobalStateKey<uint64>({ key: 'numV' });

    // The app id of a staking pool contract instance to use as template for newly created pools
    StakingPoolTemplateAppID = GlobalStateKey<uint64>({ key: 'poolTemplateAppID' });

    // Track the 'global' protocol number of stakers
    NumStakers = GlobalStateKey<uint64>({ key: 'numStakers' });

    // Track the 'global' protocol amount of stake
    TotalAlgoStaked = GlobalStateKey<uint64>({ key: 'staked' });

    // Validator list - simply incremental id - direct access to info for validator
    // and also contains all pool information (but not user-account ledger per pool)
    ValidatorList = BoxMap<ValidatorID, ValidatorInfo>({ prefix: 'v' });

    // For given user staker address, which of up to MAX_POOLS_PER_STAKER validator/pools are they in
    // We use this to find a particular addresses deposits (in up to X independent pools w/ any validators)
    StakerPoolSet = BoxMap<Address, StaticArray<ValidatorPoolKey, typeof MAX_POOLS_PER_STAKER>>({ prefix: 'sps' });

    NFDRegistryAppID = TemplateVar<uint64>();

    createApplication(poolTemplateAppID: uint64): void {
        this.NumValidators.value = 0;
        this.StakingPoolTemplateAppID.value = poolTemplateAppID;
        this.NumStakers.value = 0;
        this.TotalAlgoStaked.value = 0;
    }

    /**
     * gas is a dummy no-op call that can be used to pool-up resource references and opcode cost
     */
    gas(): void {}

    private minBalanceForAccount(
        contracts: uint64,
        extraPages: uint64,
        assets: uint64,
        localInts: uint64,
        localBytes: uint64,
        globalInts: uint64,
        globalBytes: uint64
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

    private costForBoxStorage(totalNumBytes: uint64): uint64 {
        const SCBOX_PERBOX = 2500;
        const SCBOX_PERBYTE = 400;

        return SCBOX_PERBOX + totalNumBytes * SCBOX_PERBYTE;
    }

    // Cost for creator of validator contract itself is (but not really our problem - it's a bootstrap issue only)
    // this.minBalanceForAccount(0, 0, 0, 0, 0, 4, 0)

    /**
     * Returns the MBR amounts needed for various actions:
     * [
     *  AddValidatorMbr: uint64 - mbr needed to add a new validator - paid to validator contract
     *  AddPoolMbr: uint64 - mbr needed to add a new pool - paid to validator
     *  PoolInitMbr: uint64 - mbr needed to initStorage() of pool - paid to pool itself
     *  AddStakerMbr: uint64 - mbr staker needs to add to first staking payment (stays w/ validator)
     * ]
     */
    getMbrAmounts(): MbrAmounts {
        return {
            AddValidatorMbr: this.costForBoxStorage(1 /* v prefix */ + len<ValidatorID>() + len<ValidatorInfo>()),
            AddPoolMbr: this.minBalanceForAccount(
                1,
                0,
                0,
                0,
                0,
                StakingPool.schema.global.numUint,
                StakingPool.schema.global.numByteSlice
            ),
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
     * Returns the protocol constraints so that UIs can limit what users specify for validator configuration parameters.
     */
    getProtocolConstraints(): Constraints {
        return {
            EpochPayoutMinsMin: MIN_PAYOUT_MINS,
            EpochPayoutMinsMax: MAX_PAYOUT_MINS,
            MinPctToValidatorWFourDecimals: MIN_PCT_TO_VALIDATOR,
            MaxPctToValidatorWFourDecimals: MAX_PCT_TO_VALIDATOR,
            MinEntryStake: MIN_ALGO_STAKE_PER_POOL,
            MaxAlgoPerPool: MAX_ALGO_PER_POOL,
            MaxAlgoPerValidator: this.maxAllowedStake(),
            MaxNodes: MAX_NODES,
            MaxPoolsPerNode: MAX_POOLS_PER_NODE,
            MaxStakersPerPool: MAX_STAKERS_PER_POOL,
        };
    }

    /**
     * Returns the current number of validators
     */
    // @abi.readonly
    getNumValidators(): uint64 {
        return this.NumValidators.value;
    }

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
    /**
     * Return list of all pools for this validator.
     * @param {uint64} validatorID
     * @return {PoolInfo[]} - array of pools
     * Not callable from other contracts because >1K return but can be called w/ simulate which bumps log returns
     */
    getPools(validatorID: ValidatorID): PoolInfo[] {
        const retData: PoolInfo[] = [];
        const poolSet = clone(this.ValidatorList(validatorID).value.Pools);
        for (let i = 0; i < poolSet.length; i += 1) {
            if (poolSet[i].PoolAppID === 0) {
                // reached end of list...  we don't replace values here because pools can't be removed
                break;
            }
            retData.push(poolSet[i]);
        }
        return retData;
    }

    // @abi.readonly
    // getPoolAppID is useful for callers to determine app to call for removing stake if they don't have staking or
    // want to get staker list for an account.  The staking pool also uses it to get the app id of staking pool 1
    // (which contains reward tokens if being used) so that the amount available can be determined.
    getPoolAppID(validatorID: uint64, poolID: uint64): uint64 {
        assert(poolID !== 0 && poolID <= this.ValidatorList(validatorID).value.Pools.length);
        return this.ValidatorList(validatorID).value.Pools[poolID - 1].PoolAppID;
    }

    // @abi.readonly
    getPoolInfo(poolKey: ValidatorPoolKey): PoolInfo {
        return this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1];
    }

    /**
     * Calculate the maximum stake per pool for a given validator.
     * Normally this would be MaxAlgoPerPool, but it should also never go above MaxAllowedStake / NumPools so
     * as pools are added the max allowed per pool can reduce.
     *
     * @param {ValidatorID} validatorID - The ID of the validator.
     */
    getCurMaxStakePerPool(validatorID: ValidatorID): uint64 {
        const numPools = this.ValidatorList(validatorID).value.State.NumPools as uint64;
        const maxDividedBetweenPools = this.maxAllowedStake() / numPools;
        let maxPerPool: uint64 = this.ValidatorList(validatorID).value.Config.MaxAlgoPerPool;
        if (maxDividedBetweenPools < maxPerPool) {
            maxPerPool = maxDividedBetweenPools;
        }
        return maxPerPool;
    }

    // @abi.readonly
    /**
     * Helper callers can call w/ simulate to determine if 'AddStaker' MBR should be included w/ staking amount
     * @param staker
     */
    doesStakerNeedToPayMBR(staker: Address): boolean {
        return !this.StakerPoolSet(staker).exists;
    }

    /**
     * Retrieves the staked pools for an account.
     *
     * @param {Address} staker - The account to retrieve staked pools for.
     * @return {ValidatorPoolKey[]} - The array of staked pools for the account.
     */
    getStakedPoolsForAccount(staker: Address): ValidatorPoolKey[] {
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

    // @abi.readonly
    /**
     * Retrieves the token payout ratio for a given validator - returning the pool ratios of whole so that token
     * payouts across pools can be based on a stable snaphost of stake.
     *
     * @param {ValidatorID} validatorID - The ID of the validator.
     * @return {PoolTokenPayoutRatio} - The token payout ratio for the validator.
     */
    getTokenPayoutRatio(validatorID: ValidatorID): PoolTokenPayoutRatio {
        return this.ValidatorList(validatorID).value.TokenPayoutRatio;
    }

    // @abi.readonly
    getNodePoolAssignments(validatorID: uint64): NodePoolAssignmentConfig {
        assert(this.ValidatorList(validatorID).exists);

        return this.ValidatorList(validatorID).value.NodePoolAssignments;
    }

    getNFDRegistryID(): uint64 {
        return this.NFDRegistryAppID;
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
        const validatorID = this.NumValidators.value + 1;
        this.NumValidators.value = validatorID;

        this.ValidatorList(validatorID).create();
        this.ValidatorList(validatorID).value.Config = config;
        this.ValidatorList(validatorID).value.Config.ID = validatorID;
        // all other values being 0 is correct (for 'State' for eg)

        if (config.NFDForInfo !== 0) {
            // verify nfd is real, matches provided name, and owned by sender
            sendAppCall({
                applicationID: AppID.fromUint64(this.NFDRegistryAppID),
                applicationArgs: ['is_valid_nfd_appid', nfdName, itob(config.NFDForInfo)],
            });
            assert(btoi(this.itxn.lastLog) === 1, "provided NFD isn't valid");
            // Verify the NFDs owner is same as our sender (presumably either owner or manager)
            assert(
                this.txn.sender === (AppID.fromUint64(config.NFDForInfo).globalState('i.owner.a') as Address),
                'If specifying NFD, account adding validator must be owner'
            );
        }
        if (config.EntryGatingType === GATING_TYPE_CREATED_BY_NFD_ADDRESSES) {
            // we require the NFD we compare against to be the one set in NFDForInfo
            assert(config.NFDForInfo !== 0, 'an NFD must be specified for the validator when gating by NFD addresses');
        }
        if (config.EntryGatingType === GATING_TYPE_SEGMENT_OF_NFD) {
            // verify gating NFD is at least 'real' - since we just have app id - fetch its name then do is valid call
            const nfdRootAppID = extractUint64(config.EntryGatingValue, 0);
            assert(this.isNFDAppIDValid(nfdRootAppID), 'provided NFD App ID for gating must be valid NFD');
        }
        return validatorID;
    }

    /**
     * Changes the Validator Manager for a specific Validator ID.
     * [ ONLY OWNER CAN CHANGE ]
     *
     * @param {ValidatorID} validatorID - The ID of the validator to change the manager for.
     * @param {Address} manager - The new manager address.
     */
    changeValidatorManager(validatorID: ValidatorID, manager: Address): void {
        assert(this.txn.sender === this.ValidatorList(validatorID).value.Config.Owner);
        this.ValidatorList(validatorID).value.Config.Manager = manager;
    }

    /**
     * Updates the sunset information for a given validator.
     * [ ONLY OWNER CAN CHANGE ]
     *
     * @param {ValidatorID} validatorID - The ID of the validator to update.
     * @param {uint64} sunsettingOn - The new sunset timestamp.
     * @param {uint64} sunsettingTo - The new sunset to validator ID.
     */
    changeValidatorSunsetInfo(validatorID: ValidatorID, sunsettingOn: uint64, sunsettingTo: ValidatorID): void {
        assert(this.txn.sender === this.ValidatorList(validatorID).value.Config.Owner);
        this.ValidatorList(validatorID).value.Config.SunsettingOn = sunsettingOn;
        this.ValidatorList(validatorID).value.Config.SunsettingTo = sunsettingTo;
    }

    /**
     * Changes the NFD for a validator in the ValidatorList contract.
     * [ ONLY OWNER OR MANAGER CAN CHANGE ]
     *
     * @param {ValidatorID} validatorID - The ID of the validator to update.
     * @param {uint64} nfdAppID - The application ID of the NFD to assign to the validator.
     * @param {string} nfdName - The name of the NFD (which must match)
     */
    changeValidatorNFD(validatorID: ValidatorID, nfdAppID: uint64, nfdName: string): void {
        // Must be called by the owner or manager of the validator.
        assert(
            this.txn.sender === this.ValidatorList(validatorID).value.Config.Owner ||
                this.txn.sender === this.ValidatorList(validatorID).value.Config.Manager
        );
        // verify nfd is real, and owned by owner or manager
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

    /**
     * Change the commission address that validator rewards are sent to.
     [ ONLY OWNER CAN CHANGE ]
     */
    changeValidatorCommissionAddress(validatorID: ValidatorID, commissionAddress: Address): void {
        assert(this.txn.sender === this.ValidatorList(validatorID).value.Config.Owner);
        assert(commissionAddress !== Address.zeroAddress);
        this.ValidatorList(validatorID).value.Config.ValidatorCommissionAddress = commissionAddress;
    }

    /**
     * Allow the additional rewards (gating entry, additional token rewards) information be changed at will.
     * The validator may want to adjust the tokens or amounts.
     * [ ONLY OWNER CAN CHANGE ]
     * TODO: should there be limits on how often it can be changed?
     * TODO: when they change the RewardTokenID - pool 1 has to opt-in to it !  should it send back the remaining of prior token ?
     */
    changeValidatorRewardInfo(
        validatorID: ValidatorID,
        EntryGatingType: uint8,
        EntryGatingValue: bytes32,
        GatingAssetMinBalance: uint64,
        RewardPerPayout: uint64
    ): void {
        assert(this.txn.sender === this.ValidatorList(validatorID).value.Config.Owner);

        this.ValidatorList(validatorID).value.Config.EntryGatingType = EntryGatingType;
        this.ValidatorList(validatorID).value.Config.EntryGatingValue = EntryGatingValue;
        this.ValidatorList(validatorID).value.Config.GatingAssetMinBalance = GatingAssetMinBalance;
        this.ValidatorList(validatorID).value.Config.RewardPerPayout = RewardPerPayout;
    }

    /**
     * Adds a new pool to a validator's pool set, returning the 'key' to reference the pool in the future for staking, etc.
     * The caller must pay the cost of the validators MBR increase as well as the MBR that will be needed for the pool itself.
     *
     * [ ONLY OWNER OR MANAGER CAN call ]
     * @param {PayTxn} mbrPayment payment from caller which covers mbr increase of adding a new pool
     * @param {uint64} validatorID is ID of validator to pool to (must be owner or manager)
     * @param {uint64} nodeNum is node number to add to
     * @returns {ValidatorPoolKey} pool key to created pool
     *
     */
    addPool(mbrPayment: PayTxn, validatorID: ValidatorID, nodeNum: uint64): ValidatorPoolKey {
        // Must be called by the owner or manager of the validator.
        assert(
            this.txn.sender === this.ValidatorList(validatorID).value.Config.Owner ||
                this.txn.sender === this.ValidatorList(validatorID).value.Config.Manager
        );

        // must match MBR exactly
        verifyPayTxn(mbrPayment, { amount: this.getMbrAmounts().AddPoolMbr, receiver: this.app.address });

        assert(this.ValidatorList(validatorID).exists);

        let numPools: uint64 = this.ValidatorList(validatorID).value.State.NumPools as uint64;
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

        this.ValidatorList(validatorID).value.State.NumPools = numPools as uint16;
        // We don't need to manipulate anything in the Pools array as the '0' values are all correct for PoolInfo
        // No stakers, no algo staked
        this.ValidatorList(validatorID).value.Pools[numPools - 1].PoolAppID = this.itxn.createdApplicationID.id;
        this.addPoolToNode(validatorID, this.itxn.createdApplicationID.id, nodeNum);

        // PoolID is 1-based, 0 is invalid id
        return { ID: validatorID, PoolID: numPools as uint64, PoolAppID: this.itxn!.createdApplicationID.id };
    }

    /**
     * Adds stake to a validator pool.
     *
     * @param {PayTxn} stakedAmountPayment - payment coming from staker to place into a pool
     * @param {ValidatorID} validatorID - The ID of the validator.
     * @param {uint64} valueToVerify - only if validator has gating to enter - this is asset id or nfd id that corresponds to gating.
     * Txn sender is factored in as well if that is part of gating.
     * * @returns {ValidatorPoolKey} - The key of the validator pool.
     */
    addStake(stakedAmountPayment: PayTxn, validatorID: ValidatorID, valueToVerify: uint64): ValidatorPoolKey {
        assert(this.ValidatorList(validatorID).exists);

        const staker = this.txn.sender;
        // The prior transaction should be a payment to this pool for the amount specified.  If this is stakers
        // first time staking, then we subtract the required MBR from their payment as that MBR amount needs to stay
        // behind in this contract to cover the MBR needed for creating the 'StakerPoolSet' storage.
        verifyPayTxn(stakedAmountPayment, {
            sender: staker,
            receiver: this.app.address,
        });

        // Ensure we're not over our protocol maximum for combined stake in all pools
        assert(
            this.ValidatorList(validatorID).value.State.TotalAlgoStaked < this.maxAllowedStake(),
            'total staked for all of a validators pools may not exceed protocol maximum'
        );
        // If the validator specified that a specific token creator is required to stake, verify that the required
        // balance is held by the staker, and that the asset they offered up to validate was created by the account
        // the validator defined as its creator requirement.
        this.doesStakerMeetGating(validatorID, valueToVerify);

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
        const isNewStakerToValidator = findRet[1];
        const isNewStakerToProtocol = findRet[2];
        if (poolKey.PoolID === 0) {
            throw Error('No pool available with free stake.  Validator needs to add another pool');
        }

        // Update StakerPoolList for this found pool (new or existing)
        this.updateStakerPoolSet(staker, poolKey);
        // Send the callers algo amount (- mbrAmtLeftBehind) to the specified staking pool, and it then updates
        // the staker data.
        this.callPoolAddStake(
            stakedAmountPayment,
            poolKey,
            mbrAmtLeftBehind,
            isNewStakerToValidator,
            isNewStakerToProtocol
        );
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
     * setTokenPayoutRatio is called by Staking Pool # 1 (ONLY) to ask the validator (us) to calculate the ratios
     * of stake in the pools for subsequent token payouts (ie: 2 pools, '100' algo total staked, 60 in pool 1, and 40
     * in pool 2.  This is done so we have a stable snapshot of stake - taken once per epoch - only triggered by
     * pool 1 doing payout.  Pools other than 1 doing payout call pool 1 to ask it do it first.
     * It would be 60/40% in the PoolPctOfWhole values.  The token reward payouts then use these values instead of
     * their 'current' stake which changes as part of the payouts themselves (and people could be changing stake
     * during the epoch updates across pools)
     *
     * Multiple pools will call us via pool 1 (pool2->pool1->valdiator, etc.) so don't assert on pool1 calling multiple
     * times in same epoch.  Just return.
     *
     * @param validatorID - validator id (and thus pool) calling us.  Verified so that sender MUST be pool 1 of this validator.
     * @returns PoolTokenPayoutRatio - the finished ratio data
     */
    setTokenPayoutRatio(validatorID: ValidatorID): PoolTokenPayoutRatio {
        // Get pool 1 for this validator - caller MUST MATCH!
        const pool1AppID = this.ValidatorList(validatorID).value.Pools[0].PoolAppID;
        assert(pool1AppID !== 0);
        // Sender has to match the pool app id passed in - so we ensure only pool 1 can call us.
        if (this.txn.sender !== AppID.fromUint64(pool1AppID).address) {
            return this.ValidatorList(validatorID).value.TokenPayoutRatio;
        }

        // They can only call us if the epoch update time doesn't match what pool 1 already has - and it has to be at least
        // a full epoch since last update (unless not set).  Same check as pools themselves perform.
        const curTime = globals.latestTimestamp;
        const lastPayoutUpdate = this.ValidatorList(validatorID).value.TokenPayoutRatio.UpdatedForPayout;
        if (lastPayoutUpdate !== 0) {
            const secsSinceLastPayout = curTime - lastPayoutUpdate;
            const epochInSecs = (this.ValidatorList(validatorID).value.Config.PayoutEveryXMins as uint64) * 60;
            // We've had one payout - so we need to be at least one epoch past the last payout.
            if (secsSinceLastPayout < epochInSecs) {
                return this.ValidatorList(validatorID).value.TokenPayoutRatio;
            }
            // We've already done the calcs..
            if ((AppID.fromUint64(pool1AppID).globalState('lastPayout') as uint64) === lastPayoutUpdate) {
                return this.ValidatorList(validatorID).value.TokenPayoutRatio;
            }
        }
        this.ValidatorList(validatorID).value.TokenPayoutRatio.UpdatedForPayout = curTime;

        const curNumPools = this.ValidatorList(validatorID).value.State.NumPools as uint64;
        const totalStakeForValidator = this.ValidatorList(validatorID).value.State.TotalAlgoStaked;
        for (let i = 0; i < curNumPools; i += 1) {
            // ie: this pool 2 has 1000 algo staked and the validator has 10,000 staked total (9000 pool 1, 1000 pool 2)
            // so this pool is 10% of the total and thus it gets 10% of the avail community token reward.
            // Get our pools pct of all stake w/ 4 decimals
            // ie, based on prior eg  - (1000 * 1e6) / 10000 = 100,000 (or 10%)
            const ourPoolPctOfWhole = wideRatio(
                [this.ValidatorList(validatorID).value.Pools[i].TotalAlgoStaked, 1_000_000],
                [totalStakeForValidator]
            );
            this.ValidatorList(validatorID).value.TokenPayoutRatio.PoolPctOfWhole[i] = ourPoolPctOfWhole;
        }
        return this.ValidatorList(validatorID).value.TokenPayoutRatio;
    }

    /**
     * stakeUpdatedViaRewards is called by Staking Pools to inform the validator (us) that a particular amount of total
     * stake has been added to the specified pool.  This is used to update the stats we have in our PoolInfo storage.
     * The calling App ID is validated against our pool list as well.
     * @param {ValidatorPoolKey} poolKey - ValidatorPoolKey type
     * @param {uint64} algoToAdd - amount this validator's total stake increased via rewards
     * @param {uint64} rewardTokenAmountReserved - amount this validator's total stake increased via rewards (that should be
     * seen as 'accounted for/pending spent')
     */
    stakeUpdatedViaRewards(poolKey: ValidatorPoolKey, algoToAdd: uint64, rewardTokenAmountReserved: uint64): void {
        this.verifyPoolKeyCaller(poolKey);

        // Update the specified amount of stake (+reward tokens reserved) - update pool stats, then total validator stats
        this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].TotalAlgoStaked += algoToAdd;
        this.ValidatorList(poolKey.ID).value.State.TotalAlgoStaked += algoToAdd;
        this.ValidatorList(poolKey.ID).value.State.RewardTokenHeldBack += rewardTokenAmountReserved;

        this.TotalAlgoStaked.value += algoToAdd;

        // Re-validate the NFD as well while we're here, removing as associated nfd if no longer owner
        this.reverifyNFDOwnership(poolKey.ID);
    }

    /**
     * stakeRemoved is called by Staking Pools to inform the validator (us) that a particular amount of total stake has been removed
     * from the specified pool.  This is used to update the stats we have in our PoolInfo storage.
     * If any amount of rewardRemoved is specified, then that amount of reward is sent to the use
     * The calling App ID is validated against our pool list as well.

     * @param {ValidatorPoolKey} poolKey - ValidatorPoolKey type - [validatorID, PoolID] compound type
     * @param {Address} staker
     * @param {uint64} amountRemoved - algo amount removed
     * @param {uint64} rewardRemoved - if applicable, amount of token reward removed (by pool 1 caller) or TO remove and pay out (via pool 1 from different pool caller)
     * @param {boolean} stakerRemoved
     */
    stakeRemoved(
        poolKey: ValidatorPoolKey,
        staker: Address,
        amountRemoved: uint64,
        rewardRemoved: uint64,
        stakerRemoved: boolean
    ): void {
        if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget();
        }
        this.verifyPoolKeyCaller(poolKey);

        // Yup - we've been called by an official staking pool telling us about stake that was removed from it,
        // so we can update our validator's staking stats.
        assert(amountRemoved > 0);

        // Remove the specified amount of stake - update pool stats, then total validator stats
        this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].TotalAlgoStaked -= amountRemoved;
        this.ValidatorList(poolKey.ID).value.State.TotalAlgoStaked -= amountRemoved;
        this.TotalAlgoStaked.value -= amountRemoved;

        if (rewardRemoved > 0) {
            const rewardTokenID = this.ValidatorList(poolKey.ID).value.Config.RewardTokenID;
            assert(rewardTokenID !== 0, "rewardRemoved can't be set if validator doesn't have reward token!");
            assert(
                this.ValidatorList(poolKey.ID).value.State.RewardTokenHeldBack >= rewardRemoved,
                'reward being removed must be covered by hold back amount'
            );
            // If pool 1 is calling us, then they already sent the reward token to the staker and we just need to
            // update the RewardTokenHeldBack value and that's it.
            this.ValidatorList(poolKey.ID).value.State.RewardTokenHeldBack -= rewardRemoved;

            // If a different pool called us, then they CAN'T send the token - we've already updated the
            // RewardTokenHeldBack value and then call method in the pool that can only be called by us (the
            // validator), and can only be called on pool 1 [Index 0] - to have it do the token payout.
            if (poolKey.PoolID !== 1) {
                sendMethodCall<typeof StakingPool.prototype.payTokenReward>({
                    applicationID: AppID.fromUint64(this.ValidatorList(poolKey.ID).value.Pools[0].PoolAppID),
                    methodArgs: [staker, rewardTokenID, rewardRemoved],
                });
            }
        }

        if (stakerRemoved) {
            // remove from that pool
            this.ValidatorList(poolKey.ID).value.Pools[poolKey.PoolID - 1].TotalStakers -= 1;
            // then update the staker set.
            const removeRet = this.removeFromStakerPoolSet(staker, <ValidatorPoolKey>{
                ID: poolKey.ID,
                PoolID: poolKey.PoolID,
                PoolAppID: poolKey.PoolAppID,
            });
            const stakerOutOfThisValidator = removeRet[0];
            const stakerOutOfProtocol = removeRet[1];
            // then remove as a staker from validator stats if they're 'out' of that validators pools
            if (stakerOutOfThisValidator) {
                this.ValidatorList(poolKey.ID).value.State.TotalStakers -= 1;
            }
            // and remove from count of stakers in 'protocol' stats if they're out of ALL pools
            if (stakerOutOfProtocol) {
                this.NumStakers.value -= 1;
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
     * @returns {ValidatorPoolKey, boolean, boolean} - The pool for the staker, true/false on whether the staker is 'new'
     * to this VALIDATOR, and true/false if staker is new to the protocol.
     */
    findPoolForStaker(
        validatorID: ValidatorID,
        staker: Address,
        amountToStake: uint64
    ): [ValidatorPoolKey, boolean, boolean] {
        let isNewStakerToValidator = true;
        let isNewStakerToProtocol = true;
        // We have max per pool per validator - this value is stored in the pools as well, and they enforce it on their
        // addStake calls but the values should be the same, and we shouldn't even try to add stake if it won't even
        // be accepted.
        // However, one thing extra we also handle is have a 'soft' maximum per pool so that the amounts balance out based on
        // maxAllowedStake() (x % of all online stake) - taking that max / numPools.  This way as pools are added
        // to go beyond the individual pool maximum, the maximum for each pool starts to reflect the max allowed but
        // balanced across the pools.
        const maxPerPool = this.getCurMaxStakePerPool(validatorID);
        // If there's already a stake list for this account, walk that first, so if the staker is already in THIS
        // validator, then go to the stakers existing pool(s) w/ this validator first.
        if (this.StakerPoolSet(staker).exists) {
            const poolSet = clone(this.StakerPoolSet(staker).value);
            assert(validatorID !== 0);
            for (let i = 0; i < poolSet.length; i += 1) {
                if (globals.opcodeBudget < 300) {
                    increaseOpcodeBudget();
                }
                if (poolSet[i].ID === 0) {
                    continue;
                }
                isNewStakerToProtocol = false;
                if (poolSet[i].ID === validatorID) {
                    // Staker isn't new to this validator - but might still be out of room in this slot.
                    isNewStakerToValidator = false;
                    if (
                        this.ValidatorList(validatorID).value.Pools[poolSet[i].PoolID - 1].TotalAlgoStaked +
                            amountToStake <=
                        maxPerPool
                    ) {
                        return [poolSet[i], isNewStakerToValidator, isNewStakerToProtocol];
                    }
                }
            }
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
                return [
                    { ID: validatorID, PoolID: i + 1, PoolAppID: pools[i].PoolAppID },
                    isNewStakerToValidator,
                    isNewStakerToProtocol,
                ];
            }
        }
        // Not found is poolID 0
        return [{ ID: validatorID, PoolID: 0, PoolAppID: 0 }, isNewStakerToValidator, isNewStakerToProtocol];
    }

    /**
     * Find the specified pool (in any node number) and move it to the specified node.
     * The pool account is forced offline if moved so prior node will still run for 320 rounds but
     * new key goes online on new node soon after (320 rounds after it goes online)
     * No-op if success, asserts if not found or can't move  (no space in target)
     * [ ONLY OWNER OR MANAGER CAN CHANGE ]
     * Only callable by owner or manager
     */
    movePoolToNode(validatorID: ValidatorID, poolAppID: uint64, nodeNum: uint64): void {
        // Must be called by the owner or manager of the validator.
        assert(
            this.txn.sender === this.ValidatorList(validatorID).value.Config.Owner ||
                this.txn.sender === this.ValidatorList(validatorID).value.Config.Manager
        );

        const nodePoolAssignments = clone(this.ValidatorList(validatorID).value.NodePoolAssignments);
        assert(nodeNum >= 1 && nodeNum <= MAX_NODES);
        // iterate  all the PoolAppIDs slots to find the specified poolAppID
        for (let srcNodeIdx = 0; srcNodeIdx < MAX_NODES; srcNodeIdx += 1) {
            for (let i = 0; i < MAX_POOLS_PER_NODE; i += 1) {
                if (nodePoolAssignments.Nodes[srcNodeIdx].PoolAppIDs[i] === poolAppID) {
                    assert(nodeNum - 1 !== srcNodeIdx, "can't move to same node");
                    // found it - clear this slot
                    this.ValidatorList(validatorID).value.NodePoolAssignments.Nodes[srcNodeIdx].PoolAppIDs[i] = 0;

                    // Force that pool offline since it's moving nodes !
                    sendMethodCall<typeof StakingPool.prototype.goOffline>({
                        applicationID: AppID.fromUint64(poolAppID),
                    });

                    // now - add it to desired node
                    this.addPoolToNode(validatorID, poolAppID, nodeNum);
                    return;
                }
            }
        }
        throw Error("couldn't find pool app id in nodes to move");
    }

    /**
     * This method verifies the ownership of NFD (Named Function Data) by a validator.
     * If the ownership is no longer valid, it removes the NFD from the validator's configuration.
     *
     * @param {ValidatorID} validatorID - The ID of the validator whose data should be re-evaluated.
     */
    private reverifyNFDOwnership(validatorID: ValidatorID): void {
        const validatorConfig = this.ValidatorList(validatorID).value.Config;
        if (validatorConfig.NFDForInfo !== 0) {
            // We already verified the nfd id and name were correct at creation time - so we don't need to verify
            // the nfd is real anymore, just that its still owned by the validator.
            const nfdOwner = AppID.fromUint64(validatorConfig.NFDForInfo).globalState('i.owner.a') as Address;
            // If they no longer own the nfd - remove it (!) from the validator config
            if (validatorConfig.Owner !== nfdOwner && validatorConfig.Manager !== nfdOwner) {
                // Remove the NFD from this validator !
                this.ValidatorList(validatorID).value.Config.NFDForInfo = 0;
            }
        }
    }

    private validateConfig(config: ValidatorConfig): void {
        // Verify all the values in the ValidatorConfig are correct
        assert(config.EntryGatingType >= GATING_TYPE_NONE && config.EntryGatingType <= GATING_TYPE_CONST_MAX);
        assert(config.PayoutEveryXMins >= MIN_PAYOUT_MINS && config.PayoutEveryXMins <= MAX_PAYOUT_MINS);
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
     * @param {boolean} isNewStakerToValidator - if this is a new, first-time staker to the validator
     * @param {boolean} isNewStakerToProtocol - if this is a new, first-time staker to the protocol
     */
    private callPoolAddStake(
        stakedAmountPayment: PayTxn,
        poolKey: ValidatorPoolKey,
        mbrAmtPaid: uint64,
        isNewStakerToValidator: boolean,
        isNewStakerToProtocol: boolean
    ): void {
        if (globals.opcodeBudget < 500) {
            increaseOpcodeBudget();
        }
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

        // now update our validator and global totals
        if (isNewStakerToValidator) {
            this.ValidatorList(poolKey.ID).value.State.TotalStakers += 1;
        }
        if (isNewStakerToProtocol) {
            this.NumStakers.value += 1;
        }
        this.ValidatorList(poolKey.ID).value.State.TotalAlgoStaked += stakedAmountPayment.amount - mbrAmtPaid;
        this.TotalAlgoStaked.value += stakedAmountPayment.amount - mbrAmtPaid;
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
     * @return [boolean, boolean] [is the staker gone from ALL pools of the given VALIDATOR, and is staker gone from ALL pools]
     */
    private removeFromStakerPoolSet(staker: Address, poolKey: ValidatorPoolKey): [boolean, boolean] {
        // track how many pools staker is in, so we  can know if they remove all stake from all pools of this validator
        let inSameValidatorPoolCount = 0;
        let inAnyPoolCount = 0;
        let found = false;

        const poolSet = clone(this.StakerPoolSet(staker).value);
        for (let i = 0; i < this.StakerPoolSet(staker).value.length; i += 1) {
            if (poolSet[i].ID === 0) {
                continue;
            }
            inAnyPoolCount += 1;
            if (poolSet[i].ID === poolKey.ID) {
                if (poolSet[i] === poolKey) {
                    found = true;
                    // 'zero' it out
                    this.StakerPoolSet(staker).value[i] = { ID: 0, PoolID: 0, PoolAppID: 0 };
                } else {
                    inSameValidatorPoolCount += 1;
                }
            }
        }
        if (!found) {
            throw Error('No matching slot found when told to remove a pool from the stakers set');
        }
        // Are they completely out of the staking pool ?
        return [inSameValidatorPoolCount === 0, inAnyPoolCount === 0];
    }

    private addPoolToNode(validatorID: ValidatorID, poolAppID: uint64, nodeNum: uint64) {
        const nodePoolAssignments = clone(this.ValidatorList(validatorID).value.NodePoolAssignments);
        const maxPoolsPerNodeForThisValidator = this.ValidatorList(validatorID).value.Config.PoolsPerNode as uint64;
        // add the new staking pool to the specified node number - if there is room
        assert(nodeNum >= 1 && nodeNum <= MAX_NODES);
        // iterate  all the PoolAppIDs slots to see if any are free (non 0)
        for (let i = 0; i < maxPoolsPerNodeForThisValidator; i += 1) {
            if (nodePoolAssignments.Nodes[nodeNum - 1].PoolAppIDs[i] === 0) {
                // update box data
                this.ValidatorList(validatorID).value.NodePoolAssignments.Nodes[nodeNum - 1].PoolAppIDs[i] = poolAppID;
                return;
            }
        }
        throw Error('no available space in specified node for this pool');
    }

    /**
     * Checks if a staker meets the gating requirements specified by the validator.
     *
     * @param {ValidatorID} validatorID - The ID of the validator.
     * @param {uint64} valueToVerify - The value to verify against the gating requirements.
     * @returns {void} or asserts if requirements not met.
     */
    private doesStakerMeetGating(validatorID: ValidatorID, valueToVerify: uint64): void {
        const type = this.ValidatorList(validatorID).value.Config.EntryGatingType;
        if (type === GATING_TYPE_NONE) {
            return;
        }
        const staker = this.txn.sender;
        const gateReq = clone(this.ValidatorList(validatorID).value.Config.EntryGatingValue);

        // If an asset gating - check the balance requirement - can handle whether right asset afterward
        if (
            type === GATING_TYPE_ASSETS_CREATED_BY ||
            type === GATING_TYPE_ASSET_ID ||
            type === GATING_TYPE_CREATED_BY_NFD_ADDRESSES
        ) {
            assert(valueToVerify !== 0);
            let balRequired = this.ValidatorList(validatorID).value.Config.GatingAssetMinBalance;
            if (balRequired === 0) {
                balRequired = 1;
            }
            assert(
                staker.assetBalance(AssetID.fromUint64(valueToVerify)) >= balRequired,
                'must have required minimum balance of validator defined token to add stake'
            );
        }
        if (type === GATING_TYPE_ASSETS_CREATED_BY) {
            assert(
                AssetID.fromUint64(valueToVerify).creator === Address.fromBytes(gateReq),
                'specified asset must be created by creator that the validator defined as a requirement to stake'
            );
        }
        if (type === GATING_TYPE_ASSET_ID) {
            const requiredAsset = extractUint64(gateReq, 0);
            assert(requiredAsset !== 0);
            assert(
                valueToVerify === requiredAsset,
                'specified asset must be identical to the asset id defined as a requirement to stake'
            );
        }
        if (type === GATING_TYPE_CREATED_BY_NFD_ADDRESSES) {
            const nfdForInfo = this.ValidatorList(validatorID).value.Config.NFDForInfo;
            // Walk all the linked addresses defined by this NFD (stored packed in v.caAlgo.0.as as a 'set' of 32-byte PKs)
            // if any are the creator of the specified asset then we pass.
            assert(
                this.isAddressInNFDCAAlgoList(nfdForInfo, AssetID.fromUint64(valueToVerify).creator),
                'specified asset must be created by creator that is one of the linked addresses in an nfd'
            );
        }
        if (type === GATING_TYPE_SEGMENT_OF_NFD) {
            // verify NFD user wants to offer up for testing is at least 'real' - since we just have app id - fetch its name then do is valid call
            const userOfferedNFDAppID = valueToVerify;
            assert(this.isNFDAppIDValid(userOfferedNFDAppID), 'provided NFD must be valid');

            // now see if specified NFD's owner, or any of its caAlgo fields matches the staker's address
            assert(
                rawBytes(AppID.fromUint64(userOfferedNFDAppID).globalState('i.owner.a') as Address) ===
                    rawBytes(staker) || this.isAddressInNFDCAAlgoList(userOfferedNFDAppID, staker),
                "provided nfd for entry isn't owned or linked to the staker"
            );

            // We at least know it's a real NFD - now.. is it a segment of the root NFD the validator defined ?
            const requiredParentAppID = extractUint64(gateReq, 0);

            assert(
                (AppID.fromUint64(userOfferedNFDAppID).globalState('i.parentAppID') as uint64) === requiredParentAppID,
                'specified nfd must be a segment of the nfd the validator specified as a requirement'
            );
        }
    }

    /**
     * Checks if the given NFD App ID is valid.  Using only the App ID there's no validation against the name (ie: that nfd X is name Y)
     * So it's assumed for the caller, the app id alone is fine.  The name is fetched from the specified app id and the two
     * together are used for validity check call to the nfd registry.
     *
     * @param {uint64} nfdAppID - The NFD App ID to verify.
     *
     * @returns {boolean} - Returns true if the NFD App ID is valid, otherwise false.
     */
    private isNFDAppIDValid(nfdAppID: uint64): boolean {
        // verify NFD user wants to offer up for testing is at least 'real' - since we just have app id - fetch its name then do is valid call
        const userOfferedNFDName = AppID.fromUint64(nfdAppID).globalState('i.name') as string;

        sendAppCall({
            applicationID: AppID.fromUint64(this.NFDRegistryAppID),
            applicationArgs: ['is_valid_nfd_appid', userOfferedNFDName, itob(nfdAppID)],
        });
        return btoi(this.itxn.lastLog) === 1;
    }

    /**
     * Checks if the specified address is present in an NFDs list of verified addresses.
     * The NFD is assumed to have already been validated as official.
     *
     * @param {uint64} nfdAppID - The NFD application ID.
     * @param {Address} addrToFind - The address to find in the v.caAlgo.0.as property
     * @return {boolean} - `true` if the address is present, `false` otherwise.
     */
    private isAddressInNFDCAAlgoList(nfdAppID: uint64, addrToFind: Address): boolean {
        sendAppCall({
            applicationID: AppID.fromUint64(nfdAppID),
            applicationArgs: ['read_property', 'v.caAlgo.0.as'],
        });
        const caAlgoData = this.itxn.lastLog;
        for (let i = 0; i < caAlgoData.length; i += 32) {
            const addr = extract3(caAlgoData, i, 32);
            if (addr !== rawBytes(globals.zeroAddress) && addr === rawBytes(addrToFind)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Returns the maximum allowed stake per validator based on a percentage of all current online stake
     */
    private maxAllowedStake(): uint64 {
        const online = this.getCurrentOnlineStake();

        return wideRatio([online, MAX_VALIDATOR_PCT_OF_ONLINE], [1000]);
    }

    private getCurrentOnlineStake(): uint64 {
        // TODO - replace w/ appropriate AVM call once available but return fixed 2 billion for now.
        return 2_000_000_000_000_000;
    }
}
