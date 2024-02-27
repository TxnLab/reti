package reti

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"strings"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/common/models"
	"github.com/algorand/go-algorand-sdk/v2/crypto"
	"github.com/algorand/go-algorand-sdk/v2/transaction"
	"github.com/algorand/go-algorand-sdk/v2/types"

	"github.com/TxnLab/reti/internal/lib/algo"
	"github.com/TxnLab/reti/internal/lib/misc"
)

const (
	MaxNodes        = 12
	MaxPoolsPerNode = 6
)

type ValidatorInfo struct {
	Config ValidatorConfig
	Pools  []PoolInfo `json:"pools,omitempty"`
}

type ValidatorConfig struct {
	// ID of this validator (sequentially assigned)
	ID uint64
	// Account that controls config - presumably cold-wallet
	Owner string
	// Account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign for the transactions
	Manager string
	// Optional NFD AppID which the validator uses to describe their validator pool
	NFDForInfo uint64

	// Payout frequency - ie: 7, 30, etc.
	PayoutEveryXDays int
	// Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -
	PercentToValidator int
	// account that receives the validation commission each epoch payout (can be ZeroAddress)
	ValidatorCommissionAddress string
	// minimum stake required to enter pool - but must withdraw all if want to go below this amount as well(!)
	MinEntryStake uint64
	// maximum stake allowed per pool (to keep under incentive limits)
	MaxAlgoPerPool uint64
	// Number of pools to allow per node (max of 3 is recommended)
	PoolsPerNode int
}

func ValidatorConfigFromABIReturn(returnVal any) (*ValidatorConfig, error) {
	if arrReturn, ok := returnVal.([]any); ok {
		if len(arrReturn) != 10 {
			return nil, fmt.Errorf("should be 10 elements returned in ValidatorConfig response")
		}
		pkAsString := func(pk []uint8) string {
			addr, _ := types.EncodeAddress(pk)
			return addr
		}
		config := &ValidatorConfig{}
		config.ID = arrReturn[0].(uint64)
		config.Owner = pkAsString(arrReturn[1].([]uint8))
		config.Manager = pkAsString(arrReturn[2].([]uint8))
		config.NFDForInfo = arrReturn[3].(uint64)
		config.PayoutEveryXDays = int(arrReturn[4].(uint16))
		config.PercentToValidator = int(arrReturn[5].(uint32))
		config.ValidatorCommissionAddress = pkAsString(arrReturn[6].([]uint8))
		config.MinEntryStake = arrReturn[7].(uint64)
		config.MaxAlgoPerPool = arrReturn[8].(uint64)
		config.PoolsPerNode = int(arrReturn[9].(uint8))

		return config, nil
	}
	return nil, fmt.Errorf("unknown value returned from abi, type:%T", returnVal)
}

func (v *ValidatorConfig) String() string {
	var out strings.Builder

	out.WriteString(fmt.Sprintf("ID: %d\n", v.ID))
	out.WriteString(fmt.Sprintf("Owner: %s\n", v.Owner))
	out.WriteString(fmt.Sprintf("Manager: %s\n", v.Manager))
	out.WriteString(fmt.Sprintf("Validator Commission Address: %s\n", v.ValidatorCommissionAddress))
	out.WriteString(fmt.Sprintf("%% to Validator: %.04f\n", float64(v.PercentToValidator)/10_000.0))
	if v.NFDForInfo != 0 {
		out.WriteString(fmt.Sprintf("NFD ID: %d\n", v.NFDForInfo))
	}
	out.WriteString(fmt.Sprintf("Payout Every %d days\n", v.PayoutEveryXDays))
	out.WriteString(fmt.Sprintf("Min Entry Stake: %s\n", algo.FormattedAlgoAmount(v.MinEntryStake)))
	out.WriteString(fmt.Sprintf("Max Algo Per Pool: %s\n", algo.FormattedAlgoAmount(v.MaxAlgoPerPool)))
	out.WriteString(fmt.Sprintf("Max Pools per Node: %d\n", v.PoolsPerNode))

	return out.String()
	//return fmt.Sprintf("ID: %d, Owner: %s, Manager: %s, NFDForInfo: %d, PayoutEveryXDays: %d, PercentToValidator: %d, ValidatorCommissionAddress: %s, MinEntryStake: %d, MaxAlgoPerPool: %d, PoolsPerNode: %d", v.ID, v.Owner, v.Manager, v.NFDForInfo, v.PayoutEveryXDays, v.PercentToValidator, v.ValidatorCommissionAddress, v.MinEntryStake, v.MaxAlgoPerPool, v.PoolsPerNode)
}

type ValidatorCurState struct {
	NumPools        int    // current number of pools this validator has - capped at MaxPools
	TotalStakers    uint64 // total number of stakers across all pools
	TotalAlgoStaked uint64 // total amount staked to this validator across ALL of its pools
}

func (v *ValidatorCurState) String() string {
	return fmt.Sprintf("NumPools: %d, TotalStakers: %d, TotalAlgoStaked: %d", v.NumPools, v.TotalStakers, v.TotalAlgoStaked)
}

func ValidatorCurStateFromABIReturn(returnVal any) (*ValidatorCurState, error) {
	if arrReturn, ok := returnVal.([]any); ok {
		if len(arrReturn) != 3 {
			return nil, fmt.Errorf("should be 3 elements returned in ValidatorCurState response")
		}
		state := &ValidatorCurState{}
		state.NumPools = int(arrReturn[0].(uint16))
		state.TotalStakers = arrReturn[1].(uint64)
		state.TotalAlgoStaked = arrReturn[2].(uint64)

		return state, nil
	}
	return nil, fmt.Errorf("unknown value returned from abi, type:%T", returnVal)
}

type ValidatorPoolKey struct {
	ID        uint64 // 0 is invalid - should start at 1 (but is direct key in box)
	PoolID    uint64 // 0 means INVALID ! - so 1 is index, technically of [0]
	PoolAppID uint64
}

func (v *ValidatorPoolKey) String() string {
	return fmt.Sprintf("ValidatorPoolKey{ID: %d, PoolID: %d, PoolAppID: %d}", v.ID, v.PoolID, v.PoolAppID)
}

func ValidatorPoolKeyFromABIReturn(returnVal any) (*ValidatorPoolKey, error) {
	if arrReturn, ok := returnVal.([]any); ok {
		if len(arrReturn) != 3 {
			return nil, fmt.Errorf("should be 3 elements returned in ValidatorPoolKey response")
		}
		key := &ValidatorPoolKey{}
		key.ID = arrReturn[0].(uint64)
		key.PoolID = arrReturn[1].(uint64)
		key.PoolAppID = arrReturn[2].(uint64)

		return key, nil
	}
	return nil, errCantFetchPoolKey
}

type PoolInfo struct {
	PoolAppID       uint64 // The App ID of this staking pool contract instance
	TotalStakers    int
	TotalAlgoStaked uint64
}

func ValidatorPoolsFromABIReturn(returnVal any) ([]PoolInfo, error) {
	var retPools []PoolInfo
	if arrReturn, ok := returnVal.([]any); ok {
		for _, poolInfoAny := range arrReturn {
			if poolInfo, ok := poolInfoAny.([]any); ok {
				if len(poolInfo) != 3 {
					return nil, fmt.Errorf("should be 3 elements returned in PoolInfo response")
				}
				retPools = append(retPools, PoolInfo{
					PoolAppID:       poolInfo[0].(uint64),
					TotalStakers:    int(poolInfo[1].(uint16)),
					TotalAlgoStaked: poolInfo[2].(uint64),
				})
			}
		}
		return retPools, nil
	}
	return retPools, errCantFetchPoolKey
}

func ValidatorPoolInfoFromABIReturn(returnVal any) (*PoolInfo, error) {
	if arrReturn, ok := returnVal.([]any); ok {
		if len(arrReturn) != 3 {
			return nil, fmt.Errorf("should be 3 elements returned in PoolInfo response")
		}
		key := &PoolInfo{}
		key.PoolAppID = arrReturn[0].(uint64)
		key.TotalStakers = int(arrReturn[1].(uint16))
		key.PoolAppID = arrReturn[2].(uint64)

		return key, nil
	}
	return nil, errCantFetchPoolKey
}

func (r *Reti) AddValidator(info *ValidatorInfo, nfdName string) (uint64, error) {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return 0, err
	}

	ownerAddr, _ := types.DecodeAddress(info.Config.Owner)
	managerAddr, _ := types.DecodeAddress(info.Config.Manager)
	commissionAddr, _ := types.DecodeAddress(info.Config.ValidatorCommissionAddress)

	// first determine how much we have to add in MBR to the validator
	mbrs, err := r.getMbrAmounts(ownerAddr)
	if err != nil {
		return 0, err
	}

	// Now try to actually create the validator !!
	atc := transaction.AtomicTransactionComposer{}

	method, err := r.validatorContract.GetMethodByName("addValidator")
	if err != nil {
		return 0, err
	}
	// We need to set all the box references ourselves still in go, so we need the id of the 'next' validator
	// We'll do the next two just to be safe (for race condition of someone else adding validator before us)
	curValidatorID, err := r.getNumValidators()
	if err != nil {
		return 0, err
	}
	slog.Debug("mbrs", "validatormbr", mbrs.AddValidatorMbr)

	// Pay the mbr to add a validator then wrap for use in ATC.
	paymentTxn, err := transaction.MakePaymentTxn(ownerAddr.String(), crypto.GetApplicationAddress(r.RetiAppID).String(), mbrs.AddValidatorMbr, nil, "", params)
	payTxWithSigner := transaction.TransactionWithSigner{
		Txn:    paymentTxn,
		Signer: algo.SignWithAccountForATC(r.signer, ownerAddr.String()),
	}

	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:  r.RetiAppID,
		Method: method,
		MethodArgs: []any{
			// MBR payment
			payTxWithSigner,
			// --
			nfdName,
			[]any{
				0, // id is ignored and assigned by contract
				ownerAddr,
				managerAddr,
				info.Config.NFDForInfo,
				uint16(info.Config.PayoutEveryXDays),
				uint16(info.Config.PercentToValidator),
				commissionAddr,
				info.Config.MinEntryStake,
				info.Config.MaxAlgoPerPool,
				uint8(info.Config.PoolsPerNode),
			},
		},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(curValidatorID + 1)},
			{AppID: 0, Name: GetValidatorListBoxName(curValidatorID + 2)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          ownerAddr,
		Signer:          algo.SignWithAccountForATC(r.signer, ownerAddr.String()),
	})

	result, err := atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return 0, err
	}
	if validatorID, ok := result.MethodResults[0].ReturnValue.(uint64); ok {
		return validatorID, nil
	}
	return 0, nil
}

func (r *Reti) GetValidatorConfig(id uint64, sender types.Address) (*ValidatorConfig, error) {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	// Now try to actually create the validator !!
	atc := transaction.AtomicTransactionComposer{}

	method, err := r.validatorContract.GetMethodByName("getValidatorConfig")
	if err != nil {
		return nil, err
	}
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:      r.RetiAppID,
		Method:     method,
		MethodArgs: []any{id},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(id)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          sender,
		Signer:          transaction.EmptyTransactionSigner{},
	})

	result, err := atc.Simulate(context.Background(), r.algoClient, models.SimulateRequest{
		AllowEmptySignatures:  true,
		AllowUnnamedResources: true,
	})
	if err != nil {
		return nil, err
	}
	return ValidatorConfigFromABIReturn(result.MethodResults[0].ReturnValue)
}

func (r *Reti) GetValidatorState(id uint64, sender types.Address) (*ValidatorCurState, error) {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	// Now try to actually create the validator !!
	atc := transaction.AtomicTransactionComposer{}

	method, err := r.validatorContract.GetMethodByName("getValidatorState")
	if err != nil {
		return nil, err
	}
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:      r.RetiAppID,
		Method:     method,
		MethodArgs: []any{id},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(id)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          sender,
		Signer:          transaction.EmptyTransactionSigner{},
	})

	result, err := atc.Simulate(context.Background(), r.algoClient, models.SimulateRequest{
		AllowEmptySignatures:  true,
		AllowUnnamedResources: true,
	})
	if err != nil {
		return nil, err
	}
	return ValidatorCurStateFromABIReturn(result.MethodResults[0].ReturnValue)
}

func (r *Reti) GetValidatorPools(id uint64, sender types.Address) ([]PoolInfo, error) {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	// Now try to actually create the validator !!
	atc := transaction.AtomicTransactionComposer{}

	getPoolInfoMethod, err := r.validatorContract.GetMethodByName("getPools")
	if err != nil {
		return nil, err
	}
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:      r.RetiAppID,
		Method:     getPoolInfoMethod,
		MethodArgs: []any{id},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(id)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          sender,
		Signer:          algo.SignWithAccountForATC(r.signer, sender.String()),
	})

	result, err := atc.Simulate(context.Background(), r.algoClient, models.SimulateRequest{
		AllowEmptySignatures:  true,
		AllowMoreLogging:      true,
		AllowUnnamedResources: true,
	})
	if err != nil {
		return nil, err
	}
	return ValidatorPoolsFromABIReturn(result.MethodResults[0].ReturnValue)
}

func (r *Reti) GetValidatorPoolInfo(poolKey ValidatorPoolKey, sender types.Address) (*PoolInfo, error) {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	// Now try to actually create the validator !!
	atc := transaction.AtomicTransactionComposer{}

	getPoolInfoMethod, _ := r.validatorContract.GetMethodByName("getPoolInfo")
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:       r.RetiAppID,
		Method:      getPoolInfoMethod,
		MethodArgs:  []any{poolKey.ID, poolKey.PoolID, poolKey.PoolAppID},
		ForeignApps: []uint64{poolKey.PoolAppID},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(poolKey.PoolAppID)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          sender,
		Signer:          algo.SignWithAccountForATC(r.signer, sender.String()),
	})

	result, err := atc.Simulate(context.Background(), r.algoClient, models.SimulateRequest{
		AllowEmptySignatures:  true,
		AllowUnnamedResources: true,
	})
	if err != nil {
		return nil, err
	}
	return ValidatorPoolInfoFromABIReturn(result.MethodResults[0].ReturnValue)
}

func (r *Reti) getStakedPoolsForAccount(staker types.Address) ([]*ValidatorPoolKey, error) {
	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	method, err := r.validatorContract.GetMethodByName("getStakedPoolsForAccount")
	if err != nil {
		return nil, err
	}
	atc := transaction.AtomicTransactionComposer{}
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:           r.RetiAppID,
		Method:          method,
		MethodArgs:      []any{staker},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          staker,
		Signer:          transaction.EmptyTransactionSigner{},
	})
	result, err := atc.Simulate(context.Background(), r.algoClient, models.SimulateRequest{
		AllowEmptySignatures:  true,
		AllowUnnamedResources: true,
	})
	if err != nil {
		return nil, err
	}
	if result.SimulateResponse.TxnGroups[0].FailureMessage != "" {
		return nil, errors.New(result.SimulateResponse.TxnGroups[0].FailureMessage)
	}
	var retPools []*ValidatorPoolKey
	if arrReturn, ok := result.MethodResults[0].ReturnValue.([]any); ok {
		for _, poolInfoAny := range arrReturn {
			poolKey, err := ValidatorPoolKeyFromABIReturn(poolInfoAny)
			if err != nil {
				return nil, err
			}
			retPools = append(retPools, poolKey)
		}
		return retPools, nil
	}

	return nil, fmt.Errorf("unknown result type:%#v", result.MethodResults)
}

func (r *Reti) FindPoolForStaker(id uint64, staker types.Address, amount uint64) (*ValidatorPoolKey, error) {
	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	findPoolMethod, _ := r.validatorContract.GetMethodByName("findPoolForStaker")
	atc := transaction.AtomicTransactionComposer{}
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:           r.RetiAppID,
		Method:          findPoolMethod,
		MethodArgs:      []any{id, staker, amount},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          staker,
		Signer:          transaction.EmptyTransactionSigner{},
	})
	result, err := atc.Simulate(context.Background(), r.algoClient, models.SimulateRequest{
		AllowEmptySignatures:  true,
		AllowUnnamedResources: true,
	})
	if err != nil {
		return nil, err
	}
	if result.SimulateResponse.TxnGroups[0].FailureMessage != "" {
		return nil, errors.New(result.SimulateResponse.TxnGroups[0].FailureMessage)
	}
	// findPoolForStaker returns [ValidatorPoolKey, boolean]
	return ValidatorPoolKeyFromABIReturn(result.MethodResults[0].ReturnValue.([]any)[0])
}

func (r *Reti) AddStakingPool(info *ValidatorInfo) (*ValidatorPoolKey, error) {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	managerAddr, _ := types.DecodeAddress(info.Config.Manager)

	// first determine how much we have to add in MBR to the validator for adding a staking pool
	mbrs, err := r.getMbrAmounts(managerAddr)
	if err != nil {
		return nil, err
	}

	// Now try to actually create the pool !!
	atc := transaction.AtomicTransactionComposer{}

	method, err := r.validatorContract.GetMethodByName("addPool")
	if err != nil {
		return nil, err
	}
	// We have to pay MBR into the Validator contract itself for adding a pool
	paymentTxn, err := transaction.MakePaymentTxn(managerAddr.String(), crypto.GetApplicationAddress(r.RetiAppID).String(), mbrs.AddPoolMbr, nil, "", params)
	payTxWithSigner := transaction.TransactionWithSigner{
		Txn:    paymentTxn,
		Signer: algo.SignWithAccountForATC(r.signer, managerAddr.String()),
	}

	params.FlatFee = true
	params.Fee = types.MicroAlgos(max(uint64(params.Fee), 1000) + params.MinFee)

	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:  r.RetiAppID,
		Method: method,
		MethodArgs: []any{
			// MBR payment
			payTxWithSigner,
			// --
			info.Config.ID,
		},
		ForeignApps: []uint64{r.poolTemplateAppID()},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(info.Config.ID)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          managerAddr,
		Signer:          algo.SignWithAccountForATC(r.signer, managerAddr.String()),
	})
	result, err := atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return nil, err
	}

	poolKey, err := ValidatorPoolKeyFromABIReturn(result.MethodResults[0].ReturnValue)
	if err != nil {
		return nil, err
	}

	// Now we have to pay MBR into the staking pool itself (!) and tell it to initialize itself
	method, err = r.poolContract.GetMethodByName("initStorage")
	if err != nil {
		return nil, err
	}

	atc = transaction.AtomicTransactionComposer{}
	paymentTxn, err = transaction.MakePaymentTxn(managerAddr.String(), crypto.GetApplicationAddress(poolKey.PoolAppID).String(), mbrs.PoolInitMbr, nil, "", params)
	payTxWithSigner = transaction.TransactionWithSigner{
		Txn:    paymentTxn,
		Signer: algo.SignWithAccountForATC(r.signer, managerAddr.String()),
	}
	atc.AddTransaction(payTxWithSigner)
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:  poolKey.PoolAppID,
		Method: method,
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: []byte("stakers")},
			{AppID: 0, Name: nil}, // extra i/o
			{AppID: 0, Name: nil}, // extra i/o
			{AppID: 0, Name: nil}, // extra i/o
			{AppID: 0, Name: nil}, // extra i/o
			{AppID: 0, Name: nil}, // extra i/o
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          managerAddr,
		Signer:          algo.SignWithAccountForATC(r.signer, managerAddr.String()),
	})
	result, err = atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return nil, err
	}

	return poolKey, err
}

func (r *Reti) AddStake(validatorID uint64, staker types.Address, amount uint64) (*ValidatorPoolKey, error) {
	var (
		err           error
		amountToStake = uint64(amount)
	)

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	// first determine how much we might have to add in MBR if this is a first-time staker
	mbrs, err := r.getMbrAmounts(staker)
	if err != nil {
		return nil, err
	}

	// has this staker ever staked anything?
	poolKeys, err := r.getStakedPoolsForAccount(staker)

	if len(poolKeys) == 0 {
		misc.Infof(r.logger, "Adding %s ALGO to stake to cover first-time MBR", algo.FormattedAlgoAmount(mbrs.AddStakerMbr))
		amountToStake += mbrs.AddStakerMbr
	}

	// Because we can't do easy simulate->execute in Go we have to figure out the references ourselves which means we need to know in advance
	// what staking pool we'll go to.  So we can just ask validator to find the pool for us and then use that (some small race conditions obviously)
	futurePoolKey, err := r.FindPoolForStaker(validatorID, staker, amount)
	if err != nil {
		return nil, err
	}

	getAtc := func(feesToUse uint64) (transaction.AtomicTransactionComposer, error) {
		atc := transaction.AtomicTransactionComposer{}
		gasMethod, _ := r.validatorContract.GetMethodByName("gas")
		stakeMethod, _ := r.validatorContract.GetMethodByName("addStake")

		paymentTxn, err := transaction.MakePaymentTxn(staker.String(), crypto.GetApplicationAddress(r.RetiAppID).String(), amountToStake, nil, "", params)
		payTxWithSigner := transaction.TransactionWithSigner{
			Txn:    paymentTxn,
			Signer: algo.SignWithAccountForATC(r.signer, staker.String()),
		}

		params.FlatFee = true
		params.Fee = transaction.MinTxnFee
		// we need to stack up references in this gas method for resource pooling
		err = atc.AddMethodCall(transaction.AddMethodCallParams{
			AppID:  r.RetiAppID,
			Method: gasMethod,
			BoxReferences: []types.AppBoxReference{
				{AppID: 0, Name: GetValidatorListBoxName(validatorID)},
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: GetStakerPoolSetBoxName(staker)},
			},
			SuggestedParams: params,
			OnComplete:      types.NoOpOC,
			Sender:          staker,
			Signer:          algo.SignWithAccountForATC(r.signer, staker.String()),
		})
		if err != nil {
			return atc, err
		}
		if feesToUse == 0 {
			// we're simulating so go with super high budget
			feesToUse = 240 * transaction.MinTxnFee
		}
		params.Fee = types.MicroAlgos(feesToUse)
		err = atc.AddMethodCall(transaction.AddMethodCallParams{
			AppID:  r.RetiAppID,
			Method: stakeMethod,
			MethodArgs: []any{
				// MBR payment
				payTxWithSigner,
				// --
				validatorID,
			},
			ForeignApps: []uint64{futurePoolKey.PoolAppID},
			BoxReferences: []types.AppBoxReference{
				{AppID: futurePoolKey.PoolAppID, Name: []byte("stakers")},
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
			},
			SuggestedParams: params,
			OnComplete:      types.NoOpOC,
			Sender:          staker,
			Signer:          algo.SignWithAccountForATC(r.signer, staker.String()),
		})
		if err != nil {
			return atc, err
		}
		return atc, err
	}

	// simulate first
	atc, err := getAtc(0)
	if err != nil {
		return nil, err
	}
	simResult, err := atc.Simulate(context.Background(), r.algoClient, models.SimulateRequest{
		AllowEmptySignatures:  true,
		AllowUnnamedResources: true,
	})
	if err != nil {
		return nil, err
	}
	if simResult.SimulateResponse.TxnGroups[0].FailureMessage != "" {
		return nil, errors.New(simResult.SimulateResponse.TxnGroups[0].FailureMessage)
	}
	// Figure out how much app budget was added so we can know the real fees to use when we execute
	atc, err = getAtc(2*transaction.MinTxnFee + transaction.MinTxnFee*(simResult.SimulateResponse.TxnGroups[0].AppBudgetAdded/700))
	if err != nil {
		return nil, err
	}

	result, err := atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return nil, err
	}
	return ValidatorPoolKeyFromABIReturn(result.MethodResults[1].ReturnValue)
}

func GetValidatorListBoxName(id uint64) []byte {
	prefix := []byte("v")
	ibytes := make([]byte, 8)
	binary.BigEndian.PutUint64(ibytes, id)
	return bytes.Join([][]byte{prefix, ibytes[:]}, nil)
}

func GetStakerPoolSetBoxName(stakerAccount types.Address) []byte {
	return bytes.Join([][]byte{[]byte("sps"), stakerAccount[:]}, nil)
}

type MbrAmounts struct {
	AddValidatorMbr uint64
	AddPoolMbr      uint64
	PoolInitMbr     uint64
	AddStakerMbr    uint64
}

func (r *Reti) getMbrAmounts(caller types.Address) (MbrAmounts, error) {
	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return MbrAmounts{}, err
	}

	method, err := r.validatorContract.GetMethodByName("getMbrAmounts")
	if err != nil {
		return MbrAmounts{}, err
	}
	r.logger.Info("caller addr is:", "caller", caller.String())
	atc := transaction.AtomicTransactionComposer{}
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:           r.RetiAppID,
		Method:          method,
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          caller,
		Signer:          transaction.EmptyTransactionSigner{},
	})
	result, err := atc.Simulate(context.Background(), r.algoClient, models.SimulateRequest{
		AllowEmptySignatures:  true,
		AllowUnnamedResources: true,
	})
	if err != nil {
		return MbrAmounts{}, err
	}
	if result.SimulateResponse.TxnGroups[0].FailureMessage != "" {
		return MbrAmounts{}, errors.New(result.SimulateResponse.TxnGroups[0].FailureMessage)
	}

	if results, ok := result.MethodResults[0].ReturnValue.([]any); ok {
		if len(results) != 4 {
			return MbrAmounts{}, errors.New("invalid number of results")
		}
		var mbrs MbrAmounts
		mbrs.AddValidatorMbr = results[0].(uint64)
		mbrs.AddPoolMbr = results[1].(uint64)
		mbrs.PoolInitMbr = results[2].(uint64)
		mbrs.AddStakerMbr = results[3].(uint64)
		return mbrs, nil
	}
	return MbrAmounts{}, fmt.Errorf("unknown result type:%#v", result.MethodResults)
}

func (r *Reti) getNumValidators() (uint64, error) {
	appInfo, err := r.algoClient.GetApplicationByID(r.RetiAppID).Do(context.Background())
	if err != nil {
		return 0, err
	}
	for _, gs := range appInfo.Params.GlobalState {
		rawKey, _ := base64.StdEncoding.DecodeString(gs.Key)
		key := string(rawKey)
		if key == "numV" && gs.Value.Type == 2 {
			return gs.Value.Uint, nil
		}
	}
	return 0, errCantFetchValidators
}

func (r *Reti) poolTemplateAppID() uint64 {
	r.oneTimeInit.Do(func() {
		appInfo, err := r.algoClient.GetApplicationByID(r.RetiAppID).Do(context.Background())
		if err != nil {
			log.Panicln(err)
		}
		for _, gs := range appInfo.Params.GlobalState {
			rawKey, _ := base64.StdEncoding.DecodeString(gs.Key)
			key := string(rawKey)
			if key == "poolTemplateAppID" && gs.Value.Type == 2 {
				r.poolTmplAppID = gs.Value.Uint
				return
			}
		}
	})
	return r.poolTmplAppID
}
