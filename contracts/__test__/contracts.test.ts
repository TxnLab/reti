import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import { ValidatorRegistryClient } from '../contracts/clients/ValidatorRegistryClient';

const fixture = algorandFixture();

let appClient: ValidatorRegistryClient;

describe('ValidatorRegistry', () => {
    beforeEach(fixture.beforeEach);

    beforeAll(async () => {
        await fixture.beforeEach();
        const { algod, testAccount } = fixture.context;

        appClient = new ValidatorRegistryClient(
            {
                sender: testAccount,
                resolveBy: 'id',
                id: 0,
            },
            algod
        );

        await appClient.create.createApplication({});
    });

    test('Create application', async () => {});
    // test('sum', async () => {
    //     const a = 13;
    //     const b = 37;
    //     const sum = await appClient.doMath({a, b, operation: 'sum'});
    //     expect(sum.return?.valueOf()).toBe(BigInt(a + b));
    // });
    //
    // test('difference', async () => {
    //     const a = 13;
    //     const b = 37;
    //     const diff = await appClient.doMath({a, b, operation: 'difference'});
    //     expect(diff.return?.valueOf()).toBe(BigInt(a >= b ? a - b : b - a));
    // });
});
