package reti

import (
	"context"
	"encoding/binary"

	"github.com/algorand/go-algorand-sdk/v2/types"
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
