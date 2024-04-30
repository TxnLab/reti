/* eslint-disable import/no-relative-packages */
import * as algokit from '@algorandfoundation/algokit-utils'
import { mnemonicAccountFromEnvironment } from '@algorandfoundation/algokit-utils'
import { Account, decodeAddress, secretKeyToMnemonic } from 'algosdk'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { getTestAccount } from '@algorandfoundation/algokit-utils/testing'
import * as fs from 'fs'
import { AlgoClientConfig } from '@algorandfoundation/algokit-utils/types/network-client'
import yargs from 'yargs'
import prompts from 'prompts'
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient'
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient'

function getNetworkConfig(network: string): [AlgoClientConfig, bigint, string] {
    let registryAppID: bigint
    let feeSink: string
    switch (network) {
        case 'devnet':
        case 'localnet':
            registryAppID = 0n
            feeSink = 'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE'
            return [algokit.getConfigFromEnvOrDefaults().algodConfig, registryAppID, feeSink]
        case 'betanet':
            registryAppID = 842656530n
            feeSink = 'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE'
            break
        case 'testnet':
            registryAppID = 84366825n
            feeSink = 'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE'
            break
        case 'mainnet':
            registryAppID = 760937186n
            feeSink = 'Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA'
            break
        default:
            throw new Error(`Unsupported network network: ${network}`)
    }
    const config = {
        server: `https://${network}-api.algonode.cloud/`,
        port: 443,
    } as AlgoClientConfig

    return [config, registryAppID, feeSink]
}

/**
 * Creates a .env.localnet file in /ui root folder with updated VITE_RETI_APP_ID
 * @param {number | bigint} validatorAppId app id of the master validator contract
 */
function createViteEnvFileForLocalnet(validatorAppId: number | bigint): void {
    const templateFilePath = '../../ui/.env.template'
    const outputFilePath = '../../ui/.env.localnet'

    // Read the .env.template file
    const templateContent = fs.readFileSync(templateFilePath, 'utf8')

    const sectionStartMarker = '# ========================\n# LocalNet configuration:'
    const sectionEndMarker = '# ========================\n# TestNet configuration:'

    const startIndex = templateContent.indexOf(sectionStartMarker)
    const endIndex = templateContent.indexOf(sectionEndMarker, startIndex)

    if (startIndex === -1 || endIndex === -1) {
        console.error('Failed to extract LocalNet configuration from .env.template')
        return
    }

    // Extract the LocalNet configuration section
    let localNetSection = templateContent.substring(startIndex, endIndex)

    // Replace VITE_RETI_APP_ID placeholder with the actual validatorAppId
    localNetSection = localNetSection.replace('VITE_RETI_APP_ID=0', `VITE_RETI_APP_ID=${validatorAppId.toString()}`)

    // Write the new .env.localnet file
    fs.writeFileSync(outputFilePath, localNetSection)

    console.log(`Created ${outputFilePath} with updated VITE_RETI_APP_ID.`)
}

async function main() {
    const args = await yargs.option('network', {
        default: 'localnet',
        choices: ['localnet', 'betanet', 'testnet', 'mainnet'],
        demandOption: true,
    }).argv

    const [algodconfig, registryAppID, feeSink] = getNetworkConfig(args.network)

    const algod = algokit.getAlgoClient(algodconfig)
    const localConfig = algokit.getConfigFromEnvOrDefaults()

    let creatorAcct: Account

    // Confirm the network choice by prompting the user if they want to continue if !localnet
    if (args.network !== 'localnet') {
        // verify an env variable is defined for CREATOR_MNEMONIC !
        if (!process.env.CREATOR_MNEMONIC) {
            console.error('Environment variable CREATOR_MNEMONIC is not defined')
            process.exit(1)
        }
        creatorAcct = await mnemonicAccountFromEnvironment('CREATOR', algod)
        console.log(`using ${creatorAcct.addr} as Reti creator.  MAKE SURE THIS IS CORRECT!`)

        console.log(`You've specified you want to DEPLOY to ${args.network}!  This is permanent !`)
        const yn = await prompts({
            type: 'confirm',
            name: 'value',
            message: 'Can you confirm?',
            initial: true,
        })
        if (!yn.value) {
            return
        }
    } else {
        const kmd = algokit.getAlgoKmdClient(localConfig.kmdConfig)
        creatorAcct = await algokit.getDispenserAccount(algod, kmd)

        console.log(`Primary DISPENSER account is: ${creatorAcct.addr}`)
    }

    // Generate staking pool template instance that the validator registry will reference
    const poolClient = new StakingPoolClient(
        {
            sender: creatorAcct,
            resolveBy: 'id',
            id: 0,
        },
        algod,
    )
    const { approvalCompiled } = await poolClient.appClient.compile({
        deployTimeParams: {
            nfdRegistryAppId: registryAppID,
            feeSinkAddr: decodeAddress(feeSink).publicKey,
        },
    })

    // first we have to deploy a staking pool contract instance for future use by the staking master contract (which uses it as its
    // 'reference' instance when creating new staking pool contract instances.
    const validatorClient = new ValidatorRegistryClient(
        {
            sender: creatorAcct,
            resolveBy: 'id',
            id: 0,
            deployTimeParams: {
                nfdRegistryAppId: registryAppID,
            },
        },
        algod,
    )
    const validatorApp = await validatorClient.create.createApplication({})

    // Fund the validator w/ 2 ALGO for contract mbr reqs.
    await algokit.transferAlgos({ from: creatorAcct, to: validatorApp.appAddress, amount: AlgoAmount.Algos(2) }, algod)

    console.log(
        `loading the ${approvalCompiled.compiledBase64ToBytes.length} bytes of the staking contract into the validator contracts box storage`,
    )

    // Load the staking pool contract bytecode into the validator contract via box storage so it can later deploy
    const composer = validatorClient
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

    console.log(`Validator registry app id is:${validatorApp.appId}`)

    if (args.network === 'localnet') {
        const kmd = algokit.getAlgoKmdClient(localConfig.kmdConfig)
        // generate two dummy stakers - each w/ 100 million
        const staker1 = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(100_000_000), suppressLog: true },
            algod,
            kmd,
        )
        const staker2 = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(100_000_000), suppressLog: true },
            algod,
            kmd,
        )
        console.log(`Created test account 1:${staker1.addr}`)
        console.log(`Created test account 2:${staker2.addr}`)

        // Write the mnemonic to a .sandbox file in ../../nodemgr directory
        fs.writeFileSync(
            '../../nodemgr/.env.sandbox',
            `ALGO_MNEMONIC_${creatorAcct.addr.substring(0, 4)}=${secretKeyToMnemonic(creatorAcct.sk)}\nRETI_APPID=${validatorApp.appId}\nALGO_MNEMONIC_${staker1.addr.substring(0, 4)}=${secretKeyToMnemonic(staker1.sk)}\nALGO_MNEMONIC_${staker2.addr.substring(0, 4)}=${secretKeyToMnemonic(staker2.sk)}\n`,
        )
        console.log('Modified .env.sandbox in nodemgr directory with these values for testing')

        // Create a .env.localnet file in the ui directory with the validator app id
        createViteEnvFileForLocalnet(validatorApp.appId)
    }
}

main()
