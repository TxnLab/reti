/* eslint-disable import/no-relative-packages */
import * as algokit from '@algorandfoundation/algokit-utils';
import { secretKeyToMnemonic } from 'algosdk';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { StakingPoolClient } from '../contracts/clients/StakingPoolClient';
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient';

async function main() {
    const config = algokit.getConfigFromEnvOrDefaults();

    const algod = algokit.getAlgoClient(config.algodConfig);
    const kmd = algokit.getAlgoKmdClient(config.kmdConfig);
    const indexer = algokit.getAlgoIndexerClient(config.indexerConfig);

    const dispAcct = await algokit.getDispenserAccount(algod, kmd);
    console.log('mnemonic for dispenser test account:', secretKeyToMnemonic(dispAcct.sk));

    console.log(dispAcct.addr);

    // algokit.deployApp(StakingPoolClient.deploy(),

    // const poolClient = new StakingPoolClient({
    //         sender: dispAcct,
    //         resolveBy: 'creatorAndName',
    //         name: 'poolTemplate',
    //         creatorAddress: dispAcct.addr,
    //         findExistingUsing: indexer,
    //     },
    //     algod
    // );
    // const poolResult = await poolClient.deploy({
    //     creatingContractID: 0,
    //     validatorID: 0,
    //     poolID: 0,
    //     minAllowedStake: 1_000_000,
    //     maxStakeAllowed: 0,
    // });
    // console.log(poolResult.appId);

    const poolClient = new StakingPoolClient({ sender: dispAcct, resolveBy: 'id', id: 0 }, algod);
    const tmplPool = await poolClient.create.createApplication({
        creatingContractID: 0,
        validatorID: 0,
        poolID: 0,
        minAllowedStake: 1_000_000, // 1 algo min is hard req
        maxStakeAllowed: 0,
    });
    console.log(tmplPool.appId);

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

    console.log(validatorApp.appId);
}

main();
