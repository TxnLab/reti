package reti

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"log/slog"

	"github.com/algorand/go-algorand-sdk/v2/abi"
	"github.com/algorand/go-algorand-sdk/v2/client/v2/common/models"
	"github.com/algorand/go-algorand-sdk/v2/crypto"
	"github.com/algorand/go-algorand-sdk/v2/transaction"
	"github.com/algorand/go-algorand-sdk/v2/types"

	"github.com/TxnLab/reti/internal/lib/algo"
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
	return fmt.Sprintf("ID: %d, Owner: %s, Manager: %s, NFDForInfo: %d, PayoutEveryXDays: %d, PercentToValidator: %d, ValidatorCommissionAddress: %s, MinEntryStake: %d, MaxAlgoPerPool: %d, PoolsPerNode: %d", v.ID, v.Owner, v.Manager, v.NFDForInfo, v.PayoutEveryXDays, v.PercentToValidator, v.ValidatorCommissionAddress, v.MinEntryStake, v.MaxAlgoPerPool, v.PoolsPerNode)
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

type PoolInfo struct {
	NodeID          int
	PoolAppID       uint64 // The App ID of this staking pool contract instance
	TotalStakers    int
	TotalAlgoStaked uint64
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

	// first determine how much we have to add in MBR to the validaotr
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
	slog.Info("mbrs", "validatormbr", mbrs.AddValidatorMbr)

	// Pay the mbr to add a validator then wrap for use in ATC.
	paymentTxn, err := transaction.MakePaymentTxn(ownerAddr.String(), crypto.GetApplicationAddress(r.ValidatorAppID).String(), mbrs.AddValidatorMbr, nil, "", params)
	payTxWithSigner := transaction.TransactionWithSigner{
		Txn:    paymentTxn,
		Signer: algo.SignWithAccountForATC(r.signer, ownerAddr.String()),
	}

	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:  r.ValidatorAppID,
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

	res, err := atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return 0, err
	}
	if validatorID, ok := res.MethodResults[0].ReturnValue.(uint64); ok {
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
		AppID:      r.ValidatorAppID,
		Method:     method,
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

	res, err := atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return nil, err
	}
	return ValidatorConfigFromABIReturn(res.MethodResults[0].ReturnValue)
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
		AppID:      r.ValidatorAppID,
		Method:     method,
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

	res, err := atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return nil, err
	}
	return ValidatorCurStateFromABIReturn(res.MethodResults[0].ReturnValue)
}

func GetValidatorListBoxName(id uint64) []byte {
	prefix := []byte("v")
	ibytes := make([]byte, 8)
	binary.BigEndian.PutUint64(ibytes, id)
	return bytes.Join([][]byte{prefix, ibytes[:]}, nil)
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

	method, err := abi.MethodFromSignature("getMbrAmounts()(uint64,uint64,uint64,uint64)")
	if err != nil {
		return MbrAmounts{}, err
	}
	atc := transaction.AtomicTransactionComposer{}
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:           r.ValidatorAppID,
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
	appInfo, err := r.algoClient.GetApplicationByID(r.ValidatorAppID).Do(context.Background())
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
