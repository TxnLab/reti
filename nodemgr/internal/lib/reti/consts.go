package reti

import (
	"bytes"
	"encoding/binary"

	"github.com/algorand/go-algorand-sdk/v2/types"
)

const (
	// Global state keys in Validator contract
	VldtrNumValidators = "numV"
	VldtrPoolTmplID    = "poolTemplateAppID"

	// Global state keys in Staking pool contract
	StakePoolCreatorApp    = "creatorApp"
	StakePoolValidatorID   = "validatorID"
	StakePoolPoolID        = "poolID"
	StakePoolNumStakers    = "numStakers"
	StakePoolStaked        = "staked"
	StakePoolMinEntryStake = "minEntryStake"
	StakePoolMaxStake      = "maxStake"
	StakePoolLastPayout    = "lastPayout"
	StakePoolAlgodVer      = "algodVer"
)

func GetValidatorListBoxName(id uint64) []byte {
	prefix := []byte("v")
	ibytes := make([]byte, 8)
	binary.BigEndian.PutUint64(ibytes, id)
	return bytes.Join([][]byte{prefix, ibytes[:]}, nil)
}

func GetStakerPoolSetBoxName(stakerAccount types.Address) []byte {
	return bytes.Join([][]byte{[]byte("sps"), stakerAccount[:]}, nil)
}

func GetStakerLedgerBoxName() []byte {
	return []byte("stakers")
}
