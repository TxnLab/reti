package reti

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/common/models"
	"github.com/algorand/go-algorand-sdk/v2/crypto"
	"github.com/algorand/go-algorand-sdk/v2/transaction"
	"github.com/algorand/go-algorand-sdk/v2/types"

	"github.com/TxnLab/reti/internal/lib/algo"
	"github.com/TxnLab/reti/internal/lib/misc"
)

type StakedInfo struct {
	Account            types.Address
	Balance            uint64
	TotalRewarded      uint64
	RewardTokenBalance uint64
	EntryRound         uint64
}

func (r *Reti) GetLedgerForPool(poolAppID uint64) ([]StakedInfo, error) {
	var retLedger []StakedInfo
	boxData, err := r.algoClient.GetApplicationBoxByName(poolAppID, GetStakerLedgerBoxName()).Do(context.Background())
	if err != nil {
		return nil, err
	}
	// Iterate through the boxData.Value []byte, taking the fixed-size struct data stored in it (StakedInfo encoded struct)
	// and appending to retLedger as it goes
	const stakedInfoSize = 64
	for i := 0; i < len(boxData.Value); i += stakedInfoSize {
		ledgerData := boxData.Value[i : i+stakedInfoSize]
		var stakedInfo StakedInfo
		stakedInfo.Account = types.Address{}
		copy(stakedInfo.Account[:], ledgerData[0:32])
		stakedInfo.Balance = binary.BigEndian.Uint64(ledgerData[32:40])
		stakedInfo.TotalRewarded = binary.BigEndian.Uint64(ledgerData[40:48])
		stakedInfo.RewardTokenBalance = binary.BigEndian.Uint64(ledgerData[48:56])
		stakedInfo.EntryRound = binary.BigEndian.Uint64(ledgerData[56:64])
		retLedger = append(retLedger, stakedInfo)
	}

	return retLedger, nil
}

func (r *Reti) GetPoolID(poolAppID uint64) (uint64, error) {
	appInfo, err := r.algoClient.GetApplicationByID(poolAppID).Do(context.Background())
	if err != nil {
		return 0, err
	}
	return algo.GetIntFromGlobalState(appInfo.Params.GlobalState, StakePoolPoolId)
}

func (r *Reti) GetLastPayout(poolAppID uint64) (uint64, error) {
	appInfo, err := r.algoClient.GetApplicationByID(poolAppID).Do(context.Background())
	if err != nil {
		return 0, err
	}
	return algo.GetIntFromGlobalState(appInfo.Params.GlobalState, StakePoolLastPayout)
}

func (r *Reti) GetAlgodVer(poolAppID uint64) (string, error) {
	appInfo, err := r.algoClient.GetApplicationByID(poolAppID).Do(context.Background())
	if err != nil {
		return "", err
	}
	return algo.GetStringFromGlobalState(appInfo.Params.GlobalState, StakePoolAlgodVer)
}

func (r *Reti) UpdateAlgodVer(poolAppID uint64, algodVer string, caller types.Address) error {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return err
	}

	atc := transaction.AtomicTransactionComposer{}
	updateAlgodVerMethod, _ := r.poolContract.GetMethodByName("updateAlgodVer")

	params.FlatFee = true
	params.Fee = transaction.MinTxnFee * 2

	err = atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:       poolAppID,
		Method:      updateAlgodVerMethod,
		MethodArgs:  []any{algodVer},
		ForeignApps: []uint64{r.RetiAppId},
		BoxReferences: []types.AppBoxReference{
			{AppID: r.RetiAppId, Name: GetValidatorListBoxName(r.ValidatorId)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          caller,
		Signer:          algo.SignWithAccountForATC(r.signer, caller.String()),
	})
	if err != nil {
		return err
	}

	_, err = atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return err
	}
	return nil
}

func (r *Reti) EpochBalanceUpdate(poolID int, poolAppID uint64, caller types.Address) error {
	var (
		err  error
		info = r.Info()
	)

	// make sure we even have enough rewards to do the payout
	pools, err := r.GetValidatorPools(r.ValidatorId)
	if err != nil {
		return fmt.Errorf("failed to get validator pools: %w", err)
	}
	rewardAvail := r.PoolAvailableRewards(poolAppID, pools[poolID-1].TotalAlgoStaked)
	misc.Infof(r.Logger, "Pool:%d epoch update for app id:%d, avail rewards:%s", poolID, poolAppID, algo.FormattedAlgoAmount(rewardAvail))

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return err
	}

	getAtc := func(feesToUse uint64) (transaction.AtomicTransactionComposer, error) {
		atc := transaction.AtomicTransactionComposer{}
		gasMethod, _ := r.poolContract.GetMethodByName("gas")
		epochUpdateMethod, _ := r.poolContract.GetMethodByName("epochBalanceUpdate")

		newParams := params

		newParams.FlatFee = true
		newParams.Fee = 0

		extraApps := []uint64{}

		if r.info.Config.NFDForInfo != 0 {
			extraApps = append(extraApps, r.info.Config.NFDForInfo)
		}

		// we need to stack up references in these two gas methods for resource pooling
		err = atc.AddMethodCall(transaction.AddMethodCallParams{
			AppID:       poolAppID,
			Method:      gasMethod,
			ForeignApps: []uint64{r.RetiAppId},
			BoxReferences: []types.AppBoxReference{
				{AppID: r.RetiAppId, Name: GetValidatorListBoxName(r.ValidatorId)},
				{AppID: 0, Name: GetStakerLedgerBoxName()},
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
			},
			SuggestedParams: newParams,
			OnComplete:      types.NoOpOC,
			Sender:          caller,
			Signer:          algo.SignWithAccountForATC(r.signer, caller.String()),
		})
		if err != nil {
			return atc, err
		}
		err = atc.AddMethodCall(transaction.AddMethodCallParams{
			AppID:       poolAppID,
			Method:      gasMethod,
			ForeignApps: extraApps,
			ForeignAccounts: []string{
				info.Config.ValidatorCommissionAddress,
				r.info.Config.Manager,
			},
			SuggestedParams: newParams,
			OnComplete:      types.NoOpOC,
			Sender:          caller,
			Signer:          algo.SignWithAccountForATC(r.signer, caller.String()),
		})
		if err != nil {
			return atc, err
		}
		if feesToUse == 0 {
			// we're simulating so go with super high budget
			feesToUse = 240 * transaction.MinTxnFee
		}
		newParams.Fee = types.MicroAlgos(feesToUse)
		err = atc.AddMethodCall(transaction.AddMethodCallParams{
			AppID:  poolAppID,
			Method: epochUpdateMethod,
			BoxReferences: []types.AppBoxReference{
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
				{AppID: 0, Name: nil}, // extra i/o
			},
			SuggestedParams: newParams,
			OnComplete:      types.NoOpOC,
			Sender:          caller,
			Signer:          algo.SignWithAccountForATC(r.signer, caller.String()),
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
		AllowUnnamedResources: true,
	})
	if err != nil {
		return err
	}
	if simResult.SimulateResponse.TxnGroups[0].FailureMessage != "" {
		return errors.New(simResult.SimulateResponse.TxnGroups[0].FailureMessage)
	}
	// Figure out how much app budget was added so we can know the real fees to use when we execute
	atc, err = getAtc(transaction.MinTxnFee * (simResult.SimulateResponse.TxnGroups[0].AppBudgetAdded / 700))
	if err != nil {
		return err
	}

	_, err = atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return err
	}
	return nil
}

func (r *Reti) GoOnline(poolAppID uint64, caller types.Address, votePK []byte, selectionPK []byte, stateProofPK []byte, voteFirst uint64, voteLast uint64, voteKeyDilution uint64) error {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return err
	}

	atc := transaction.AtomicTransactionComposer{}
	goOnlineMethod, _ := r.poolContract.GetMethodByName("goOnline")

	params.FlatFee = true
	params.Fee = transaction.MinTxnFee * 3

	err = atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:  poolAppID,
		Method: goOnlineMethod,
		MethodArgs: []any{
			votePK,
			selectionPK,
			stateProofPK,
			voteFirst,
			voteLast,
			voteKeyDilution,
		},
		ForeignApps: []uint64{r.RetiAppId},
		BoxReferences: []types.AppBoxReference{
			{AppID: r.RetiAppId, Name: GetValidatorListBoxName(r.ValidatorId)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          caller,
		Signer:          algo.SignWithAccountForATC(r.signer, caller.String()),
	})
	if err != nil {
		return err
	}

	_, err = atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return err
	}
	return nil
}

func (r *Reti) GoOffline(poolAppID uint64, caller types.Address) error {
	var err error

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return err
	}

	atc := transaction.AtomicTransactionComposer{}
	goOfflineMethod, _ := r.poolContract.GetMethodByName("goOffline")

	params.FlatFee = true
	params.Fee = transaction.MinTxnFee * 3

	err = atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:       poolAppID,
		Method:      goOfflineMethod,
		ForeignApps: []uint64{r.RetiAppId},
		BoxReferences: []types.AppBoxReference{
			{AppID: r.RetiAppId, Name: GetValidatorListBoxName(r.ValidatorId)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          caller,
		Signer:          algo.SignWithAccountForATC(r.signer, caller.String()),
	})
	if err != nil {
		return err
	}

	_, err = atc.Execute(r.algoClient, context.Background(), 4)
	if err != nil {
		return err
	}
	return nil
}

// PoolBalance just returns the currently available (minus MBR) balance for basic 'is this usable' check.
func (r *Reti) PoolBalance(poolAppID uint64) uint64 {
	return r.PoolAvailableRewards(poolAppID, 0)
}

func (r *Reti) PoolAvailableRewards(poolAppID uint64, totalAlgoStaked uint64) uint64 {
	acctInfo, _ := algo.GetBareAccount(context.Background(), r.algoClient, crypto.GetApplicationAddress(poolAppID).String())
	return acctInfo.Amount - totalAlgoStaked - acctInfo.MinBalance
}
