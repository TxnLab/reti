package reti

import (
	"embed"
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/algorand/go-algorand-sdk/v2/abi"
	"github.com/algorand/go-algorand-sdk/v2/client/v2/algod"

	"github.com/TxnLab/reti/internal/lib/algo"
)

type Reti struct {
	ValidatorAppID uint64

	logger     *slog.Logger
	algoClient *algod.Client
	signer     algo.MultipleWalletSigner

	validatorContract *abi.Contract
	poolContract      *abi.Contract

	// Fetch the staking pool app id only once by fetching global state of the validator app id
	// (need it for 'app references')
	oneTimeInit   sync.Once
	poolTmplAppID uint64
}

func New(
	validatorAppID uint64,
	logger *slog.Logger,
	algoClient *algod.Client,
	signer algo.MultipleWalletSigner,
) (*Reti, error) {

	retReti := &Reti{
		ValidatorAppID: validatorAppID,
		logger:         logger,
		algoClient:     algoClient,
		signer:         signer,
	}
	validatorContract, err := loadContract("artifacts/contracts/ValidatorRegistry.arc32.json")
	if err != nil {
		return nil, err
	}
	poolContract, err := loadContract("artifacts/contracts/StakingPool.arc32.json")
	if err != nil {
		return nil, err
	}
	retReti.validatorContract = validatorContract
	retReti.poolContract = poolContract

	return retReti, nil
}

//go:embed artifacts/contracts/ValidatorRegistry.arc32.json
//go:embed artifacts/contracts/StakingPool.arc32.json
var embeddedF embed.FS

func loadContract(fname string) (*abi.Contract, error) {
	data, err := embeddedF.ReadFile(fname)
	if err != nil {
		return nil, err
	}
	return loadContractFromArc32(data)
}

// ABIContractWrap struct is just so we can unmarshal an arc32 document into the abi.contract type
// we ignore everything else in arc32
type ABIContractWrap struct {
	Contract abi.Contract `json:"contract"`
}

func loadContractFromArc32(arc32 []byte) (*abi.Contract, error) {
	var contractWrap ABIContractWrap
	err := json.Unmarshal(arc32, &contractWrap)
	if err != nil {
		return nil, err
	}
	return &contractWrap.Contract, nil
}
