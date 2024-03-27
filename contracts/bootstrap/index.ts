/* eslint-disable import/no-relative-packages */
import * as algokit from '@algorandfoundation/algokit-utils';
import { Account, Address, decodeAddress, secretKeyToMnemonic } from 'algosdk';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { getTestAccount } from '@algorandfoundation/algokit-utils/testing';
import * as fs from 'fs';
import { AlgoClientConfig } from '@algorandfoundation/algokit-utils/types/network-client';
import yargs from 'yargs';
import prompts from 'prompts';
import { mnemonicAccount, mnemonicAccountFromEnvironment } from '@algorandfoundation/algokit-utils';
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient';
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient';

async function getNetworkConfig(network: string): Promise<[AlgoClientConfig, bigint, string]> {
    let registryAppID: bigint;
    let feeSink: string;
    switch (network) {
        case 'devnet':
        case 'localnet':
            registryAppID = 0n;
            feeSink = 'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE';
            return [algokit.getConfigFromEnvOrDefaults().algodConfig, registryAppID, feeSink];
        case 'betanet':
            registryAppID = 842656530n;
            feeSink = 'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE';
            break;
        case 'testnet':
            registryAppID = 84366825n;
            feeSink = 'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE';
            break;
        case 'mainnet':
            registryAppID = 760937186n;
            feeSink = 'Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA';
            break;
        default:
            throw new Error(`Unsupported network network: ${network}`);
    }
    const config = {
        server: `https://${network}-api.algonode.cloud/`,
        port: 443,
    } as AlgoClientConfig;

    return [config, registryAppID, feeSink];
}

async function main() {
    const args = await yargs.option('network', {
        default: 'localnet',
        choices: ['localnet', 'betanet', 'testnet', 'mainnet'],
        demandOption: true,
    }).argv;

    const [algodconfig, registryAppID, feeSink] = await getNetworkConfig(args.network);

    const algod = algokit.getAlgoClient(algodconfig);
    const localConfig = algokit.getConfigFromEnvOrDefaults();

    let creatorAcct: Account;

    // Confirm the network choice by prompting the user if they want to continue if !localnet
    if (args.network !== 'localnet') {
        // verify an env variable is defined for CREATOR_MNEMONIC !
        if (!process.env.CREATOR_MNEMONIC) {
            console.error('Environment variable CREATOR_MNEMONIC is not defined');
            process.exit(1);
        }
        creatorAcct = await mnemonicAccountFromEnvironment('CREATOR', algod);
        console.log(`using ${creatorAcct.addr} as Reti creator.  MAKE SURE THIS IS CORRECT!`);

        console.log(`You've specified you want to DEPLOY to ${args.network}!  This is permanent !`);
        const yn = await prompts({
            type: 'confirm',
            name: 'value',
            message: 'Can you confirm?',
            initial: true,
        });
        if (!yn.value) {
            return;
        }
    } else {
        const kmd = algokit.getAlgoKmdClient(localConfig.kmdConfig);
        creatorAcct = await algokit.getDispenserAccount(algod, kmd);

        console.log(`Primary DISPENSER account is: ${creatorAcct.addr}`);
    }

    // Generate staking pool template instance that the validatory registry will reference
    const poolClient = new StakingPoolClient(
        {
            sender: creatorAcct,
            resolveBy: 'id',
            id: 0,
            deployTimeParams: {
                NFDRegistryAppID: registryAppID,
                FeeSinkAddr: decodeAddress(feeSink).publicKey,
            },
        },
        algod
    );
    const tmplPool = await poolClient.create.createApplication({
        creatingContractID: 0,
        validatorID: 0,
        poolID: 0,
        minEntryStake: 1_000_000, // 1 algo min is hard req in contract creation
    });

    // first we have to deploy a staking pool contract instance for future use by the staking master contract (which uses it as its
    // 'reference' instance when creating new staking pool contract instances.
    const validatorClient = new ValidatorRegistryClient(
        {
            sender: creatorAcct,
            resolveBy: 'id',
            id: 0,
            deployTimeParams: {
                NFDRegistryAppID: registryAppID,
            },
        },
        algod
    );
    const validatorApp = await validatorClient.create.createApplication({ poolTemplateAppID: tmplPool.appId });

    // Fund the validator w/ min .1 ALGO !
    algokit.transferAlgos({ from: creatorAcct, to: validatorApp.appAddress, amount: AlgoAmount.Algos(0.1) }, algod);

    console.log(`Validator registry app id is:${validatorApp.appId}`);

    if (args.network === 'localnet') {
        const kmd = algokit.getAlgoKmdClient(localConfig.kmdConfig);
        // generate two dummy stakers - each w/ 100 million
        const staker1 = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(100_000_000), suppressLog: true },
            algod,
            kmd
        );
        const staker2 = await getTestAccount(
            { initialFunds: AlgoAmount.Algos(100_000_000), suppressLog: true },
            algod,
            kmd
        );
        console.log(`Created test account 1:${staker1.addr}`);
        console.log(`Created test account 2:${staker2.addr}`);

        // Write the mnemonic to a .sandbox file in ../../nodemgr directory
        fs.writeFileSync(
            '../../nodemgr/.env.sandbox',
            `ALGO_MNEMONIC_${creatorAcct.addr.substring(0, 4)}=${secretKeyToMnemonic(creatorAcct.sk)}\nRETI_APPID=${validatorApp.appId}\nALGO_MNEMONIC_${staker1.addr.substring(0, 4)}=${secretKeyToMnemonic(staker1.sk)}\nALGO_MNEMONIC_${staker2.addr.substring(0, 4)}=${secretKeyToMnemonic(staker2.sk)}\n`
        );
        console.log('Modified .env.sandbox in nodemgr directory with these values for testing');
    }
}

main();
