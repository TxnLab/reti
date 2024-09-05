import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { algoKitLogCaptureFixture, algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Account, decodeAddress, encodeAddress, getApplicationAddress } from 'algosdk'
import { assetOptIn, transferAlgos, transferAsset } from '@algorandfoundation/algokit-utils'
import { AlgorandTestAutomationContext } from '@algorandfoundation/algokit-utils/types/testing'
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient'
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient'
import {
    addStake,
    addStakingPool,
    addValidator,
    ALGORAND_ZERO_ADDRESS_STRING,
    bigIntFromBytes,
    claimTokens,
    createAsset,
    createValidatorConfig,
    epochBalanceUpdate,
    GATING_TYPE_ASSET_ID,
    GATING_TYPE_ASSETS_CREATED_BY,
    getCurMaxStakePerPool,
    getMbrAmountsFromValidatorClient,
    getPoolAvailBalance,
    getPoolInfo,
    getProtocolConstraints,
    getStakedPoolsForAccount,
    getStakeInfoFromBoxValue,
    getStakerInfo,
    getTokenPayoutRatio,
    getValidatorState,
    incrementRoundNumberBy,
    logStakingPoolInfo,
    removeStake,
    StakedInfo,
    ValidatorConfig,
    ValidatorPoolKey,
} from '../helpers/helpers'

const FEE_SINK_ADDR = 'Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA'

const MaxPoolsPerNode = 3
// Periodically set this to max amount allowed in protocol (200 atm) but when testing more frequently this should be lowered to something like 20 stakers
// The ValidatorWFullPoolWRewards test is 'skip'ped for now - but should be periodically enabled for testing.
const MaxStakersPerPool = 200

const fixture = algorandFixture({ testAccountFunding: AlgoAmount.Algos(10000) })
const logs = algoKitLogCaptureFixture()

// algokit.Config.configure({ debug: true });

const MaxAlgoPerPool = AlgoAmount.Algos(100_000).microAlgos
let validatorMasterClient: ValidatorRegistryClient
let poolClient: StakingPoolClient

let validatorMbr: bigint
let poolMbr: bigint
let poolInitMbr: bigint
let stakerMbr: bigint

// =====
// First construct the 'template' pool and then the master validator contract that everything will use
beforeAll(async () => {
    await fixture.beforeEach()
    // testAccount here is the account that creates the Validator master contracts themselves - but basically one-time thing to be ignored
    const { algod, testAccount } = fixture.context

    // Generate staking pool template instance that the validator registry will reference
    poolClient = new StakingPoolClient(
        {
            sender: testAccount,
            resolveBy: 'id',
            id: 0,
        },
        algod,
    )
    const { approvalCompiled } = await poolClient.appClient.compile({
        deployTimeParams: {
            nfdRegistryAppId: 0,
            feeSinkAddr: decodeAddress(FEE_SINK_ADDR).publicKey,
        },
    })
    validatorMasterClient = new ValidatorRegistryClient(
        {
            sender: testAccount,
            resolveBy: 'id',
            id: 0,
            deployTimeParams: {
                nfdRegistryAppId: 0,
            },
        },
        algod,
    )

    const validatorApp = await validatorMasterClient.create.createApplication({}, { schema: { extraPages: 3 } })
    // verify that the constructed validator contract is initialized as expected
    expect(validatorApp.appId).toBeDefined()
    expect(validatorApp.appAddress).toBeDefined()

    const validatorGlobalState = await validatorMasterClient.appClient.getGlobalState()
    expect(validatorGlobalState.numV.value).toEqual(0)
    expect(validatorGlobalState.foo).toBeUndefined() // sanity check that undefined states doesn't match 0.

    // need 3 ALGO for things to really work at all w/ this validator contract account so get that out of the way
    await validatorMasterClient.appClient.fundAppAccount(AlgoAmount.Algos(3))
    // Load the staking pool contract bytecode into the validator contract via box storage so it can later deploy
    const composer = validatorMasterClient
        .compose()
        .initStakingContract({ approvalProgramSize: approvalCompiled.compiledBase64ToBytes.length })

    // load the StakingPool contract into box storage of the validator
    // call loadStakingContractData - chunking the data from approvalCompiled 2000 bytes at a time
    for (let i = 0; i < approvalCompiled.compiledBase64ToBytes.length; i += 2000) {
        composer.loadStakingContractData({
            offset: i,
            data: approvalCompiled.compiledBase64ToBytes.subarray(i, i + 2000),
        })
    }
    await composer.finalizeStakingContract({}).execute({ populateAppCallResources: true })
    ;[validatorMbr, poolMbr, poolInitMbr, stakerMbr] = await getMbrAmountsFromValidatorClient(validatorMasterClient)
})

describe('MultValidatorAddCheck', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    // Just verify adding new validators and their ids incrementing and mbrs being covered, etc.,
    test('validatorAddTests', async () => {
        const validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        const validatorsAppRef = await validatorMasterClient.appClient.getAppReference()
        const origMbr = (await fixture.context.algod.accountInformation(validatorsAppRef.appAddress).do())[
            'min-balance'
        ]

        const config = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            validatorCommissionAddress: validatorOwnerAccount.addr,
        })
        let expectedID = 1
        let validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr,
        )
        expect(validatorId).toEqual(expectedID)
        const newMbr = (await fixture.context.algod.accountInformation(validatorsAppRef.appAddress).do())['min-balance']
        expect(newMbr).toEqual(origMbr + Number(validatorMbr))

        expectedID += 1
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr,
        )
        expect(validatorId).toEqual(expectedID)
        expectedID += 1
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr,
        )
        expect(validatorId).toEqual(expectedID)
    })
})

describe('StakeAdds', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number
    let validatorOwnerAccount: Account
    let poolAppId: bigint
    let firstPoolKey: ValidatorPoolKey

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

        const config = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            validatorCommissionAddress: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            maxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            percentToValidator: 50000, // 5%
            poolsPerNode: MaxPoolsPerNode,
        })

        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr,
        )

        // Add new pool - then we'll add stake and verify balances.
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr,
        )
        // should be [validator id, pool id (1 based)]
        expect(firstPoolKey.id).toEqual(BigInt(validatorId))
        expect(firstPoolKey.poolId).toEqual(1n)

        // get the app id via contract call - it should match what we just got back in poolKey[2]
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                { sendParams: { populateAppCallResources: true } },
            )
        ).return!
        expect(firstPoolKey.poolAppId).toEqual(poolAppId)

        const stateData = await getValidatorState(validatorMasterClient, validatorId)
        expect(stateData.numPools).toEqual(1)
        expect(stateData.totalAlgoStaked).toEqual(0n)
        expect(stateData.totalStakers).toEqual(0n)

        const validatorGlobalState = await validatorMasterClient.appClient.getGlobalState()
        expect(validatorGlobalState.staked.value).toEqual(0)
        expect(validatorGlobalState.numStakers.value).toEqual(0)

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.poolAppId).toEqual(BigInt(poolAppId))
        expect(poolInfo.totalStakers).toEqual(0)
        expect(poolInfo.totalAlgoStaked).toEqual(0n)
    })

    // Creates dummy staker:
    // adds 'not enough' 1000 algo but taking out staker mbr - fails because <1000 min - checks failure
    // adds 1000 algo (plus enough to cover staker mbr)
    // tries to remove 200 algo (checks failure) because it would go below 1000 algo min.
    // adds 1000 algo more - should end at exactly 2000 algo staked
    test('firstStaker', async () => {
        // get current balance of staker pool (should already include needed MBR in balance - but subtract it out, so it's seen as the '0' amount)
        const origStakePoolInfo = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do()

        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        // Start by funding 'not enough' (we pay minimum stake [but no mbr]) - should fail (!)
        await expect(
            addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, AlgoAmount.Algos(1000), 0n),
        ).rejects.toThrowError()

        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
        )
        const [stakedPoolKey, fees1] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount1,
            0n,
        )
        // should match info from first staking pool
        expect(stakedPoolKey.id).toEqual(firstPoolKey.id)
        expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId)
        expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId)

        let poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.totalStakers).toEqual(1)
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)))

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)

        let validatorGlobalState = await validatorMasterClient.appClient.getGlobalState()
        expect(validatorGlobalState.staked.value).toEqual(stakeAmount1.microAlgos - Number(stakerMbr))
        expect(validatorGlobalState.numStakers.value).toEqual(1)

        const poolBalance1 = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do()
        expect(poolBalance1.amount).toEqual(origStakePoolInfo.amount + stakeAmount1.microAlgos - Number(stakerMbr))

        // now try to remove partial amount - which should fail because it will take staked amount to < its 'minimum amount'
        const ourPoolClient = new StakingPoolClient(
            { sender: stakerAccount, resolveBy: 'id', id: stakedPoolKey.poolAppId },
            fixture.context.algod,
        )
        await expect(removeStake(ourPoolClient, stakerAccount, AlgoAmount.Algos(200))).rejects.toThrowError()

        // verify pool stake didn't change!
        poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)))
        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)

        validatorGlobalState = await validatorMasterClient.appClient.getGlobalState()
        expect(validatorGlobalState.staked.value).toEqual(stakeAmount1.microAlgos - Number(stakerMbr))
        expect(validatorGlobalState.numStakers.value).toEqual(1)

        // stake again for 1000 more - should go to same pool (!)
        const stakeAmount2 = AlgoAmount.Algos(1000)
        const [stakedKey2, fees2] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount2,
            0n,
        )
        // should be same as what we added prior
        expect(stakedKey2.id).toEqual(firstPoolKey.id)
        expect(stakedKey2.poolId).toEqual(firstPoolKey.poolId)
        expect(stakedKey2.poolAppId).toEqual(firstPoolKey.poolAppId)
        // verify pool state changed...
        poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.totalAlgoStaked).toEqual(
            BigInt(stakeAmount1.microAlgos - Number(stakerMbr) + stakeAmount2.microAlgos),
        )
        // and global state changed
        validatorGlobalState = await validatorMasterClient.appClient.getGlobalState()
        expect(validatorGlobalState.staked.value).toEqual(
            stakeAmount1.microAlgos - Number(stakerMbr) + stakeAmount2.microAlgos,
        )

        // ....and verify data for the 'staker' is correct as well
        const stakerInfo = await getStakerInfo(ourPoolClient, stakerAccount)
        expect(encodeAddress(stakerInfo.staker.publicKey)).toEqual(stakerAccount.addr)
        // should be full 2000 algos (we included extra for mbr to begin with)
        expect(stakerInfo.balance).toEqual(BigInt(AlgoAmount.Algos(2000).microAlgos))

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)

        // let's also get list of all staked pools we're part of... should only contain 1 entry and just be our pool
        const allPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount)
        expect(allPools).toHaveLength(1)
        expect(allPools[0]).toEqual(firstPoolKey)

        // second balance check of pool - it should increase by full stake amount since existing staker staked again, so no additional
        // mbr was needed
        const poolBalance2 = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do()
        expect(poolBalance2.amount).toEqual(poolBalance1.amount + stakeAmount2.microAlgos)

        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do()
        expect(stakerAcctBalance.amount).toEqual(
            AlgoAmount.Algos(5000).microAlgos - // funded amount
                stakeAmount1.microAlgos -
                stakeAmount2.microAlgos -
                fees1.microAlgos -
                fees2.microAlgos,
        )

        // Verify 'total' staked from validator contract
        const stateData = await getValidatorState(validatorMasterClient, validatorId)
        expect(stateData.numPools).toEqual(1)
        expect(stateData.totalAlgoStaked).toEqual(
            BigInt(stakeAmount1.microAlgos + stakeAmount2.microAlgos - Number(stakerMbr)),
        )
        expect(stateData.totalStakers).toEqual(1n)
        // and. globally
        validatorGlobalState = await validatorMasterClient.appClient.getGlobalState()
        expect(validatorGlobalState.staked.value).toEqual(
            stakeAmount1.microAlgos + stakeAmount2.microAlgos - Number(stakerMbr),
        )
    })

    // Creates new staker account
    // Adds 2000 algo to pool (not caring about mbr - so actual amount will be less the stakermbr amount)
    test('nextStaker', async () => {
        // get current balance of staker pool
        const origStakePoolInfo = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do()
        // and of all pools
        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)

        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        // add 2000 stake by random staker - should go to NEW slot - but this is still their first add, so they have to pay more mbr
        // this time - since it's over minimum... don't pay 'extra' - so we should ensure that the MBR is NOT part of what we stake
        const stakeAmount1 = AlgoAmount.Algos(2000)
        const [stakedPoolKey, fees] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount1,
            0n,
        )
        // should be same as what we added prior
        expect(stakedPoolKey.id).toEqual(firstPoolKey.id)
        expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId)
        expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId)

        const poolBalance1 = await fixture.context.algod.accountInformation(getApplicationAddress(poolAppId)).do()
        expect(poolBalance1.amount).toEqual(origStakePoolInfo.amount + stakeAmount1.microAlgos - Number(stakerMbr))

        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do()
        expect(stakerAcctBalance.amount).toEqual(
            AlgoAmount.Algos(5000).microAlgos - // funded amount
                stakeAmount1.microAlgos -
                fees.microAlgos,
        )

        // let's also get list of all staked pools we're part of... should only contain 1 entry and just be our pool
        const allPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount)
        expect(allPools).toHaveLength(1)
        expect(allPools[0]).toEqual(firstPoolKey)

        // Verify 'total' staked from validator contract
        const stateData = await getValidatorState(validatorMasterClient, validatorId)
        expect(stateData.numPools).toEqual(1)
        expect(stateData.totalAlgoStaked).toEqual(
            origValidatorState.totalAlgoStaked + BigInt(stakeAmount1.microAlgos - Number(stakerMbr)),
        )
        expect(stateData.totalStakers).toEqual(BigInt(2))
    })

    test('validatorPoolCheck', async () => {
        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.poolAppId).toEqual(BigInt(poolAppId))
        expect(poolInfo.totalStakers).toEqual(2)
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(AlgoAmount.Algos(4000).microAlgos - Number(stakerMbr)))
    })

    test('addMaxPoolsAndFill', async () => {
        const pools: ValidatorPoolKey[] = []
        const stakers: Account[] = []
        const poolsToCreate = MaxPoolsPerNode

        // capture current 'total' state for all pools
        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)

        // we create 'max pools per node' new pools on new node (first pool is still there which wee added as part of beforeAll)
        for (let i = 0; i < poolsToCreate; i += 1) {
            const newPool = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                2, // add to different node - otherwise we'll fail
                validatorOwnerAccount,
                poolMbr,
                poolInitMbr,
            )
            expect(newPool.poolId).toEqual(BigInt(2 + i))
            pools.push(newPool)
        }

        for (let i = 0; i < poolsToCreate; i += 1) {
            const poolInfo = await getPoolInfo(validatorMasterClient, pools[i])
            expect(poolInfo.poolAppId).toEqual(pools[i].poolAppId)
            expect(poolInfo.totalStakers).toEqual(0)
            expect(poolInfo.totalAlgoStaked).toEqual(0n)
        }

        // now create X new stakers
        for (let i = 0; i < poolsToCreate; i += 1) {
            // fund some new staker accounts (4)
            const stakerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.MicroAlgos(MaxAlgoPerPool + AlgoAmount.Algos(4000).microAlgos),
                suppressLog: true,
            })
            stakers.push(stakerAccount)
        }
        // have the first max-1 of the max new stakers - add such that each pool is basically completely full but just
        // short, so we can still add a small amount later in a test.
        // add stake for each - each time should work and go to new pool (starting with first pool we added - the one
        // that's already there shouldn't have room).  Then next add of same size should fail. then next add of something
        // small should go to first pool again
        const stakeAmount = AlgoAmount.MicroAlgos(MaxAlgoPerPool - AlgoAmount.Algos(1000).microAlgos)
        for (let i = 0; i < poolsToCreate - 1; i += 1) {
            const [stakedPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakers[i],
                stakeAmount,
                0n,
            )
            // should go to each pool in succession since it's basically the entire pool
            expect(stakedPoolKey.id).toEqual(pools[i].id)
            expect(stakedPoolKey.poolId).toEqual(pools[i].poolId)
            expect(stakedPoolKey.poolAppId).toEqual(pools[i].poolAppId)

            expect(await getStakedPoolsForAccount(validatorMasterClient, stakers[i])).toEqual([stakedPoolKey])
        }
        // now try to add larger stake from staker max-1... should fail... nothing free
        await expect(
            addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakers[MaxPoolsPerNode - 1],
                AlgoAmount.MicroAlgos(MaxAlgoPerPool + AlgoAmount.Algos(1000).microAlgos),
                0n,
            ),
        ).rejects.toThrowError()

        // For last staker - get their staked pool list - should be empty
        expect(await getStakedPoolsForAccount(validatorMasterClient, stakers[MaxPoolsPerNode - 1])).toHaveLength(0)
        // have stakermaxPools-1 stake large amount - just barely under max - so should only fit in last pool
        const [fitTestStake1] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakers[MaxPoolsPerNode - 1],
            AlgoAmount.MicroAlgos(MaxAlgoPerPool - AlgoAmount.Algos(1000).microAlgos),
            0n,
        )
        expect(fitTestStake1.id).toEqual(pools[MaxPoolsPerNode - 1].id)
        expect(fitTestStake1.poolId).toEqual(pools[MaxPoolsPerNode - 1].poolId)
        expect(fitTestStake1.poolAppId).toEqual(pools[MaxPoolsPerNode - 1].poolAppId)

        // Now have staker maxPools-1 stake 1000 - it'll fit in last pool (just) since it first tries pools staker is already in
        const [fitTestStake2] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakers[MaxPoolsPerNode - 1],
            AlgoAmount.Algos(1000),
            0n,
        )
        expect(fitTestStake2.id).toEqual(pools[MaxPoolsPerNode - 1].id)
        expect(fitTestStake2.poolId).toEqual(pools[MaxPoolsPerNode - 1].poolId)
        expect(fitTestStake2.poolAppId).toEqual(pools[MaxPoolsPerNode - 1].poolAppId)

        // now try to add smallish stake from staker maxPools-1... should go to very first pool
        // # of stakers shouldn't increase!  They're new entrant into pool but already staked somewhere else !
        const [fitTestStake3] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakers[MaxPoolsPerNode - 1],
            AlgoAmount.Algos(1000),
            0n,
        )
        expect(fitTestStake3.id).toEqual(firstPoolKey.id)
        expect(fitTestStake3.poolId).toEqual(firstPoolKey.poolId)
        expect(fitTestStake3.poolAppId).toEqual(firstPoolKey.poolAppId)

        // For staker maxPools-1 - get their staked pool list - should now be two entries - pool maxPools+1 (pool #maxpools we added) then pool 1 (order of staking)
        const lastStakerPools = await getStakedPoolsForAccount(validatorMasterClient, stakers[MaxPoolsPerNode - 1])
        expect(lastStakerPools).toHaveLength(2)
        expect(lastStakerPools[0]).toEqual(pools[MaxPoolsPerNode - 1])
        expect(lastStakerPools[1]).toEqual(firstPoolKey)

        // Get 'total' staked from validator contract
        const stateData = await getValidatorState(validatorMasterClient, validatorId)
        consoleLogger.info(
            `num pools: ${stateData.numPools}, total staked:${stateData.totalAlgoStaked}, stakers:${stateData.totalStakers}`,
        )
        expect(stateData.numPools).toEqual(MaxPoolsPerNode + 1)
        expect(stateData.totalAlgoStaked).toEqual(
            origValidatorState.totalAlgoStaked +
                BigInt(stakeAmount.microAlgos * MaxPoolsPerNode) -
                BigInt(stakerMbr * BigInt(MaxPoolsPerNode)) +
                BigInt(AlgoAmount.Algos(2000).microAlgos),
        )
        expect(stateData.totalStakers).toEqual(BigInt(MaxPoolsPerNode + 2))
    })

    test('addThenRemoveStake', async () => {
        const stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(10_000),
            suppressLog: true,
        })
        let amountStaked = 0
        // smallish amount of stake - should just get added to first pool
        const [addStake1, fees1] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            AlgoAmount.Algos(1100),
            0n,
        )
        amountStaked += AlgoAmount.Algos(1100).microAlgos
        expect(addStake1.id).toEqual(firstPoolKey.id)
        expect(addStake1.poolId).toEqual(firstPoolKey.poolId)
        expect(addStake1.poolAppId).toEqual(firstPoolKey.poolAppId)

        // add again. should go to same place
        const [addStake2, fees2] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            AlgoAmount.Algos(2000),
            0n,
        )
        amountStaked += AlgoAmount.Algos(2000).microAlgos

        expect(addStake2.id).toEqual(firstPoolKey.id)
        expect(addStake2.poolId).toEqual(firstPoolKey.poolId)
        expect(addStake2.poolAppId).toEqual(firstPoolKey.poolAppId)

        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do()
        expect(stakerAcctBalance.amount).toEqual(
            AlgoAmount.Algos(10_000).microAlgos - // funded amount
                amountStaked -
                fees1.microAlgos -
                fees2.microAlgos,
        )

        // Verify the staked data matches....
        const allPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount)
        expect(allPools).toHaveLength(1)
        expect(allPools[0]).toEqual(firstPoolKey)
        // ....and verify data for the 'staker' is correct as well
        const ourPoolClient = new StakingPoolClient(
            { sender: stakerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod,
        )
        // The amount 'actually' staked won't include the MBR amount
        const stakerInfo = await getStakerInfo(ourPoolClient, stakerAccount)
        expect(encodeAddress(stakerInfo.staker.publicKey)).toEqual(stakerAccount.addr)
        expect(stakerInfo.balance).toEqual(BigInt(amountStaked - Number(stakerMbr)))

        // Get Pool info before removing stake..
        const preRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)

        // then remove the stake !
        const removeFees = await removeStake(
            ourPoolClient,
            stakerAccount,
            AlgoAmount.MicroAlgos(Number(stakerInfo.balance)),
        )
        const newBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do()
        expect(newBalance.amount).toEqual(
            stakerAcctBalance.amount + Number(stakerInfo.balance) - removeFees, // microAlgo for `removeStake fees
        )

        // stakers should have been reduced and stake amount should have been reduced by stake removed
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(postRemovePoolInfo.totalStakers).toEqual(preRemovePoolInfo.totalStakers - 1)
        expect(postRemovePoolInfo.totalAlgoStaked).toEqual(preRemovePoolInfo.totalAlgoStaked - stakerInfo.balance)
    })

    test('addThenRemoveAllStake', async () => {
        const stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(10_000),
            suppressLog: true,
        })
        let amountStaked = 0
        // smallish amount of stake - should just get added to first pool
        const [addStake1, addFees] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            AlgoAmount.Algos(1100),
            0n,
        )
        amountStaked += AlgoAmount.Algos(1100).microAlgos
        expect(addStake1.id).toEqual(firstPoolKey.id)
        expect(addStake1.poolId).toEqual(firstPoolKey.poolId)
        expect(addStake1.poolAppId).toEqual(firstPoolKey.poolAppId)

        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do()
        expect(stakerAcctBalance.amount).toEqual(
            AlgoAmount.Algos(10_000).microAlgos - // funded amount
                amountStaked -
                addFees.microAlgos,
        )

        // Verify the staked data matches....
        const allPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount)
        expect(allPools).toHaveLength(1)
        expect(allPools[0]).toEqual(firstPoolKey)
        // ....and verify data for the 'staker' is correct as well
        const ourPoolClient = new StakingPoolClient(
            { sender: stakerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod,
        )
        // The amount 'actually' staked won't include the MBR amount
        const stakerInfo = await getStakerInfo(ourPoolClient, stakerAccount)
        expect(encodeAddress(stakerInfo.staker.publicKey)).toEqual(stakerAccount.addr)
        expect(stakerInfo.balance).toEqual(BigInt(amountStaked - Number(stakerMbr)))

        // Get Pool info before removing stake..
        const preRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)

        // then remove ALL the stake  (specifying 0 to remove all)
        const removeFees = await removeStake(ourPoolClient, stakerAccount, AlgoAmount.MicroAlgos(0))
        const newBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do()
        expect(newBalance.amount).toEqual(
            stakerAcctBalance.amount + Number(stakerInfo.balance) - removeFees, // microAlgo for removeStake fees
        )

        // stakers should have been reduced and stake amount should have been reduced by stake removed
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(postRemovePoolInfo.totalStakers).toEqual(preRemovePoolInfo.totalStakers - 1)
        expect(postRemovePoolInfo.totalAlgoStaked).toEqual(preRemovePoolInfo.totalAlgoStaked - stakerInfo.balance)
    })

    test('getStakeInfo', async () => {
        await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'getStakeInfo')
    })
})

describe('StakeAddWMixedRemove', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number
    let validatorOwnerAccount: Account
    let firstPoolKey: ValidatorPoolKey

    beforeAll(async () => {
        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        const config = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            validatorCommissionAddress: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            maxAlgoPerPool: BigInt(MaxAlgoPerPool),
            percentToValidator: 50000,
            poolsPerNode: MaxPoolsPerNode,
        })

        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr,
        )
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr,
        )
    })
    test('addRemoveByStaker', async () => {
        const stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(10_000),
            suppressLog: true,
        })
        let amountStaked = 0
        const [addStake1] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            AlgoAmount.Algos(1100),
            0n,
        )
        amountStaked = AlgoAmount.Algos(1100).microAlgos - Number(stakerMbr)
        expect(addStake1.id).toEqual(firstPoolKey.id)
        expect(addStake1.poolId).toEqual(firstPoolKey.poolId)
        expect(addStake1.poolAppId).toEqual(firstPoolKey.poolAppId)

        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do()
        const ourPoolClient = new StakingPoolClient(
            { sender: stakerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod,
        )

        // Get Pool info before removing stake..
        const preRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        // then remove the stake !
        const removeFees = await removeStake(ourPoolClient, stakerAccount, AlgoAmount.MicroAlgos(0))
        const newBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do()
        expect(newBalance.amount).toEqual(
            stakerAcctBalance.amount + amountStaked - removeFees, // microAlgo for `removeStake fees
        )

        // stakers should have been reduced and stake amount should have been reduced by stake removed
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(postRemovePoolInfo.totalStakers).toEqual(preRemovePoolInfo.totalStakers - 1)
        expect(postRemovePoolInfo.totalAlgoStaked).toEqual(preRemovePoolInfo.totalAlgoStaked - BigInt(amountStaked))
    })

    test('addRemoveFail', async () => {
        const stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(10_000),
            suppressLog: true,
        })
        const [addStake1] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            AlgoAmount.Algos(1100),
            0n,
        )
        expect(addStake1.id).toEqual(firstPoolKey.id)
        expect(addStake1.poolId).toEqual(firstPoolKey.poolId)
        expect(addStake1.poolAppId).toEqual(firstPoolKey.poolAppId)

        const ourPoolClient = new StakingPoolClient(
            { sender: stakerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod,
        )
        const otherAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(10_000),
            suppressLog: true,
        })

        await expect(removeStake(ourPoolClient, otherAccount, AlgoAmount.MicroAlgos(0))).rejects.toThrowError()
    })

    test('addRemoveByValidator', async () => {
        const stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(10_000),
            suppressLog: true,
        })
        let amountStaked = 0
        const [addStake1] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            AlgoAmount.Algos(1100),
            0n,
        )
        amountStaked = AlgoAmount.Algos(1100).microAlgos - Number(stakerMbr)
        expect(addStake1.id).toEqual(firstPoolKey.id)
        expect(addStake1.poolId).toEqual(firstPoolKey.poolId)
        expect(addStake1.poolAppId).toEqual(firstPoolKey.poolAppId)

        const stakerAcctBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do()
        const ourPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod,
        )

        const preRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        // client is sending txns via validatorOwnerAccount - but we're removing stakerAccount's stake (to them)
        const removeFees = await removeStake(ourPoolClient, stakerAccount, AlgoAmount.MicroAlgos(0))
        const newBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do()
        expect(newBalance.amount).toEqual(
            stakerAcctBalance.amount + amountStaked - removeFees, // microAlgo for `removeStake fees
        )

        // stakers should have been reduced and stake amount should have been reduced by stake removed
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(postRemovePoolInfo.totalStakers).toEqual(preRemovePoolInfo.totalStakers - 1)
        expect(postRemovePoolInfo.totalAlgoStaked).toEqual(preRemovePoolInfo.totalAlgoStaked - BigInt(amountStaked))
    })
})

export async function verifyRewardAmounts(
    context: AlgorandTestAutomationContext,
    algoRewardedAmount: bigint,
    tokenRewardedAmount: bigint,
    stakersPriorToReward: StakedInfo[],
    stakersAfterReward: StakedInfo[],
    epochRoundLength: number,
): Promise<void> {
    // iterate stakersPriorToReward and total the 'balance' value to get a 'total amount'
    // then determine if the stakersAfterReward version's balance incremented in accordance w/ their percentage of
    // the 'total' - where they get that percentage of the rewardedAmount.
    const totalAmount = stakersPriorToReward.reduce((total, staker) => BigInt(total) + staker.balance, BigInt(0))

    // Figure out the timestamp of prior block and use that as the 'current time' for purposes
    // of matching the epoch payout calculations in the contract
    const curStatus = await context.algod.status().do()
    const lastBlock = curStatus['last-round']
    const thisEpochBegin = lastBlock - (lastBlock % epochRoundLength)
    let numStakers = 0
    for (let i = 0; i < stakersPriorToReward.length; i += 1) {
        if (encodeAddress(stakersPriorToReward[i].staker.publicKey) === ALGORAND_ZERO_ADDRESS_STRING) {
            continue
        }
        numStakers += 1
    }
    consoleLogger.info(
        `verifyRewardAmounts checking ${numStakers} stakers. ` +
            `reward:${algoRewardedAmount}, totalAmount:${totalAmount}, ` +
            `epochBegin:${thisEpochBegin}, epochLength:${epochRoundLength}`,
    )
    // Iterate all stakers - determine which haven't been for entire epoch - pay them proportionally less for having
    // less time in pool.  We keep track of their stake and then will later reduce the effective 'total staked' amount
    // by that so that the remaining stakers get the remaining reward + excess based on their % of stake against
    // remaining participants.
    let partialStakeAmount: bigint = BigInt(0)
    let algoRewardsAvail: bigint = algoRewardedAmount
    let tokenRewardsAvail: bigint = tokenRewardedAmount

    for (let i = 0; i < stakersPriorToReward.length; i += 1) {
        if (encodeAddress(stakersPriorToReward[i].staker.publicKey) === ALGORAND_ZERO_ADDRESS_STRING) {
            continue
        }
        if (stakersPriorToReward[i].entryRound >= thisEpochBegin) {
            consoleLogger.info(`staker:${i}, Entry:${stakersPriorToReward[i].entryRound} - after epoch - continuing`)
            continue
        }
        const origBalance = stakersPriorToReward[i].balance
        const origRwdTokenBal = stakersPriorToReward[i].rewardTokenBalance
        const timeInPool: bigint = BigInt(thisEpochBegin) - stakersPriorToReward[i].entryRound
        const timePercentage: bigint = (BigInt(timeInPool) * BigInt(1000)) / BigInt(epochRoundLength) // 34.7% becomes 347
        if (timePercentage < BigInt(1000)) {
            // partial staker
            const expectedReward =
                (BigInt(origBalance) * algoRewardedAmount * BigInt(timePercentage)) / (totalAmount * BigInt(1000))
            consoleLogger.info(
                `staker:${i}, Entry:${stakersPriorToReward[i].entryRound} TimePct:${timePercentage}, ` +
                    `PctTotal:${Number((origBalance * BigInt(1000)) / totalAmount) / 10} ` +
                    `ExpReward:${expectedReward}, ActReward:${stakersAfterReward[i].balance - origBalance} ` +
                    `${encodeAddress(stakersPriorToReward[i].staker.publicKey)}`,
            )

            if (origBalance + expectedReward !== stakersAfterReward[i].balance) {
                consoleLogger.warn(
                    `staker:${i} expected: ${origBalance + expectedReward} reward but got: ${stakersAfterReward[i].balance}`,
                )
                expect(stakersAfterReward[i].balance).toBe(origBalance + expectedReward)
            }
            const expectedTokenReward =
                (BigInt(origBalance) * tokenRewardedAmount * BigInt(timePercentage)) / (totalAmount * BigInt(1000))
            consoleLogger.info(
                `staker:${i}, ExpTokenReward:${expectedTokenReward}, ActTokenReward:${stakersAfterReward[i].rewardTokenBalance - origRwdTokenBal}`,
            )

            if (origRwdTokenBal + expectedTokenReward !== stakersAfterReward[i].rewardTokenBalance) {
                consoleLogger.warn(
                    `staker:${i} expected: ${origRwdTokenBal + expectedTokenReward} reward but got: ${stakersAfterReward[i].rewardTokenBalance}`,
                )
                expect(stakersAfterReward[i].rewardTokenBalance).toBe(origRwdTokenBal + expectedTokenReward)
            }

            partialStakeAmount += origBalance

            algoRewardsAvail -= expectedReward
            tokenRewardsAvail -= expectedTokenReward
        }
    }
    const newPoolTotalStake = totalAmount - partialStakeAmount

    // now go through again and only worry about full 100% time-in-epoch stakers
    for (let i = 0; i < stakersPriorToReward.length; i += 1) {
        if (encodeAddress(stakersPriorToReward[i].staker.publicKey) === ALGORAND_ZERO_ADDRESS_STRING) {
            continue
        }
        if (stakersPriorToReward[i].entryRound >= thisEpochBegin) {
            consoleLogger.info(
                `staker:${i}, ${encodeAddress(stakersPriorToReward[i].staker.publicKey)} SKIPPED because entry is newer at:${stakersPriorToReward[i].entryRound}`,
            )
        } else {
            const origBalance = stakersPriorToReward[i].balance
            const origRwdTokenBal = stakersPriorToReward[i].rewardTokenBalance
            const timeInPool: bigint = BigInt(thisEpochBegin) - stakersPriorToReward[i].entryRound
            let timePercentage: bigint = (BigInt(timeInPool) * BigInt(1000)) / BigInt(epochRoundLength) // 34.7% becomes 347
            if (timePercentage < BigInt(1000)) {
                continue
            }
            if (timePercentage > BigInt(1000)) {
                timePercentage = BigInt(1000)
            }
            const expectedReward = (BigInt(origBalance) * algoRewardsAvail) / newPoolTotalStake
            consoleLogger.info(
                `staker:${i}, TimePct:${timePercentage}, PctTotal:${Number((origBalance * BigInt(1000)) / newPoolTotalStake) / 10} ExpReward:${expectedReward}, ActReward:${stakersAfterReward[i].balance - origBalance} ${encodeAddress(stakersPriorToReward[i].staker.publicKey)}`,
            )
            const expectedTokenReward = (BigInt(origBalance) * tokenRewardsAvail) / newPoolTotalStake
            consoleLogger.info(
                `staker:${i}, ExpTokenReward:${expectedTokenReward}, ActTokenReward:${stakersAfterReward[i].rewardTokenBalance - origRwdTokenBal}`,
            )

            if (origRwdTokenBal + expectedTokenReward !== stakersAfterReward[i].rewardTokenBalance) {
                consoleLogger.warn(
                    `staker:${i} expected: ${origRwdTokenBal + expectedTokenReward} reward but got: ${stakersAfterReward[i].rewardTokenBalance}`,
                )
                expect(stakersAfterReward[i].rewardTokenBalance).toBe(origRwdTokenBal + expectedTokenReward)
            }
        }
    }
}

describe('StakeWRewards', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number
    let validatorOwnerAccount: Account
    const stakerAccounts: Account[] = []
    let poolAppId: bigint
    let firstPoolKey: ValidatorPoolKey
    let firstPoolClient: StakingPoolClient

    const PctToValidator = 5
    const epochRoundLength = 4

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

        const config = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            maxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            percentToValidator: PctToValidator * 10000,
            validatorCommissionAddress: validatorOwnerAccount.addr,
            epochRoundLength,
        })
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr,
        )

        // Add new pool - then we'll add stake and verify balances.
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr,
        )
        // should be [validator id, pool id (1 based)]
        expect(firstPoolKey.id).toEqual(BigInt(validatorId))
        expect(firstPoolKey.poolId).toEqual(1n)

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod,
        )

        // get the app id via contract call - it should match what we just got back in poolKey[2]
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                { sendParams: { populateAppCallResources: true } },
            )
        ).return!
        expect(firstPoolKey.poolAppId).toEqual(poolAppId)

        const stateData = await getValidatorState(validatorMasterClient, validatorId)
        expect(stateData.numPools).toEqual(1)
        expect(stateData.totalAlgoStaked).toEqual(0n)
        expect(stateData.totalStakers).toEqual(0n)

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.poolAppId).toEqual(BigInt(poolAppId))
        expect(poolInfo.totalStakers).toEqual(0)
        expect(poolInfo.totalAlgoStaked).toEqual(0n)
    })

    // Creates dummy staker:
    // adds 1000 algo (plus enough to cover staker mbr)
    test('firstStaker', async () => {
        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        stakerAccounts.push(stakerAccount)

        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
        )
        const [stakedPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount1,
            0n,
        )
        // should match info from first staking pool
        expect(stakedPoolKey.id).toEqual(firstPoolKey.id)
        expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId)
        expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId)

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.totalStakers).toEqual(1)
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)))

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
    })

    test('testFirstRewards', async () => {
        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

        const reward = AlgoAmount.Algos(200)
        // put some test 'reward' algos into staking pool
        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            },
            fixture.context.algod,
        )
        await incrementRoundNumberBy(fixture.context, 320 + epochRoundLength + epochRoundLength / 2)

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`)

        const payoutBefore = BigInt((await firstPoolClient.appClient.getGlobalState()).lastPayout.value as bigint)
        const epochBefore = BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint)

        // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
        const fees = await epochBalanceUpdate(firstPoolClient)
        const expectedValidatorReward = reward.microAlgos * (PctToValidator / 100)

        expect(BigInt((await firstPoolClient.appClient.getGlobalState()).lastPayout.value as bigint)).toBeGreaterThan(
            payoutBefore,
        )
        expect(BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint)).toEqual(
            epochBefore + 1n,
        )

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
        // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
        expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos + expectedValidatorReward)

        // Verify all the stakers in the pool got what we think they should have
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

        await verifyRewardAmounts(
            fixture.context,
            (BigInt(reward.microAlgos) - BigInt(expectedValidatorReward)) as bigint,
            0n,
            stakersPriorToReward as StakedInfo[],
            stakersAfterReward as StakedInfo[],
            epochRoundLength,
        )

        // the total staked should have grown as well - reward minus what the validator was paid in their commission
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(
            Number(origValidatorState.totalAlgoStaked) + (reward.microAlgos - expectedValidatorReward),
        )

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
    })

    test('extractRewards', async () => {
        const origStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do()

        // Remove it all
        const fees = await removeStake(firstPoolClient, stakerAccounts[0], AlgoAmount.Algos(1190))

        const newStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do()
        // 1000 algos staked + 190 reward (- fees for removing stake)
        expect(newStakerBalance.amount).toEqual(origStakerBalance.amount + AlgoAmount.Algos(1190).microAlgos - fees)

        // no one should be left and be 0 balance
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(postRemovePoolInfo.totalStakers).toEqual(0)
        expect(postRemovePoolInfo.totalAlgoStaked).toEqual(0n)

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(0)
        expect(Number(newValidatorState.totalStakers)).toEqual(0)

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
    })

    test('testNoRewards', async () => {
        await incrementRoundNumberBy(fixture.context, epochRoundLength)

        // Do epoch payout immediately with no new funds - should still succeed but basically do nothing
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
        const epochBefore = BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint)
        const lastPayout = BigInt((await firstPoolClient.appClient.getGlobalState()).lastPayout.value as bigint)
        const fees = await epochBalanceUpdate(firstPoolClient)

        const newGS = await firstPoolClient.appClient.getGlobalState()
        expect(BigInt(newGS.epochNumber.value as bigint)).toEqual(epochBefore + 1n)
        expect(newGS.lastPayout.value as bigint).toBeGreaterThan(lastPayout)
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
        expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos)
    })

    test('testTooEarlyEpoch', async () => {
        // put some test 'reward' algos into staking pool
        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                amount: AlgoAmount.Algos(100),
            },
            fixture.context.algod,
        )
        const params = await fixture.context.algod.getTransactionParams().do()
        // add blocks to get to exact start of new epoch
        if (params.firstRound % epochRoundLength !== 0) {
            await incrementRoundNumberBy(fixture.context, epochRoundLength - (params.firstRound % epochRoundLength))
        }
        // this payout should work...
        await epochBalanceUpdate(firstPoolClient)

        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                amount: AlgoAmount.Algos(100),
            },
            fixture.context.algod,
        )
        // We added more again - but enough time shouldn't have passed to allow another payout
        await expect(epochBalanceUpdate(firstPoolClient)).rejects.toThrowError()

        // and staked amount should still be 0
        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.totalStakers).toEqual(0)
        expect(poolInfo.totalAlgoStaked).toEqual(0n)

        await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'should be no stakers !')

        // We added 200 algo in to bump the clock a bit - and cause transactions - this is basically future reward
        // we did 1 payout - so balance should be 200 - (validator % of 100)
        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
        expect(poolBalance).toEqual(
            BigInt(AlgoAmount.Algos(200).microAlgos) -
                BigInt(AlgoAmount.Algos(100).microAlgos * (PctToValidator / 100)),
        )
        consoleLogger.info(`ending pool balance: ${poolBalance}`)
    })

    test('testPartialReward', async () => {
        // Create two (brand new!) stakers - with same amount entered - but we'll enter later to the first staker so
        // it will be a 'partial' entry into the epoch (so we can ensure partial payout occurs) for the other stakers
        // - this will verify the partial stakers have the reward divided correctly
        const partialEpochStaker1 = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        const partialEpochStaker2 = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        stakerAccounts.push(partialEpochStaker1)
        stakerAccounts.push(partialEpochStaker2)

        const params = await fixture.context.algod.getTransactionParams().do()
        // add blocks to get to block prior to start of new epoch
        await incrementRoundNumberBy(fixture.context, epochRoundLength - 1 - (params.firstRound % epochRoundLength))

        // double-check no one should be left and be 0 balance
        const checkPoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(checkPoolInfo.totalStakers).toEqual(0)
        expect(checkPoolInfo.totalAlgoStaked).toEqual(0n)

        const checkValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        expect(Number(checkValidatorState.totalAlgoStaked)).toEqual(0)
        expect(Number(checkValidatorState.totalStakers)).toEqual(0)

        // Ok, re-enter the pool so no need to pay MBR
        const stakeAmount1 = AlgoAmount.Algos(1000)
        // Add stake for first staker
        const [aPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccounts[0],
            stakeAmount1,
            0n,
        )
        expect(aPoolKey.poolAppId).toEqual(aPoolKey.poolAppId)

        const staker1Info = await getStakerInfo(firstPoolClient, stakerAccounts[0])
        const stakingPoolGS = await firstPoolClient.appClient.getGlobalState()
        consoleLogger.info(
            `lastPayout:${stakingPoolGS.lastPayout.value}, staker1 entry round: ${staker1Info.entryRound}`,
        )

        // add next staker immediately after - with such small epoch it should be somewhat smaller reward
        const partialStakersAmount = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
        )
        // Add stake for each partial-epoch staker
        const [newPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            partialEpochStaker1,
            partialStakersAmount,
            0n,
        )

        expect(newPoolKey.poolAppId).toEqual(aPoolKey.poolAppId)
        const staker2Info = await getStakerInfo(firstPoolClient, partialEpochStaker1)
        consoleLogger.info(`partialEpochStaker: new entry round: ${staker2Info.entryRound}`)
        const [newPoolKey2] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            partialEpochStaker2,
            partialStakersAmount,
            0n,
        )

        expect(newPoolKey2.poolAppId).toEqual(aPoolKey.poolAppId)
        const staker3Info = await getStakerInfo(firstPoolClient, partialEpochStaker2)
        consoleLogger.info(`partialEpochStaker: new entry round: ${staker3Info.entryRound}`)

        await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'should have three stakers')

        // ok now do payouts - and see if we can verify the expected totals
        const poolInfo = await getPoolInfo(validatorMasterClient, aPoolKey)
        expect(poolInfo.totalStakers).toEqual(3)
        // only subtract out 2 stakers mbr because only the 'fullEpochStaker' will be 'new' to staking
        expect(poolInfo.totalAlgoStaked).toEqual(
            BigInt(stakeAmount1.microAlgos + partialStakersAmount.microAlgos * 2) - 2n * stakerMbr,
        )

        // What's pool's current balance
        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
        const knownReward = poolBalance - poolInfo.totalAlgoStaked
        const expectedValidatorReward = Number(knownReward) * (PctToValidator / 100)

        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

        await incrementRoundNumberBy(fixture.context, 320 + epochRoundLength)

        // do reward calcs
        await epochBalanceUpdate(firstPoolClient)
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

        await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'after payouts')
        await verifyRewardAmounts(
            fixture.context,
            knownReward - BigInt(expectedValidatorReward),
            0n,
            stakersPriorToReward,
            stakersAfterReward,
            epochRoundLength,
        )
    })
})

describe('StakeW0Commission', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number
    let validatorOwnerAccount: Account
    const stakerAccounts: Account[] = []
    let poolAppId: bigint
    let firstPoolKey: ValidatorPoolKey
    let firstPoolClient: StakingPoolClient

    const PctToValidator = 0

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

        const config = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            maxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            percentToValidator: PctToValidator * 10000,
            validatorCommissionAddress: validatorOwnerAccount.addr,
        })
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr,
        )
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr,
        )
        expect(firstPoolKey.id).toEqual(BigInt(validatorId))
        expect(firstPoolKey.poolId).toEqual(1n)

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod,
        )
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                { sendParams: { populateAppCallResources: true } },
            )
        ).return!
        expect(firstPoolKey.poolAppId).toEqual(poolAppId)
    })

    // boilerplate at this point. just dd some stake - testing different commissions is all we care about
    test('firstStaker', async () => {
        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        stakerAccounts.push(stakerAccount)

        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
        )
        const [stakedPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount1,
            0n,
        )
        // should match info from first staking pool
        expect(stakedPoolKey.id).toEqual(firstPoolKey.id)
        expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId)
        expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId)

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.totalStakers).toEqual(1)
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)))

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
    })

    test('testFirstRewards', async () => {
        await incrementRoundNumberBy(fixture.context, 322)

        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

        const reward = AlgoAmount.Algos(200)
        // put some test 'reward' algos into staking pool
        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            },
            fixture.context.algod,
        )

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`)

        const epochBefore = BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint)

        // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
        const fees = await epochBalanceUpdate(firstPoolClient)
        const expectedValidatorReward = reward.microAlgos * (PctToValidator / 100)

        expect(BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint)).toEqual(
            epochBefore + 1n,
        )

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
        // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
        expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos + expectedValidatorReward)

        // Verify all the stakers in the pool got what we think they should have
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

        await verifyRewardAmounts(
            fixture.context,
            (BigInt(reward.microAlgos) - BigInt(expectedValidatorReward)) as bigint,
            0n,
            stakersPriorToReward as StakedInfo[],
            stakersAfterReward as StakedInfo[],
            1 as number,
        )

        // the total staked should have grown as well - reward minus what the validator was paid in their commission
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(
            Number(origValidatorState.totalAlgoStaked) + (reward.microAlgos - expectedValidatorReward),
        )

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
    })

    test('extractRewards', async () => {
        const origStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do()

        const expectedBalance = AlgoAmount.Algos(1000 + 200 - 200 * (PctToValidator / 100))
        // Remove it all
        const fees = await removeStake(firstPoolClient, stakerAccounts[0], expectedBalance)

        const newStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do()
        // 1000 algos staked + 190 reward (- fees for removing stake)
        expect(newStakerBalance.amount).toEqual(origStakerBalance.amount + expectedBalance.microAlgos - fees)

        // no one should be left and be 0 balance
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(postRemovePoolInfo.totalStakers).toEqual(0)
        expect(postRemovePoolInfo.totalAlgoStaked).toEqual(0n)

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(0)
        expect(Number(newValidatorState.totalStakers)).toEqual(0)

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
    })
})

describe('StakeW100Commission', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number
    let validatorOwnerAccount: Account
    const stakerAccounts: Account[] = []
    let poolAppId: bigint
    let firstPoolKey: ValidatorPoolKey
    let firstPoolClient: StakingPoolClient

    const PctToValidator = 100

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

        const config = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            maxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            percentToValidator: PctToValidator * 10000,
            validatorCommissionAddress: validatorOwnerAccount.addr,
        })
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr,
        )
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr,
        )
        expect(firstPoolKey.id).toEqual(BigInt(validatorId))
        expect(firstPoolKey.poolId).toEqual(1n)

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod,
        )
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                { sendParams: { populateAppCallResources: true } },
            )
        ).return!
        expect(firstPoolKey.poolAppId).toEqual(poolAppId)
    })

    // boilerplate at this point. just dd some stake - testing different commissions is all we care about
    test('firstStaker', async () => {
        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        stakerAccounts.push(stakerAccount)

        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
        )
        const [stakedPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount1,
            0n,
        )
        // should match info from first staking pool
        expect(stakedPoolKey.id).toEqual(firstPoolKey.id)
        expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId)
        expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId)

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.totalStakers).toEqual(1)
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)))

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
    })

    test('testFirstRewards', async () => {
        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

        const reward = AlgoAmount.Algos(200)
        // put some test 'reward' algos into staking pool
        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            },
            fixture.context.algod,
        )

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`)

        const epochBefore = BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint)

        // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
        const fees = await epochBalanceUpdate(firstPoolClient)
        const expectedValidatorReward = reward.microAlgos * (PctToValidator / 100)

        expect(BigInt((await firstPoolClient.appClient.getGlobalState()).epochNumber.value as bigint)).toEqual(
            epochBefore + 1n,
        )

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
        // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
        expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos + expectedValidatorReward)

        // Verify all the stakers in the pool got what we think they should have
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

        await verifyRewardAmounts(
            fixture.context,
            (BigInt(reward.microAlgos) - BigInt(expectedValidatorReward)) as bigint,
            0n,
            stakersPriorToReward as StakedInfo[],
            stakersAfterReward as StakedInfo[],
            1 as number,
        )

        // the total staked should have grown as well - reward minus what the validator was paid in their commission
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(
            Number(origValidatorState.totalAlgoStaked) + (reward.microAlgos - expectedValidatorReward),
        )

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
    })

    test('extractRewards', async () => {
        const origStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do()

        const expectedBalance = AlgoAmount.Algos(1000 + 200 - 200 * (PctToValidator / 100))
        // Remove it all
        const fees = await removeStake(firstPoolClient, stakerAccounts[0], expectedBalance)

        const newStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do()
        // 1000 algos staked + 190 reward (- fees for removing stake)
        expect(newStakerBalance.amount).toEqual(origStakerBalance.amount + expectedBalance.microAlgos - fees)

        // no one should be left and be 0 balance
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(postRemovePoolInfo.totalStakers).toEqual(0)
        expect(postRemovePoolInfo.totalAlgoStaked).toEqual(0n)

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(0)
        expect(Number(newValidatorState.totalStakers)).toEqual(0)

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
    })
})

describe('StakeWTokenWRewards', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number
    let validatorOwnerAccount: Account
    let tokenCreatorAccount: Account
    let validatorConfig: ValidatorConfig
    const stakerAccounts: Account[] = []
    let poolAppId: bigint
    let firstPoolKey: ValidatorPoolKey
    let firstPoolClient: StakingPoolClient

    let rewardTokenID: bigint
    const PctToValidator = 5
    const decimals = 0
    const tokenRewardPerPayout = BigInt(1000 * 10 ** decimals)
    const epochRoundLength = 4

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Create a reward token to pay out to stakers
        tokenCreatorAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        rewardTokenID = await createAsset(
            fixture.context.algod,
            tokenCreatorAccount,
            'Reward Token',
            'RWDTOKEN',
            100_000,
            decimals,
        )

        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

        validatorConfig = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            maxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            percentToValidator: PctToValidator * 10000,
            validatorCommissionAddress: validatorOwnerAccount.addr,
            rewardTokenID,
            rewardPerPayout: tokenRewardPerPayout, // 1000 tokens per epoch
            epochRoundLength,
        })
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            validatorConfig,
            validatorMbr,
        )

        // Add new pool - then we'll add stake and verify balances.
        // first pool needs extra .1 to cover MBR of opted-in reward token !
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr + BigInt(AlgoAmount.Algos(0.1).microAlgos),
        )
        // should be [validator id, pool id (1 based)]
        expect(firstPoolKey.id).toEqual(BigInt(validatorId))
        expect(firstPoolKey.poolId).toEqual(1n)

        // now send a bunch of our reward token to the pool !
        await transferAsset(
            {
                from: tokenCreatorAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                assetId: Number(rewardTokenID),
                amount: 5000 * 10 ** decimals,
            },
            fixture.context.algod,
        )

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod,
        )

        // get the app id via contract call - it should match what we just got back in the poolKey
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                { sendParams: { populateAppCallResources: true } },
            )
        ).return!
        expect(firstPoolKey.poolAppId).toEqual(poolAppId)

        const stateData = await getValidatorState(validatorMasterClient, validatorId)
        expect(stateData.numPools).toEqual(1)
        expect(stateData.totalAlgoStaked).toEqual(0n)
        expect(stateData.totalStakers).toEqual(0n)
        expect(stateData.rewardTokenHeldBack).toEqual(0n)

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.poolAppId).toEqual(BigInt(poolAppId))
        expect(poolInfo.totalStakers).toEqual(0)
        expect(poolInfo.totalAlgoStaked).toEqual(0n)
    })

    // Creates dummy staker:
    // adds 1000 algo (plus enough to cover staker mbr)
    test('firstStaker', async () => {
        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        stakerAccounts.push(stakerAccount)
        // opt-in to reward token
        await assetOptIn({ account: stakerAccount, assetId: Number(rewardTokenID) }, fixture.context.algod)

        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
        )
        const [stakedPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount1,
            0n,
        )
        // should match info from first staking pool
        expect(stakedPoolKey.id).toEqual(firstPoolKey.id)
        expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId)
        expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId)

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.totalStakers).toEqual(1)
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)))

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
    })

    test('testFirstRewards', async () => {
        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

        const reward = AlgoAmount.Algos(200)

        // put some test 'reward' algos into staking pool - reward tokens are already there
        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            },
            fixture.context.algod,
        )
        await incrementRoundNumberBy(fixture.context, 320 + epochRoundLength + epochRoundLength / 2)

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`)

        // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
        const fees = await epochBalanceUpdate(firstPoolClient)
        const expectedValidatorReward = reward.microAlgos * (PctToValidator / 100)

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
        // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
        expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos + expectedValidatorReward)

        // Verify all the stakers in the pool got what we think they should have
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

        await verifyRewardAmounts(
            fixture.context,
            (BigInt(reward.microAlgos) - BigInt(expectedValidatorReward)) as bigint,
            BigInt(tokenRewardPerPayout),
            stakersPriorToReward as StakedInfo[],
            stakersAfterReward as StakedInfo[],
            1 as number,
        )

        // the total staked should have grown as well - reward minus what the validator was paid in their commission
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(
            Number(origValidatorState.totalAlgoStaked) + (reward.microAlgos - expectedValidatorReward),
        )
        // await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'tokenRewardCheck');

        // the reward tokens 'held' back should've grown by the token payout amount
        expect(newValidatorState.rewardTokenHeldBack).toEqual(BigInt(validatorConfig.rewardPerPayout))

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
    })

    test('extractRewards', async () => {
        const origStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do()

        // Remove it all
        const removeFees = await removeStake(firstPoolClient, stakerAccounts[0], AlgoAmount.Algos(1190))

        const newStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[0].addr).do()
        // 1000 algos staked + 190 reward (- .004 in fees for removing stake)
        expect(newStakerBalance.amount).toEqual(
            origStakerBalance.amount + AlgoAmount.Algos(1190).microAlgos - removeFees,
        )
        // verify that reward token payout came to us
        const assetInfo = await fixture.context.algod
            .accountAssetInformation(stakerAccounts[0].addr, Number(rewardTokenID))
            .do()
        expect(BigInt(assetInfo['asset-holding'].amount)).toEqual(tokenRewardPerPayout)

        // no one should be left and be 0 balance
        const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(postRemovePoolInfo.totalStakers).toEqual(0)
        expect(postRemovePoolInfo.totalAlgoStaked).toEqual(0n)

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(0)
        expect(Number(newValidatorState.totalStakers)).toEqual(0)
        expect(newValidatorState.rewardTokenHeldBack).toEqual(0n)

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
    })

    test('testPartialReward', async () => {
        // Create second (brand new!) staker - with same amount entered - but we'll enter later to the first staker so
        // it will be a 'partial' entry into the epoch (so we can ensure partial payout occurs)
        const partialEpochStaker = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        stakerAccounts.push(partialEpochStaker)
        // opt-in to reward token
        await assetOptIn({ account: partialEpochStaker, assetId: Number(rewardTokenID) }, fixture.context.algod)

        const params = await fixture.context.algod.getTransactionParams().do()
        // add blocks to get to block prior to start of new epoch
        await incrementRoundNumberBy(fixture.context, epochRoundLength - 1 - (params.firstRound % epochRoundLength))

        // double-check no one should be left and be 0 balance
        const checkPoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(checkPoolInfo.totalStakers).toEqual(0)
        expect(checkPoolInfo.totalAlgoStaked).toEqual(0n)

        const checkValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        expect(Number(checkValidatorState.totalAlgoStaked)).toEqual(0)
        expect(Number(checkValidatorState.totalStakers)).toEqual(0)

        // Ok, re-enter the pool - but we'll be in right off the bat and be there for full epoch
        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.Algos(1000)
        // Add stake for first staker - partial epoch
        const [aPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccounts[0],
            stakeAmount1,
            0n,
        )
        expect(aPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId)

        const staker1Info = await getStakerInfo(firstPoolClient, stakerAccounts[0])
        const stakingPoolGS = await firstPoolClient.appClient.getGlobalState()
        consoleLogger.info(
            `lastPayout:${stakingPoolGS.lastPayout.value}, staker1 entry round: ${staker1Info.entryRound}`,
        )

        const stakeAmount2 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
        )

        // Add stake for partial-epoch staker
        const [newPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            partialEpochStaker,
            stakeAmount2,
            0n,
        )

        expect(newPoolKey.poolAppId).toEqual(aPoolKey.poolAppId)
        const staker2Info = await getStakerInfo(firstPoolClient, partialEpochStaker)
        consoleLogger.info(`partialEpochStaker: new entry round: ${staker2Info.entryRound}`)

        await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'should have two stakers')

        // ok now do payouts - and see if we can verify the expected totals
        const poolInfo = await getPoolInfo(validatorMasterClient, aPoolKey)
        expect(poolInfo.totalStakers).toEqual(2)
        // only subtract out 1 staker mbr because only the 'fullEpochStaker' will be 'new' to staking
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos + stakeAmount2.microAlgos) - stakerMbr)

        // What's pool's current balance
        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
        const knownReward = poolBalance - poolInfo.totalAlgoStaked
        const expectedValidatorReward = Number(knownReward) * (PctToValidator / 100)

        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

        await incrementRoundNumberBy(fixture.context, 320 + epochRoundLength)

        // do reward calcs
        await epochBalanceUpdate(firstPoolClient)
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

        await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'after payouts')
        await verifyRewardAmounts(
            fixture.context,
            knownReward - BigInt(expectedValidatorReward),
            BigInt(tokenRewardPerPayout),
            stakersPriorToReward,
            stakersAfterReward,
            epochRoundLength,
        )

        // DON'T claim!  we want some tokens remaining to be paid out left for following reclaimTokenRewards test
    })

    test('reclaimTokenRewards', async () => {
        // as 'owner' get tokens back from reward pool - but we should only get back what's not held back
        // so we verify some are held back and that we receive everything but that.
        const pool1Address = getApplicationAddress(firstPoolKey.poolAppId)
        const rewardTokenBalance = await fixture.context.algod
            .accountAssetInformation(pool1Address, Number(rewardTokenID))
            .do()

        const validatorCurState = await getValidatorState(validatorMasterClient, validatorId)
        const tokensHeldBack = validatorCurState.rewardTokenHeldBack
        expect(tokensHeldBack).toBeGreaterThan(0n)

        const ownerTokenBalPre = await fixture.context.algod
            .accountAssetInformation(tokenCreatorAccount.addr, Number(rewardTokenID))
            .do()

        // should fail - not owner of validator
        await expect(
            validatorMasterClient.emptyTokenRewards(
                { validatorId, receiver: tokenCreatorAccount.addr },
                { sendParams: { fee: AlgoAmount.MicroAlgos(3000), populateAppCallResources: true } },
            ),
        ).rejects.toThrowError()
        // now get client with our owner as caller
        const valAppRef = await validatorMasterClient.appClient.getAppReference()
        const validatorClient = new ValidatorRegistryClient(
            {
                sender: validatorOwnerAccount,
                resolveBy: 'id',
                id: valAppRef.appId,
            },
            fixture.context.algod,
        )

        const sentAmount = (
            await validatorClient.emptyTokenRewards(
                { validatorId, receiver: tokenCreatorAccount.addr },
                { sendParams: { fee: AlgoAmount.MicroAlgos(3000), populateAppCallResources: true } },
            )
        ).return!
        expect(sentAmount).toEqual(BigInt(rewardTokenBalance['asset-holding'].amount) - tokensHeldBack)
        const ownerTokenBal = await fixture.context.algod
            .accountAssetInformation(tokenCreatorAccount.addr, Number(rewardTokenID))
            .do()
        expect(ownerTokenBal['asset-holding'].amount).toEqual(
            ownerTokenBalPre['asset-holding'].amount + Number(sentAmount),
        )
    })
})

describe('StakeUnstakeAccumTests', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number
    let validatorOwnerAccount: Account
    const stakerAccounts: Account[] = []
    let poolAppId: bigint
    let firstPoolKey: ValidatorPoolKey
    let firstPoolClient: StakingPoolClient

    const PctToValidator = 5
    const epochRoundLength = 8

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

        const config = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            maxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            percentToValidator: PctToValidator * 10000,
            validatorCommissionAddress: validatorOwnerAccount.addr,
            epochRoundLength,
        })
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr,
        )

        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr,
        )
        // should be [validator id, pool id (1 based)]
        expect(firstPoolKey.id).toEqual(BigInt(validatorId))
        expect(firstPoolKey.poolId).toEqual(1n)

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod,
        )

        // get the app id via contract call - it should match what we just got back in poolKey[2]
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                { sendParams: { populateAppCallResources: true } },
            )
        ).return!
        expect(firstPoolKey.poolAppId).toEqual(poolAppId)

        const stateData = await getValidatorState(validatorMasterClient, validatorId)
        expect(stateData.numPools).toEqual(1)
        expect(stateData.totalAlgoStaked).toEqual(0n)
        expect(stateData.totalStakers).toEqual(0n)

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.poolAppId).toEqual(BigInt(poolAppId))
        expect(poolInfo.totalStakers).toEqual(0)
        expect(poolInfo.totalAlgoStaked).toEqual(0n)
    })

    // Dummy staker - add 3000 algo - and then we'll slowly remove stake to see if we can trigger remove stake bug
    test('stakeAccumTests', async () => {
        // Fund a 'staker account' that will be the new 'staker'
        const stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        stakerAccounts.push(stakerAccount)

        const stakeAmount1 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(2000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
        )
        const [stakedPoolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            stakeAmount1,
            0n,
        )
        const params = await fixture.context.algod.status().do()
        let lastBlock = params['last-round']

        // should match info from first staking pool
        expect(stakedPoolKey.id).toEqual(firstPoolKey.id)
        expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId)
        expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId)

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.totalStakers).toEqual(1)
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)))

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod,
        )
        const AVG_ROUNDS_PER_DAY = 30857 // approx 'daily' rounds for APR bins (60*60*24/2.8)
        let poolGS = await firstPoolClient.getGlobalState()
        const binRoundStart = poolGS.binRoundStart!.asBigInt()
        let roundsRemaining = binRoundStart + BigInt(AVG_ROUNDS_PER_DAY) - BigInt(lastBlock)
        consoleLogger.info(`bin start:${binRoundStart}, rounds remaining in bin:${roundsRemaining}`)
        const stakeAccum = bigIntFromBytes(poolGS.stakeAccumulator!.asByteArray())
        expect(stakeAccum).toEqual(roundsRemaining * BigInt(stakeAmount1.microAlgos - Number(stakerMbr)))

        // Ok, now add 'more' stake - we're updating existing slot for pool - ensure accumulator is updated
        const stakeAmount2 = AlgoAmount.Algos(1000)
        await addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount2, 0n)
        lastBlock = (await fixture.context.algod.status().do())['last-round']
        roundsRemaining = binRoundStart + BigInt(AVG_ROUNDS_PER_DAY) - BigInt(lastBlock)
        poolGS = await firstPoolClient.getGlobalState()
        const secondStakeAccum = bigIntFromBytes(poolGS.stakeAccumulator!.asByteArray())
        expect(secondStakeAccum).toEqual(stakeAccum + BigInt(roundsRemaining) * BigInt(stakeAmount2.microAlgos))

        // remove bits of stake
        await removeStake(firstPoolClient, stakerAccounts[0], AlgoAmount.Algos(50))
        lastBlock = (await fixture.context.algod.status().do())['last-round']
        roundsRemaining = binRoundStart + BigInt(AVG_ROUNDS_PER_DAY) - BigInt(lastBlock)
        poolGS = await firstPoolClient.getGlobalState()
        const newStakeAccum = bigIntFromBytes(poolGS.stakeAccumulator!.asByteArray())
        expect(newStakeAccum).toEqual(
            secondStakeAccum - BigInt(roundsRemaining) * BigInt(AlgoAmount.Algos(50).microAlgos),
        )

        // remove bits of stake
        await removeStake(firstPoolClient, stakerAccounts[0], AlgoAmount.Algos(50))
        lastBlock = (await fixture.context.algod.status().do())['last-round']
        roundsRemaining = binRoundStart + BigInt(AVG_ROUNDS_PER_DAY) - BigInt(lastBlock)
        poolGS = await firstPoolClient.getGlobalState()
        const thirdStakeAccum = bigIntFromBytes(poolGS.stakeAccumulator!.asByteArray())
        expect(thirdStakeAccum).toEqual(
            newStakeAccum - BigInt(roundsRemaining) * BigInt(AlgoAmount.Algos(50).microAlgos),
        )
    })
})

describe('TokenRewardOnlyTokens', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number
    let validatorOwnerAccount: Account
    let validatorConfig: ValidatorConfig
    let firstPoolKey: ValidatorPoolKey
    let firstPoolClient: StakingPoolClient
    let stakerAccount: Account

    let rewardTokenID: bigint
    const tokenRewardPerPayout = 1000n

    beforeAll(async () => {
        // Create a reward token to pay out to stakers
        const tokenCreatorAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        rewardTokenID = await createAsset(
            fixture.context.algod,
            tokenCreatorAccount,
            'Reward Token',
            'RWDTOKEN',
            100_000,
            0,
        )

        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

        validatorConfig = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            maxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            percentToValidator: 5 * 10000,
            validatorCommissionAddress: validatorOwnerAccount.addr,
            rewardTokenID,
            rewardPerPayout: tokenRewardPerPayout, // 1000 tokens per epoch
        })
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            validatorConfig,
            validatorMbr,
        )

        // Add new pool - then we'll add stake and verify balances.
        // first pool needs extra .1 to cover MBR of opted-in reward token !
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr + BigInt(AlgoAmount.Algos(0.1).microAlgos),
        )
        // should be [validator id, pool id (1 based)]
        expect(firstPoolKey.id).toEqual(BigInt(validatorId))
        expect(firstPoolKey.poolId).toEqual(1n)

        await transferAsset(
            {
                from: tokenCreatorAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                assetId: Number(rewardTokenID),
                amount: 5000,
            },
            fixture.context.algod,
        )

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod,
        )
    })

    // Creates dummy staker:
    // adds 1000 algo (plus enough to cover staker mbr)
    test('firstStaker', async () => {
        // Fund a 'staker account' that will be the new 'staker'
        stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        // opt-in to reward token
        await assetOptIn({ account: stakerAccount, assetId: Number(rewardTokenID) }, fixture.context.algod)

        // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
        // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
        // we pay the extra here so the final staked amount should be exactly 1000
        const stakeAmount1 = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
        )
        await addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount1, 0n)
        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)))
        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
    })

    test('testFirstRewards', async () => {
        await incrementRoundNumberBy(fixture.context, 322)

        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

        // Perform epoch payout calculation - should be 0 algo reward (!)
        // we should just do token payout
        const fees = await epochBalanceUpdate(firstPoolClient)

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
        // validator owner balance shouldn't have changed (other than fees to call epoch update)
        expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos)

        // Verify all the stakers in the pool got what we think they should have
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

        await verifyRewardAmounts(
            fixture.context,
            0n, // 0 algo reward
            BigInt(tokenRewardPerPayout),
            stakersPriorToReward as StakedInfo[],
            stakersAfterReward as StakedInfo[],
            1 as number,
        )

        // the total staked should have grown as well - reward minus what the validator was paid in their commission
        expect(newValidatorState.totalAlgoStaked).toEqual(origValidatorState.totalAlgoStaked)

        // the reward tokens 'held' back should've grown by the token payout amount
        expect(newValidatorState.rewardTokenHeldBack).toEqual(BigInt(validatorConfig.rewardPerPayout))

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
    })

    test('extractRewards', async () => {
        const origStakerBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do()

        // Remove it all - but w/ claimTokens call instead of removeStake
        const removeFees = await claimTokens(firstPoolClient, stakerAccount)

        const newStakerBalance = await fixture.context.algod.accountInformation(stakerAccount.addr).do()
        // 1000 algos staked + 190 reward (- .004 in fees for removing stake)
        expect(newStakerBalance.amount).toEqual(origStakerBalance.amount - removeFees)
        // verify that reward token payout came to us
        const assetInfo = await fixture.context.algod
            .accountAssetInformation(stakerAccount.addr, Number(rewardTokenID))
            .do()
        expect(BigInt(assetInfo['asset-holding'].amount)).toEqual(tokenRewardPerPayout)

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        // total staked should be same -staker shouldn't have gone away - token held back should've gone to 0
        expect(newValidatorState.totalAlgoStaked).toEqual(BigInt(AlgoAmount.Algos(1000).microAlgos))
        expect(newValidatorState.totalStakers).toEqual(1n)
        expect(newValidatorState.rewardTokenHeldBack).toEqual(0n)

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
    })
})

describe('DoublePoolWTokens', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number
    let validatorOwnerAccount: Account
    let validatorConfig: ValidatorConfig
    const stakerAccounts: Account[] = []
    let poolAppId: bigint
    const poolKeys: ValidatorPoolKey[] = []
    const poolClients: StakingPoolClient[] = []

    let rewardTokenID: bigint
    const PctToValidator = 5
    const decimals = 0
    const tokenRewardPerPayout = BigInt(1000 * 10 ** decimals)

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Create a reward token to pay out to stakers
        const tokenCreatorAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        rewardTokenID = await createAsset(
            fixture.context.algod,
            tokenCreatorAccount,
            'Reward Token',
            'RWDTOKEN',
            100_000,
            decimals,
        )

        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

        validatorConfig = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            maxAlgoPerPool: BigInt(AlgoAmount.Algos(5_000).microAlgos), // just do 5k per pool
            percentToValidator: PctToValidator * 10000,
            validatorCommissionAddress: validatorOwnerAccount.addr,
            rewardTokenID,
            rewardPerPayout: tokenRewardPerPayout, // 1000 tokens per epoch
        })
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            validatorConfig,
            validatorMbr,
        )

        // Add new pool - then we'll add stake and verify balances.
        // first pool needs extra .1 to cover MBR of opted-in reward token !
        poolKeys.push(
            await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                poolMbr,
                poolInitMbr + BigInt(AlgoAmount.Algos(0.1).microAlgos),
            ),
        )
        // should be [validator id, pool id (1 based)]
        expect(poolKeys[0].id).toEqual(BigInt(validatorId))
        expect(poolKeys[0].poolId).toEqual(1n)

        // now send a bunch of our reward token to the pool !
        await transferAsset(
            {
                from: tokenCreatorAccount,
                to: getApplicationAddress(poolKeys[0].poolAppId),
                assetId: Number(rewardTokenID),
                amount: 5000 * 10 ** decimals,
            },
            fixture.context.algod,
        )

        poolClients.push(
            new StakingPoolClient(
                { sender: validatorOwnerAccount, resolveBy: 'id', id: poolKeys[0].poolAppId },
                fixture.context.algod,
            ),
        )

        // get the app id via contract call - it should match what we just got back in the poolKey
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: poolKeys[0].id, poolId: poolKeys[0].poolId },
                { sendParams: { populateAppCallResources: true } },
            )
        ).return!
        expect(poolKeys[0].poolAppId).toEqual(poolAppId)

        const stateData = await getValidatorState(validatorMasterClient, validatorId)
        expect(stateData.numPools).toEqual(1)
        expect(stateData.totalAlgoStaked).toEqual(0n)
        expect(stateData.totalStakers).toEqual(0n)
        expect(stateData.rewardTokenHeldBack).toEqual(0n)

        const poolInfo = await getPoolInfo(validatorMasterClient, poolKeys[0])
        expect(poolInfo.poolAppId).toEqual(BigInt(poolAppId))
        expect(poolInfo.totalStakers).toEqual(0)
        expect(poolInfo.totalAlgoStaked).toEqual(0n)

        // ok - all in working order. add second pool as well - no need to do
        poolKeys.push(
            await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                poolMbr,
                poolInitMbr, // no extra .1 for pool 2 !
            ),
        )
        expect(poolKeys[1].poolId).toEqual(BigInt(2))
        poolClients.push(
            new StakingPoolClient(
                { sender: validatorOwnerAccount, resolveBy: 'id', id: poolKeys[1].poolAppId },
                fixture.context.algod,
            ),
        )
    })

    // add 2 stakers - full pool amount each
    test('addStakers', async () => {
        for (let i = 0; i < 2; i += 1) {
            const stakerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(6000),
                suppressLog: true,
            })
            stakerAccounts.push(stakerAccount)
            // opt-in to reward token
            await assetOptIn({ account: stakerAccount, assetId: Number(rewardTokenID) }, fixture.context.algod)

            const stakeAmount = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(5000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
            )
            const [stakedPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                stakeAmount,
                0n,
            )
            // each staker should land in diff pool because we're maxing the pool
            expect(stakedPoolKey.id).toEqual(poolKeys[i].id)
            expect(stakedPoolKey.poolId).toEqual(poolKeys[i].poolId)
            expect(stakedPoolKey.poolAppId).toEqual(poolKeys[i].poolAppId)

            const poolInfo = await getPoolInfo(validatorMasterClient, poolKeys[i])
            expect(poolInfo.totalStakers).toEqual(1)
            expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount.microAlgos - Number(stakerMbr)))
        }

        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(BigInt(2))
        expect((await getValidatorState(validatorMasterClient, validatorId)).totalAlgoStaked).toEqual(
            BigInt(AlgoAmount.Algos(10000).microAlgos),
        )
    })

    test('testFirstRewards', async () => {
        await incrementRoundNumberBy(fixture.context, 322)

        let cumTokRewards = 0n
        for (let poolIdx = 0; poolIdx < 2; poolIdx += 1) {
            consoleLogger.info(`testing rewards payout for pool # ${poolIdx + 1}`)
            const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
            const stakersPriorToReward = await getStakeInfoFromBoxValue(poolClients[poolIdx])
            const reward = AlgoAmount.Algos(200)
            // put some test 'reward' algos into each staking pool
            await transferAlgos(
                {
                    from: fixture.context.testAccount,
                    to: getApplicationAddress(poolKeys[poolIdx].poolAppId),
                    amount: reward,
                },
                fixture.context.algod,
            )
            // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
            const fees = await epochBalanceUpdate(poolClients[poolIdx])
            const expectedValidatorReward = reward.microAlgos * (PctToValidator / 100)
            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
            // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
            expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos + expectedValidatorReward)

            // Verify all the stakers in the pool got what we think they should have
            const stakersAfterReward = await getStakeInfoFromBoxValue(poolClients[poolIdx])

            const payoutRatio = await getTokenPayoutRatio(validatorMasterClient, validatorId)
            const tokenRewardForThisPool =
                (BigInt(tokenRewardPerPayout) * payoutRatio.PoolPctOfWhole[poolIdx]) / BigInt(1_000_000)
            cumTokRewards += tokenRewardForThisPool

            await verifyRewardAmounts(
                fixture.context,
                (BigInt(reward.microAlgos) - BigInt(expectedValidatorReward)) as bigint,
                tokenRewardForThisPool, // we split evenly into 2 pools - so token reward should be as well
                stakersPriorToReward as StakedInfo[],
                stakersAfterReward as StakedInfo[],
                1 as number,
            )

            // the total staked should have grown as well - reward minus what the validator was paid in their commission
            expect(Number(newValidatorState.totalAlgoStaked)).toEqual(
                Number(origValidatorState.totalAlgoStaked) + (reward.microAlgos - expectedValidatorReward),
            )

            // the reward tokens 'held' back should've grown by the token payout amount for this pool
            expect(newValidatorState.rewardTokenHeldBack).toEqual(cumTokRewards)
        }
    })

    test('extractRewards', async () => {
        for (let i = 0; i < 2; i += 1) {
            const origPoolInfo = await getPoolInfo(validatorMasterClient, poolKeys[i])
            const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            const stakerInfo = await getStakerInfo(poolClients[i], stakerAccounts[i])
            const origStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[i].addr).do()
            const origStakerAssetBalance = await fixture.context.algod
                .accountAssetInformation(stakerAccounts[i].addr, Number(rewardTokenID))
                .do()

            // Remove all stake
            await removeStake(poolClients[i], stakerAccounts[i], AlgoAmount.Algos(0))
            const removeFees = AlgoAmount.MicroAlgos(7000).microAlgos

            const newStakerBalance = await fixture.context.algod.accountInformation(stakerAccounts[i].addr).do()

            expect(BigInt(newStakerBalance.amount)).toEqual(
                BigInt(origStakerBalance.amount) + stakerInfo.balance - BigInt(removeFees),
            )
            // verify that pending reward token payout came to us
            const newStakerAssetBalance = await fixture.context.algod
                .accountAssetInformation(stakerAccounts[i].addr, Number(rewardTokenID))
                .do()
            expect(BigInt(newStakerAssetBalance['asset-holding'].amount)).toEqual(
                BigInt(origStakerAssetBalance['asset-holding'].amount) + stakerInfo.rewardTokenBalance,
            )

            // no one should be left and be 0 balance
            const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, poolKeys[i])
            expect(postRemovePoolInfo.totalStakers).toEqual(origPoolInfo.totalStakers - 1)
            expect(postRemovePoolInfo.totalAlgoStaked).toEqual(
                BigInt(origPoolInfo.totalAlgoStaked - stakerInfo.balance),
            )

            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            expect(newValidatorState.totalAlgoStaked).toEqual(origValidatorState.totalAlgoStaked - stakerInfo.balance)
            expect(newValidatorState.totalStakers).toEqual(origValidatorState.totalStakers - 1n)
            expect(newValidatorState.rewardTokenHeldBack).toEqual(
                BigInt(origValidatorState.rewardTokenHeldBack - stakerInfo.rewardTokenBalance),
            )
        }
    })
})

describe('TokenGatingByCreator', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number

    let tokenCreatorAccount: Account
    let validatorOwnerAccount: Account
    let validatorConfig: ValidatorConfig
    let firstPoolKey: ValidatorPoolKey

    let gatingToken1Id: bigint
    let gatingToken2Id: bigint

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Create a token that will be required for stakers to possess in order to stake
        tokenCreatorAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        gatingToken1Id = await createAsset(
            fixture.context.algod,
            tokenCreatorAccount,
            'Gating Token 1',
            'GATETK1',
            10,
            0,
        )
        gatingToken2Id = await createAsset(
            fixture.context.algod,
            tokenCreatorAccount,
            'Gating Token 2',
            'GATETK2',
            10,
            0,
        )

        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

        validatorConfig = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            maxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            percentToValidator: 5 * 10000,
            validatorCommissionAddress: validatorOwnerAccount.addr,
            // stakers must possess any token created by tokenCreatorAccount
            entryGatingType: GATING_TYPE_ASSETS_CREATED_BY,
            entryGatingAddress: tokenCreatorAccount.addr,
            gatingAssetMinBalance: 2n, // require 2 so we can see if only having 1 fails us
        })
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            validatorConfig,
            validatorMbr,
        )

        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr,
        )
    })

    describe('stakeTest', () => {
        beforeEach(fixture.beforeEach)
        beforeEach(logs.beforeEach)
        afterEach(logs.afterEach)

        let stakerAccount: Account
        let stakerCreatedTokenId: bigint
        beforeAll(async () => {
            // Fund a 'staker account' that will be the new 'staker'
            stakerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(5000),
                suppressLog: true,
            })

            await assetOptIn({ account: stakerAccount, assetId: Number(gatingToken1Id) }, fixture.context.algod)
            await assetOptIn({ account: stakerAccount, assetId: Number(gatingToken2Id) }, fixture.context.algod)
            // Send gating tokens to our staker for use in tests
            await transferAsset(
                {
                    from: tokenCreatorAccount,
                    to: stakerAccount,
                    assetId: Number(gatingToken1Id),
                    amount: 2,
                },
                fixture.context.algod,
            )
            await transferAsset(
                {
                    from: tokenCreatorAccount,
                    to: stakerAccount,
                    assetId: Number(gatingToken2Id),
                    amount: 2,
                },
                fixture.context.algod,
            )

            stakerCreatedTokenId = await createAsset(
                fixture.context.algod,
                stakerAccount,
                'Dummy Token',
                'DUMMY',
                10,
                0,
            )
        })

        test('stakeNoTokenOffered', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
            )
            await expect(
                addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount1, 0n),
            ).rejects.toThrowError()
        })

        test('stakeWrongTokenOffered', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
            )
            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    stakeAmount1,
                    stakerCreatedTokenId,
                ),
            ).rejects.toThrowError()
        })

        test('stakeWGatingToken1', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
            )
            const [stakedPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                stakeAmount1,
                gatingToken1Id,
            )
            // should match info from first staking pool
            expect(stakedPoolKey.id).toEqual(firstPoolKey.id)
            expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId)
            expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId)

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.totalStakers).toEqual(1)
            expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)))

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
        })

        test('stakeWGatingToken2', async () => {
            const stakeAmount2 = AlgoAmount.MicroAlgos(AlgoAmount.Algos(1000).microAlgos)
            const [stakedPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                stakeAmount2,
                gatingToken2Id,
            )
            // should match info from first staking pool
            expect(stakedPoolKey.id).toEqual(firstPoolKey.id)
            expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId)
            expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId)

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.totalStakers).toEqual(1)
            expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount2.microAlgos * 2))

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
        })

        test('stakeWGatingToken2NotMeetingBalReq', async () => {
            // send 1 of the token back to creator - we should now fail to add more stake because we don't meet the token minimum
            await transferAsset(
                {
                    from: stakerAccount,
                    to: tokenCreatorAccount,
                    assetId: Number(gatingToken2Id),
                    amount: 1,
                },
                fixture.context.algod,
            )

            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    AlgoAmount.MicroAlgos(AlgoAmount.Algos(1000).microAlgos),
                    gatingToken2Id,
                ),
            ).rejects.toThrowError()
        })
    })
})

describe('TokenGatingByAsset', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number

    let tokenCreatorAccount: Account
    let validatorOwnerAccount: Account
    let validatorConfig: ValidatorConfig
    let firstPoolKey: ValidatorPoolKey

    let gatingToken1Id: bigint
    let gatingToken2Id: bigint

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Create a token that will be required for stakers to possess in order to stake
        tokenCreatorAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        gatingToken1Id = await createAsset(
            fixture.context.algod,
            tokenCreatorAccount,
            'Gating Token 1 [Other by same]',
            'GATETK1',
            10,
            0,
        )
        gatingToken2Id = await createAsset(
            fixture.context.algod,
            tokenCreatorAccount,
            'Gating Token 2 [Required]',
            'GATETK2',
            10,
            0,
        )

        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

        validatorConfig = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            maxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            percentToValidator: 5 * 10000,
            validatorCommissionAddress: validatorOwnerAccount.addr,
            // stakers must possess ONLY the second gating token - explicit id !
            entryGatingType: GATING_TYPE_ASSET_ID,
            entryGatingAssets: [gatingToken2Id, 0n, 0n, 0n],
            gatingAssetMinBalance: 2n, // require 2 so we can see if only having 1 fails us
        })
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            validatorConfig,
            validatorMbr,
        )

        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr,
        )
    })

    describe('stakeTest', () => {
        beforeEach(fixture.beforeEach)
        beforeEach(logs.beforeEach)
        afterEach(logs.afterEach)

        let stakerAccount: Account
        let stakerCreatedTokenId: bigint
        beforeAll(async () => {
            // Fund a 'staker account' that will be the new 'staker'
            stakerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(5000),
                suppressLog: true,
            })

            await assetOptIn({ account: stakerAccount, assetId: Number(gatingToken1Id) }, fixture.context.algod)
            await assetOptIn({ account: stakerAccount, assetId: Number(gatingToken2Id) }, fixture.context.algod)
            // Send gating tokens to our staker for use in tests
            await transferAsset(
                {
                    from: tokenCreatorAccount,
                    to: stakerAccount,
                    assetId: Number(gatingToken1Id),
                    amount: 2,
                },
                fixture.context.algod,
            )
            await transferAsset(
                {
                    from: tokenCreatorAccount,
                    to: stakerAccount,
                    assetId: Number(gatingToken2Id),
                    amount: 2,
                },
                fixture.context.algod,
            )

            stakerCreatedTokenId = await createAsset(
                fixture.context.algod,
                stakerAccount,
                'Dummy Token',
                'DUMMY',
                10,
                0,
            )
        })

        test('stakeNoTokenOffered', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
            )
            await expect(
                addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount1, 0n),
            ).rejects.toThrowError()
        })

        test('stakeWrongTokenOffered', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
            )
            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    stakeAmount1,
                    stakerCreatedTokenId,
                ),
            ).rejects.toThrowError()
        })

        test('stakeWGatingToken1ShouldFail', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
            )
            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    stakeAmount1,
                    gatingToken1Id,
                ),
            ).rejects.toThrowError()
        })

        test('stakeWGatingToken2ShouldPass', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
            )
            const [stakedPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                stakeAmount1,
                gatingToken2Id,
            )
            // should match info from first staking pool
            expect(stakedPoolKey.id).toEqual(firstPoolKey.id)
            expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId)
            expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId)

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.totalStakers).toEqual(1)
            expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)))

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
        })

        test('stakeWGatingToken2NotMeetingBalReq', async () => {
            // send 1 of the token back to creator - we should now fail to add more stake because we don't meet the token minimum
            await transferAsset(
                {
                    from: stakerAccount,
                    to: tokenCreatorAccount,
                    assetId: Number(gatingToken2Id),
                    amount: 1,
                },
                fixture.context.algod,
            )

            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    AlgoAmount.MicroAlgos(AlgoAmount.Algos(1000).microAlgos),
                    gatingToken2Id,
                ),
            ).rejects.toThrowError()
        })
    })
})

describe('TokenGatingMultAssets', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number

    let tokenCreatorAccount: Account
    let validatorOwnerAccount: Account
    let validatorConfig: ValidatorConfig
    let firstPoolKey: ValidatorPoolKey

    const gatingTokens: bigint[] = []

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Create a token that will be required for stakers to possess in order to stake
        tokenCreatorAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(5000),
            suppressLog: true,
        })
        // create 4 dummy assets
        for (let i = 0; i < 4; i += 1) {
            gatingTokens.push(
                await createAsset(fixture.context.algod, tokenCreatorAccount, `Gating Token ${i}`, `GATETK${i}`, 10, 0),
            )
        }

        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

        validatorConfig = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            maxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            percentToValidator: 5 * 10000,
            validatorCommissionAddress: validatorOwnerAccount.addr,
            // stakers must possess ONLY the second gating token - explicit id !
            entryGatingType: GATING_TYPE_ASSET_ID,
            entryGatingAssets: [gatingTokens[0], gatingTokens[1], gatingTokens[2], gatingTokens[3]],
            gatingAssetMinBalance: 2n, // require 2 so we can see if only having 1 fails
        })
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            validatorConfig,
            validatorMbr,
        )

        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr,
        )
    })

    describe('stakeTest', () => {
        beforeEach(fixture.beforeEach)
        beforeEach(logs.beforeEach)
        afterEach(logs.afterEach)

        let stakerAccount: Account
        let stakerCreatedTokenId: bigint
        beforeAll(async () => {
            // Fund a 'staker account' that will be the new 'staker'
            stakerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(8000),
                suppressLog: true,
            })

            for (let i = 0; i < 4; i += 1) {
                await assetOptIn({ account: stakerAccount, assetId: Number(gatingTokens[i]) }, fixture.context.algod)
                await transferAsset(
                    {
                        from: tokenCreatorAccount,
                        to: stakerAccount,
                        assetId: Number(gatingTokens[i]),
                        amount: 2,
                    },
                    fixture.context.algod,
                )
            }
            stakerCreatedTokenId = await createAsset(
                fixture.context.algod,
                stakerAccount,
                'Dummy Token',
                'DUMMY',
                10,
                0,
            )
        })

        test('stakeNoTokenOffered', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
            )
            await expect(
                addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount1, 0n),
            ).rejects.toThrowError()
        })

        test('stakeWrongTokenOffered', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
            )
            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    stakeAmount1,
                    stakerCreatedTokenId,
                ),
            ).rejects.toThrowError()
        })

        test('stakeWGatingTokens', async () => {
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
            )
            const [stakedPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                stakeAmount1,
                gatingTokens[0],
            )
            expect(stakedPoolKey.id).toEqual(firstPoolKey.id)
            expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId)
            expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId)

            let poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.totalStakers).toEqual(1)
            expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos - Number(stakerMbr)))

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)

            // Now try w/ the rest of the tokens - all should succeed and should only add more stake
            for (let i = 1; i < 4; i += 1) {
                await addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    AlgoAmount.Algos(1000),
                    gatingTokens[i],
                )
            }
            poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.totalStakers).toEqual(1)
            expect(poolInfo.totalAlgoStaked).toEqual(BigInt(AlgoAmount.Algos(1000).microAlgos * 4))
            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
        })

        test('stakeWGatingToken2ShouldPass', async () => {
            const stakeAmount1 = AlgoAmount.Algos(1000)
            const [stakedPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                stakeAmount1,
                gatingTokens[1],
            )
            expect(stakedPoolKey.id).toEqual(firstPoolKey.id)
            expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId)
            expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId)

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.totalStakers).toEqual(1)
            expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount1.microAlgos * 5))
            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
        })

        test('stakeWGatingToken2NotMeetingBalReq', async () => {
            // send 1 of a token back to creator - we should now fail to add more stake because we don't meet the token minimum
            await transferAsset(
                {
                    from: stakerAccount,
                    to: tokenCreatorAccount,
                    assetId: Number(gatingTokens[1]),
                    amount: 1,
                },
                fixture.context.algod,
            )

            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    AlgoAmount.MicroAlgos(AlgoAmount.Algos(1000).microAlgos),
                    gatingTokens[1],
                ),
            ).rejects.toThrowError()
        })
    })
})

describe('SaturatedValidator', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number

    let validatorOwnerAccount: Account
    let stakerAccount: Account
    let validatorConfig: ValidatorConfig
    const pools: ValidatorPoolKey[] = []

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

        validatorConfig = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            maxAlgoPerPool: 0n,
            percentToValidator: 5 * 10000,
            validatorCommissionAddress: validatorOwnerAccount.addr,
        })
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            validatorConfig,
            validatorMbr,
        )

        pools.push(
            await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                poolMbr,
                poolInitMbr,
            ),
        )

        stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(300e6),
            suppressLog: true,
        })
    })

    // Fill up the first pool completely
    test('stakeFillingPool', async () => {
        const constraints = await getProtocolConstraints(validatorMasterClient)
        const stakeAmount = AlgoAmount.MicroAlgos(Number(constraints.MaxAlgoPerPool + stakerMbr))
        await addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount, 0n)
        expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
        const poolInfo = await getPoolInfo(validatorMasterClient, pools[0])
        expect(poolInfo.totalStakers).toEqual(1)
        expect(poolInfo.totalAlgoStaked).toEqual(BigInt(stakeAmount.microAlgos - Number(stakerMbr)))

        // try to add again - should fail
        await expect(
            addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                AlgoAmount.MicroAlgos(1000),
                0n,
            ),
        ).rejects.toThrowError()
    })

    // Now we add 2 more pools, total of 3 - and max state per pool should reduce accordingly.
    test('addPools', async () => {
        const constraints = await getProtocolConstraints(validatorMasterClient)
        const curSoftMax = await getCurMaxStakePerPool(validatorMasterClient, validatorId)
        expect(curSoftMax).toEqual(constraints.MaxAlgoPerPool)

        for (let i = 0; i < 2; i += 1) {
            pools.push(
                await addStakingPool(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    1,
                    validatorOwnerAccount,
                    poolMbr,
                    poolInitMbr,
                ),
            )
        }
        expect((await getValidatorState(validatorMasterClient, validatorId)).numPools).toEqual(3)
        // Our maximum per pool should've changed now - to be max algo per validator / numNodes (3)
        const newSoftMax = await getCurMaxStakePerPool(validatorMasterClient, validatorId)
        expect(newSoftMax).toEqual(
            BigInt(Math.min(Number(constraints.MaxAlgoPerValidator / 3n), Number(constraints.MaxAlgoPerPool))),
        )
    })

    test('fillNewPools', async () => {
        const constraints = await getProtocolConstraints(validatorMasterClient)
        const newSoftMax = await getCurMaxStakePerPool(validatorMasterClient, validatorId)

        let [poolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            AlgoAmount.MicroAlgos(Number(newSoftMax)),
            0n,
        )
        expect(poolKey.poolId).toEqual(2n)

        const state = await getValidatorState(validatorMasterClient, validatorId)
        expect(state.totalAlgoStaked).toEqual(constraints.MaxAlgoPerPool + newSoftMax)

        // Fill again - this will put us at max and with current dev defaults at least - over saturation limit
        // 3 pools of 70m (210m) vs saturation limit of 10% of 2b or 200m.
        ;[poolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakerAccount,
            AlgoAmount.MicroAlgos(Number(newSoftMax)),
            0n,
        )
        expect(poolKey.poolId).toEqual(3n)
    })

    test('testPenalties', async () => {
        const state = await getValidatorState(validatorMasterClient, validatorId)
        const origPoolBalance = await getPoolAvailBalance(fixture.context, pools[2])

        const tmpPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: pools[2].poolAppId },
            fixture.context.algod,
        )
        const poolInfo = await getPoolInfo(validatorMasterClient, pools[2])
        const rewardAmount = AlgoAmount.Algos(200).microAlgos
        // ok, NOW it should be over the limit on next balance update - send a bit more algo - and it should be in
        // saturated state now - so reward gets diminished, validator gets nothing, rest goes to fee sink
        const rewardSender = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.MicroAlgos(rewardAmount + 4e6),
            suppressLog: true,
        })
        await transferAlgos(
            {
                from: rewardSender,
                to: getApplicationAddress(pools[2].poolAppId),
                amount: AlgoAmount.MicroAlgos(rewardAmount),
            },
            fixture.context.algod,
        )
        const wNewRewardPoolBal = await getPoolAvailBalance(fixture.context, pools[2])
        // pools account balance should be excess above totalAlgoStaked now...
        expect(wNewRewardPoolBal).toEqual(poolInfo.totalAlgoStaked + BigInt(rewardAmount))

        // but after epochBalanceUpdate - the 'staked amount' should have grown - but not by as much (depends on ratio of stake vs saturation limit)
        const origFeeSinkBal = await fixture.context.algod.accountInformation(FEE_SINK_ADDR).do()
        // make sure all the stakers are considered fully staked...
        await incrementRoundNumberBy(fixture.context, 321)

        await epochBalanceUpdate(tmpPoolClient)

        const postSaturatedPoolBal = await getPoolAvailBalance(fixture.context, pools[2])

        const constraints = await getProtocolConstraints(validatorMasterClient)

        const normalValidatorCommission = BigInt(rewardAmount) * (5n / 100n)
        let diminishedRewards = (BigInt(rewardAmount) * constraints.AmtConsideredSaturated) / state.totalAlgoStaked
        if (diminishedRewards > BigInt(rewardAmount) - normalValidatorCommission) {
            consoleLogger.info(
                `reducing awards from ${diminishedRewards} to ${BigInt(rewardAmount) - normalValidatorCommission}`,
            )
            diminishedRewards = BigInt(rewardAmount) - normalValidatorCommission
        }

        expect(postSaturatedPoolBal).toEqual(poolInfo.totalAlgoStaked + diminishedRewards)
        // reward should've been reduced with rest going to fee sink
        const newFeeSinkBal = await fixture.context.algod.accountInformation(FEE_SINK_ADDR).do()
        expect(newFeeSinkBal.amount).toBeGreaterThanOrEqual(
            origFeeSinkBal.amount + (rewardAmount - Number(diminishedRewards)),
        )
        consoleLogger.info(`diminishedRewards:${diminishedRewards}`)

        // stake should've increased by diminishedRewards
        const newPoolInfo = await getPoolInfo(validatorMasterClient, pools[2])
        const newPoolBalance = await getPoolAvailBalance(fixture.context, pools[2])
        expect(newPoolBalance).toEqual(origPoolBalance + diminishedRewards)
        expect(newPoolBalance).toEqual(newPoolInfo.totalAlgoStaked)
    })
})

describe('StakeAddRemoveBugVerify', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number
    let validatorOwnerAccount: Account
    let firstPoolKey: ValidatorPoolKey
    let firstPoolClient: StakingPoolClient

    beforeAll(async () => {
        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        const config = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            validatorCommissionAddress: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1).microAlgos),
            maxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            percentToValidator: 50000, // 5%
            poolsPerNode: MaxPoolsPerNode,
        })
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr,
        )
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr,
        )
        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod,
        )
    })

    test('addRemoveStakers', async () => {
        const stakers: Account[] = []
        for (let i = 0; i < 3; i += 1) {
            const stakerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.MicroAlgos(MaxAlgoPerPool + AlgoAmount.Algos(4000).microAlgos),
                suppressLog: true,
            })
            stakers.push(stakerAccount)
        }
        // we have 3 stakers, now stake 0, 2, 1.  Remove 2 - add stake for 1
        // with 1.0 bug it'll add entry for staker 1 twice
        const stakeAmt = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
        )
        let [poolKey] = await addStake(fixture.context, validatorMasterClient, validatorId, stakers[0], stakeAmt, 0n)
        expect(poolKey.id).toEqual(firstPoolKey.id)
        ;[poolKey] = await addStake(fixture.context, validatorMasterClient, validatorId, stakers[2], stakeAmt, 0n)
        expect(poolKey.id).toEqual(firstPoolKey.id)
        ;[poolKey] = await addStake(fixture.context, validatorMasterClient, validatorId, stakers[1], stakeAmt, 0n)
        expect(poolKey.id).toEqual(firstPoolKey.id)

        // ledger should be staker 0, 2, 1, {empty}
        let stakerData = await getStakeInfoFromBoxValue(firstPoolClient)
        expect(encodeAddress(stakerData[0].staker.publicKey)).toEqual(stakers[0].addr)
        expect(encodeAddress(stakerData[1].staker.publicKey)).toEqual(stakers[2].addr)
        expect(encodeAddress(stakerData[2].staker.publicKey)).toEqual(stakers[1].addr)
        expect(encodeAddress(stakerData[3].staker.publicKey)).toEqual(ALGORAND_ZERO_ADDRESS_STRING)
        expect(stakerData[0].balance).toEqual(1000n * 1000000n)
        expect(stakerData[1].balance).toEqual(1000n * 1000000n)
        expect(stakerData[2].balance).toEqual(1000n * 1000000n)
        expect(stakerData[3].balance).toEqual(0n)

        // now remove staker 2's stake - and we should end up with ledger of 0, {empty}, 1, {empty}
        await removeStake(firstPoolClient, stakers[2], AlgoAmount.Algos(1000))
        stakerData = await getStakeInfoFromBoxValue(firstPoolClient)
        expect(encodeAddress(stakerData[0].staker.publicKey)).toEqual(stakers[0].addr)
        expect(encodeAddress(stakerData[1].staker.publicKey)).toEqual(ALGORAND_ZERO_ADDRESS_STRING)
        expect(encodeAddress(stakerData[2].staker.publicKey)).toEqual(stakers[1].addr)
        expect(encodeAddress(stakerData[3].staker.publicKey)).toEqual(ALGORAND_ZERO_ADDRESS_STRING)
        expect(stakerData[0].balance).toEqual(1000n * 1000000n)
        expect(stakerData[1].balance).toEqual(0n)
        expect(stakerData[2].balance).toEqual(1000n * 1000000n)
        expect(stakerData[3].balance).toEqual(0n)

        // now try to add more stake for staker 1... prior bug means it'd re-add in the first empty slot !
        // verify it just adds to existing stake in later slot
        ;[poolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorId,
            stakers[1],
            AlgoAmount.Algos(500),
            0n,
        )
        expect(poolKey.id).toEqual(firstPoolKey.id)

        stakerData = await getStakeInfoFromBoxValue(firstPoolClient)
        expect(encodeAddress(stakerData[0].staker.publicKey)).toEqual(stakers[0].addr)
        expect(encodeAddress(stakerData[1].staker.publicKey)).toEqual(ALGORAND_ZERO_ADDRESS_STRING)
        expect(encodeAddress(stakerData[2].staker.publicKey)).toEqual(stakers[1].addr)
        expect(encodeAddress(stakerData[3].staker.publicKey)).toEqual(ALGORAND_ZERO_ADDRESS_STRING)
        expect(stakerData[0].balance).toEqual(1000n * 1000000n)
        expect(stakerData[1].balance).toEqual(0n)
        expect(stakerData[2].balance).toEqual(1500n * 1000000n)
        expect(stakerData[3].balance).toEqual(0n)
    })
})

describe('StakerMultiPoolAddRemoveBugVerify', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    const validatorIds: number[] = []
    const poolKeys: ValidatorPoolKey[] = []
    let validatorOwnerAccount: Account

    beforeAll(async () => {
        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        const config = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            validatorCommissionAddress: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1).microAlgos),
            maxAlgoPerPool: BigInt(MaxAlgoPerPool), // this comes into play in later tests !!
            percentToValidator: 50000, // 5%
            poolsPerNode: MaxPoolsPerNode,
        })
        validatorIds.push(
            await addValidator(fixture.context, validatorMasterClient, validatorOwnerAccount, config, validatorMbr),
        )
        poolKeys.push(
            await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorIds[0],
                1,
                validatorOwnerAccount,
                poolMbr,
                poolInitMbr,
            ),
        )
        validatorIds.push(
            await addValidator(fixture.context, validatorMasterClient, validatorOwnerAccount, config, validatorMbr),
        )
        poolKeys.push(
            await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorIds[1],
                1,
                validatorOwnerAccount,
                poolMbr,
                poolInitMbr,
            ),
        )
    })

    // Stake to validator 1, then stake to validator 2, then unstake all from validator 1 then stake again to
    // validator 2.  With bug present, validator 2 will be listed twice in staker pool set and should fail this test
    test('stakeUnstakeReproduce', async () => {
        const stakerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.MicroAlgos(MaxAlgoPerPool + AlgoAmount.Algos(4000).microAlgos),
            suppressLog: true,
        })
        const stakeAmt = AlgoAmount.MicroAlgos(
            AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
        )
        let [poolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorIds[0],
            stakerAccount,
            stakeAmt,
            0n,
        )
        expect(poolKey.id).toEqual(poolKeys[0].id)
        ;[poolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorIds[1],
            stakerAccount,
            stakeAmt,
            0n,
        )
        expect(poolKey.id).toEqual(poolKeys[1].id)

        let stakerPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount)
        expect(stakerPools).toHaveLength(2)
        expect(stakerPools[0].id).toEqual(poolKeys[0].id)
        expect(stakerPools[1].id).toEqual(poolKeys[1].id)

        expect(stakerPools[0].poolAppId).toEqual(poolKeys[0].poolAppId)
        expect(stakerPools[1].poolAppId).toEqual(poolKeys[1].poolAppId)

        // now unstake all from validator 1
        const val1Pool = new StakingPoolClient(
            { sender: stakerAccount, resolveBy: 'id', id: poolKeys[0].poolAppId },
            fixture.context.algod,
        )

        await removeStake(val1Pool, stakerAccount, AlgoAmount.Algos(0))
        stakerPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount)
        expect(stakerPools).toHaveLength(1)
        expect(stakerPools[0].id).toEqual(poolKeys[1].id)

        // stake more - but to validator 2 - prior bug would add 'new' entry in first internal slot
        ;[poolKey] = await addStake(
            fixture.context,
            validatorMasterClient,
            validatorIds[1],
            stakerAccount,
            stakeAmt,
            0n,
        )
        expect(poolKey.id).toEqual(poolKeys[1].id)

        // with prior bug this will fail because validator 2 would be added 'again' in first internal slot
        stakerPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount)
        expect(stakerPools).toHaveLength(1)
        expect(stakerPools[0].id).toEqual(poolKeys[1].id)
    })
})

// Remove skip when want to do full pool (200 stakers) testing
describe.skip('ValidatorWFullPoolWRewards', () => {
    beforeEach(fixture.beforeEach)
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    let validatorId: number
    let validatorOwnerAccount: Account
    let poolAppId: bigint
    let firstPoolKey: ValidatorPoolKey
    let firstPoolClient: StakingPoolClient

    const PctToValidator = 5
    const NumStakers = MaxStakersPerPool

    // add validator and 1 pool for subsequent stake tests
    beforeAll(async () => {
        // Fund a 'validator account' that will be the validator owner.
        validatorOwnerAccount = await fixture.context.generateAccount({
            initialFunds: AlgoAmount.Algos(500),
            suppressLog: true,
        })
        consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

        const config = createValidatorConfig({
            owner: validatorOwnerAccount.addr,
            manager: validatorOwnerAccount.addr,
            minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
            maxAlgoPerPool: BigInt(AlgoAmount.Algos(1000 * NumStakers).microAlgos), // this comes into play in later tests !!
            percentToValidator: PctToValidator * 10000,
            validatorCommissionAddress: validatorOwnerAccount.addr,
        })
        validatorId = await addValidator(
            fixture.context,
            validatorMasterClient,
            validatorOwnerAccount,
            config,
            validatorMbr,
        )

        // Add new pool - then we'll add stake and verify balances.
        firstPoolKey = await addStakingPool(
            fixture.context,
            validatorMasterClient,
            validatorId,
            1,
            validatorOwnerAccount,
            poolMbr,
            poolInitMbr,
        )
        // should be [validator id, pool id (1 based)]
        expect(firstPoolKey.id).toEqual(BigInt(validatorId))
        expect(firstPoolKey.poolId).toEqual(1n)

        firstPoolClient = new StakingPoolClient(
            { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
            fixture.context.algod,
        )

        // get the app id via contract call - it should match what we just got back in poolKey[2]
        poolAppId = (
            await validatorMasterClient.getPoolAppId(
                { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                { sendParams: { populateAppCallResources: true } },
            )
        ).return!
        expect(firstPoolKey.poolAppId).toEqual(poolAppId)

        const stateData = await getValidatorState(validatorMasterClient, validatorId)
        expect(stateData.numPools).toEqual(1)
        expect(stateData.totalAlgoStaked).toEqual(0n)
        expect(stateData.totalStakers).toEqual(0n)

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        expect(poolInfo.poolAppId).toEqual(BigInt(poolAppId))
        expect(poolInfo.totalStakers).toEqual(0)
        expect(poolInfo.totalAlgoStaked).toEqual(0n)
    })

    // Creates maxStakersPerPool stakers:
    test(
        'addStakers',
        async () => {
            for (let i = 0; i < NumStakers + 1; i += 1) {
                const stakerAccount = await fixture.context.generateAccount({
                    initialFunds: AlgoAmount.Algos(5000),
                    suppressLog: true,
                })

                // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
                // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
                // we pay the extra here so the final staked amount should be exactly 1000
                const stakeAmount1 = AlgoAmount.MicroAlgos(
                    AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
                )
                let stakedPoolKey: ValidatorPoolKey
                if (i < NumStakers) {
                    consoleLogger.info(`adding staker:${i + 1}`)
                    ;[stakedPoolKey] = await addStake(
                        fixture.context,
                        validatorMasterClient,
                        validatorId,
                        stakerAccount,
                        stakeAmount1,
                        0n,
                    )
                } else {
                    // staker # numStakers + 1 should fail because no pool is available (because we exceeded max algo)
                    await expect(
                        addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount1, 0n),
                    ).rejects.toThrowError()
                    continue
                }
                // should match info from first staking pool
                expect(stakedPoolKey.id).toEqual(firstPoolKey.id)
                expect(stakedPoolKey.poolId).toEqual(firstPoolKey.poolId)
                expect(stakedPoolKey.poolAppId).toEqual(firstPoolKey.poolAppId)

                const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
                expect(poolInfo.totalStakers).toEqual(i + 1)
                expect(poolInfo.totalAlgoStaked).toEqual(
                    BigInt(stakeAmount1.microAlgos - Number(stakerMbr)) * BigInt(i + 1),
                )

                expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(
                    BigInt(i + 1),
                )
            }
        },
        4 * 60 * 1000, // 4 mins
    )

    test('testFirstRewards', async () => {
        // ensure everyone is completely in the epoch
        await incrementRoundNumberBy(fixture.context, 320)

        const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        const ownerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
        const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

        const reward = AlgoAmount.Algos(2000)
        // put some test 'reward' algos into staking pool
        await transferAlgos(
            {
                from: fixture.context.testAccount,
                to: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            },
            fixture.context.algod,
        )

        const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
        consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`)

        // Perform epoch payout calculation  - we get back how much it cost to issue the txn
        const fees = await epochBalanceUpdate(firstPoolClient)
        const expectedValidatorReward = reward.microAlgos * (PctToValidator / 100)

        const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
        const newOwnerBalance = await fixture.context.algod.accountInformation(validatorOwnerAccount.addr).do()
        // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
        expect(newOwnerBalance.amount).toEqual(ownerBalance.amount - fees.microAlgos + expectedValidatorReward)

        // Verify all the stakers in the pool got what we think they should have
        const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

        // get time from most recent block to use as
        await verifyRewardAmounts(
            fixture.context,
            BigInt(reward.microAlgos) - BigInt(expectedValidatorReward),
            0n,
            stakersPriorToReward,
            stakersAfterReward,
            1,
        )

        // the total staked should have grown as well - reward minus what the validator was paid in their commission
        expect(Number(newValidatorState.totalAlgoStaked)).toEqual(
            Number(origValidatorState.totalAlgoStaked) + (reward.microAlgos - expectedValidatorReward),
        )

        const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
        expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
    })
})

describe('CoinFabrik Audit suggested extra tests', () => {
    describe('HI-01 Token Reward Calculation Inconsistent for Partial Stakers', () => {
        beforeEach(fixture.beforeEach)
        beforeEach(logs.beforeEach)
        afterEach(logs.afterEach)

        let validatorId: number
        let validatorOwnerAccount: Account
        let tokenCreatorAccount: Account
        let partialEpochStaker: Account
        let partialEpochStaker2: Account
        let validatorConfig: ValidatorConfig
        let poolAppId: bigint
        let firstPoolKey: ValidatorPoolKey
        let firstPoolClient: StakingPoolClient

        let rewardTokenID: bigint
        const decimals = 0
        const tokenRewardPerPayout = BigInt(1000 * 10 ** decimals)
        const epochRoundLength = 4

        beforeAll(async () => {
            // Create a reward token to pay out to stakers
            tokenCreatorAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(5000),
                suppressLog: true,
            })
            rewardTokenID = await createAsset(
                fixture.context.algod,
                tokenCreatorAccount,
                'Reward Token',
                'RWDTOKEN',
                100_000,
                decimals,
            )

            // Fund a 'validator account' that will be the validator owner.
            validatorOwnerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(500),
                suppressLog: true,
            })
            consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

            validatorConfig = createValidatorConfig({
                owner: validatorOwnerAccount.addr,
                manager: validatorOwnerAccount.addr,
                minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
                validatorCommissionAddress: validatorOwnerAccount.addr,
                rewardTokenID,
                rewardPerPayout: tokenRewardPerPayout, // 1000 tokens per epoch
                epochRoundLength,
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                validatorConfig,
                validatorMbr,
            )

            // Add new pool - then we'll add stake and verify balances.
            // first pool needs extra .1 to cover MBR of opted-in reward token !
            firstPoolKey = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                poolMbr,
                poolInitMbr + BigInt(AlgoAmount.Algos(0.1).microAlgos),
            )
            // should be [validator id, pool id (1 based)]
            expect(firstPoolKey.id).toEqual(BigInt(validatorId))
            expect(firstPoolKey.poolId).toEqual(1n)

            // now send a bunch of our reward token to the pool !
            await transferAsset(
                {
                    from: tokenCreatorAccount,
                    to: getApplicationAddress(firstPoolKey.poolAppId),
                    assetId: Number(rewardTokenID),
                    amount: 5000 * 10 ** decimals,
                },
                fixture.context.algod,
            )

            firstPoolClient = new StakingPoolClient(
                { sender: validatorOwnerAccount, resolveBy: 'id', id: firstPoolKey.poolAppId },
                fixture.context.algod,
            )

            // get the app id via contract call - it should match what we just got back in the poolKey
            poolAppId = (
                await validatorMasterClient.getPoolAppId(
                    { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                    { sendParams: { populateAppCallResources: true } },
                )
            ).return!
            expect(firstPoolKey.poolAppId).toEqual(poolAppId)

            // Create stakers for test and opt it reward asset
            partialEpochStaker = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(5000),
                suppressLog: true,
            })
            // stakerAccounts.push(partialEpochStaker)
            await assetOptIn({ account: partialEpochStaker, assetId: Number(rewardTokenID) }, fixture.context.algod)

            partialEpochStaker2 = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(5000),
                suppressLog: true,
            })
            // stakerAccounts.push(partialEpochStaker2)
            await assetOptIn({ account: partialEpochStaker2, assetId: Number(rewardTokenID) }, fixture.context.algod)
        })

        // FAILS - Reflects ISSUE H1-01
        test('Token partial epoch rewards distributed should not affect subsequent distributions during the same epoch update', async () => {
            const params = await fixture.context.algod.getTransactionParams().do()

            // increment rounds to get to the start of new epoch. This means that staking will occur 1 round after.
            await incrementRoundNumberBy(fixture.context, epochRoundLength - (params.firstRound % epochRoundLength))

            // Stake 1000 Algos + MBR
            const stakeAmount = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
            )

            // Add stake for first staker - partial epoch
            const [aPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                partialEpochStaker,
                stakeAmount,
                0n,
            )

            // Add stake for partial-epoch staker
            const [newPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                partialEpochStaker2,
                stakeAmount,
                0n,
            )

            expect(newPoolKey.poolAppId).toEqual(aPoolKey.poolAppId)

            const staker2Info = await getStakerInfo(firstPoolClient, partialEpochStaker)
            consoleLogger.info(`partialEpochStaker: new entry round: ${staker2Info.entryRound}`)

            await incrementRoundNumberBy(fixture.context, 320 + epochRoundLength)

            const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

            await epochBalanceUpdate(firstPoolClient)

            const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

            // Over 1000 rewards tokens, with 2 stakers with 50% of total each, we should get:
            // partialEpochStaker (75%) should have: 375 tokens (1000 / 2 * 0.75)
            // partialEpochStaker2 (50%) should have: 250 tokens (1000 / 2 * 0.5)
            await verifyRewardAmounts(
                fixture.context,
                0n,
                BigInt(tokenRewardPerPayout),
                stakersPriorToReward,
                stakersAfterReward,
                epochRoundLength,
            )
        })
    })

    describe('ME-02 Incorrect Validator SunsettingOn Verification', () => {
        beforeEach(fixture.beforeEach)
        beforeEach(logs.beforeEach)
        afterEach(logs.afterEach)

        let validatorId: number
        let validatorOwnerAccount: Account
        let stakerAccount: Account
        let newSunset: number

        beforeAll(async () => {
            // Fund a 'validator account' that will be the validator owner.
            validatorOwnerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(500),
                suppressLog: true,
            })
            consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

            const config = createValidatorConfig({
                owner: validatorOwnerAccount.addr,
                manager: validatorOwnerAccount.addr,
                minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
                validatorCommissionAddress: validatorOwnerAccount.addr,
            })

            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                config,
                validatorMbr,
            )

            await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                poolMbr,
                poolInitMbr,
            )

            // set sunset 1 round after now
            newSunset = (await fixture.context.algod.getTransactionParams().do()).firstRound + 1

            await validatorMasterClient
                .compose()
                .changeValidatorSunsetInfo(
                    { validatorId, sunsettingOn: newSunset, sunsettingTo: validatorId },
                    { sender: validatorOwnerAccount },
                )
                .execute({ populateAppCallResources: true, suppressLog: true })

            const newConfig = await validatorMasterClient
                .compose()
                .getValidatorConfig({ validatorId }, { sender: validatorOwnerAccount })
                .execute({ populateAppCallResources: true, suppressLog: true })

            // Check changes have been registered
            expect(new ValidatorConfig(...newConfig.returns).sunsettingOn).toEqual(BigInt(newSunset))

            // Fund a 'staker account' that will be the new 'staker'
            stakerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(5000),
                suppressLog: true,
            })
        })

        // FAILS - Reflects ISSUE ME-02
        test('Cannot stake after sunsetting', async () => {
            // Increment rounds to go beyond validator's sunset
            await incrementRoundNumberBy(fixture.context, 3)

            // Let's check that we are past the new sunset value
            expect(newSunset).toBeLessThan((await fixture.context.algod.getTransactionParams().do()).firstRound)

            const stakeAmount = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(Number(stakerMbr)).microAlgos,
            )

            // Staking should throw since we are past the validator's sunset
            await expect(
                addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount, 0n),
            ).rejects.toThrowError()
        })
    })

    describe('ME-03 Incentivizing Pool Saturation for Staker Gain', () => {
        beforeEach(fixture.beforeEach)
        beforeEach(logs.beforeEach)
        afterEach(logs.afterEach)

        let validatorId: number

        let validatorOwnerAccount: Account
        let stakerAccount: Account
        let validatorConfig: ValidatorConfig
        const pools: ValidatorPoolKey[] = []

        let pool0Client: StakingPoolClient
        let pool1Client: StakingPoolClient

        const PctToValidator = 5
        const epochRoundLength = 4
        const rewardAmount = AlgoAmount.Algos(200).microAlgos
        const expectedValidatorReward = rewardAmount * (PctToValidator / 100)
        const expectedNotSaturatedReward = rewardAmount - expectedValidatorReward

        // add validator and 3 pools for subsequent stake tests
        beforeAll(async () => {
            // Fund a 'validator account' that will be the validator owner.
            validatorOwnerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(500),
                suppressLog: true,
            })
            consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

            validatorConfig = createValidatorConfig({
                owner: validatorOwnerAccount.addr,
                manager: validatorOwnerAccount.addr,
                minEntryStake: BigInt(AlgoAmount.Algos(1000).microAlgos),
                percentToValidator: PctToValidator * 10000, // 5 %
                validatorCommissionAddress: validatorOwnerAccount.addr,
                epochRoundLength,
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                validatorConfig,
                validatorMbr,
            )

            // Get amount considered saturated from constraints (based on prior hardcoded 200m saturated or
            // network template ensuring only 20% of stake is online) and create 3 pools.
            // as may need at least three pools to reach saturation
            // (ie: 136-200m Algos saturation level, 70m hardcap maxAllowedPerPool)
            for (let i = 0; i < 3; i += 1) {
                pools.push(
                    await addStakingPool(
                        fixture.context,
                        validatorMasterClient,
                        validatorId,
                        1,
                        validatorOwnerAccount,
                        poolMbr,
                        poolInitMbr,
                    ),
                )
            }

            const rewardSender = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.MicroAlgos(rewardAmount * 2 + 2e6),
                suppressLog: true,
            })

            // Send 200 Algos rewards to pool 0 & 1
            for (let i = 0; i < 2; i += 1) {
                await transferAlgos(
                    {
                        from: rewardSender,
                        to: getApplicationAddress(pools[i].poolAppId),
                        amount: AlgoAmount.MicroAlgos(rewardAmount),
                    },
                    fixture.context.algod,
                )
            }

            pool0Client = new StakingPoolClient(
                { sender: validatorOwnerAccount, resolveBy: 'id', id: pools[0].poolAppId },
                fixture.context.algod,
            )

            pool1Client = new StakingPoolClient(
                { sender: validatorOwnerAccount, resolveBy: 'id', id: pools[1].poolAppId },
                fixture.context.algod,
            )

            stakerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(210e6),
                suppressLog: true,
            })

            // Transfer min bal to fee sink
            await transferAlgos(
                {
                    from: validatorOwnerAccount,
                    to: FEE_SINK_ADDR,
                    amount: AlgoAmount.Algos(0.1),
                },
                fixture.context.algod,
            )
        })

        // FAILS - Reflects ISSUE ME-03
        test('Saturation should not benefit stakers', async () => {
            // First, let's take the validator just below saturation and updateRewards.
            // Then, take the validator just over saturation, updateRewards and compare what stakers get in each case.
            // first lets make sure AVM 'online stake numbers' match for algo movement we've made prior to this test
            // increment by 320 rounds so AVM's view of online stake matches current balances.
            await incrementRoundNumberBy(fixture.context, 320)

            function minBigInt(x: bigint, y: bigint): bigint {
                return x < y ? x : y
            }

            const constraints = await getProtocolConstraints(validatorMasterClient)
            const amtPerPool = minBigInt(constraints.MaxAlgoPerPool, constraints.AmtConsideredSaturated / 3n)

            const stakeAmounts: AlgoAmount[] = []
            stakeAmounts.push(AlgoAmount.MicroAlgos(Number(amtPerPool + stakerMbr)))
            stakeAmounts.push(AlgoAmount.MicroAlgos(Number(amtPerPool)))

            for (let i = 0; i < 2; i += 1) {
                await addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmounts[i], 0n)
            }
            expect((await getValidatorState(validatorMasterClient, validatorId)).totalAlgoStaked).toBeLessThan(
                constraints.AmtConsideredSaturated,
            )

            // Pool 0 & Pool 1 have the same amount staked. Both have rewards for 200 Algos.
            // Let's compare their rewards if pool 0 receives their rewards before validator gets slightly saturated, and pool 1 after.

            const pool0BeforeRewards = await getPoolInfo(validatorMasterClient, pools[0])
            const pool1BeforeRewards = await getPoolInfo(validatorMasterClient, pools[1])
            const pool0StakersBeforeReward = await getStakeInfoFromBoxValue(pool0Client)
            const pool1StakersBeforeReward = await getStakeInfoFromBoxValue(pool1Client)

            expect(pool0BeforeRewards.totalAlgoStaked).toEqual(pool1BeforeRewards.totalAlgoStaked)
            expect(pool0StakersBeforeReward[0].staker).toEqual(pool1StakersBeforeReward[0].staker)
            expect(pool0StakersBeforeReward[0].balance).toEqual(pool1StakersBeforeReward[0].balance)

            // make sure all the stakers are considered fully staked...
            await incrementRoundNumberBy(fixture.context, 320 + epochRoundLength + epochRoundLength / 2)

            // Distribute rewards to pool 0 WITHOUT saturation
            await epochBalanceUpdate(pool0Client)

            const notSaturatedReward = (await getStakeInfoFromBoxValue(pool0Client))[0].totalRewarded

            expect(notSaturatedReward).toEqual(BigInt(expectedNotSaturatedReward))

            // Now, slightly saturate the validator. Notice that total stake have been increased by rewards distribution
            const validatorTotalStakeAfter = (await getValidatorState(validatorMasterClient, validatorId))
                .totalAlgoStaked

            // add 2 algo beyond to go into saturation
            const amountToSaturation = AlgoAmount.MicroAlgos(
                Number(constraints.AmtConsideredSaturated - validatorTotalStakeAfter + 1n),
            )

            const [aPoolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                amountToSaturation,
                0n,
            )

            expect(aPoolKey.poolId).toEqual(3n)

            const validatorTotalStakeAfterSaturation = (await getValidatorState(validatorMasterClient, validatorId))
                .totalAlgoStaked

            expect(validatorTotalStakeAfterSaturation).toEqual(
                validatorTotalStakeAfter + BigInt(amountToSaturation.microAlgos),
            )
            expect(validatorTotalStakeAfterSaturation).toEqual(constraints.AmtConsideredSaturated + 1n)

            // Distribute rewards for pool 1 WITH saturation. Not necessary to forward rounds because pool1 has not been updated.
            await epochBalanceUpdate(pool1Client)

            const saturatedReward = (await getStakeInfoFromBoxValue(pool1Client))[0].totalRewarded

            // Since staker had the same stake in both pools for 100% of the epoch,
            // the reward with the validator saturated should be less or ar least equal
            // to the reward with the validator NOT saturated to not incentivize adversary behavior.
            expect(saturatedReward).toBeLessThanOrEqual(notSaturatedReward)
        })
    })

    describe('MI-05 Inconsistent Configuration Validation', () => {
        beforeEach(fixture.beforeEach)
        beforeEach(logs.beforeEach)
        afterEach(logs.afterEach)

        let validatorId: number
        let validatorOwnerAccount: Account

        beforeAll(async () => {
            // Fund a 'validator account' that will be the validator owner.
            validatorOwnerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(500),
                suppressLog: true,
            })
            consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

            const config = createValidatorConfig({
                owner: validatorOwnerAccount.addr,
                manager: validatorOwnerAccount.addr,
                validatorCommissionAddress: validatorOwnerAccount.addr,
            })

            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                config,
                validatorMbr,
            )
        })

        // FAILS - Reflects ISSUE MI-05
        test('Validator Manager cannot be set to zero address', async () => {
            const zeroAddress = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'

            await expect(
                validatorMasterClient
                    .compose()
                    .changeValidatorManager(
                        {
                            validatorId,
                            manager: zeroAddress,
                        },
                        { sender: validatorOwnerAccount },
                    )
                    .execute({ populateAppCallResources: true, suppressLog: true }),
            ).rejects.toThrowError()
        })

        // FAILS - Reflects ISSUE MI-05
        test('Entry gating type cannot be > 4', async () => {
            const badGatingType = 255

            await expect(
                validatorMasterClient
                    .compose()
                    .changeValidatorRewardInfo(
                        {
                            validatorId,
                            entryGatingType: badGatingType,
                            entryGatingAddress: validatorOwnerAccount.addr,
                            entryGatingAssets: [0, 0, 0, 0],
                            gatingAssetMinBalance: 0,
                            rewardPerPayout: 0,
                        },
                        { sender: validatorOwnerAccount },
                    )
                    .execute({ populateAppCallResources: true, suppressLog: true }),
            ).rejects.toThrowError()
        })

        // FAILS - Reflects ISSUE MI-05
        // invalid test - sunsetting is timestamp, not round and setting before now is way to instantly sunset which
        // may be desired outcome.
        test.skip('SunsettingOn cannot be set before now', async () => {
            // set the new sunset 1000 rounds before now
            const badSunset = (await fixture.context.algod.getTransactionParams().do()).firstRound - 1000

            await expect(
                validatorMasterClient
                    .compose()
                    .changeValidatorSunsetInfo(
                        { validatorId, sunsettingOn: badSunset, sunsettingTo: validatorId },
                        { sender: validatorOwnerAccount },
                    )
                    .execute({ populateAppCallResources: true, suppressLog: true }),
            ).rejects.toThrowError()
        })
    })
})
