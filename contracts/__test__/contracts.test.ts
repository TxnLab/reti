import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { algoKitLogCaptureFixture, algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging'
import { AlgorandTestAutomationContext } from '@algorandfoundation/algokit-utils/types/testing'
import { Account, getApplicationAddress } from 'algosdk'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import {
    StakedInfo,
    StakingPoolClient,
    StakingPoolFactory,
    ValidatorPoolKey,
} from '../contracts/clients/StakingPoolClient'
import {
    MbrAmounts,
    ValidatorConfig,
    ValidatorRegistryClient,
    ValidatorRegistryFactory,
} from '../contracts/clients/ValidatorRegistryClient'
import {
    addStake,
    addStakingPool,
    addValidator,
    ALGORAND_ZERO_ADDRESS_STRING,
    claimTokens,
    createAsset,
    createValidatorConfig,
    epochBalanceUpdate,
    GATING_TYPE_ASSET_ID,
    GATING_TYPE_ASSETS_CREATED_BY,
    getCurMaxStakePerPool,
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
} from '../helpers/helpers'

describe('reti', () => {
    const FEE_SINK_ADDR = 'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE'

    const MaxPoolsPerNode = 3
    // Periodically set this to max amount allowed in protocol (200 atm) but when testing more frequently this should be lowered to something like 20 stakers
    // The ValidatorWFullPoolWRewards test is 'skip'ped for now - but should be periodically enabled for testing.
    const MaxStakersPerPool = 200n

    const fixture = algorandFixture({ testAccountFunding: AlgoAmount.Algos(10000) })
    const logs = algoKitLogCaptureFixture()

    // Config.configure({ debug: true, traceAll: true })

    const MaxAlgoPerPool = AlgoAmount.Algos(100_000).microAlgos
    let validatorMasterClient: ValidatorRegistryClient
    let validatorMasterAlgorandClient: AlgorandClient
    let validatorFactory: ValidatorRegistryFactory
    let stakingPoolFactory: StakingPoolFactory
    let mbrs: MbrAmounts

    // =====
    // First construct the 'template' pool and then the master validator contract that everything will use
    beforeAll(async () => {
        await fixture.beforeEach()

        // testAccount here is the account that creates the Validator master contracts themselves - but basically one-time thing to be ignored
        const { algorand, testAccount } = fixture.context
        validatorMasterAlgorandClient = algorand

        // Generate staking pool template instance that the validator registry will reference
        stakingPoolFactory = validatorMasterAlgorandClient.client.getTypedAppFactory(StakingPoolFactory)
        const { approvalProgram: stakingApprovalProgram } = await stakingPoolFactory.appFactory.compile({
            deployTimeParams: {
                nfdRegistryAppId: 0,
            },
        })
        validatorFactory = validatorMasterAlgorandClient.client.getTypedAppFactory(ValidatorRegistryFactory, {
            defaultSender: testAccount.addr,
            deployTimeParams: {
                nfdRegistryAppId: 0,
            },
        })

        const { result, appClient } = await validatorFactory.send.create.createApplication({
            args: [],
            extraProgramPages: 3,
        })
        validatorMasterClient = appClient
        // verify that the constructed validator contract is initialized as expected
        expect(result.appId).toBeDefined()
        expect(result.appAddress).toBeDefined()

        const validatorGlobalState = await validatorMasterClient.state.global.getAll()
        expect(validatorGlobalState.numValidators).toEqual(0n)

        // need 3 ALGO for things to really work at all w/ this validator contract account so get that out of the way
        await validatorMasterClient.appClient.fundAppAccount({ amount: AlgoAmount.Algos(3) })
        // Load the staking pool contract bytecode into the validator contract via box storage so it can later deploy
        const composer = validatorMasterClient
            .newGroup()
            .initStakingContract({ args: { approvalProgramSize: stakingApprovalProgram.length } })

        // load the StakingPool contract into box storage of the validator
        // call loadStakingContractData - chunking the data from approvalCompiled 2000 bytes at a time
        for (let i = 0; i < stakingApprovalProgram.length; i += 2000) {
            composer.loadStakingContractData({
                args: {
                    offset: i,
                    data: stakingApprovalProgram.subarray(i, i + 2000),
                },
            })
        }
        await composer.finalizeStakingContract({ args: [] }).send({ populateAppCallResources: true })

        // This method should be marked readonly so it uses simulate rather than firing a transaction
        // The previous implementation used a manual call to simulate which works too of course, but this way we get typing
        mbrs = (await validatorMasterClient.send.getMbrAmounts()).return!
    })

    beforeEach(async () => {
        await fixture.beforeEach()
        // Propagate signers from any `beforeAll` calls
        fixture.algorand.account.setSigners(validatorMasterAlgorandClient.account)
        // Register the test account for this test with the validatorMasterClient
        validatorMasterAlgorandClient.setSignerFromAccount(fixture.context.testAccount)
        // Register any generated test accounts for this test with the validatorMasterClient
        const generator = fixture.context.generateAccount
        fixture.context.generateAccount = async (params) => {
            const account = await generator({ initialFunds: params.initialFunds, suppressLog: true })
            validatorMasterAlgorandClient.setSignerFromAccount(account)
            return account
        }
    })
    beforeEach(logs.beforeEach)
    afterEach(logs.afterEach)

    describe('MultValidatorAddCheck', () => {
        // Just verify adding new validators and their ids incrementing and mbrs being covered, etc.,
        test('validatorAddTests', async () => {
            const validatorOwnerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(500),
                suppressLog: true,
            })
            const origMbr = (await fixture.algorand.account.getInformation(validatorMasterClient.appAddress)).minBalance

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
                mbrs.addValidatorMbr,
            )
            expect(validatorId).toEqual(expectedID)
            const newMbr = (await fixture.algorand.account.getInformation(validatorMasterClient.appAddress)).minBalance
            expect(newMbr.microAlgo).toEqual(origMbr.microAlgo + mbrs.addValidatorMbr)

            expectedID += 1
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                config,
                mbrs.addValidatorMbr,
            )
            expect(validatorId).toEqual(expectedID)
            expectedID += 1
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                config,
                mbrs.addValidatorMbr,
            )
            expect(validatorId).toEqual(expectedID)
        })
    })

    describe('StakeAdds', () => {
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
                minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                maxAlgoPerPool: MaxAlgoPerPool, // this comes into play in later tests !!
                percentToValidator: 50000n, // 5%
                poolsPerNode: BigInt(MaxPoolsPerNode),
            })

            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                config,
                mbrs.addValidatorMbr,
            )

            // Add new pool - then we'll add stake and verify balances.
            firstPoolKey = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                mbrs.addPoolMbr,
                mbrs.poolInitMbr,
            )
            // should be [validator id, pool id (1 based)]
            expect(firstPoolKey.id).toEqual(BigInt(validatorId))
            expect(firstPoolKey.poolId).toEqual(1n)

            // get the app id via contract call - it should match what we just got back in poolKey[2]
            poolAppId = (
                await validatorMasterClient.send.getPoolAppId({
                    args: { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                    populateAppCallResources: true,
                })
            ).return!
            expect(firstPoolKey.poolAppId).toEqual(poolAppId)

            const stateData = await getValidatorState(validatorMasterClient, validatorId)
            expect(stateData.numPools).toEqual(1n)
            expect(stateData.totalAlgoStaked).toEqual(0n)
            expect(stateData.totalStakers).toEqual(0n)

            const validatorGlobalState = await validatorMasterClient.state.global.getAll()
            expect(validatorGlobalState.totalAlgoStaked).toEqual(0n)
            expect(validatorGlobalState.numStakers).toEqual(0n)

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.poolAppId).toEqual(poolAppId)
            expect(poolInfo.totalStakers).toEqual(0n)
            expect(poolInfo.totalAlgoStaked).toEqual(0n)
        })

        // Creates dummy staker:
        // adds 'not enough' 1000 algo but taking out staker mbr - fails because <1000 min - checks failure
        // adds 1000 algo (plus enough to cover staker mbr)
        // tries to remove 200 algo (checks failure) because it would go below 1000 algo min.
        // adds 1000 algo more - should end at exactly 2000 algo staked
        test('firstStaker', async () => {
            // get current balance of staker pool (should already include needed MBR in balance - but subtract it out, so it's seen as the '0' amount)
            const origStakePoolInfo = await fixture.context.algorand.account.getInformation(
                getApplicationAddress(poolAppId),
            )

            // Fund a 'staker account' that will be the new 'staker'
            const stakerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(5000),
                suppressLog: true,
            })
            // Start by funding 'not enough' (we pay minimum stake [but no mbr]) - should fail (!)
            await expect(
                addStake(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    stakerAccount,
                    AlgoAmount.Algos(1000),
                    0n,
                ),
            ).rejects.toThrowError()

            // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
            // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
            // we pay the extra here so the final staked amount should be exactly 1000
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
            expect(poolInfo.totalStakers).toEqual(1n)
            expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount1.microAlgo - mbrs.addStakerMbr)

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)

            let validatorGlobalState = await validatorMasterClient.state.global.getAll()
            expect(validatorGlobalState.totalAlgoStaked).toEqual(stakeAmount1.microAlgo - mbrs.addStakerMbr)
            expect(validatorGlobalState.numStakers).toEqual(1n)

            const poolBalance1 = await fixture.context.algorand.account.getInformation(getApplicationAddress(poolAppId))
            expect(poolBalance1.balance.microAlgo).toEqual(
                origStakePoolInfo.balance.microAlgo + stakeAmount1.microAlgo - mbrs.addStakerMbr,
            )

            // now try to remove partial amount - which should fail because it will take staked amount to < its 'minimum amount'
            const ourPoolClient = stakingPoolFactory.getAppClientById({
                appId: stakedPoolKey.poolAppId,
                defaultSender: stakerAccount.addr,
            })
            await expect(removeStake(ourPoolClient, stakerAccount, AlgoAmount.Algos(200))).rejects.toThrowError()

            // verify pool stake didn't change!
            poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount1.microAlgos - mbrs.addStakerMbr)
            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)

            validatorGlobalState = await validatorMasterClient.state.global.getAll()
            expect(validatorGlobalState.totalAlgoStaked).toEqual(stakeAmount1.microAlgos - mbrs.addStakerMbr)
            expect(validatorGlobalState.numStakers).toEqual(1n)

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
                stakeAmount1.microAlgos - mbrs.addStakerMbr + stakeAmount2.microAlgos,
            )
            // and global state changed
            validatorGlobalState = await validatorMasterClient.state.global.getAll()
            expect(validatorGlobalState.totalAlgoStaked).toEqual(
                stakeAmount1.microAlgos - mbrs.addStakerMbr + stakeAmount2.microAlgos,
            )

            // ....and verify data for the 'staker' is correct as well
            const stakerInfo = await getStakerInfo(ourPoolClient, stakerAccount)
            expect(stakerInfo.account).toEqual(stakerAccount.addr)
            // should be full 2000 algos (we included extra for mbr to begin with)
            expect(stakerInfo.balance).toEqual(AlgoAmount.Algos(2000).microAlgos)

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)

            // let's also get list of all staked pools we're part of... should only contain 1 entry and just be our pool
            const allPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount)
            expect(allPools).toHaveLength(1)
            expect(allPools[0]).toEqual(firstPoolKey)

            // second balance check of pool - it should increase by full stake amount since existing staker staked again, so no additional
            // mbr was needed
            const poolBalance2 = await fixture.context.algorand.account.getInformation(getApplicationAddress(poolAppId))
            expect(poolBalance2.balance.microAlgo).toEqual(poolBalance1.balance.microAlgo + stakeAmount2.microAlgo)

            const stakerAcctBalance = await fixture.context.algorand.account.getInformation(stakerAccount.addr)
            expect(stakerAcctBalance.balance.microAlgo).toEqual(
                AlgoAmount.Algos(5000).microAlgos - // funded amount
                    stakeAmount1.microAlgos -
                    stakeAmount2.microAlgos -
                    fees1.microAlgos -
                    fees2.microAlgos,
            )

            // Verify 'total' staked from validator contract
            const stateData = await getValidatorState(validatorMasterClient, validatorId)
            expect(stateData.numPools).toEqual(1n)
            expect(stateData.totalAlgoStaked).toEqual(
                stakeAmount1.microAlgos + stakeAmount2.microAlgos - mbrs.addStakerMbr,
            )
            expect(stateData.totalStakers).toEqual(1n)
            // and. globally
            validatorGlobalState = await validatorMasterClient.state.global.getAll()
            expect(validatorGlobalState.totalAlgoStaked).toEqual(
                stakeAmount1.microAlgos + stakeAmount2.microAlgos - mbrs.addStakerMbr,
            )
        })

        // Creates new staker account
        // Adds 2000 algo to pool (not caring about mbr - so actual amount will be less the mbrs.addStakerMbr amount)
        test('nextStaker', async () => {
            // get current balance of staker pool
            const origStakePoolInfo = await fixture.context.algorand.account.getInformation(
                getApplicationAddress(poolAppId),
            )
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

            const poolBalance1 = await fixture.context.algorand.account.getInformation(getApplicationAddress(poolAppId))
            expect(poolBalance1.balance.microAlgo).toEqual(
                origStakePoolInfo.balance.microAlgo + stakeAmount1.microAlgos - mbrs.addStakerMbr,
            )

            const stakerAcctBalance = await fixture.context.algorand.account.getInformation(stakerAccount.addr)
            expect(stakerAcctBalance.balance.microAlgo).toEqual(
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
            expect(stateData.numPools).toEqual(1n)
            expect(stateData.totalAlgoStaked).toEqual(
                origValidatorState.totalAlgoStaked + stakeAmount1.microAlgos - mbrs.addStakerMbr,
            )
            expect(stateData.totalStakers).toEqual(2n)
        })

        test('validatorPoolCheck', async () => {
            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.poolAppId).toEqual(poolAppId)
            expect(poolInfo.totalStakers).toEqual(2n)
            expect(poolInfo.totalAlgoStaked).toEqual(AlgoAmount.Algos(4000).microAlgos - mbrs.addStakerMbr)
        })

        test('addMaxPoolsAndFill', async () => {
            const pools: ValidatorPoolKey[] = []
            const stakers: Account[] = []
            const poolsToCreate = MaxPoolsPerNode

            // capture current 'total' state for all pools
            const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)

            // we create 'max pools per node' new pools on new node (first pool is still there which we added as part of beforeAll)
            for (let i = 0; i < poolsToCreate; i += 1) {
                const newPool = await addStakingPool(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    2, // add to different node - otherwise we'll fail
                    validatorOwnerAccount,
                    mbrs.addPoolMbr,
                    mbrs.poolInitMbr,
                )
                expect(newPool.poolId).toEqual(BigInt(2 + i))
                pools.push(newPool)
            }

            for (let i = 0; i < poolsToCreate; i += 1) {
                const poolInfo = await getPoolInfo(validatorMasterClient, pools[i])
                expect(poolInfo.poolAppId).toEqual(pools[i].poolAppId)
                expect(poolInfo.totalStakers).toEqual(0n)
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
            expect(stateData.numPools).toEqual(BigInt(MaxPoolsPerNode + 1))
            expect(stateData.totalAlgoStaked).toEqual(
                origValidatorState.totalAlgoStaked +
                    stakeAmount.microAlgos * BigInt(MaxPoolsPerNode) -
                    mbrs.addStakerMbr * BigInt(MaxPoolsPerNode) +
                    AlgoAmount.Algos(2000).microAlgos,
            )
            expect(stateData.totalStakers).toEqual(BigInt(MaxPoolsPerNode + 2))
        })

        test('addThenRemoveStake', async () => {
            const stakerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(10_000),
                suppressLog: true,
            })
            let amountStaked = 0n
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

            const stakerAcctBalance = await fixture.context.algorand.account.getInformation(stakerAccount.addr)
            expect(stakerAcctBalance.balance.microAlgo).toEqual(
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
            const ourPoolClient = stakingPoolFactory.getAppClientById({
                appId: firstPoolKey.poolAppId,
                defaultSender: stakerAccount.addr,
            })
            // The amount 'actually' staked won't include the MBR amount
            const stakerInfo = await getStakerInfo(ourPoolClient, stakerAccount)
            expect(stakerInfo.account).toEqual(stakerAccount.addr)
            expect(stakerInfo.balance).toEqual(amountStaked - mbrs.addStakerMbr)

            // Get Pool info before removing stake..
            const preRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)

            // then remove the stake !
            const removeFees = await removeStake(
                ourPoolClient,
                stakerAccount,
                AlgoAmount.MicroAlgos(stakerInfo.balance),
            )
            const newBalance = await fixture.context.algorand.account.getInformation(stakerAccount.addr)
            expect(newBalance.balance.microAlgo).toEqual(
                stakerAcctBalance.balance.microAlgo + stakerInfo.balance - removeFees, // microAlgo for `removeStake fees
            )

            // stakers should have been reduced and stake amount should have been reduced by stake removed
            const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(postRemovePoolInfo.totalStakers).toEqual(preRemovePoolInfo.totalStakers - 1n)
            expect(postRemovePoolInfo.totalAlgoStaked).toEqual(preRemovePoolInfo.totalAlgoStaked - stakerInfo.balance)
        })

        test('addThenRemoveAllStake', async () => {
            const stakerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(10_000),
                suppressLog: true,
            })
            let amountStaked = 0n
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

            const stakerAcctBalance = await fixture.context.algorand.account.getInformation(stakerAccount.addr)
            expect(stakerAcctBalance.balance.microAlgo).toEqual(
                AlgoAmount.Algos(10_000).microAlgos - // funded amount
                    amountStaked -
                    addFees.microAlgos,
            )

            // Verify the staked data matches....
            const allPools = await getStakedPoolsForAccount(validatorMasterClient, stakerAccount)
            expect(allPools).toHaveLength(1)
            expect(allPools[0]).toEqual(firstPoolKey)
            // ....and verify data for the 'staker' is correct as well
            const ourPoolClient = stakingPoolFactory.getAppClientById({
                appId: firstPoolKey.poolAppId,
                defaultSender: stakerAccount.addr,
            })
            // The amount 'actually' staked won't include the MBR amount
            const stakerInfo = await getStakerInfo(ourPoolClient, stakerAccount)
            expect(stakerInfo.account).toEqual(stakerAccount.addr)
            expect(stakerInfo.balance).toEqual(amountStaked - mbrs.addStakerMbr)

            // Get Pool info before removing stake..
            const preRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)

            // then remove ALL the stake  (specifying 0 to remove all)
            const removeFees = await removeStake(ourPoolClient, stakerAccount, AlgoAmount.MicroAlgos(0))
            const newBalance = await fixture.context.algorand.account.getInformation(stakerAccount.addr)
            expect(newBalance.balance.microAlgo).toEqual(
                stakerAcctBalance.balance.microAlgo + stakerInfo.balance - removeFees, // microAlgo for removeStake fees
            )

            // stakers should have been reduced and stake amount should have been reduced by stake removed
            const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(postRemovePoolInfo.totalStakers).toEqual(preRemovePoolInfo.totalStakers - 1n)
            expect(postRemovePoolInfo.totalAlgoStaked).toEqual(preRemovePoolInfo.totalAlgoStaked - stakerInfo.balance)
        })

        test('getStakeInfo', async () => {
            await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'getStakeInfo')
        })
    })

    describe('StakeAddWMixedRemove', () => {
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
                minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                maxAlgoPerPool: MaxAlgoPerPool,
                percentToValidator: 50000n,
                poolsPerNode: BigInt(MaxPoolsPerNode),
            })

            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                config,
                mbrs.addValidatorMbr,
            )
            firstPoolKey = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                mbrs.addPoolMbr,
                mbrs.poolInitMbr,
            )
        })
        test('addRemoveByStaker', async () => {
            const stakerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(10_000),
                suppressLog: true,
            })
            let amountStaked = 0n
            const [addStake1] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                AlgoAmount.Algos(1100),
                0n,
            )
            amountStaked = AlgoAmount.Algos(1100).microAlgos - mbrs.addStakerMbr
            expect(addStake1.id).toEqual(firstPoolKey.id)
            expect(addStake1.poolId).toEqual(firstPoolKey.poolId)
            expect(addStake1.poolAppId).toEqual(firstPoolKey.poolAppId)

            const stakerAcctBalance = await fixture.context.algorand.account.getInformation(stakerAccount.addr)
            const ourPoolClient = stakingPoolFactory.getAppClientById({
                appId: firstPoolKey.poolAppId,
                defaultSender: stakerAccount.addr,
            })

            // Get Pool info before removing stake..
            const preRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            // then remove the stake !
            const removeFees = await removeStake(ourPoolClient, stakerAccount, AlgoAmount.MicroAlgos(0))
            const newBalance = await fixture.context.algorand.account.getInformation(stakerAccount.addr)
            expect(newBalance.balance.microAlgo).toEqual(
                stakerAcctBalance.balance.microAlgo + amountStaked - removeFees, // microAlgo for `removeStake fees
            )

            // stakers should have been reduced and stake amount should have been reduced by stake removed
            const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(postRemovePoolInfo.totalStakers).toEqual(preRemovePoolInfo.totalStakers - 1n)
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

            const ourPoolClient = stakingPoolFactory.getAppClientById({
                appId: firstPoolKey.poolAppId,
                defaultSender: stakerAccount.addr,
            })
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
            let amountStaked = 0n
            const [addStake1] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                AlgoAmount.Algos(1100),
                0n,
            )
            amountStaked = AlgoAmount.Algos(1100).microAlgos - mbrs.addStakerMbr
            expect(addStake1.id).toEqual(firstPoolKey.id)
            expect(addStake1.poolId).toEqual(firstPoolKey.poolId)
            expect(addStake1.poolAppId).toEqual(firstPoolKey.poolAppId)

            const stakerAcctBalance = await fixture.context.algorand.account.getInformation(stakerAccount.addr)
            const ourPoolClient = stakingPoolFactory.getAppClientById({
                appId: firstPoolKey.poolAppId,
                defaultSender: validatorOwnerAccount.addr,
            })

            const preRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            // client is sending txns via validatorOwnerAccount - but we're removing stakerAccount's stake (to them)
            const removeFees = await removeStake(ourPoolClient, stakerAccount, AlgoAmount.MicroAlgos(0))
            const newBalance = await fixture.context.algorand.account.getInformation(stakerAccount.addr)
            expect(newBalance.balance.microAlgo).toEqual(
                stakerAcctBalance.balance.microAlgo + amountStaked - removeFees, // microAlgo for `removeStake fees
            )

            // stakers should have been reduced and stake amount should have been reduced by stake removed
            const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(postRemovePoolInfo.totalStakers).toEqual(preRemovePoolInfo.totalStakers - 1n)
            expect(postRemovePoolInfo.totalAlgoStaked).toEqual(preRemovePoolInfo.totalAlgoStaked - amountStaked)
        })
    })

    async function verifyRewardAmounts(
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
        const totalAmount = stakersPriorToReward.reduce((total, staker) => total + staker.balance, 0n)

        // Figure out the timestamp of prior block and use that as the 'current time' for purposes
        // of matching the epoch payout calculations in the contract
        const curStatus = await context.algod.status().do()
        const lastBlock = curStatus['last-round']
        const thisEpochBegin = lastBlock - (lastBlock % epochRoundLength)
        let numStakers = 0
        for (let i = 0; i < stakersPriorToReward.length; i += 1) {
            if (stakersPriorToReward[i].account === ALGORAND_ZERO_ADDRESS_STRING) {
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
        let partialStakeAmount: bigint = 0n
        let algoRewardsAvail: bigint = algoRewardedAmount
        let tokenRewardsAvail: bigint = tokenRewardedAmount

        for (let i = 0; i < stakersPriorToReward.length; i += 1) {
            if (stakersPriorToReward[i].account === ALGORAND_ZERO_ADDRESS_STRING) {
                continue
            }
            if (stakersPriorToReward[i].entryRound >= thisEpochBegin) {
                consoleLogger.info(
                    `staker:${i}, Entry:${stakersPriorToReward[i].entryRound} - after epoch - continuing`,
                )
                continue
            }
            const origBalance = stakersPriorToReward[i].balance
            const origRwdTokenBal = stakersPriorToReward[i].rewardTokenBalance
            const timeInPool: bigint = BigInt(thisEpochBegin) - stakersPriorToReward[i].entryRound
            const timePercentage: bigint = (timeInPool * 1000n) / BigInt(epochRoundLength) // 34.7% becomes 347
            if (timePercentage < 1000n) {
                // partial staker
                const expectedReward = (origBalance * algoRewardedAmount * timePercentage) / (totalAmount * 1000n)
                consoleLogger.info(
                    `staker:${i}, Entry:${stakersPriorToReward[i].entryRound} TimePct:${timePercentage}, ` +
                        `PctTotal:${(origBalance * 1000n) / totalAmount / 10n} ` +
                        `ExpReward:${expectedReward}, ActReward:${stakersAfterReward[i].balance - origBalance} ` +
                        `${stakersPriorToReward[i].account}`,
                )

                if (origBalance + expectedReward !== stakersAfterReward[i].balance) {
                    consoleLogger.warn(
                        `staker:${i} expected: ${origBalance + expectedReward} reward but got: ${stakersAfterReward[i].balance}`,
                    )
                    expect(stakersAfterReward[i].balance).toBe(origBalance + expectedReward)
                }
                const expectedTokenReward = (origBalance * tokenRewardedAmount * timePercentage) / (totalAmount * 1000n)
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
            if (stakersPriorToReward[i].account === ALGORAND_ZERO_ADDRESS_STRING) {
                continue
            }
            if (stakersPriorToReward[i].entryRound >= thisEpochBegin) {
                consoleLogger.info(
                    `staker:${i}, ${stakersPriorToReward[i].account} SKIPPED because entry is newer at:${stakersPriorToReward[i].entryRound}`,
                )
            } else {
                const origBalance = stakersPriorToReward[i].balance
                const origRwdTokenBal = stakersPriorToReward[i].rewardTokenBalance
                const timeInPool: bigint = BigInt(thisEpochBegin) - stakersPriorToReward[i].entryRound
                let timePercentage: bigint = (timeInPool * 1000n) / BigInt(epochRoundLength) // 34.7% becomes 347
                if (timePercentage < 1000n) {
                    continue
                }
                if (timePercentage > 1000n) {
                    timePercentage = 1000n
                }
                const expectedReward = (origBalance * algoRewardsAvail) / newPoolTotalStake
                consoleLogger.info(
                    `staker:${i}, TimePct:${timePercentage}, PctTotal:${(origBalance * 1000n) / newPoolTotalStake / 10n} ExpReward:${expectedReward}, ActReward:${stakersAfterReward[i].balance - origBalance} ${stakersPriorToReward[i].account}`,
                )
                const expectedTokenReward = (origBalance * tokenRewardsAvail) / newPoolTotalStake
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
                minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                maxAlgoPerPool: MaxAlgoPerPool, // this comes into play in later tests !!
                percentToValidator: BigInt(PctToValidator * 10000),
                validatorCommissionAddress: validatorOwnerAccount.addr,
                epochRoundLength: BigInt(epochRoundLength),
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                config,
                mbrs.addValidatorMbr,
            )

            // Add new pool - then we'll add stake and verify balances.
            firstPoolKey = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                mbrs.addPoolMbr,
                mbrs.poolInitMbr,
            )
            // should be [validator id, pool id (1 based)]
            expect(firstPoolKey.id).toEqual(BigInt(validatorId))
            expect(firstPoolKey.poolId).toEqual(1n)

            firstPoolClient = stakingPoolFactory.getAppClientById({
                appId: firstPoolKey.poolAppId,
                defaultSender: validatorOwnerAccount.addr,
            })

            // get the app id via contract call - it should match what we just got back in poolKey[2]
            poolAppId = (
                await validatorMasterClient.send.getPoolAppId({
                    args: { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                    populateAppCallResources: true,
                })
            ).return!
            expect(firstPoolKey.poolAppId).toEqual(poolAppId)

            const stateData = await getValidatorState(validatorMasterClient, validatorId)
            expect(stateData.numPools).toEqual(1n)
            expect(stateData.totalAlgoStaked).toEqual(0n)
            expect(stateData.totalStakers).toEqual(0n)

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.poolAppId).toEqual(poolAppId)
            expect(poolInfo.totalStakers).toEqual(0n)
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
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
            expect(poolInfo.totalStakers).toEqual(1n)
            expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount1.microAlgos - mbrs.addStakerMbr)

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
        })

        test('testFirstRewards', async () => {
            const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            const ownerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
            const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

            const reward = AlgoAmount.Algos(200)
            // put some test 'reward' algos into staking pool
            await fixture.algorand.send.payment({
                sender: fixture.context.testAccount.addr,
                receiver: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            })
            await incrementRoundNumberBy(fixture.context, 320 + epochRoundLength + epochRoundLength / 2)

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`)

            const payoutBefore = (await firstPoolClient.state.global.lastPayout())!
            const epochBefore = (await firstPoolClient.state.global.epochNumber())!

            // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
            const fees = await epochBalanceUpdate(firstPoolClient)
            const expectedValidatorReward = (reward.microAlgos * BigInt(PctToValidator)) / 100n

            expect(await firstPoolClient.state.global.lastPayout()).toBeGreaterThan(payoutBefore)
            expect(await firstPoolClient.state.global.epochNumber()).toEqual(epochBefore + 1n)

            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            const newOwnerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
            // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
            expect(newOwnerBalance.balance.microAlgo).toEqual(
                ownerBalance.balance.microAlgo - fees.microAlgos + expectedValidatorReward,
            )

            // Verify all the stakers in the pool got what we think they should have
            const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

            await verifyRewardAmounts(
                fixture.context,
                reward.microAlgos - expectedValidatorReward,
                0n,
                stakersPriorToReward as StakedInfo[],
                stakersAfterReward as StakedInfo[],
                epochRoundLength,
            )

            // the total staked should have grown as well - reward minus what the validator was paid in their commission
            expect(newValidatorState.totalAlgoStaked).toEqual(
                origValidatorState.totalAlgoStaked + reward.microAlgos - expectedValidatorReward,
            )

            const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
            expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
        })

        test('extractRewards', async () => {
            const origStakerBalance = await fixture.context.algorand.account.getInformation(stakerAccounts[0].addr)

            // Remove it all
            const fees = await removeStake(firstPoolClient, stakerAccounts[0], AlgoAmount.Algos(1190))

            const newStakerBalance = await fixture.context.algorand.account.getInformation(stakerAccounts[0].addr)
            // 1000 algos staked + 190 reward (- fees for removing stake)
            expect(newStakerBalance.balance.microAlgo).toEqual(
                origStakerBalance.balance.microAlgo + AlgoAmount.Algos(1190).microAlgos - fees,
            )

            // no one should be left and be 0 balance
            const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(postRemovePoolInfo.totalStakers).toEqual(0n)
            expect(postRemovePoolInfo.totalAlgoStaked).toEqual(0n)

            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            expect(newValidatorState.totalAlgoStaked).toEqual(0n)
            expect(newValidatorState.totalStakers).toEqual(0n)

            const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
            expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
        })

        test('testNoRewards', async () => {
            await incrementRoundNumberBy(fixture.context, epochRoundLength)

            // Do epoch payout immediately with no new funds - should still succeed but basically do nothing
            const ownerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
            const epochBefore = (await firstPoolClient.state.global.epochNumber())!
            const lastPayout = (await firstPoolClient.state.global.lastPayout())!
            const fees = await epochBalanceUpdate(firstPoolClient)

            const newGS = await firstPoolClient.state.global.getAll()
            expect(newGS.epochNumber).toEqual(epochBefore + 1n)
            expect(newGS.lastPayout).toBeGreaterThan(lastPayout)
            const newOwnerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
            expect(newOwnerBalance.balance.microAlgo).toEqual(ownerBalance.balance.microAlgo - fees.microAlgos)
        })

        test('testTooEarlyEpoch', async () => {
            // put some test 'reward' algos into staking pool
            await fixture.algorand.send.payment({
                sender: fixture.context.testAccount.addr,
                receiver: getApplicationAddress(firstPoolKey.poolAppId),
                amount: AlgoAmount.Algos(100),
            })
            const params = await fixture.context.algod.getTransactionParams().do()
            // add blocks to get to exact start of new epoch
            if (params.firstRound % epochRoundLength !== 0) {
                await incrementRoundNumberBy(fixture.context, epochRoundLength - (params.firstRound % epochRoundLength))
            }
            // this payout should work...
            await epochBalanceUpdate(firstPoolClient)

            await fixture.algorand.send.payment({
                sender: fixture.context.testAccount.addr,
                receiver: getApplicationAddress(firstPoolKey.poolAppId),
                amount: AlgoAmount.Algos(100),
                note: '2',
            })
            // We added more again - but enough time shouldn't have passed to allow another payout
            await expect(epochBalanceUpdate(firstPoolClient)).rejects.toThrowError()

            // and staked amount should still be 0
            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.totalStakers).toEqual(0n)
            expect(poolInfo.totalAlgoStaked).toEqual(0n)

            await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'should be no stakers !')

            // We added 200 algo in to bump the clock a bit - and cause transactions - this is basically future reward
            // we did 1 payout - so balance should be 200 - (validator % of 100)
            const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
            expect(poolBalance).toEqual(
                AlgoAmount.Algos(200).microAlgos - (AlgoAmount.Algos(100).microAlgos * BigInt(PctToValidator)) / 100n,
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
            expect(checkPoolInfo.totalStakers).toEqual(0n)
            expect(checkPoolInfo.totalAlgoStaked).toEqual(0n)

            const checkValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            expect(checkValidatorState.totalAlgoStaked).toEqual(0n)
            expect(checkValidatorState.totalStakers).toEqual(0n)

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
            const stakingPoolGS = await firstPoolClient.state.global.getAll()
            consoleLogger.info(`lastPayout:${stakingPoolGS.lastPayout}, staker1 entry round: ${staker1Info.entryRound}`)

            // add next staker immediately after - with such small epoch it should be somewhat smaller reward
            const partialStakersAmount = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
            expect(poolInfo.totalStakers).toEqual(3n)
            // only subtract out 2 stakers mbr because only the 'fullEpochStaker' will be 'new' to staking
            expect(poolInfo.totalAlgoStaked).toEqual(
                stakeAmount1.microAlgos + partialStakersAmount.microAlgos * 2n - 2n * mbrs.addStakerMbr,
            )

            // What's pool's current balance
            const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
            const knownReward = poolBalance - poolInfo.totalAlgoStaked
            const expectedValidatorReward = (knownReward * BigInt(PctToValidator)) / 100n

            const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

            await incrementRoundNumberBy(fixture.context, 320 + epochRoundLength)

            // do reward calcs
            await epochBalanceUpdate(firstPoolClient)
            const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

            await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'after payouts')
            await verifyRewardAmounts(
                fixture.context,
                knownReward - expectedValidatorReward,
                0n,
                stakersPriorToReward,
                stakersAfterReward,
                epochRoundLength,
            )
        })
    })

    describe('StakeW0Commission', () => {
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
                minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                maxAlgoPerPool: MaxAlgoPerPool, // this comes into play in later tests !!
                percentToValidator: BigInt(PctToValidator * 10000),
                validatorCommissionAddress: validatorOwnerAccount.addr,
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                config,
                mbrs.addValidatorMbr,
            )
            firstPoolKey = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                mbrs.addPoolMbr,
                mbrs.poolInitMbr,
            )
            expect(firstPoolKey.id).toEqual(BigInt(validatorId))
            expect(firstPoolKey.poolId).toEqual(1n)

            firstPoolClient = stakingPoolFactory.getAppClientById({
                appId: firstPoolKey.poolAppId,
                defaultSender: validatorOwnerAccount.addr,
            })
            poolAppId = (
                await validatorMasterClient.send.getPoolAppId({
                    args: { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                    populateAppCallResources: true,
                })
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
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
            expect(poolInfo.totalStakers).toEqual(1n)
            expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount1.microAlgos - mbrs.addStakerMbr)

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
        })

        test('testFirstRewards', async () => {
            await incrementRoundNumberBy(fixture.context, 322)

            const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            const ownerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
            const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

            const reward = AlgoAmount.Algos(200)
            // put some test 'reward' algos into staking pool
            await fixture.algorand.send.payment({
                sender: fixture.context.testAccount.addr,
                receiver: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            })

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`)

            const epochBefore = (await firstPoolClient.state.global.epochNumber())!

            // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
            const fees = await epochBalanceUpdate(firstPoolClient)
            const expectedValidatorReward = (reward.microAlgos * BigInt(PctToValidator)) / 100n

            expect((await firstPoolClient.state.global.epochNumber())!).toEqual(epochBefore + 1n)

            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            const newOwnerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
            // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
            expect(newOwnerBalance.balance.microAlgo).toEqual(
                ownerBalance.balance.microAlgo - fees.microAlgos + expectedValidatorReward,
            )

            // Verify all the stakers in the pool got what we think they should have
            const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

            await verifyRewardAmounts(
                fixture.context,
                reward.microAlgos - expectedValidatorReward,
                0n,
                stakersPriorToReward as StakedInfo[],
                stakersAfterReward as StakedInfo[],
                1 as number,
            )

            // the total staked should have grown as well - reward minus what the validator was paid in their commission
            expect(newValidatorState.totalAlgoStaked).toEqual(
                origValidatorState.totalAlgoStaked + (reward.microAlgos - expectedValidatorReward),
            )

            const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
            expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
        })

        test('extractRewards', async () => {
            const origStakerBalance = await fixture.context.algorand.account.getInformation(stakerAccounts[0].addr)

            const expectedBalance = AlgoAmount.Algos(1000 + 200 - 200 * (PctToValidator / 100))
            // Remove it all
            const fees = await removeStake(firstPoolClient, stakerAccounts[0], expectedBalance)

            const newStakerBalance = await fixture.context.algorand.account.getInformation(stakerAccounts[0].addr)
            // 1000 algos staked + 190 reward (- fees for removing stake)
            expect(newStakerBalance.balance.microAlgo).toEqual(
                origStakerBalance.balance.microAlgo + expectedBalance.microAlgos - fees,
            )

            // no one should be left and be 0 balance
            const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(postRemovePoolInfo.totalStakers).toEqual(0n)
            expect(postRemovePoolInfo.totalAlgoStaked).toEqual(0n)

            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            expect(newValidatorState.totalAlgoStaked).toEqual(0n)
            expect(newValidatorState.totalStakers).toEqual(0n)

            const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
            expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
        })
    })

    describe('StakeW100Commission', () => {
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
                minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                maxAlgoPerPool: MaxAlgoPerPool, // this comes into play in later tests !!
                percentToValidator: BigInt(PctToValidator * 10000),
                validatorCommissionAddress: validatorOwnerAccount.addr,
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                config,
                mbrs.addValidatorMbr,
            )
            firstPoolKey = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                mbrs.addPoolMbr,
                mbrs.poolInitMbr,
            )
            expect(firstPoolKey.id).toEqual(BigInt(validatorId))
            expect(firstPoolKey.poolId).toEqual(1n)

            firstPoolClient = stakingPoolFactory.getAppClientById({
                appId: firstPoolKey.poolAppId,
                defaultSender: validatorOwnerAccount.addr,
            })
            poolAppId = (
                await validatorMasterClient.send.getPoolAppId({
                    args: { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                    populateAppCallResources: true,
                })
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
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
            expect(poolInfo.totalStakers).toEqual(1n)
            expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount1.microAlgos - mbrs.addStakerMbr)

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
        })

        test('testFirstRewards', async () => {
            const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            const ownerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
            const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

            const reward = AlgoAmount.Algos(200)
            // put some test 'reward' algos into staking pool
            await fixture.algorand.send.payment({
                sender: fixture.context.testAccount.addr,
                receiver: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            })

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`)

            const epochBefore = (await firstPoolClient.state.global.epochNumber())!

            // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
            const fees = await epochBalanceUpdate(firstPoolClient)
            const expectedValidatorReward = (reward.microAlgos * BigInt(PctToValidator)) / 100n

            expect((await firstPoolClient.state.global.epochNumber())!).toEqual(epochBefore + 1n)

            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            const newOwnerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
            // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
            expect(newOwnerBalance.balance.microAlgo).toEqual(
                ownerBalance.balance.microAlgo - fees.microAlgos + expectedValidatorReward,
            )

            // Verify all the stakers in the pool got what we think they should have
            const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

            await verifyRewardAmounts(
                fixture.context,
                reward.microAlgos - expectedValidatorReward,
                0n,
                stakersPriorToReward as StakedInfo[],
                stakersAfterReward as StakedInfo[],
                1,
            )

            // the total staked should have grown as well - reward minus what the validator was paid in their commission
            expect(newValidatorState.totalAlgoStaked).toEqual(
                origValidatorState.totalAlgoStaked + (reward.microAlgos - expectedValidatorReward),
            )

            const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
            expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
        })

        test('extractRewards', async () => {
            const origStakerBalance = await fixture.context.algorand.account.getInformation(stakerAccounts[0].addr)

            const expectedBalance = AlgoAmount.Algos(1000 + 200 - 200 * (PctToValidator / 100))
            // Remove it all
            const fees = await removeStake(firstPoolClient, stakerAccounts[0], expectedBalance)

            const newStakerBalance = await fixture.context.algorand.account.getInformation(stakerAccounts[0].addr)
            // 1000 algos staked + 190 reward (- fees for removing stake)
            expect(newStakerBalance.balance.microAlgo).toEqual(
                origStakerBalance.balance.microAlgo + expectedBalance.microAlgos - fees,
            )

            // no one should be left and be 0 balance
            const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(postRemovePoolInfo.totalStakers).toEqual(0n)
            expect(postRemovePoolInfo.totalAlgoStaked).toEqual(0n)

            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            expect(newValidatorState.totalAlgoStaked).toEqual(0n)
            expect(newValidatorState.totalStakers).toEqual(0n)

            const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
            expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
        })
    })

    describe('StakeWTokenWRewards', () => {
        let validatorId: number
        let validatorOwnerAccount: Account
        let tokenCreatorAccount: Account
        let validatorConfig: ValidatorConfig
        const stakerAccounts: Account[] = []
        let poolAppId: bigint
        let firstPoolKey: ValidatorPoolKey
        let firstPoolClient: StakingPoolClient

        let rewardTokenId: bigint
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
            rewardTokenId = await createAsset(
                fixture.context,
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
                minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                maxAlgoPerPool: MaxAlgoPerPool, // this comes into play in later tests !!
                percentToValidator: BigInt(PctToValidator * 10000),
                validatorCommissionAddress: validatorOwnerAccount.addr,
                rewardTokenId,
                rewardPerPayout: tokenRewardPerPayout, // 1000 tokens per epoch
                epochRoundLength: BigInt(epochRoundLength),
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                validatorConfig,
                mbrs.addValidatorMbr,
            )

            // Add new pool - then we'll add stake and verify balances.
            // first pool needs extra .1 to cover MBR of opted-in reward token !
            firstPoolKey = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                mbrs.addPoolMbr,
                mbrs.poolInitMbr + AlgoAmount.Algos(0.1).microAlgos,
            )
            // should be [validator id, pool id (1 based)]
            expect(firstPoolKey.id).toEqual(BigInt(validatorId))
            expect(firstPoolKey.poolId).toEqual(1n)

            // now send a bunch of our reward token to the pool !
            await fixture.algorand.send.assetTransfer({
                sender: tokenCreatorAccount.addr,
                receiver: getApplicationAddress(firstPoolKey.poolAppId),
                assetId: rewardTokenId,
                amount: BigInt(5000 * 10 ** decimals),
            })

            firstPoolClient = stakingPoolFactory.getAppClientById({
                appId: firstPoolKey.poolAppId,
                defaultSender: validatorOwnerAccount.addr,
            })

            // get the app id via contract call - it should match what we just got back in the poolKey
            poolAppId = (
                await validatorMasterClient.send.getPoolAppId({
                    args: { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                    populateAppCallResources: true,
                })
            ).return!
            expect(firstPoolKey.poolAppId).toEqual(poolAppId)

            const stateData = await getValidatorState(validatorMasterClient, validatorId)
            expect(stateData.numPools).toEqual(1n)
            expect(stateData.totalAlgoStaked).toEqual(0n)
            expect(stateData.totalStakers).toEqual(0n)
            expect(stateData.rewardTokenHeldBack).toEqual(0n)

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.poolAppId).toEqual(poolAppId)
            expect(poolInfo.totalStakers).toEqual(0n)
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
            await fixture.algorand.send.assetOptIn({ sender: stakerAccount.addr, assetId: rewardTokenId })

            // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
            // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
            // we pay the extra here so the final staked amount should be exactly 1000
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
            expect(poolInfo.totalStakers).toEqual(1n)
            expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount1.microAlgos - mbrs.addStakerMbr)

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
        })

        test('testFirstRewards', async () => {
            const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            const ownerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
            const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

            const reward = AlgoAmount.Algos(200)

            // put some test 'reward' algos into staking pool - reward tokens are already there
            await fixture.algorand.send.payment({
                sender: fixture.context.testAccount.addr,
                receiver: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            })
            await incrementRoundNumberBy(fixture.context, 320 + epochRoundLength + epochRoundLength / 2)

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`)

            // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
            const fees = await epochBalanceUpdate(firstPoolClient)
            const expectedValidatorReward = (reward.microAlgos * BigInt(PctToValidator)) / 100n

            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            const newOwnerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
            // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
            expect(newOwnerBalance.balance.microAlgo).toEqual(
                ownerBalance.balance.microAlgo - fees.microAlgos + expectedValidatorReward,
            )

            // Verify all the stakers in the pool got what we think they should have
            const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

            await verifyRewardAmounts(
                fixture.context,
                (reward.microAlgos - expectedValidatorReward) as bigint,
                tokenRewardPerPayout,
                stakersPriorToReward as StakedInfo[],
                stakersAfterReward as StakedInfo[],
                1 as number,
            )

            // the total staked should have grown as well - reward minus what the validator was paid in their commission
            expect(newValidatorState.totalAlgoStaked).toEqual(
                origValidatorState.totalAlgoStaked + reward.microAlgos - expectedValidatorReward,
            )
            // await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'tokenRewardCheck');

            // the reward tokens 'held' back should've grown by the token payout amount
            expect(newValidatorState.rewardTokenHeldBack).toEqual(validatorConfig.rewardPerPayout)

            const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
            expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
        })

        test('extractRewards', async () => {
            const origStakerBalance = await fixture.context.algorand.account.getInformation(stakerAccounts[0].addr)

            // Remove it all
            const removeFees = await removeStake(firstPoolClient, stakerAccounts[0], AlgoAmount.Algos(1190))

            const newStakerBalance = await fixture.context.algorand.account.getInformation(stakerAccounts[0].addr)
            // 1000 algos staked + 190 reward (- .004 in fees for removing stake)
            expect(newStakerBalance.balance.microAlgo).toEqual(
                origStakerBalance.balance.microAlgo + AlgoAmount.Algos(1190).microAlgos - removeFees,
            )
            // verify that reward token payout came to us
            const assetInfo = await fixture.context.algorand.asset.getAccountInformation(
                stakerAccounts[0].addr,
                rewardTokenId,
            )
            expect(assetInfo.balance).toEqual(tokenRewardPerPayout)

            // no one should be left and be 0 balance
            const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(postRemovePoolInfo.totalStakers).toEqual(0n)
            expect(postRemovePoolInfo.totalAlgoStaked).toEqual(0n)

            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            expect(newValidatorState.totalAlgoStaked).toEqual(0n)
            expect(newValidatorState.totalStakers).toEqual(0n)
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
            await fixture.algorand.send.assetOptIn({ sender: partialEpochStaker.addr, assetId: rewardTokenId })

            const params = await fixture.context.algod.getTransactionParams().do()
            // add blocks to get to block prior to start of new epoch
            await incrementRoundNumberBy(fixture.context, epochRoundLength - 1 - (params.firstRound % epochRoundLength))

            // double-check no one should be left and be 0 balance
            const checkPoolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(checkPoolInfo.totalStakers).toEqual(0n)
            expect(checkPoolInfo.totalAlgoStaked).toEqual(0n)

            const checkValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            expect(checkValidatorState.totalAlgoStaked).toEqual(0n)
            expect(checkValidatorState.totalStakers).toEqual(0n)

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
            const stakingPoolGS = await firstPoolClient.state.global.getAll()
            consoleLogger.info(`lastPayout:${stakingPoolGS.lastPayout}, staker1 entry round: ${staker1Info.entryRound}`)

            const stakeAmount2 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
            expect(poolInfo.totalStakers).toEqual(2n)
            // only subtract out 1 staker mbr because only the 'fullEpochStaker' will be 'new' to staking
            expect(poolInfo.totalAlgoStaked).toEqual(
                stakeAmount1.microAlgos + stakeAmount2.microAlgos - mbrs.addStakerMbr,
            )

            // What's pool's current balance
            const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
            const knownReward = poolBalance - poolInfo.totalAlgoStaked
            const expectedValidatorReward = (knownReward * BigInt(PctToValidator)) / 100n

            const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

            await incrementRoundNumberBy(fixture.context, 320 + epochRoundLength)

            // do reward calcs
            await epochBalanceUpdate(firstPoolClient)
            const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

            await logStakingPoolInfo(fixture.context, firstPoolKey.poolAppId, 'after payouts')
            await verifyRewardAmounts(
                fixture.context,
                knownReward - expectedValidatorReward,
                tokenRewardPerPayout,
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
            const rewardTokenBalance = await fixture.context.algorand.asset.getAccountInformation(
                pool1Address,
                rewardTokenId,
            )

            const validatorCurState = await getValidatorState(validatorMasterClient, validatorId)
            const tokensHeldBack = validatorCurState.rewardTokenHeldBack
            expect(tokensHeldBack).toBeGreaterThan(0n)

            const ownerTokenBalPre = await fixture.context.algorand.asset.getAccountInformation(
                tokenCreatorAccount.addr,
                rewardTokenId,
            )

            // should fail - not owner of validator
            await expect(
                validatorMasterClient.send.emptyTokenRewards({
                    args: { validatorId, receiver: tokenCreatorAccount.addr },
                    staticFee: AlgoAmount.MicroAlgos(3000),
                    populateAppCallResources: true,
                }),
            ).rejects.toThrowError()
            // now get client with our owner as caller
            const validatorClient = validatorFactory.getAppClientById({
                appId: validatorMasterClient.appId,
                defaultSender: validatorOwnerAccount.addr,
            })

            const sentAmount = (
                await validatorClient.send.emptyTokenRewards({
                    args: { validatorId, receiver: tokenCreatorAccount.addr },
                    staticFee: AlgoAmount.MicroAlgos(3000),
                    populateAppCallResources: true,
                })
            ).return!
            expect(sentAmount).toEqual(rewardTokenBalance.balance - tokensHeldBack)
            const ownerTokenBal = await fixture.context.algorand.asset.getAccountInformation(
                tokenCreatorAccount.addr,
                rewardTokenId,
            )
            expect(ownerTokenBal.balance).toEqual(ownerTokenBalPre.balance + sentAmount)
        })
    })

    describe('StakeUnstakeAccumTests', () => {
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
                minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                maxAlgoPerPool: MaxAlgoPerPool, // this comes into play in later tests !!
                percentToValidator: BigInt(PctToValidator * 10000),
                validatorCommissionAddress: validatorOwnerAccount.addr,
                epochRoundLength: BigInt(epochRoundLength),
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                config,
                mbrs.addValidatorMbr,
            )

            firstPoolKey = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                mbrs.addPoolMbr,
                mbrs.poolInitMbr,
            )
            // should be [validator id, pool id (1 based)]
            expect(firstPoolKey.id).toEqual(BigInt(validatorId))
            expect(firstPoolKey.poolId).toEqual(1n)

            firstPoolClient = stakingPoolFactory.getAppClientById({
                appId: firstPoolKey.poolAppId,
                defaultSender: validatorOwnerAccount.addr,
            })

            // get the app id via contract call - it should match what we just got back in poolKey[2]
            poolAppId = (
                await validatorMasterClient.send.getPoolAppId({
                    args: { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                    populateAppCallResources: true,
                })
            ).return!
            expect(firstPoolKey.poolAppId).toEqual(poolAppId)

            const stateData = await getValidatorState(validatorMasterClient, validatorId)
            expect(stateData.numPools).toEqual(1n)
            expect(stateData.totalAlgoStaked).toEqual(0n)
            expect(stateData.totalStakers).toEqual(0n)

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.poolAppId).toEqual(poolAppId)
            expect(poolInfo.totalStakers).toEqual(0n)
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
                AlgoAmount.Algos(2000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
            expect(poolInfo.totalStakers).toEqual(1n)
            expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount1.microAlgos - mbrs.addStakerMbr)

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)

            firstPoolClient = stakingPoolFactory.getAppClientById({
                appId: firstPoolKey.poolAppId,
                defaultSender: validatorOwnerAccount.addr,
            })
            let poolGS = await firstPoolClient.state.global.getAll()
            let roundsPerDay = poolGS.roundsPerDay!
            const binRoundStart = poolGS.binRoundStart!
            let roundsRemaining = binRoundStart + roundsPerDay - BigInt(lastBlock)
            consoleLogger.info(`bin start:${binRoundStart}, rounds remaining in bin:${roundsRemaining}`)
            const stakeAccum = poolGS.stakeAccumulator!
            expect(stakeAccum).toEqual(roundsRemaining * (stakeAmount1.microAlgos - mbrs.addStakerMbr))

            // Ok, now add 'more' stake - we're updating existing slot for pool - ensure accumulator is updated
            const stakeAmount2 = AlgoAmount.Algos(1000)
            await addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount2, 0n)
            roundsPerDay = (await firstPoolClient.state.global.roundsPerDay())!
            lastBlock = (await fixture.context.algod.status().do())['last-round']
            roundsRemaining = binRoundStart + roundsPerDay - BigInt(lastBlock)
            poolGS = await firstPoolClient.state.global.getAll()
            const secondStakeAccum = poolGS.stakeAccumulator!
            expect(secondStakeAccum).toEqual(stakeAccum + roundsRemaining * stakeAmount2.microAlgos)

            // remove bits of stake
            await removeStake(firstPoolClient, stakerAccounts[0], AlgoAmount.Algos(50))
            roundsPerDay = (await firstPoolClient.state.global.roundsPerDay())!
            lastBlock = (await fixture.context.algod.status().do())['last-round']
            roundsRemaining = binRoundStart + roundsPerDay - BigInt(lastBlock)
            poolGS = await firstPoolClient.state.global.getAll()
            const newStakeAccum = poolGS.stakeAccumulator!
            expect(newStakeAccum).toEqual(secondStakeAccum - roundsRemaining * AlgoAmount.Algos(50).microAlgos)

            // remove bits of stake
            await removeStake(firstPoolClient, stakerAccounts[0], AlgoAmount.Algos(60))
            roundsPerDay = (await firstPoolClient.state.global.roundsPerDay())!
            lastBlock = (await fixture.context.algod.status().do())['last-round']
            roundsRemaining = binRoundStart + roundsPerDay - BigInt(lastBlock)
            poolGS = await firstPoolClient.state.global.getAll()
            const thirdStakeAccum = poolGS.stakeAccumulator!
            expect(thirdStakeAccum).toEqual(newStakeAccum - roundsRemaining * AlgoAmount.Algos(60).microAlgos)
        })
    })

    describe('TokenRewardOnlyTokens', () => {
        let validatorId: number
        let validatorOwnerAccount: Account
        let validatorConfig: ValidatorConfig
        let firstPoolKey: ValidatorPoolKey
        let firstPoolClient: StakingPoolClient
        let stakerAccount: Account

        let rewardTokenId: bigint
        const tokenRewardPerPayout = 1000n

        beforeAll(async () => {
            // Create a reward token to pay out to stakers
            const tokenCreatorAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(5000),
                suppressLog: true,
            })
            rewardTokenId = await createAsset(
                fixture.context,
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
                minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                maxAlgoPerPool: MaxAlgoPerPool, // this comes into play in later tests !!
                percentToValidator: BigInt(5 * 10000),
                validatorCommissionAddress: validatorOwnerAccount.addr,
                rewardTokenId,
                rewardPerPayout: tokenRewardPerPayout, // 1000 tokens per epoch
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                validatorConfig,
                mbrs.addValidatorMbr,
            )

            // Add new pool - then we'll add stake and verify balances.
            // first pool needs extra .1 to cover MBR of opted-in reward token !
            firstPoolKey = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                mbrs.addPoolMbr,
                mbrs.poolInitMbr + AlgoAmount.Algos(0.1).microAlgos,
            )
            // should be [validator id, pool id (1 based)]
            expect(firstPoolKey.id).toEqual(BigInt(validatorId))
            expect(firstPoolKey.poolId).toEqual(1n)

            await fixture.algorand.send.assetTransfer({
                sender: tokenCreatorAccount.addr,
                receiver: getApplicationAddress(firstPoolKey.poolAppId),
                assetId: rewardTokenId,
                amount: BigInt(5000),
            })

            firstPoolClient = stakingPoolFactory.getAppClientById({
                appId: firstPoolKey.poolAppId,
                defaultSender: validatorOwnerAccount.addr,
            })
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
            await fixture.algorand.send.assetOptIn({ sender: stakerAccount.addr, assetId: rewardTokenId })

            // now stake 1000(+mbr), min for this pool - for the first time - which means actual stake amount will be reduced
            // by 'first time staker' fee to cover MBR (which goes to VALIDATOR contract account, not staker contract account!)
            // we pay the extra here so the final staked amount should be exactly 1000
            const stakeAmount1 = AlgoAmount.MicroAlgos(
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
            )
            await addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount1, 0n)
            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount1.microAlgos - mbrs.addStakerMbr)
            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
        })

        test('testFirstRewards', async () => {
            await incrementRoundNumberBy(fixture.context, 322)

            const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            const ownerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
            const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

            // Perform epoch payout calculation - should be 0 algo reward (!)
            // we should just do token payout
            const fees = await epochBalanceUpdate(firstPoolClient)

            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            const newOwnerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
            // validator owner balance shouldn't have changed (other than fees to call epoch update)
            expect(newOwnerBalance.balance.microAlgo).toEqual(ownerBalance.balance.microAlgo - fees.microAlgos)

            // Verify all the stakers in the pool got what we think they should have
            const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

            await verifyRewardAmounts(
                fixture.context,
                0n, // 0 algo reward
                tokenRewardPerPayout,
                stakersPriorToReward as StakedInfo[],
                stakersAfterReward as StakedInfo[],
                1 as number,
            )

            // the total staked should have grown as well - reward minus what the validator was paid in their commission
            expect(newValidatorState.totalAlgoStaked).toEqual(origValidatorState.totalAlgoStaked)

            // the reward tokens 'held' back should've grown by the token payout amount
            expect(newValidatorState.rewardTokenHeldBack).toEqual(validatorConfig.rewardPerPayout)

            const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
            expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
        })

        test('extractRewards', async () => {
            const origStakerBalance = await fixture.context.algorand.account.getInformation(stakerAccount.addr)

            // Remove it all - but w/ claimTokens call instead of removeStake
            const removeFees = await claimTokens(firstPoolClient, stakerAccount)

            const newStakerBalance = await fixture.context.algorand.account.getInformation(stakerAccount.addr)
            // 1000 algos staked + 190 reward (- .004 in fees for removing stake)
            expect(newStakerBalance.balance.microAlgo).toEqual(origStakerBalance.balance.microAlgo - removeFees)
            // verify that reward token payout came to us
            const assetInfo = await fixture.context.algorand.asset.getAccountInformation(
                stakerAccount.addr,
                rewardTokenId,
            )
            expect(assetInfo.balance).toEqual(tokenRewardPerPayout)

            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            // total staked should be same -staker shouldn't have gone away - token held back should've gone to 0
            expect(newValidatorState.totalAlgoStaked).toEqual(AlgoAmount.Algos(1000).microAlgos)
            expect(newValidatorState.totalStakers).toEqual(1n)
            expect(newValidatorState.rewardTokenHeldBack).toEqual(0n)

            const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
            expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
        })
    })

    describe('DoublePoolWTokens', () => {
        let validatorId: number
        let validatorOwnerAccount: Account
        let validatorConfig: ValidatorConfig
        const stakerAccounts: Account[] = []
        let poolAppId: bigint
        const poolKeys: ValidatorPoolKey[] = []
        const poolClients: StakingPoolClient[] = []

        let rewardTokenId: bigint
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
            rewardTokenId = await createAsset(
                fixture.context,
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
                minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                maxAlgoPerPool: AlgoAmount.Algos(5_000).microAlgos, // just do 5k per pool
                percentToValidator: BigInt(PctToValidator * 10000),
                validatorCommissionAddress: validatorOwnerAccount.addr,
                rewardTokenId,
                rewardPerPayout: tokenRewardPerPayout, // 1000 tokens per epoch
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                validatorConfig,
                mbrs.addValidatorMbr,
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
                    mbrs.addPoolMbr,
                    mbrs.poolInitMbr + AlgoAmount.Algos(0.1).microAlgos,
                ),
            )
            // should be [validator id, pool id (1 based)]
            expect(poolKeys[0].id).toEqual(BigInt(validatorId))
            expect(poolKeys[0].poolId).toEqual(1n)

            // now send a bunch of our reward token to the pool !
            await fixture.algorand.send.assetTransfer({
                sender: tokenCreatorAccount.addr,
                receiver: getApplicationAddress(poolKeys[0].poolAppId),
                assetId: rewardTokenId,
                amount: BigInt(5000 * 10 ** decimals),
            })

            poolClients.push(
                stakingPoolFactory.getAppClientById({
                    appId: poolKeys[0].poolAppId,
                    defaultSender: validatorOwnerAccount.addr,
                }),
            )

            // get the app id via contract call - it should match what we just got back in the poolKey
            poolAppId = (
                await validatorMasterClient.send.getPoolAppId({
                    args: { validatorId: poolKeys[0].id, poolId: poolKeys[0].poolId },
                    populateAppCallResources: true,
                })
            ).return!
            expect(poolKeys[0].poolAppId).toEqual(poolAppId)

            const stateData = await getValidatorState(validatorMasterClient, validatorId)
            expect(stateData.numPools).toEqual(1n)
            expect(stateData.totalAlgoStaked).toEqual(0n)
            expect(stateData.totalStakers).toEqual(0n)
            expect(stateData.rewardTokenHeldBack).toEqual(0n)

            const poolInfo = await getPoolInfo(validatorMasterClient, poolKeys[0])
            expect(poolInfo.poolAppId).toEqual(poolAppId)
            expect(poolInfo.totalStakers).toEqual(0n)
            expect(poolInfo.totalAlgoStaked).toEqual(0n)

            // ok - all in working order. add second pool as well - no need to do
            poolKeys.push(
                await addStakingPool(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    1,
                    validatorOwnerAccount,
                    mbrs.addPoolMbr,
                    mbrs.poolInitMbr, // no extra .1 for pool 2 !
                ),
            )
            expect(poolKeys[1].poolId).toEqual(2n)
            poolClients.push(
                stakingPoolFactory.getAppClientById({
                    appId: poolKeys[1].poolAppId,
                    defaultSender: validatorOwnerAccount.addr,
                }),
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
                await fixture.algorand.send.assetOptIn({ sender: stakerAccount.addr, assetId: rewardTokenId })

                const stakeAmount = AlgoAmount.MicroAlgos(
                    AlgoAmount.Algos(5000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
                expect(poolInfo.totalStakers).toEqual(1n)
                expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount.microAlgos - mbrs.addStakerMbr)
            }

            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(2n)
            expect((await getValidatorState(validatorMasterClient, validatorId)).totalAlgoStaked).toEqual(
                AlgoAmount.Algos(10000).microAlgos,
            )
        })

        test('testFirstRewards', async () => {
            await incrementRoundNumberBy(fixture.context, 322)

            let cumTokRewards = 0n
            for (let poolIdx = 0; poolIdx < 2; poolIdx += 1) {
                consoleLogger.info(`testing rewards payout for pool # ${poolIdx + 1}`)
                const origValidatorState = await getValidatorState(validatorMasterClient, validatorId)
                const ownerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
                const stakersPriorToReward = await getStakeInfoFromBoxValue(poolClients[poolIdx])
                const reward = AlgoAmount.Algos(200)
                // put some test 'reward' algos into each staking pool
                await fixture.algorand.send.payment({
                    sender: fixture.context.testAccount.addr,
                    receiver: getApplicationAddress(poolKeys[poolIdx].poolAppId),
                    amount: reward,
                })
                // Perform epoch payout calculation  - we also get back how much it cost to issue the txn
                const fees = await epochBalanceUpdate(poolClients[poolIdx])
                const expectedValidatorReward = (reward.microAlgos * BigInt(PctToValidator)) / 100n
                const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
                const newOwnerBalance = await fixture.context.algorand.account.getInformation(
                    validatorOwnerAccount.addr,
                )
                // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
                expect(newOwnerBalance.balance.microAlgo).toEqual(
                    ownerBalance.balance.microAlgo - fees.microAlgos + expectedValidatorReward,
                )

                // Verify all the stakers in the pool got what we think they should have
                const stakersAfterReward = await getStakeInfoFromBoxValue(poolClients[poolIdx])

                const payoutRatio = await getTokenPayoutRatio(validatorMasterClient, validatorId)
                const tokenRewardForThisPool = (tokenRewardPerPayout * payoutRatio.poolPctOfWhole[poolIdx]) / 1_000_000n
                cumTokRewards += tokenRewardForThisPool

                await verifyRewardAmounts(
                    fixture.context,
                    reward.microAlgos - expectedValidatorReward,
                    tokenRewardForThisPool, // we split evenly into 2 pools - so token reward should be as well
                    stakersPriorToReward as StakedInfo[],
                    stakersAfterReward as StakedInfo[],
                    1 as number,
                )

                // the total staked should have grown as well - reward minus what the validator was paid in their commission
                expect(newValidatorState.totalAlgoStaked).toEqual(
                    origValidatorState.totalAlgoStaked + (reward.microAlgos - expectedValidatorReward),
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
                const origStakerBalance = await fixture.context.algorand.account.getInformation(stakerAccounts[i].addr)
                const origStakerAssetBalance = await fixture.context.algorand.asset.getAccountInformation(
                    stakerAccounts[i].addr,
                    rewardTokenId,
                )

                // Remove all stake
                await removeStake(poolClients[i], stakerAccounts[i], AlgoAmount.Algos(0))
                const removeFees = AlgoAmount.MicroAlgos(7000).microAlgos

                const newStakerBalance = await fixture.context.algorand.account.getInformation(stakerAccounts[i].addr)

                expect(newStakerBalance.balance.microAlgo).toEqual(
                    origStakerBalance.balance.microAlgo + stakerInfo.balance - removeFees,
                )
                // verify that pending reward token payout came to us
                const newStakerAssetBalance = await fixture.context.algorand.asset.getAccountInformation(
                    stakerAccounts[i].addr,
                    rewardTokenId,
                )
                expect(newStakerAssetBalance.balance).toEqual(
                    origStakerAssetBalance.balance + stakerInfo.rewardTokenBalance,
                )

                // no one should be left and be 0 balance
                const postRemovePoolInfo = await getPoolInfo(validatorMasterClient, poolKeys[i])
                expect(postRemovePoolInfo.totalStakers).toEqual(origPoolInfo.totalStakers - 1n)
                expect(postRemovePoolInfo.totalAlgoStaked).toEqual(origPoolInfo.totalAlgoStaked - stakerInfo.balance)

                const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
                expect(newValidatorState.totalAlgoStaked).toEqual(
                    origValidatorState.totalAlgoStaked - stakerInfo.balance,
                )
                expect(newValidatorState.totalStakers).toEqual(origValidatorState.totalStakers - 1n)
                expect(newValidatorState.rewardTokenHeldBack).toEqual(
                    origValidatorState.rewardTokenHeldBack - stakerInfo.rewardTokenBalance,
                )
            }
        })
    })

    describe('TokenGatingByCreator', () => {
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
            gatingToken1Id = await createAsset(fixture.context, tokenCreatorAccount, 'Gating Token 1', 'GATETK1', 10, 0)
            gatingToken2Id = await createAsset(fixture.context, tokenCreatorAccount, 'Gating Token 2', 'GATETK2', 10, 0)

            // Fund a 'validator account' that will be the validator owner.
            validatorOwnerAccount = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.Algos(500),
                suppressLog: true,
            })
            consoleLogger.info(`validator account ${validatorOwnerAccount.addr}`)

            validatorConfig = createValidatorConfig({
                owner: validatorOwnerAccount.addr,
                manager: validatorOwnerAccount.addr,
                minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                maxAlgoPerPool: MaxAlgoPerPool, // this comes into play in later tests !!
                percentToValidator: BigInt(5 * 10000),
                validatorCommissionAddress: validatorOwnerAccount.addr,
                // stakers must possess any token created by tokenCreatorAccount
                entryGatingType: BigInt(GATING_TYPE_ASSETS_CREATED_BY),
                entryGatingAddress: tokenCreatorAccount.addr,
                gatingAssetMinBalance: 2n, // require 2 so we can see if only having 1 fails us
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                validatorConfig,
                mbrs.addValidatorMbr,
            )

            firstPoolKey = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                mbrs.addPoolMbr,
                mbrs.poolInitMbr,
            )
        })

        describe('stakeTest', () => {
            let stakerAccount: Account
            let stakerCreatedTokenId: bigint
            beforeAll(async () => {
                // Fund a 'staker account' that will be the new 'staker'
                stakerAccount = await fixture.context.generateAccount({
                    initialFunds: AlgoAmount.Algos(5000),
                    suppressLog: true,
                })

                await fixture.algorand.send.assetOptIn({ sender: stakerAccount.addr, assetId: gatingToken1Id })
                await fixture.algorand.send.assetOptIn({ sender: stakerAccount.addr, assetId: gatingToken2Id })
                // Send gating tokens to our staker for use in tests
                await fixture.algorand.send.assetTransfer({
                    sender: tokenCreatorAccount.addr,
                    receiver: stakerAccount.addr,
                    assetId: gatingToken1Id,
                    amount: 2n,
                })
                await fixture.algorand.send.assetTransfer({
                    sender: tokenCreatorAccount.addr,
                    receiver: stakerAccount.addr,
                    assetId: gatingToken2Id,
                    amount: 2n,
                })

                stakerCreatedTokenId = await createAsset(fixture.context, stakerAccount, 'Dummy Token', 'DUMMY', 10, 0)
            })

            test('stakeNoTokenOffered', async () => {
                const stakeAmount1 = AlgoAmount.MicroAlgos(
                    AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
                )
                await expect(
                    addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount1, 0n),
                ).rejects.toThrowError()
            })

            test('stakeWrongTokenOffered', async () => {
                const stakeAmount1 = AlgoAmount.MicroAlgos(
                    AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
                    AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
                expect(poolInfo.totalStakers).toEqual(1n)
                expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount1.microAlgos - mbrs.addStakerMbr)

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
                expect(poolInfo.totalStakers).toEqual(1n)
                expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount2.microAlgos * 2n)

                expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
            })

            test('stakeWGatingToken2NotMeetingBalReq', async () => {
                // send 1 of the token back to creator - we should now fail to add more stake because we don't meet the token minimum
                await fixture.algorand.send.assetTransfer({
                    sender: stakerAccount.addr,
                    receiver: tokenCreatorAccount.addr,
                    assetId: gatingToken2Id,
                    amount: 1n,
                })

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
                fixture.context,
                tokenCreatorAccount,
                'Gating Token 1 [Other by same]',
                'GATETK1',
                10,
                0,
            )
            gatingToken2Id = await createAsset(
                fixture.context,
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
                minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                maxAlgoPerPool: MaxAlgoPerPool, // this comes into play in later tests !!
                percentToValidator: BigInt(5 * 10000),
                validatorCommissionAddress: validatorOwnerAccount.addr,
                // stakers must possess ONLY the second gating token - explicit id !
                entryGatingType: BigInt(GATING_TYPE_ASSET_ID),
                entryGatingAssets: [gatingToken2Id, 0n, 0n, 0n],
                gatingAssetMinBalance: 2n, // require 2 so we can see if only having 1 fails us
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                validatorConfig,
                mbrs.addValidatorMbr,
            )

            firstPoolKey = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                mbrs.addPoolMbr,
                mbrs.poolInitMbr,
            )
        })

        describe('stakeTest', () => {
            let stakerAccount: Account
            let stakerCreatedTokenId: bigint
            beforeAll(async () => {
                // Fund a 'staker account' that will be the new 'staker'
                stakerAccount = await fixture.context.generateAccount({
                    initialFunds: AlgoAmount.Algos(5000),
                    suppressLog: true,
                })

                await fixture.algorand.send.assetOptIn({ sender: stakerAccount.addr, assetId: gatingToken1Id })
                await fixture.algorand.send.assetOptIn({ sender: stakerAccount.addr, assetId: gatingToken2Id })
                // Send gating tokens to our staker for use in tests
                await fixture.algorand.send.assetTransfer({
                    sender: tokenCreatorAccount.addr,
                    receiver: stakerAccount.addr,
                    assetId: gatingToken1Id,
                    amount: 2n,
                })
                await fixture.algorand.send.assetTransfer({
                    sender: tokenCreatorAccount.addr,
                    receiver: stakerAccount.addr,
                    assetId: gatingToken2Id,
                    amount: 2n,
                })

                stakerCreatedTokenId = await createAsset(fixture.context, stakerAccount, 'Dummy Token', 'DUMMY', 10, 0)
            })

            test('stakeNoTokenOffered', async () => {
                const stakeAmount1 = AlgoAmount.MicroAlgos(
                    AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
                )
                await expect(
                    addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount1, 0n),
                ).rejects.toThrowError()
            })

            test('stakeWrongTokenOffered', async () => {
                const stakeAmount1 = AlgoAmount.MicroAlgos(
                    AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
                    AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
                    AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
                expect(poolInfo.totalStakers).toEqual(1n)
                expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount1.microAlgos - mbrs.addStakerMbr)

                expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
            })

            test('stakeWGatingToken2NotMeetingBalReq', async () => {
                // send 1 of the token back to creator - we should now fail to add more stake because we don't meet the token minimum
                await fixture.algorand.send.assetTransfer({
                    sender: stakerAccount.addr,
                    receiver: tokenCreatorAccount.addr,
                    assetId: gatingToken2Id,
                    amount: 1n,
                })

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
                    await createAsset(fixture.context, tokenCreatorAccount, `Gating Token ${i}`, `GATETK${i}`, 10, 0),
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
                minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                maxAlgoPerPool: MaxAlgoPerPool, // this comes into play in later tests !!
                percentToValidator: BigInt(5 * 10000),
                validatorCommissionAddress: validatorOwnerAccount.addr,
                // stakers must possess ONLY the second gating token - explicit id !
                entryGatingType: BigInt(GATING_TYPE_ASSET_ID),
                entryGatingAssets: [gatingTokens[0], gatingTokens[1], gatingTokens[2], gatingTokens[3]],
                gatingAssetMinBalance: 2n, // require 2 so we can see if only having 1 fails
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                validatorConfig,
                mbrs.addValidatorMbr,
            )

            firstPoolKey = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                mbrs.addPoolMbr,
                mbrs.poolInitMbr,
            )
        })

        describe('stakeTest', () => {
            let stakerAccount: Account
            let stakerCreatedTokenId: bigint
            beforeAll(async () => {
                // Fund a 'staker account' that will be the new 'staker'
                stakerAccount = await fixture.context.generateAccount({
                    initialFunds: AlgoAmount.Algos(8000),
                    suppressLog: true,
                })

                for (let i = 0; i < 4; i += 1) {
                    await fixture.algorand.send.assetOptIn({ sender: stakerAccount.addr, assetId: gatingTokens[i] })
                    await fixture.algorand.send.assetTransfer({
                        sender: tokenCreatorAccount.addr,
                        receiver: stakerAccount.addr,
                        assetId: gatingTokens[i],
                        amount: 2n,
                    })
                }
                stakerCreatedTokenId = await createAsset(fixture.context, stakerAccount, 'Dummy Token', 'DUMMY', 10, 0)
            })

            test('stakeNoTokenOffered', async () => {
                const stakeAmount1 = AlgoAmount.MicroAlgos(
                    AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
                )
                await expect(
                    addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount1, 0n),
                ).rejects.toThrowError()
            })

            test('stakeWrongTokenOffered', async () => {
                const stakeAmount1 = AlgoAmount.MicroAlgos(
                    AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
                    AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
                expect(poolInfo.totalStakers).toEqual(1n)
                expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount1.microAlgos - mbrs.addStakerMbr)

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
                expect(poolInfo.totalStakers).toEqual(1n)
                expect(poolInfo.totalAlgoStaked).toEqual(AlgoAmount.Algos(1000).microAlgos * 4n)
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
                expect(poolInfo.totalStakers).toEqual(1n)
                expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount1.microAlgos * 5n)
                expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
            })

            test('stakeWGatingToken2NotMeetingBalReq', async () => {
                // send 1 of a token back to creator - we should now fail to add more stake because we don't meet the token minimum
                await fixture.algorand.send.assetTransfer({
                    sender: stakerAccount.addr,
                    receiver: tokenCreatorAccount.addr,
                    assetId: gatingTokens[1],
                    amount: 1n,
                })

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
                minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                maxAlgoPerPool: 0n,
                percentToValidator: BigInt(5 * 10000),
                validatorCommissionAddress: validatorOwnerAccount.addr,
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                validatorConfig,
                mbrs.addValidatorMbr,
            )

            pools.push(
                await addStakingPool(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    1,
                    validatorOwnerAccount,
                    mbrs.addPoolMbr,
                    mbrs.poolInitMbr,
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
            const stakeAmount = AlgoAmount.MicroAlgos(constraints.maxAlgoPerPool + mbrs.addStakerMbr)
            await addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount, 0n)
            expect((await getValidatorState(validatorMasterClient, validatorId)).totalStakers).toEqual(1n)
            const poolInfo = await getPoolInfo(validatorMasterClient, pools[0])
            expect(poolInfo.totalStakers).toEqual(1n)
            expect(poolInfo.totalAlgoStaked).toEqual(stakeAmount.microAlgos - mbrs.addStakerMbr)

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
            expect(curSoftMax).toEqual(constraints.maxAlgoPerPool)

            for (let i = 0; i < 2; i += 1) {
                pools.push(
                    await addStakingPool(
                        fixture.context,
                        validatorMasterClient,
                        validatorId,
                        1,
                        validatorOwnerAccount,
                        mbrs.addPoolMbr,
                        mbrs.poolInitMbr,
                    ),
                )
            }
            expect((await getValidatorState(validatorMasterClient, validatorId)).numPools).toEqual(3n)
            // Our maximum per pool should've changed now - to be max algo per validator / numNodes (3)
            const newSoftMax = await getCurMaxStakePerPool(validatorMasterClient, validatorId)
            expect(newSoftMax).toEqual(
                BigInt(Math.min(Number(constraints.maxAlgoPerValidator / 3n), Number(constraints.maxAlgoPerPool))),
            )
        })

        test('fillNewPools', async () => {
            const constraints = await getProtocolConstraints(validatorMasterClient)
            const newSoftMax = (await getCurMaxStakePerPool(validatorMasterClient, validatorId)) as bigint

            let [poolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                AlgoAmount.MicroAlgos(newSoftMax),
                0n,
            )
            expect(poolKey.poolId).toEqual(2n)

            const state = await getValidatorState(validatorMasterClient, validatorId)
            expect(state.totalAlgoStaked).toEqual(constraints.maxAlgoPerPool + newSoftMax)

            // Fill again - this will put us at max and with current dev defaults at least - over saturation limit
            // 3 pools of 70m (210m) vs saturation limit of 10% of 2b or 200m.
            ;[poolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakerAccount,
                AlgoAmount.MicroAlgos(newSoftMax),
                0n,
            )
            expect(poolKey.poolId).toEqual(3n)
        })

        test('testPenalties', async () => {
            const state = await getValidatorState(validatorMasterClient, validatorId)
            const origPoolBalance = await getPoolAvailBalance(fixture.context, pools[2])

            const tmpPoolClient = stakingPoolFactory.getAppClientById({
                appId: pools[2].poolAppId,
                defaultSender: validatorOwnerAccount.addr,
            })

            const poolInfo = await getPoolInfo(validatorMasterClient, pools[2])
            const rewardAmount = AlgoAmount.Algos(200).microAlgos
            // ok, NOW it should be over the limit on next balance update - send a bit more algo - and it should be in
            // saturated state now - so reward gets diminished, validator gets nothing, rest goes to fee sink
            const rewardSender = await fixture.context.generateAccount({
                initialFunds: AlgoAmount.MicroAlgos(rewardAmount + 4_000_000n),
                suppressLog: true,
            })
            await fixture.algorand.send.payment({
                sender: rewardSender.addr,
                receiver: getApplicationAddress(pools[2].poolAppId),
                amount: AlgoAmount.MicroAlgos(rewardAmount),
            })
            const wNewRewardPoolBal = await getPoolAvailBalance(fixture.context, pools[2])
            // pools account balance should be excess above totalAlgoStaked now...
            expect(wNewRewardPoolBal).toEqual(poolInfo.totalAlgoStaked + rewardAmount)

            // but after epochBalanceUpdate - the 'staked amount' should have grown - but not by as much (depends on ratio of stake vs saturation limit)
            const origFeeSinkBal = await fixture.context.algorand.account.getInformation(FEE_SINK_ADDR)
            // make sure all the stakers are considered fully staked...
            await incrementRoundNumberBy(fixture.context, 321)

            await epochBalanceUpdate(tmpPoolClient)

            const postSaturatedPoolBal = await getPoolAvailBalance(fixture.context, pools[2])

            const constraints = await getProtocolConstraints(validatorMasterClient)

            const normalValidatorCommission = rewardAmount * (5n / 100n)
            let diminishedRewards = (rewardAmount * constraints.amtConsideredSaturated) / state.totalAlgoStaked
            if (diminishedRewards > rewardAmount - normalValidatorCommission) {
                consoleLogger.info(
                    `reducing awards from ${diminishedRewards} to ${rewardAmount - normalValidatorCommission}`,
                )
                diminishedRewards = rewardAmount - normalValidatorCommission
            }

            expect(postSaturatedPoolBal).toEqual(poolInfo.totalAlgoStaked + diminishedRewards)
            // reward should've been reduced with rest going to fee sink
            const newFeeSinkBal = await fixture.context.algorand.account.getInformation(FEE_SINK_ADDR)
            expect(newFeeSinkBal.balance.microAlgo).toBeGreaterThanOrEqual(
                origFeeSinkBal.balance.microAlgo + (rewardAmount - diminishedRewards),
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
                minEntryStake: AlgoAmount.Algos(1).microAlgos,
                maxAlgoPerPool: MaxAlgoPerPool, // this comes into play in later tests !!
                percentToValidator: 50000n, // 5%
                poolsPerNode: BigInt(MaxPoolsPerNode),
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                config,
                mbrs.addValidatorMbr,
            )
            firstPoolKey = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                mbrs.addPoolMbr,
                mbrs.poolInitMbr,
            )
            firstPoolClient = stakingPoolFactory.getAppClientById({
                appId: firstPoolKey.poolAppId,
                defaultSender: validatorOwnerAccount.addr,
            })
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
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
            )
            let [poolKey] = await addStake(
                fixture.context,
                validatorMasterClient,
                validatorId,
                stakers[0],
                stakeAmt,
                0n,
            )
            expect(poolKey.id).toEqual(firstPoolKey.id)
            ;[poolKey] = await addStake(fixture.context, validatorMasterClient, validatorId, stakers[2], stakeAmt, 0n)
            expect(poolKey.id).toEqual(firstPoolKey.id)
            ;[poolKey] = await addStake(fixture.context, validatorMasterClient, validatorId, stakers[1], stakeAmt, 0n)
            expect(poolKey.id).toEqual(firstPoolKey.id)

            // ledger should be staker 0, 2, 1, {empty}
            let stakerData = await getStakeInfoFromBoxValue(firstPoolClient)
            expect(stakerData[0].account).toEqual(stakers[0].addr)
            expect(stakerData[1].account).toEqual(stakers[2].addr)
            expect(stakerData[2].account).toEqual(stakers[1].addr)
            expect(stakerData[3].account).toEqual(ALGORAND_ZERO_ADDRESS_STRING)
            expect(stakerData[0].balance).toEqual(1000n * 1000000n)
            expect(stakerData[1].balance).toEqual(1000n * 1000000n)
            expect(stakerData[2].balance).toEqual(1000n * 1000000n)
            expect(stakerData[3].balance).toEqual(0n)

            // now remove staker 2's stake - and we should end up with ledger of 0, {empty}, 1, {empty}
            await removeStake(firstPoolClient, stakers[2], AlgoAmount.Algos(1000))
            stakerData = await getStakeInfoFromBoxValue(firstPoolClient)
            expect(stakerData[0].account).toEqual(stakers[0].addr)
            expect(stakerData[1].account).toEqual(ALGORAND_ZERO_ADDRESS_STRING)
            expect(stakerData[2].account).toEqual(stakers[1].addr)
            expect(stakerData[3].account).toEqual(ALGORAND_ZERO_ADDRESS_STRING)
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
            expect(stakerData[0].account).toEqual(stakers[0].addr)
            expect(stakerData[1].account).toEqual(ALGORAND_ZERO_ADDRESS_STRING)
            expect(stakerData[2].account).toEqual(stakers[1].addr)
            expect(stakerData[3].account).toEqual(ALGORAND_ZERO_ADDRESS_STRING)
            expect(stakerData[0].balance).toEqual(1000n * 1000000n)
            expect(stakerData[1].balance).toEqual(0n)
            expect(stakerData[2].balance).toEqual(1500n * 1000000n)
            expect(stakerData[3].balance).toEqual(0n)
        })
    })

    describe('StakerMultiPoolAddRemoveBugVerify', () => {
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
                minEntryStake: AlgoAmount.Algos(1).microAlgos,
                maxAlgoPerPool: MaxAlgoPerPool, // this comes into play in later tests !!
                percentToValidator: 50000n, // 5%
                poolsPerNode: BigInt(MaxPoolsPerNode),
            })
            validatorIds.push(
                await addValidator(
                    fixture.context,
                    validatorMasterClient,
                    validatorOwnerAccount,
                    config,
                    mbrs.addValidatorMbr,
                ),
            )
            poolKeys.push(
                await addStakingPool(
                    fixture.context,
                    validatorMasterClient,
                    validatorIds[0],
                    1,
                    validatorOwnerAccount,
                    mbrs.addPoolMbr,
                    mbrs.poolInitMbr,
                ),
            )
            validatorIds.push(
                await addValidator(
                    fixture.context,
                    validatorMasterClient,
                    validatorOwnerAccount,
                    config,
                    mbrs.addValidatorMbr,
                ),
            )
            poolKeys.push(
                await addStakingPool(
                    fixture.context,
                    validatorMasterClient,
                    validatorIds[1],
                    1,
                    validatorOwnerAccount,
                    mbrs.addPoolMbr,
                    mbrs.poolInitMbr,
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
                AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
            const val1Pool = stakingPoolFactory.getAppClientById({
                appId: poolKeys[0].poolAppId,
                defaultSender: stakerAccount.addr,
            })

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
        let validatorId: number
        let validatorOwnerAccount: Account
        let poolAppId: bigint
        let firstPoolKey: ValidatorPoolKey
        let firstPoolClient: StakingPoolClient

        const PctToValidator = 5
        const NumStakers = Number(MaxStakersPerPool)

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
                minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                maxAlgoPerPool: AlgoAmount.Algos(1000 * NumStakers).microAlgos, // this comes into play in later tests !!
                percentToValidator: BigInt(PctToValidator * 10000),
                validatorCommissionAddress: validatorOwnerAccount.addr,
            })
            validatorId = await addValidator(
                fixture.context,
                validatorMasterClient,
                validatorOwnerAccount,
                config,
                mbrs.addValidatorMbr,
            )

            // Add new pool - then we'll add stake and verify balances.
            firstPoolKey = await addStakingPool(
                fixture.context,
                validatorMasterClient,
                validatorId,
                1,
                validatorOwnerAccount,
                mbrs.addPoolMbr,
                mbrs.poolInitMbr,
            )
            // should be [validator id, pool id (1 based)]
            expect(firstPoolKey.id).toEqual(BigInt(validatorId))
            expect(firstPoolKey.poolId).toEqual(1n)

            firstPoolClient = stakingPoolFactory.getAppClientById({
                appId: firstPoolKey.poolAppId,
                defaultSender: validatorOwnerAccount.addr,
            })

            // get the app id via contract call - it should match what we just got back in poolKey[2]
            poolAppId = (
                await validatorMasterClient.send.getPoolAppId({
                    args: { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                    populateAppCallResources: true,
                })
            ).return!
            expect(firstPoolKey.poolAppId).toEqual(poolAppId)

            const stateData = await getValidatorState(validatorMasterClient, validatorId)
            expect(stateData.numPools).toEqual(1n)
            expect(stateData.totalAlgoStaked).toEqual(0n)
            expect(stateData.totalStakers).toEqual(0n)

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            expect(poolInfo.poolAppId).toEqual(poolAppId)
            expect(poolInfo.totalStakers).toEqual(0n)
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
                        AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
                            addStake(
                                fixture.context,
                                validatorMasterClient,
                                validatorId,
                                stakerAccount,
                                stakeAmount1,
                                0n,
                            ),
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
                        stakeAmount1.microAlgos - mbrs.addStakerMbr * BigInt(i + 1),
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
            const ownerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
            const stakersPriorToReward = await getStakeInfoFromBoxValue(firstPoolClient)

            const reward = AlgoAmount.Algos(2000)
            // put some test 'reward' algos into staking pool
            await fixture.algorand.send.payment({
                sender: fixture.context.testAccount.addr,
                receiver: getApplicationAddress(firstPoolKey.poolAppId),
                amount: reward,
            })

            const poolInfo = await getPoolInfo(validatorMasterClient, firstPoolKey)
            consoleLogger.info(`pool stakers:${poolInfo.totalStakers}, staked:${poolInfo.totalAlgoStaked}`)

            // Perform epoch payout calculation  - we get back how much it cost to issue the txn
            const fees = await epochBalanceUpdate(firstPoolClient)
            const expectedValidatorReward = (reward.microAlgos * BigInt(PctToValidator)) / 100n

            const newValidatorState = await getValidatorState(validatorMasterClient, validatorId)
            const newOwnerBalance = await fixture.context.algorand.account.getInformation(validatorOwnerAccount.addr)
            // validator owner should have gotten the expected reward (minus the fees they just paid ofc)
            expect(newOwnerBalance.balance.microAlgo).toEqual(
                ownerBalance.balance.microAlgo - fees.microAlgos + expectedValidatorReward,
            )

            // Verify all the stakers in the pool got what we think they should have
            const stakersAfterReward = await getStakeInfoFromBoxValue(firstPoolClient)

            // get time from most recent block to use as
            await verifyRewardAmounts(
                fixture.context,
                reward.microAlgos - expectedValidatorReward,
                0n,
                stakersPriorToReward,
                stakersAfterReward,
                1,
            )

            // the total staked should have grown as well - reward minus what the validator was paid in their commission
            expect(newValidatorState.totalAlgoStaked).toEqual(
                origValidatorState.totalAlgoStaked + (reward.microAlgos - expectedValidatorReward),
            )

            const poolBalance = await getPoolAvailBalance(fixture.context, firstPoolKey)
            expect(poolBalance).toEqual(newValidatorState.totalAlgoStaked)
        })
    })

    describe('CoinFabrik Audit suggested extra tests', () => {
        describe('HI-01 Token Reward Calculation Inconsistent for Partial Stakers', () => {
            let validatorId: number
            let validatorOwnerAccount: Account
            let tokenCreatorAccount: Account
            let partialEpochStaker: Account
            let partialEpochStaker2: Account
            let validatorConfig: ValidatorConfig
            let poolAppId: bigint
            let firstPoolKey: ValidatorPoolKey
            let firstPoolClient: StakingPoolClient

            let rewardTokenId: bigint
            const decimals = 0
            const tokenRewardPerPayout = BigInt(1000 * 10 ** decimals)
            const epochRoundLength = 4

            beforeAll(async () => {
                // Create a reward token to pay out to stakers
                tokenCreatorAccount = await fixture.context.generateAccount({
                    initialFunds: AlgoAmount.Algos(5000),
                    suppressLog: true,
                })
                rewardTokenId = await createAsset(
                    fixture.context,
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
                    minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                    validatorCommissionAddress: validatorOwnerAccount.addr,
                    rewardTokenId,
                    rewardPerPayout: tokenRewardPerPayout, // 1000 tokens per epoch
                    epochRoundLength: BigInt(epochRoundLength),
                })
                validatorId = await addValidator(
                    fixture.context,
                    validatorMasterClient,
                    validatorOwnerAccount,
                    validatorConfig,
                    mbrs.addValidatorMbr,
                )

                // Add new pool - then we'll add stake and verify balances.
                // first pool needs extra .1 to cover MBR of opted-in reward token !
                firstPoolKey = await addStakingPool(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    1,
                    validatorOwnerAccount,
                    mbrs.addPoolMbr,
                    mbrs.poolInitMbr + AlgoAmount.Algos(0.1).microAlgos,
                )
                // should be [validator id, pool id (1 based)]
                expect(firstPoolKey.id).toEqual(BigInt(validatorId))
                expect(firstPoolKey.poolId).toEqual(1n)

                // now send a bunch of our reward token to the pool !
                await fixture.algorand.send.assetTransfer({
                    sender: tokenCreatorAccount.addr,
                    receiver: getApplicationAddress(firstPoolKey.poolAppId),
                    assetId: rewardTokenId,
                    amount: BigInt(5000 * 10 ** decimals),
                })

                firstPoolClient = stakingPoolFactory.getAppClientById({
                    appId: firstPoolKey.poolAppId,
                    defaultSender: validatorOwnerAccount.addr,
                })

                // get the app id via contract call - it should match what we just got back in the poolKey
                poolAppId = (
                    await validatorMasterClient.send.getPoolAppId({
                        args: { validatorId: firstPoolKey.id, poolId: firstPoolKey.poolId },
                        populateAppCallResources: true,
                    })
                ).return!
                expect(firstPoolKey.poolAppId).toEqual(poolAppId)

                // Create stakers for test and opt it reward asset
                partialEpochStaker = await fixture.context.generateAccount({
                    initialFunds: AlgoAmount.Algos(5000),
                    suppressLog: true,
                })
                // stakerAccounts.push(partialEpochStaker)
                await fixture.algorand.send.assetOptIn({ sender: partialEpochStaker.addr, assetId: rewardTokenId })

                partialEpochStaker2 = await fixture.context.generateAccount({
                    initialFunds: AlgoAmount.Algos(5000),
                    suppressLog: true,
                })
                // stakerAccounts.push(partialEpochStaker2)
                await fixture.algorand.send.assetOptIn({ sender: partialEpochStaker2.addr, assetId: rewardTokenId })
            })

            // FAILS - Reflects ISSUE H1-01
            test('Token partial epoch rewards distributed should not affect subsequent distributions during the same epoch update', async () => {
                const params = await fixture.context.algod.getTransactionParams().do()

                // increment rounds to get to the start of new epoch. This means that staking will occur 1 round after.
                await incrementRoundNumberBy(fixture.context, epochRoundLength - (params.firstRound % epochRoundLength))

                // Stake 1000 Algos + MBR
                const stakeAmount = AlgoAmount.MicroAlgos(
                    AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
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
                    tokenRewardPerPayout,
                    stakersPriorToReward,
                    stakersAfterReward,
                    epochRoundLength,
                )
            })
        }, 20_000)

        describe('ME-02 Incorrect Validator SunsettingOn Verification', () => {
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
                    minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                    validatorCommissionAddress: validatorOwnerAccount.addr,
                })

                validatorId = await addValidator(
                    fixture.context,
                    validatorMasterClient,
                    validatorOwnerAccount,
                    config,
                    mbrs.addValidatorMbr,
                )

                await addStakingPool(
                    fixture.context,
                    validatorMasterClient,
                    validatorId,
                    1,
                    validatorOwnerAccount,
                    mbrs.addPoolMbr,
                    mbrs.poolInitMbr,
                )

                // set sunset 1 round after now
                newSunset = (await fixture.context.algod.getTransactionParams().do()).firstRound + 1

                await validatorMasterClient
                    .newGroup()
                    .changeValidatorSunsetInfo({
                        args: { validatorId, sunsettingOn: newSunset, sunsettingTo: validatorId },
                        sender: validatorOwnerAccount.addr,
                    })
                    .send({ populateAppCallResources: true, suppressLog: true })

                const newConfig = await validatorMasterClient
                    .newGroup()
                    .getValidatorConfig({ args: { validatorId }, sender: validatorOwnerAccount.addr })
                    .send({ populateAppCallResources: true, suppressLog: true })

                // Check changes have been registered
                expect(newConfig.returns[0]!.sunsettingOn).toEqual(BigInt(newSunset))

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
                    AlgoAmount.Algos(1000).microAlgos + AlgoAmount.MicroAlgos(mbrs.addStakerMbr).microAlgos,
                )

                // Staking should throw since we are past the validator's sunset
                await expect(
                    addStake(fixture.context, validatorMasterClient, validatorId, stakerAccount, stakeAmount, 0n),
                ).rejects.toThrowError()
            })
        })

        describe('ME-03 Incentivizing Pool Saturation for Staker Gain', () => {
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
            const expectedValidatorReward = (rewardAmount * BigInt(PctToValidator)) / 100n
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
                    minEntryStake: AlgoAmount.Algos(1000).microAlgos,
                    percentToValidator: BigInt(PctToValidator * 10000), // 5 %
                    validatorCommissionAddress: validatorOwnerAccount.addr,
                    epochRoundLength: BigInt(epochRoundLength),
                })
                validatorId = await addValidator(
                    fixture.context,
                    validatorMasterClient,
                    validatorOwnerAccount,
                    validatorConfig,
                    mbrs.addValidatorMbr,
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
                            mbrs.addPoolMbr,
                            mbrs.poolInitMbr,
                        ),
                    )
                }

                const rewardSender = await fixture.context.generateAccount({
                    initialFunds: AlgoAmount.MicroAlgos(rewardAmount * 2n + 2_000_000n),
                    suppressLog: true,
                })

                // Send 200 Algos rewards to pool 0 & 1
                for (let i = 0; i < 2; i += 1) {
                    await fixture.algorand.send.payment({
                        sender: rewardSender.addr,
                        receiver: getApplicationAddress(pools[i].poolAppId),
                        amount: AlgoAmount.MicroAlgos(rewardAmount),
                    })
                }

                pool0Client = stakingPoolFactory.getAppClientById({
                    appId: pools[0].poolAppId,
                    defaultSender: validatorOwnerAccount.addr,
                })

                pool1Client = stakingPoolFactory.getAppClientById({
                    appId: pools[1].poolAppId,
                    defaultSender: validatorOwnerAccount.addr,
                })

                stakerAccount = await fixture.context.generateAccount({
                    initialFunds: AlgoAmount.Algos(210e6),
                    suppressLog: true,
                })

                // Transfer min bal to fee sink
                await fixture.algorand.send.payment({
                    sender: validatorOwnerAccount.addr,
                    receiver: FEE_SINK_ADDR,
                    amount: AlgoAmount.Algos(0.1),
                })
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
                const amtPerPool = minBigInt(constraints.maxAlgoPerPool, constraints.amtConsideredSaturated / 3n)

                const stakeAmounts: AlgoAmount[] = []
                stakeAmounts.push(AlgoAmount.MicroAlgos(amtPerPool + mbrs.addStakerMbr))
                stakeAmounts.push(AlgoAmount.MicroAlgos(amtPerPool))

                for (let i = 0; i < 2; i += 1) {
                    await addStake(
                        fixture.context,
                        validatorMasterClient,
                        validatorId,
                        stakerAccount,
                        stakeAmounts[i],
                        0n,
                    )
                }
                expect((await getValidatorState(validatorMasterClient, validatorId)).totalAlgoStaked).toBeLessThan(
                    constraints.amtConsideredSaturated,
                )

                // Pool 0 & Pool 1 have the same amount staked. Both have rewards for 200 Algos.
                // Let's compare their rewards if pool 0 receives their rewards before validator gets slightly saturated, and pool 1 after.

                const pool0BeforeRewards = await getPoolInfo(validatorMasterClient, pools[0])
                const pool1BeforeRewards = await getPoolInfo(validatorMasterClient, pools[1])
                const pool0StakersBeforeReward = await getStakeInfoFromBoxValue(pool0Client)
                const pool1StakersBeforeReward = await getStakeInfoFromBoxValue(pool1Client)

                expect(pool0BeforeRewards.totalAlgoStaked).toEqual(pool1BeforeRewards.totalAlgoStaked)
                expect(pool0StakersBeforeReward[0].account).toEqual(pool1StakersBeforeReward[0].account)
                expect(pool0StakersBeforeReward[0].balance).toEqual(pool1StakersBeforeReward[0].balance)

                // make sure all the stakers are considered fully staked...
                await incrementRoundNumberBy(fixture.context, 320 + epochRoundLength + epochRoundLength / 2)

                // Distribute rewards to pool 0 WITHOUT saturation
                await epochBalanceUpdate(pool0Client)

                const notSaturatedReward = (await getStakeInfoFromBoxValue(pool0Client))[0].totalRewarded

                expect(notSaturatedReward).toEqual(expectedNotSaturatedReward)

                // Now, slightly saturate the validator. Notice that total stake have been increased by rewards distribution
                const validatorTotalStakeAfter = (await getValidatorState(validatorMasterClient, validatorId))
                    .totalAlgoStaked

                // add 2 algo beyond to go into saturation
                const amountToSaturation = AlgoAmount.MicroAlgos(
                    constraints.amtConsideredSaturated - validatorTotalStakeAfter + 1n,
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
                    validatorTotalStakeAfter + amountToSaturation.microAlgos,
                )
                expect(validatorTotalStakeAfterSaturation).toEqual(constraints.amtConsideredSaturated + 1n)

                // Distribute rewards for pool 1 WITH saturation. Not necessary to forward rounds because pool1 has not been updated.
                await epochBalanceUpdate(pool1Client)

                const saturatedReward = (await getStakeInfoFromBoxValue(pool1Client))[0].totalRewarded

                // Since staker had the same stake in both pools for 100% of the epoch,
                // the reward with the validator saturated should be less or ar least equal
                // to the reward with the validator NOT saturated to not incentivize adversary behavior.
                expect(saturatedReward).toBeLessThanOrEqual(notSaturatedReward)
            })
        }, 20_000)

        describe('MI-05 Inconsistent Configuration Validation', () => {
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
                    mbrs.addValidatorMbr,
                )
            })

            // FAILS - Reflects ISSUE MI-05
            test('Validator Manager cannot be set to zero address', async () => {
                const zeroAddress = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'

                await expect(
                    validatorMasterClient
                        .newGroup()
                        .changeValidatorManager({
                            args: {
                                validatorId,
                                manager: zeroAddress,
                            },
                            sender: validatorOwnerAccount.addr,
                        })
                        .send({ populateAppCallResources: true, suppressLog: true }),
                ).rejects.toThrowError()
            })

            // FAILS - Reflects ISSUE MI-05
            test('Entry gating type cannot be > 4', async () => {
                const badGatingType = 255

                await expect(
                    validatorMasterClient
                        .newGroup()
                        .changeValidatorRewardInfo({
                            args: {
                                validatorId,
                                entryGatingType: badGatingType,
                                entryGatingAddress: validatorOwnerAccount.addr,
                                entryGatingAssets: [0, 0, 0, 0],
                                gatingAssetMinBalance: 0,
                                rewardPerPayout: 0,
                            },
                            sender: validatorOwnerAccount.addr,
                        })
                        .send({ populateAppCallResources: true, suppressLog: true }),
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
                        .newGroup()
                        .changeValidatorSunsetInfo({
                            args: { validatorId, sunsettingOn: badSunset, sunsettingTo: validatorId },
                            sender: validatorOwnerAccount.addr,
                        })
                        .send({ populateAppCallResources: true, suppressLog: true }),
                ).rejects.toThrowError()
            })
        })
    })
})
