package reti

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/algorand/go-algorand-sdk/v2/abi"
	"github.com/algorand/go-algorand-sdk/v2/client/v2/algod"
	"github.com/algorand/go-algorand-sdk/v2/types"

	"github.com/TxnLab/reti/internal/lib/algo"
)

type Reti struct {
	Logger     *slog.Logger
	algoClient *algod.Client
	signer     algo.MultipleWalletSigner

	// RetiAppID is simply the master validator contract id
	RetiAppID   uint64
	ValidatorID uint64
	NodeNum     uint64

	// Loaded from on-chain state at start and on-demand via LoadStateFromChain
	Info          ValidatorInfo
	poolTmplAppID uint64

	validatorContract *abi.Contract
	poolContract      *abi.Contract
}

func New(
	validatorAppID uint64,
	logger *slog.Logger,
	algoClient *algod.Client,
	signer algo.MultipleWalletSigner,
	validatorID uint64,
	nodeNum uint64,
) (*Reti, error) {

	retReti := &Reti{
		RetiAppID:   validatorAppID,
		ValidatorID: validatorID,
		NodeNum:     nodeNum,

		Logger:     logger,
		algoClient: algoClient,
		signer:     signer,
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

	logger.Info("client initialized", "validator", validatorID, "node", nodeNum)

	return retReti, nil
}

func (r *Reti) IsConfigured() bool {
	return r.RetiAppID != 0 && r.ValidatorID != 0 && r.NodeNum != 0
}

func (r *Reti) LoadState(ctx context.Context) error {
	if r.RetiAppID == 0 {
		return errors.New("reti App ID not defined")
	}
	appInfo, err := r.algoClient.GetApplicationByID(r.RetiAppID).Do(ctx)
	if err != nil {
		return err
	}
	r.poolTmplAppID, _ = algo.GetIntFromGlobalState(appInfo.Params.GlobalState, VldtrPoolTmplID)

	// Now load all the data from the chain for our validator, etc.
	if r.ValidatorID != 0 {
		config, err := r.GetValidatorConfig(r.ValidatorID)
		if err != nil {
			return fmt.Errorf("unable to GetValidatorConfig: %w", err)
		}
		// verify this validator is one we have either owner or manager keys for !!
		_, err = r.signer.FindFirstSigner([]string{config.Owner, config.Manager})
		if err != nil {
			return fmt.Errorf("neither owner or manager address for validator id:%d has local keys present", r.ValidatorID)
		}

		pools, err := r.GetValidatorPools(r.ValidatorID)
		if err != nil {
			return fmt.Errorf("unable to GetValidatorPools: %w", err)
		}
		assignments, err := r.GetValidatorNodePoolAssignments(r.ValidatorID)
		if err != nil {
			return fmt.Errorf("unable to GetValidatorNodePoolAssignments: %w", err)
		}
		r.Info.Config = *config
		r.Info.Pools = pools
		r.Info.NodePoolAssignments = *assignments

		r.Info.LocalPools = map[uint64]uint64{}
		if r.NodeNum == 0 || int(r.NodeNum) > len(r.Info.NodePoolAssignments.Nodes) {
			return fmt.Errorf("configured Node number:%d is invalid for number of on-chain nodes configured: %d", len(r.Info.NodePoolAssignments.Nodes))
		}

		//r.Logger = r.Logger.With("validator", r.ValidatorID, "node", r.NodeNum)
		//misc.Infof(r.Logger, "test")
		//r.Logger.Info("state loaded", "validator", r.ValidatorID, "node", r.NodeNum)

		for _, poolAppID := range r.Info.NodePoolAssignments.Nodes[r.NodeNum-1].PoolAppIDs {
			poolID, err := r.GetPoolID(poolAppID)
			if err != nil {
				return fmt.Errorf("couldn't fetch pool id for staking pool app id:%d, err:%w", poolAppID, err)
			}
			r.Info.LocalPools[poolID] = poolAppID
		}
	}
	return nil
}

func (r *Reti) getLocalSignerForSimulateCalls() (types.Address, error) {
	signer, err := r.signer.FindFirstSigner(nil)
	if err != nil {
		return types.ZeroAddress, err
	}
	return types.DecodeAddress(signer)
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
