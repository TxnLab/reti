package reti

import (
	"context"
	"encoding/binary"
	"errors"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/common/models"
	"github.com/algorand/go-algorand-sdk/v2/transaction"
	"github.com/algorand/go-algorand-sdk/v2/types"

	"github.com/TxnLab/reti/internal/lib/algo"
)

type StakedInfo struct {
	Account            types.Address
	Balance            uint64
	TotalRewarded      uint64
	RewardTokenBalance uint64
	EntryTime          uint64
}

func (r *Reti) GetStakerLedger(poolAppID uint64) ([]StakedInfo, error) {
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
		stakedInfo.EntryTime = binary.BigEndian.Uint64(ledgerData[56:64])
		retLedger = append(retLedger, stakedInfo)
	}

	return retLedger, nil
}

func (r *Reti) GetLastPayout(poolAppID uint64) (uint64, error) {
	appInfo, err := r.algoClient.GetApplicationByID(poolAppID).Do(context.Background())
	if err != nil {
		return 0, err
	}
	return algo.GetIntFromGloalState(appInfo.Params.GlobalState, "lastPayout")
}

func (r *Reti) EpochBalanceUpdate(info *ValidatorInfo, poolAppID uint64, caller types.Address) error {
	var (
		err error
	)

	params, err := r.algoClient.SuggestedParams().Do(context.Background())
	if err != nil {
		return err
	}

	getAtc := func(feesToUse uint64) (transaction.AtomicTransactionComposer, error) {
		atc := transaction.AtomicTransactionComposer{}
		gasMethod, _ := r.poolContract.GetMethodByName("gas")
		epochUpdateMethod, _ := r.poolContract.GetMethodByName("epochBalanceUpdate")

		params.FlatFee = true
		params.Fee = transaction.MinTxnFee

		// we need to stack up references in this gas method for resource pooling
		err = atc.AddMethodCall(transaction.AddMethodCallParams{
			AppID:       poolAppID,
			Method:      gasMethod,
			ForeignApps: []uint64{r.RetiAppID},
			BoxReferences: []types.AppBoxReference{
				{AppID: r.RetiAppID, Name: GetValidatorListBoxName(info.Config.ID)},
				{AppID: 0, Name: nil}, // extra i/o
			},
			SuggestedParams: params,
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
		params.FlatFee = true
		params.Fee = types.MicroAlgos(feesToUse)
		err = atc.AddMethodCall(transaction.AddMethodCallParams{
			AppID:           poolAppID,
			Method:          epochUpdateMethod,
			ForeignAccounts: []string{info.Config.ValidatorCommissionAddress},
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
