import { Contract } from '@algorandfoundation/tealscript';
// import { ValidatorRegistry } from "./validatorRegistry.algo";

type StakedInfo = {
    Account: Address;
    Balance: number;
};

// eslint-disable-next-line no-unused-vars
class StakingPool extends Contract {
    programVersion = 9;

    VALIDATOR_APP_ID = TemplateVar<uint64>();

    Stakers = BoxKey<StaticArray<StakedInfo, 100>>({key: 'stakers'});

    addStake(account: Address, amountToStake: uint64): void {
        // account calling us has to be account adding stake
        assert(account !== Account.zeroAddress);
        assert(this.txn.sender === account);

        // First - is the required amount being paid?
        // Sender doesn't matter - but it 'technically' should be coming from the Validator contract address
        assert(this.txnGroup[this.txn.groupIndex - 1].sender === Application.fromID(this.VALIDATOR_APP_ID).address);
        verifyPayTxn(this.txnGroup[this.txn.groupIndex - 1], {
            receiver: this.app.address,
            amount: amountToStake,
        });
        // firstEmpty should represent 1-based index to first empty slot we find - 0 means none were found
        let firstEmpty = 0;
        // See if the account staking is already in our ledger of Stakers - if so, they're just adding to their stake
        // for (let i = 0; i < this.Stakers.value.length; i += 1) {
        for (let i = 0; i < 100; i += 1) {
            if (this.Stakers.value[i].Account === account) {
                this.Stakers.value[i].Balance += amountToStake;
            } else {
                if (firstEmpty != 0 && this.Stakers.value[i].Account === Address.zeroAddress) {
                    firstEmpty = i + 1;
                }
            }
        }
        if (firstEmpty == 0) {
            // nothing was found - pool is full and this staker can't fit
            throw Error('Staking pool full');
        }
        this.Stakers.value[firstEmpty - 1] = {Account: account, Balance: amountToStake};
    }

    removeStake(account: Address, amountToUnstake: uint64): void {
        // Our we being called by validator ?
        // assert(globals.callerApplicationID.id === this.VALIDATOR_APP_ID);

        // We want to preserve the sanctity that the ONLY account that can call us is the staking account
        // It makes it a bit awkward this way to update the state in the validator but it's safer

        // account calling us has to be account removing stake
        assert(account !== Account.zeroAddress);
        assert(this.txn.sender === account);

        for (let i = 0; i < 100; i += 1) {
            if (this.Stakers.value[i].Account === account) {
                if (this.Stakers.value[i].Balance < amountToUnstake) {
                    throw Error('Insufficient balance');
                }
                this.Stakers.value[i].Balance -= amountToUnstake;
                // Pay the staker back
                sendPayment({
                    amount: amountToUnstake,
                    receiver: account,
                    note: 'unstaked',
                });
                // sendMethodCall<[args], void>({name:})
                sendAppCall({
                    onCompletion: OnCompletion.NoOp,
                    applicationID: Application.fromID(this.VALIDATOR_APP_ID),
                    // approvalProgram: ValidatorRegistry.approvalProgram(),
                })
                if (this.Stakers.value[i].Balance === 0) {
                    // Staker has been 'removed'
                    this.Stakers.value[i].Account = Address.zeroAddress;
                }
                // Now we need to tell the validator contract to remove
                return;
            }
        }
        throw Error('Account not found');
    }
}
