package reti

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/common/models"
	"github.com/algorand/go-algorand-sdk/v2/crypto"
	"github.com/algorand/go-algorand-sdk/v2/transaction"
	"github.com/algorand/go-algorand-sdk/v2/types"

	"github.com/TxnLab/reti/internal/lib/algo"
	"github.com/TxnLab/reti/internal/lib/misc"
)

// ValidatorInfo is loaded at startup but also on-demand via Reti.LoadState
type ValidatorInfo struct {
	Config              ValidatorConfig
	Pools               []PoolInfo
	NodePoolAssignments NodePoolAssignmentConfig

	// A generated map of pool id's and the App id assigned to it - for 'our' node
	// determined via Pools and NodePoolAssignments
	LocalPools map[uint64]uint64
}

type NodeConfig struct {
	PoolAppIds []uint64
}

type NodePoolAssignmentConfig struct {
	Nodes []NodeConfig
}

type ValidatorConfig struct {
	// ID of this validator (sequentially assigned)
	ID uint64
	// account that controls config - presumably cold-wallet
	Owner string
	// account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign for the transactions
	Manager string
	// Optional NFD AppID which the validator uses to describe their validator pool
	NFDForInfo uint64

	// EntryGatingType / EntryGatingValue specifies an optional gating mechanism - whose criteria
	// the staker must meet.
	EntryGatingType    uint8
	EntryGatingAddress string
	EntryGatingAssets  []uint64

	// GatingAssetMinBalance specifies a minimum token base units amount needed of an asset owned by the specified
	// creator (if defined).  If 0, then they need to hold at lest 1 unit, but its assumed this is for tokens, ie: hold
	// 10000[.000000] of token
	GatingAssetMinBalance uint64

	// Reward token ASA ID and reward rate (Optional): A validator can define a token that users are awarded in addition to
	// the ALGO they receive for being in the pool. This will allow projects to allow rewarding members their own
	// token.  Hold at least 5000 VEST to enter a Vestige staking pool, they have 1 day epochs and all
	// stakers get X amount of VEST as daily rewards (added to stakers ‘available’ balance) for removal at any time.
	RewardTokenId   uint64
	RewardPerPayout uint64

	// Number of rounds per epoch
	EpochRoundLength int
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

	SunsettingOn uint64 // timestamp when validator will sunset (if != 0)
	SunsettingTo uint64 // validator ID that validator is 'moving' to (if known)

}

func ValidatorConfigFromABIReturn(returnVal any) (*ValidatorConfig, error) {
	if arrReturn, ok := returnVal.([]any); ok {
		if len(arrReturn) != 18 {
			return nil, fmt.Errorf("should be 18 elements returned in ValidatorConfig response")
		}
		pkAsString := func(pk []uint8) string {
			addr, _ := types.EncodeAddress(pk)
			return addr
		}
		arrValues := func(arr []any) []uint64 {
			values := make([]uint64, len(arr))
			for i, v := range arr {
				values[i] = v.(uint64)
			}
			return values
		}
		config := &ValidatorConfig{}
		config.ID = arrReturn[0].(uint64)
		config.Owner = pkAsString(arrReturn[1].([]uint8))
		config.Manager = pkAsString(arrReturn[2].([]uint8))
		config.NFDForInfo = arrReturn[3].(uint64)
		config.EntryGatingType = arrReturn[4].(uint8)
		config.EntryGatingAddress = pkAsString(arrReturn[5].([]uint8))
		config.EntryGatingAssets = arrValues(arrReturn[6].([]any))
		config.GatingAssetMinBalance = arrReturn[7].(uint64)
		config.RewardTokenId = arrReturn[8].(uint64)
		config.RewardPerPayout = arrReturn[9].(uint64)
		config.EpochRoundLength = int(arrReturn[10].(uint32))
		config.PercentToValidator = int(arrReturn[11].(uint32))
		config.ValidatorCommissionAddress = pkAsString(arrReturn[12].([]uint8))
		config.MinEntryStake = arrReturn[13].(uint64)
		config.MaxAlgoPerPool = arrReturn[14].(uint64)
		config.PoolsPerNode = int(arrReturn[15].(uint8))
		config.SunsettingOn = arrReturn[16].(uint64)
		config.SunsettingTo = arrReturn[17].(uint64)
		return config, nil
	}
	return nil, fmt.Errorf("unknown value returned from abi, type:%T", returnVal)
}

type ProtocolConstraints struct {
	epochPayoutRoundsMin           uint64
	epochPayoutRoundsMax           uint64
	MinPctToValidatorWFourDecimals uint64
	MaxPctToValidatorWFourDecimals uint64
	MinEntryStake                  uint64 // in microAlgo
	MaxAlgoPerPool                 uint64 // in microAlgo
	MaxAlgoPerValidator            uint64 // in microAlgo
	AmtConsideredSaturated         uint64 // soft stake - when saturation starts - in microAlgo
	MaxNodes                       uint64
	MaxPoolsPerNode                uint64
	MaxStakersPerPool              uint64
}

func ProtocolConstraintsFromABIReturn(returnVal any) (*ProtocolConstraints, error) {
	if arrReturn, ok := returnVal.([]any); ok {
		if len(arrReturn) != 11 {
			return nil, fmt.Errorf("should be 10 elements returned in ProtocolConstraints response")
		}
		constraints := &ProtocolConstraints{}
		constraints.epochPayoutRoundsMin = arrReturn[0].(uint64)
		constraints.epochPayoutRoundsMax = arrReturn[1].(uint64)
		constraints.MinPctToValidatorWFourDecimals = arrReturn[2].(uint64)
		constraints.MaxPctToValidatorWFourDecimals = arrReturn[3].(uint64)
		constraints.MinEntryStake = arrReturn[4].(uint64)
		constraints.MaxAlgoPerPool = arrReturn[5].(uint64)
		constraints.MaxAlgoPerValidator = arrReturn[6].(uint64)
		constraints.AmtConsideredSaturated = arrReturn[7].(uint64)
		constraints.MaxNodes = arrReturn[8].(uint64)
		constraints.MaxPoolsPerNode = arrReturn[9].(uint64)
		constraints.MaxStakersPerPool = arrReturn[10].(uint64)
		return constraints, nil
	}
	return nil, fmt.Errorf("unknown value returned from abi, type:%T", returnVal)
}

func formattedMinutes(mins int) string {
	// return a string expression of minutes in various forms (if applicable)
	// minutes, hours, days
	var out strings.Builder
	if mins < 60 {
		out.WriteString(fmt.Sprintf("%d minutes", mins))
	} else if mins < 1440 {
		hours := mins / 60
		minutes := mins % 60
		out.WriteString(fmt.Sprintf("%d hours, %d minutes", hours, minutes))
	} else {
		days := mins / 1440
		hours := (mins % 1440) / 60
		minutes := (mins % 1440) % 60
		out.WriteString(fmt.Sprintf("%d days, %d hours, %d minutes", days, hours, minutes))
	}
	return out.String()
}

func (v *ValidatorConfig) String() string {
	var out strings.Builder

	out.WriteString(fmt.Sprintf("id: %d\n", v.ID))
	out.WriteString(fmt.Sprintf("owner: %s\n", v.Owner))
	out.WriteString(fmt.Sprintf("manager: %s\n", v.Manager))
	out.WriteString(fmt.Sprintf("Validator Commission Address: %s\n", v.ValidatorCommissionAddress))
	out.WriteString(fmt.Sprintf("%% to Validator: %.04f\n", float64(v.PercentToValidator)/10_000.0))
	if v.NFDForInfo != 0 {
		out.WriteString(fmt.Sprintf("NFD id: %d\n", v.NFDForInfo))
	}
	switch v.EntryGatingType {
	case GatingTypeNone:
	case GatingTypeAssetsCreatedBy:
		out.WriteString(fmt.Sprintf("Reward Token Creator Reqd: %s\n", v.EntryGatingAddress))
		out.WriteString(fmt.Sprintf("Reward Token Min Bal: %d\n", v.GatingAssetMinBalance))
	case GatingTypeAssetId:
		out.WriteString(fmt.Sprintf("Reward Token Requires ASA:%d\n", v.EntryGatingAssets[0]))
		out.WriteString(fmt.Sprintf("Reward Token Min Bal: %d\n", v.GatingAssetMinBalance))
	case GatingTypeCreatedByNFDAddresses:
		out.WriteString(fmt.Sprintf("Reward Token NFD Creator Addresses, NFD id:%d\n", v.EntryGatingAssets[0]))
		out.WriteString(fmt.Sprintf("Reward Token Min Bal: %d\n", v.GatingAssetMinBalance))
	case GatingTypeSegmentOfNFD:
		out.WriteString(fmt.Sprintf("Reward Token NFD Segments of Root NFD id:%d\n", v.EntryGatingAssets[0]))
	}
	if v.EntryGatingType != GatingTypeNone {
		out.WriteString(fmt.Sprintf("Reward Token id: %d\n", v.RewardTokenId))
		out.WriteString(fmt.Sprintf("Reward Per Payout: %d\n", v.RewardPerPayout))
	}

	out.WriteString(fmt.Sprintf("Epoch Length:%d\n", v.EpochRoundLength))
	out.WriteString(fmt.Sprintf("Min Entry Stake: %s\n", algo.FormattedAlgoAmount(v.MinEntryStake)))
	out.WriteString(fmt.Sprintf("Max Algo Per Pool: %s\n", algo.FormattedAlgoAmount(v.MaxAlgoPerPool)))
	out.WriteString(fmt.Sprintf("Max pools per Node: %d\n", v.PoolsPerNode))
	if v.SunsettingOn != 0 {
		out.WriteString(fmt.Sprintf("Sunsetting On: %s\n", time.Unix(int64(v.SunsettingOn), 0).Format(time.RFC3339)))
		if v.SunsettingTo != 0 {
			out.WriteString(fmt.Sprintf("Sunsetting To: %d\n", v.SunsettingTo))
		}
	}

	return out.String()
}

type ValidatorCurState struct {
	NumPools            int    // current number of pools this validator has - capped at MaxPools
	TotalStakers        uint64 // total number of stakers across all pools
	TotalAlgoStaked     uint64 // total amount staked to this validator across ALL of its pools
	RewardTokenHeldBack uint64 // amount of reward tokens held back
}

func (v *ValidatorCurState) String() string {
	return fmt.Sprintf("numPools: %d, totalStakers: %d, totalAlgoStaked: %d", v.NumPools, v.TotalStakers, v.TotalAlgoStaked)
}

func ValidatorCurStateFromABIReturn(returnVal any) (*ValidatorCurState, error) {
	if arrReturn, ok := returnVal.([]any); ok {
		if len(arrReturn) != 4 {
			return nil, fmt.Errorf("should be 4 elements returned in ValidatorCurState response")
		}
		state := &ValidatorCurState{}
		state.NumPools = int(arrReturn[0].(uint16))
		state.TotalStakers = arrReturn[1].(uint64)
		state.TotalAlgoStaked = arrReturn[2].(uint64)
		state.RewardTokenHeldBack = arrReturn[3].(uint64)

		return state, nil
	}
	return nil, fmt.Errorf("unknown value returned from abi, type:%T", returnVal)
}

type ValidatorPoolKey struct {
	ID        uint64 // 0 is invalid - should start at 1 (but is direct key in box)
	PoolId    uint64 // 0 means INVALID ! - so 1 is index, technically of [0]
	PoolAppId uint64
}

func (v *ValidatorPoolKey) String() string {
	return fmt.Sprintf("ValidatorPoolKey{id: %d, poolId: %d, poolAppId: %d}", v.ID, v.PoolId, v.PoolAppId)
}

func ValidatorPoolKeyFromABIReturn(returnVal any) (*ValidatorPoolKey, error) {
	if arrReturn, ok := returnVal.([]any); ok {
		if len(arrReturn) != 3 {
			return nil, fmt.Errorf("should be 3 elements returned in ValidatorPoolKey response")
		}
		key := &ValidatorPoolKey{}
		key.ID = arrReturn[0].(uint64)
		key.PoolId = arrReturn[1].(uint64)
		key.PoolAppId = arrReturn[2].(uint64)

		return key, nil
	}
	return nil, ErrCantFetchPoolKey
}

type PoolInfo struct {
	PoolAppId       uint64 // The App id of this staking pool contract instance
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
					PoolAppId:       poolInfo[0].(uint64),
					TotalStakers:    int(poolInfo[1].(uint16)),
					TotalAlgoStaked: poolInfo[2].(uint64),
				})
			}
		}
		return retPools, nil
	}
	return retPools, ErrCantFetchPoolKey
}

func ValidatorPoolInfoFromABIReturn(returnVal any) (*PoolInfo, error) {
	if arrReturn, ok := returnVal.([]any); ok {
		if len(arrReturn) != 3 {
			return nil, fmt.Errorf("should be 3 elements returned in PoolInfo response")
		}
		key := &PoolInfo{}
		key.PoolAppId = arrReturn[0].(uint64)
		key.TotalStakers = int(arrReturn[1].(uint16))
		key.PoolAppId = arrReturn[2].(uint64)

		return key, nil
	}
	return nil, ErrCantFetchPoolKey
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
	//mustHoldCreatorAddr, _ := types.DecodeAddress(info.config.MustHoldCreatorNFT)

	// first determine how much we have to add in MBR to the validator
	mbrs, err := r.getMbrAmounts(ownerAddr)
	if err != nil {
		return 0, err
	}

	// Now try to actually create the validator !!
	atc := transaction.AtomicTransactionComposer{}

	addValidatorMethod, err := r.validatorContract.GetMethodByName("addValidator")
	if err != nil {
		return 0, err
	}
	// We need to set all the box references ourselves still in go, so we need the id of the 'next' validator
	// We'll do the next two just to be safe (for race condition of someone else adding validator before us)
	curValidatorId, err := r.GetNumValidators()
	if err != nil {
		return 0, err
	}
	slog.Debug("mbrs", "validatormbr", mbrs.AddValidatorMbr)

	params.FlatFee = true
	params.Fee = 10e6 + 1000

	// Pay the mbr to add a validator then wrap for use in ATC.
	paymentTxn, err := transaction.MakePaymentTxn(ownerAddr.String(), crypto.GetApplicationAddress(r.RetiAppId).String(), mbrs.AddValidatorMbr, nil, "", params)
	payTxWithSigner := transaction.TransactionWithSigner{
		Txn:    paymentTxn,
		Signer: algo.SignWithAccountForATC(r.signer, ownerAddr.String()),
	}
	params.Fee = 1000

	err = atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:  r.RetiAppId,
		Method: addValidatorMethod,
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
				0, // gating type none
				types.ZeroAddress,
				[]uint64{0, 0, 0, 0},
				info.Config.GatingAssetMinBalance,
				info.Config.RewardTokenId,
				info.Config.RewardPerPayout,
				uint32(info.Config.EpochRoundLength),
				uint16(info.Config.PercentToValidator),
				commissionAddr,
				info.Config.MinEntryStake,
				info.Config.MaxAlgoPerPool,
				uint8(info.Config.PoolsPerNode),
				info.Config.SunsettingOn,
				info.Config.SunsettingTo,
			},
		},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(curValidatorId + 1)},
			{AppID: 0, Name: GetValidatorListBoxName(curValidatorId + 2)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          ownerAddr,
		Signer:          algo.SignWithAccountForATC(r.signer, ownerAddr.String()),
	})
	if err != nil {
		return 0, fmt.Errorf("error in atc compose: %w", err)
	}

	result, err := atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return 0, err
	}
	if validatorId, ok := result.MethodResults[0].ReturnValue.(uint64); ok {
		return validatorId, nil
	}
	return 0, nil
}

func (r *Reti) GetProtocolConstraints() (*ProtocolConstraints, error) {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	dummyAddr, err := r.getLocalSignerForSimulateCalls()
	if err != nil {
		return nil, err
	}
	// Now try to actually create the validator !!
	atc := transaction.AtomicTransactionComposer{}

	method, _ := r.validatorContract.GetMethodByName("getProtocolConstraints")
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:           r.RetiAppId,
		Method:          method,
		MethodArgs:      []any{},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          dummyAddr,
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
		return nil, fmt.Errorf("error retrieving protocol constraints: %s", result.SimulateResponse.TxnGroups[0].FailureMessage)
	}
	return ProtocolConstraintsFromABIReturn(result.MethodResults[0].ReturnValue)
}

func (r *Reti) GetValidatorConfig(id uint64) (*ValidatorConfig, error) {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	dummyAddr, err := r.getLocalSignerForSimulateCalls()
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
		AppID:      r.RetiAppId,
		Method:     method,
		MethodArgs: []any{id},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(id)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          dummyAddr,
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
		return nil, fmt.Errorf("error retrieving validator config: %s", result.SimulateResponse.TxnGroups[0].FailureMessage)
	}
	return ValidatorConfigFromABIReturn(result.MethodResults[0].ReturnValue)
}

func (r *Reti) GetValidatorState(id uint64) (*ValidatorCurState, error) {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	dummyAddr, err := r.getLocalSignerForSimulateCalls()
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
		AppID:      r.RetiAppId,
		Method:     method,
		MethodArgs: []any{id},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(id)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          dummyAddr,
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

func (r *Reti) GetValidatorPools(id uint64) ([]PoolInfo, error) {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	dummyAddr, err := r.getLocalSignerForSimulateCalls()
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
		AppID:      r.RetiAppId,
		Method:     getPoolInfoMethod,
		MethodArgs: []any{id},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(id)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          dummyAddr,
		Signer:          transaction.EmptyTransactionSigner{},
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

func (r *Reti) GetValidatorPoolInfo(poolKey ValidatorPoolKey) (*PoolInfo, error) {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	dummyAddr, err := r.getLocalSignerForSimulateCalls()
	if err != nil {
		return nil, err
	}

	// Now try to actually create the validator !!
	atc := transaction.AtomicTransactionComposer{}

	getPoolInfoMethod, _ := r.validatorContract.GetMethodByName("getPoolInfo")
	_ = atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:       r.RetiAppId,
		Method:      getPoolInfoMethod,
		MethodArgs:  []any{poolKey.ID, poolKey.PoolId, poolKey.PoolAppId},
		ForeignApps: []uint64{poolKey.PoolAppId},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(poolKey.PoolAppId)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          dummyAddr,
		Signer:          transaction.EmptyTransactionSigner{},
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

func (r *Reti) GetStakedPoolsForAccount(staker types.Address) ([]*ValidatorPoolKey, error) {
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
		AppID:           r.RetiAppId,
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

func (r *Reti) GetValidatorNodePoolAssignments(id uint64) (*NodePoolAssignmentConfig, error) {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	dummyAddr, err := r.getLocalSignerForSimulateCalls()
	if err != nil {
		return nil, err
	}

	// Now try to actually create the validator !!
	atc := transaction.AtomicTransactionComposer{}

	getNodePoolAssignmentsMethod, err := r.validatorContract.GetMethodByName("getNodePoolAssignments")
	if err != nil {
		return nil, err
	}
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:      r.RetiAppId,
		Method:     getNodePoolAssignmentsMethod,
		MethodArgs: []any{id},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(id)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          dummyAddr,
		Signer:          transaction.EmptyTransactionSigner{},
	})

	result, err := atc.Simulate(context.Background(), r.algoClient, models.SimulateRequest{
		AllowEmptySignatures:  true,
		AllowMoreLogging:      true,
		AllowUnnamedResources: true,
	})
	if err != nil {
		return nil, err
	}
	return NodePoolAssignmentFromABIReturn(result.MethodResults[0].ReturnValue)
}

func NodePoolAssignmentFromABIReturn(returnVal any) (*NodePoolAssignmentConfig, error) {
	var retPAC = &NodePoolAssignmentConfig{}
	if arrReturn, ok := returnVal.([]any); ok {
		for _, nodeConfigAny := range arrReturn {
			if nodes, ok := nodeConfigAny.([]any); ok {
				for _, pools := range nodes {
					if poolIDs, ok := pools.([]any); ok {
						var ids []uint64
						for _, id := range poolIDs[0].([]any) {
							convertedID := id.(uint64)
							if convertedID == 0 {
								continue
							}
							ids = append(ids, convertedID)
						}
						retPAC.Nodes = append(retPAC.Nodes, NodeConfig{PoolAppIds: ids})
					}
				}
			}
		}
		return retPAC, nil
	}
	return nil, ErrCantFetchPoolKey
}

func (r *Reti) FindPoolForStaker(id uint64, staker types.Address, amount uint64) (*ValidatorPoolKey, error) {
	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, err
	}

	findPoolMethod, _ := r.validatorContract.GetMethodByName("findPoolForStaker")
	atc := transaction.AtomicTransactionComposer{}
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:           r.RetiAppId,
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

func (r *Reti) ChangeValidatorManagerAddress(id uint64, sender types.Address, managerAddress types.Address) error {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return err
	}

	atc := transaction.AtomicTransactionComposer{}

	changeAddressMethod, _ := r.validatorContract.GetMethodByName("changeValidatorManager")
	// We have to pay MBR into the Validator contract itself for adding a pool
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:  r.RetiAppId,
		Method: changeAddressMethod,
		MethodArgs: []any{
			id,
			managerAddress,
		},
		ForeignApps: []uint64{r.poolTemplateAppId()},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(id)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          sender,
		Signer:          algo.SignWithAccountForATC(r.signer, sender.String()),
	})
	_, err = atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return err
	}

	return nil

}

func (r *Reti) ChangeValidatorCommissionAddress(id uint64, sender types.Address, commissionAddress types.Address) error {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return err
	}

	atc := transaction.AtomicTransactionComposer{}

	changeAddressMethod, _ := r.validatorContract.GetMethodByName("changeValidatorCommissionAddress")
	// We have to pay MBR into the Validator contract itself for adding a pool
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:  r.RetiAppId,
		Method: changeAddressMethod,
		MethodArgs: []any{
			id,
			commissionAddress,
		},
		ForeignApps: []uint64{r.poolTemplateAppId()},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(id)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          sender,
		Signer:          algo.SignWithAccountForATC(r.signer, sender.String()),
	})
	_, err = atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return err
	}

	return nil

}

func (r *Reti) AddStakingPool(nodeNum uint64) (*ValidatorPoolKey, error) {
	var (
		info = r.Info()
		err  error
	)

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

	misc.Infof(r.Logger, "adding staking pool to node:%d", nodeNum)
	addPoolMethod, _ := r.validatorContract.GetMethodByName("addPool")
	// We have to pay MBR into the Validator contract itself for adding a pool
	paymentTxn, err := transaction.MakePaymentTxn(managerAddr.String(), crypto.GetApplicationAddress(r.RetiAppId).String(), mbrs.AddPoolMbr, nil, "", params)
	payTxWithSigner := transaction.TransactionWithSigner{
		Txn:    paymentTxn,
		Signer: algo.SignWithAccountForATC(r.signer, managerAddr.String()),
	}

	params.FlatFee = true
	params.Fee = types.MicroAlgos(max(uint64(params.MinFee), 1000) + params.MinFee)

	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:  r.RetiAppId,
		Method: addPoolMethod,
		MethodArgs: []any{
			// MBR payment
			payTxWithSigner,
			// --
			info.Config.ID,
			nodeNum,
		},
		ForeignApps: []uint64{r.poolTemplateAppId()},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(info.Config.ID)},
			{AppID: 0, Name: nil}, // extra i/o
			{AppID: 0, Name: []byte("poolTemplateApprovalBytes")},
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
	result, err := atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return nil, err
	}

	poolKey, err := ValidatorPoolKeyFromABIReturn(result.MethodResults[0].ReturnValue)
	if err != nil {
		return nil, err
	}

	err = r.CheckAndInitStakingPoolStorage(poolKey)
	if err != nil {
		return nil, err
	}

	return poolKey, err
}

func (r *Reti) MovePoolToNode(poolAppId uint64, nodeNum uint64) error {
	var (
		info = r.Info()
		err  error
	)

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return err
	}

	managerAddr, _ := types.DecodeAddress(info.Config.Manager)

	atc := transaction.AtomicTransactionComposer{}
	misc.Infof(r.Logger, "trying to move pool app id:%d to node number:%d", poolAppId, nodeNum)
	movePoolMethod, _ := r.validatorContract.GetMethodByName("movePoolToNode")

	// pay for go offline call as well
	params.FlatFee = true
	params.Fee = types.MicroAlgos(max(uint64(params.MinFee), 1000) + (2 * params.MinFee))

	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:  r.RetiAppId,
		Method: movePoolMethod,
		MethodArgs: []any{
			info.Config.ID,
			poolAppId,
			nodeNum,
		},
		ForeignApps: []uint64{
			r.poolTemplateAppId(),
			poolAppId,
		},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(info.Config.ID)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          managerAddr,
		Signer:          algo.SignWithAccountForATC(r.signer, managerAddr.String()),
	})
	_, err = atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return err
	}
	return nil
}

func (r *Reti) CheckAndInitStakingPoolStorage(poolKey *ValidatorPoolKey) error {
	// First determine if we NEED to initialize this pool !
	if val, err := r.algoClient.GetApplicationBoxByName(poolKey.PoolAppId, GetStakerLedgerBoxName()).Do(context.Background()); err == nil {
		if len(val.Value) > 0 {
			// we have value already - we're already initialized.
			return nil
		}
	}

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return err
	}

	managerAddr, _ := types.DecodeAddress(r.Info().Config.Manager)

	mbrs, err := r.getMbrAmounts(managerAddr)
	if err != nil {
		return err
	}
	poolInitMbr := mbrs.PoolInitMbr
	if r.Info().Config.RewardTokenId != 0 && poolKey.PoolId == 1 {
		poolInitMbr += 100_000 // cover MBR of reward token asset
	}

	// Now we have to pay MBR into the staking pool itself (!) and tell it to initialize itself
	gasMethod, _ := r.poolContract.GetMethodByName("gas")
	initStorageMethod, _ := r.poolContract.GetMethodByName("initStorage")

	misc.Infof(r.Logger, "initializing staking pool storage, mbr payment to pool:%s", algo.FormattedAlgoAmount(poolInitMbr))
	atc := transaction.AtomicTransactionComposer{}
	paymentTxn, err := transaction.MakePaymentTxn(managerAddr.String(), crypto.GetApplicationAddress(poolKey.PoolAppId).String(), poolInitMbr, nil, "", params)
	payTxWithSigner := transaction.TransactionWithSigner{
		Txn:    paymentTxn,
		Signer: algo.SignWithAccountForATC(r.signer, managerAddr.String()),
	}
	// we need to stack up references in this gas method for resource pooling
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:  poolKey.PoolAppId,
		Method: gasMethod,
		BoxReferences: []types.AppBoxReference{
			{AppID: r.RetiAppId, Name: GetValidatorListBoxName(poolKey.ID)},
			{AppID: 0, Name: GetStakerLedgerBoxName()},
			{AppID: 0, Name: nil}, // extra i/o
			{AppID: 0, Name: nil}, // extra i/o
			{AppID: 0, Name: nil}, // extra i/o
			{AppID: 0, Name: nil}, // extra i/o
		},
		ForeignApps:     []uint64{r.RetiAppId},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          managerAddr,
		Signer:          algo.SignWithAccountForATC(r.signer, managerAddr.String()),
	})
	params.FlatFee = true
	params.Fee = 3 * transaction.MinTxnFee
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:  poolKey.PoolAppId,
		Method: initStorageMethod,
		MethodArgs: []any{
			// MBR payment
			payTxWithSigner,
		},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: nil}, // extra i/o
			{AppID: 0, Name: nil}, // extra i/o
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
	_, err = atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return err
	}
	return nil
}

func (r *Reti) AddStake(validatorId uint64, staker types.Address, amount uint64, assetIDToCheck uint64) (*ValidatorPoolKey, error) {
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

	mbrPaymentNeeded, err := r.doesStakerNeedToPayMBR(staker)
	if err != nil {
		return nil, err
	}
	if mbrPaymentNeeded {
		misc.Infof(r.Logger, "Adding %s ALGO to stake to cover first-time MBR", algo.FormattedAlgoAmount(mbrs.AddStakerMbr))
		amountToStake += mbrs.AddStakerMbr
	}

	// Because we can't do easy simulate->execute in Go we have to figure out the references ourselves which means we need to know in advance
	// what staking pool we'll go to.  So we can just ask validator to find the pool for us and then use that (some small race conditions obviously)
	futurePoolKey, err := r.FindPoolForStaker(validatorId, staker, amount)
	if err != nil {
		return nil, err
	}

	getAtc := func(feesToUse uint64) (transaction.AtomicTransactionComposer, error) {
		atc := transaction.AtomicTransactionComposer{}
		gasMethod, _ := r.validatorContract.GetMethodByName("gas")
		stakeMethod, _ := r.validatorContract.GetMethodByName("addStake")

		params.FlatFee = true
		params.Fee = transaction.MinTxnFee

		paymentTxn, err := transaction.MakePaymentTxn(staker.String(), crypto.GetApplicationAddress(r.RetiAppId).String(), amountToStake, nil, "", params)
		payTxWithSigner := transaction.TransactionWithSigner{
			Txn:    paymentTxn,
			Signer: algo.SignWithAccountForATC(r.signer, staker.String()),
		}

		// we need to stack up references in this gas method for resource pooling
		err = atc.AddMethodCall(transaction.AddMethodCallParams{
			AppID:  r.RetiAppId,
			Method: gasMethod,
			BoxReferences: []types.AppBoxReference{
				{AppID: 0, Name: GetValidatorListBoxName(validatorId)},
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
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
		params.FlatFee = true
		params.Fee = types.MicroAlgos(feesToUse)
		err = atc.AddMethodCall(transaction.AddMethodCallParams{
			AppID:  r.RetiAppId,
			Method: stakeMethod,
			MethodArgs: []any{
				// MBR payment
				payTxWithSigner,
				// --
				validatorId,
				assetIDToCheck,
			},
			ForeignApps: []uint64{futurePoolKey.PoolAppId},
			BoxReferences: []types.AppBoxReference{
				{AppID: futurePoolKey.PoolAppId, Name: GetStakerLedgerBoxName()},
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

func (r *Reti) RemoveStake(poolKey ValidatorPoolKey, signer types.Address, staker types.Address, amount uint64) error {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return err
	}

	getAtc := func(feesToUse uint64) (transaction.AtomicTransactionComposer, error) {
		atc := transaction.AtomicTransactionComposer{}
		gasMethod, _ := r.validatorContract.GetMethodByName("gas")
		unstakeMethod, _ := r.poolContract.GetMethodByName("removeStake")

		params.FlatFee = true
		params.Fee = transaction.MinTxnFee

		// we need to stack up references in this gas method for resource pooling
		err = atc.AddMethodCall(transaction.AddMethodCallParams{
			AppID:           r.RetiAppId,
			Method:          gasMethod,
			ForeignAccounts: []string{staker.String()},
			BoxReferences: []types.AppBoxReference{
				{AppID: r.RetiAppId, Name: GetValidatorListBoxName(poolKey.ID)},
				{AppID: r.RetiAppId, Name: nil}, // extra i/o
				{AppID: r.RetiAppId, Name: GetStakerPoolSetBoxName(staker)},
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
			},
			SuggestedParams: params,
			OnComplete:      types.NoOpOC,
			Sender:          signer,
			Signer:          algo.SignWithAccountForATC(r.signer, signer.String()),
		})
		if err != nil {
			return atc, err
		}
		if feesToUse == 0 {
			// we're simulating so go with super high budget
			feesToUse = 240 * transaction.MinTxnFee
		}
		params.FlatFee = true
		params.Fee = types.MicroAlgos(feesToUse)
		err = atc.AddMethodCall(transaction.AddMethodCallParams{
			AppID:  poolKey.PoolAppId,
			Method: unstakeMethod,
			MethodArgs: []any{
				staker,
				amount,
			},
			ForeignApps: []uint64{poolKey.PoolAppId},
			BoxReferences: []types.AppBoxReference{
				{AppID: 0, Name: GetStakerLedgerBoxName()},
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
			},
			SuggestedParams: params,
			OnComplete:      types.NoOpOC,
			Sender:          signer,
			Signer:          algo.SignWithAccountForATC(r.signer, signer.String()),
		})
		if err != nil {
			return atc, err
		}
		return atc, err
	}

	// simulate first
	atc, err := getAtc(0)
	if err != nil {
		return err
	}
	simResult, err := atc.Simulate(context.Background(), r.algoClient, models.SimulateRequest{
		AllowEmptySignatures:  true,
		AllowUnnamedResources: true,
	})
	if err != nil {
		return err
	}
	if simResult.SimulateResponse.TxnGroups[0].FailureMessage != "" {
		return errors.New(simResult.SimulateResponse.TxnGroups[0].FailureMessage)
	}
	// Figure out how much app budget was added so we can know the real fees to use when we execute
	atc, err = getAtc(2*transaction.MinTxnFee + transaction.MinTxnFee*(simResult.SimulateResponse.TxnGroups[0].AppBudgetAdded/700))
	if err != nil {
		return err
	}

	_, err = atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return err
	}
	return nil
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
	atc := transaction.AtomicTransactionComposer{}
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:           r.RetiAppId,
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

func (r *Reti) doesStakerNeedToPayMBR(staker types.Address) (bool, error) {
	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return false, err
	}

	method, err := r.validatorContract.GetMethodByName("doesStakerNeedToPayMBR")
	if err != nil {
		return false, err
	}
	atc := transaction.AtomicTransactionComposer{}
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:           r.RetiAppId,
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
		return false, err
	}
	val := result.MethodResults[0].ReturnValue
	if boolReturn, ok := val.(bool); ok {
		return boolReturn, nil
	}
	return false, errors.New("unknown return value from doesStakerNeedToPayMBR")
}

func (r *Reti) GetNumValidators() (uint64, error) {
	appInfo, err := r.algoClient.GetApplicationByID(r.RetiAppId).Do(context.Background())
	if err != nil {
		return 0, err
	}
	return algo.GetUint64FromGlobalState(appInfo.Params.GlobalState, VldtrNumValidators)
}

func (r *Reti) poolTemplateAppId() uint64 {
	return r.poolTmplAppId
}
