/* eslint-disable import/no-relative-packages */
import * as algokit from '@algorandfoundation/algokit-utils';
import { secretKeyToMnemonic } from 'algosdk';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import * as fs from 'fs';
import { getTestAccount } from '@algorandfoundation/algokit-utils/testing';
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient';
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient';

async function main() {
    const config = algokit.getConfigFromEnvOrDefaults();

    const algod = algokit.getAlgoClient(config.algodConfig);
    const kmd = algokit.getAlgoKmdClient(config.kmdConfig);
    // const indexer = algokit.getAlgoIndexerClient(config.indexerConfig);

    const dispAcct = await algokit.getDispenserAccount(algod, kmd);
    // console.log('mnemonic for dispenser test account:\n', secretKeyToMnemonic(dispAcct.sk));

    console.log(`Primary DISPENSER account is: ${dispAcct.addr}`);

    // Generate staking pool template instance that the validatory registry will reference
    const poolClient = new StakingPoolClient(
        {
            sender: dispAcct,
            resolveBy: 'id',
            id: 0,
            deployTimeParams: {
                NFDRegistryAppID: 0,
            },
        },
        algod
    );
    const tmplPool = await poolClient.create.createApplication({
        creatingContractID: 0,
        validatorID: 0,
        poolID: 0,
        minEntryStake: 1_000_000, // 1 algo min is hard req in contract creation
        maxStakeAllowed: 0,
    });

    // // first we have to deploy a staking pool contract instance for future use by the staking master contract (which uses it as its
    // // 'reference' instance when creating new staking pool contract instances.
    const validatorClient = new ValidatorRegistryClient(
        {
            sender: dispAcct,
            resolveBy: 'id',
            id: 0,
            deployTimeParams: {
                NFDRegistryAppID: 0,
            },
        },
        algod
    );
    const validatorApp = await validatorClient.create.createApplication({ poolTemplateAppID: tmplPool.appId });

    // Fund the validator w/ min .1 ALGO !
    algokit.transferAlgos({ from: dispAcct, to: validatorApp.appAddress, amount: AlgoAmount.Algos(0.1) }, algod);

    console.log(`Validatory registry app id is:${validatorApp.appId}`);

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
        `ALGO_MNEMONIC_${dispAcct.addr.substring(0, 4)}=${secretKeyToMnemonic(dispAcct.sk)}\nRETI_APPID=${validatorApp.appId}\nALGO_MNEMONIC_${staker1.addr.substring(0, 4)}=${secretKeyToMnemonic(staker1.sk)}\nALGO_MNEMONIC_${staker2.addr.substring(0, 4)}=${secretKeyToMnemonic(staker2.sk)}\n`
    );
    console.log('Modified .env.sandbox in nodemgr directory with these values for testing');
}

main();
