package reti

import (
	"bytes"
	"encoding/binary"

	"github.com/algorand/go-algorand-sdk/v2/types"
)

const (
	// Global state keys in Validator contract
	VldtrNumValidators = "numV"
	VldtrPoolTmplId    = "poolTemplateAppId"

	// Global state keys in Staking pool contract
	StakePoolCreatorApp    = "creatorApp"
	StakePoolValidatorId   = "validatorId"
	StakePoolPoolId        = "poolId"
	StakePoolNumStakers    = "numStakers"
	StakePoolStaked        = "staked"
	StakePoolMinEntryStake = "minEntryStake"
	StakePoolMaxStake      = "maxStake"
	StakePoolLastPayout    = "lastPayout"
	StakePoolAlgodVer      = "algodVer"
	StakePoolEWMA          = "ewma"
	StakePoolStakeAccum    = "stakeAccumulator"

	// Gating types
	GatingTypeNone                  = 0
	GatingTypeAssetsCreatedBy       = 1
	GatingTypeAssetId               = 2
	GatingTypeCreatedByNFDAddresses = 3
	GatingTypeSegmentOfNFD          = 4
)

// Algorand address to use as sender for read-only simulate calls (not signed but still has to be valid address)
// Use devnet/betanet/testnet feesink (funded same on mainnet so can also use there)
var DummyAlgoSender, _ = types.DecodeAddress("A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE")

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
