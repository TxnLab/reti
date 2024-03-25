package reti

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"

	"github.com/algorand/go-algorand-sdk/v2/abi"
	"github.com/algorand/go-algorand-sdk/v2/client/v2/algod"
	"github.com/algorand/go-algorand-sdk/v2/types"

	"github.com/TxnLab/reti/internal/lib/algo"
	"github.com/TxnLab/reti/internal/lib/misc"
)

type Reti struct {
	Logger     *slog.Logger
	algoClient *algod.Client
	signer     algo.MultipleWalletSigner

	// RetiAppID is simply the master validator contract id
	RetiAppID   uint64
	ValidatorID uint64
	NodeNum     uint64

	poolTmplAppID uint64

	validatorContract *abi.Contract
	poolContract      *abi.Contract

	// Loaded from on-chain state at start and on-demand via LoadStateFromChain
	// Mutex wrap is just lazy way of allowing single shared-state of instance data that's periodically updated
	sync.RWMutex
	info ValidatorInfo
}

func (r *Reti) Info() ValidatorInfo {
	r.RLock()
	defer r.RUnlock()
	return r.info
}

func (r *Reti) SetInfo(Info ValidatorInfo) {
	r.Lock()
	defer r.Unlock()
	r.info = Info
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

	misc.Infof(logger, "client initialized, Protocol App ID:%d, Validator ID:%d, Node Number:%d", validatorAppID, validatorID, nodeNum)

	return retReti, nil
}

func (r *Reti) IsConfigured() bool {
	return r.RetiAppID != 0 && r.ValidatorID != 0 && r.NodeNum != 0
}

// LoadState loads the state of the Reti instance by retrieving information from
// the chain and setting the local values to the on-chain current state.
// It also verifies that the validator has either owner or manager keys present, and match the
// keys we have available (which will have to sign for either owner or manager depending on call)
// Prometheus metrics are also updated based on loaded state.
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
		constraints, err := r.GetProtocolConstraints()
		if err != nil {
			return fmt.Errorf("unable to GetProtocolConstraints: %w", err)
		}

		// We could get total stake etc for all pools at once via the validator state but since there will be multiple instances
		// of this daemon we should just report per-validator data and the validator can max / sum, etc. as appropriate
		// in their metrics dashboard - taking data from all daemons.
		pools, err := r.GetValidatorPools(r.ValidatorID)
		if err != nil {
			return fmt.Errorf("unable to GetValidatorPools: %w", err)
		}

		assignments, err := r.GetValidatorNodePoolAssignments(r.ValidatorID)
		if err != nil {
			return fmt.Errorf("unable to GetValidatorNodePoolAssignments: %w", err)
		}
		newInfo := ValidatorInfo{
			Config:              *config,
			Pools:               pools,
			NodePoolAssignments: *assignments,
			LocalPools:          map[uint64]uint64{},
		}

		if r.NodeNum == 0 || int(r.NodeNum) > len(newInfo.NodePoolAssignments.Nodes) {
			return fmt.Errorf("configured Node number:%d is invalid for number of on-chain nodes configured: %d", len(newInfo.NodePoolAssignments.Nodes))
		}

		r.Logger.Debug("state re-loaded")

		// Just report metrics for OUR node - validators will presumably scrape metrics from all their nodes
		var (
			localStakers      uint64
			localTotalStaked  uint64
			localTotalRewards float64
		)
		for _, poolAppID := range newInfo.NodePoolAssignments.Nodes[r.NodeNum-1].PoolAppIDs {
			var poolID uint64
			for poolIdx, pool := range pools {
				if pool.PoolAppID == poolAppID {
					localStakers += uint64(pool.TotalStakers)
					localTotalStaked += pool.TotalAlgoStaked
					localTotalRewards += float64(r.PoolAvailableRewards(pool.PoolAppID, pool.TotalAlgoStaked)) / 1e6

					poolID = uint64(poolIdx + 1)
					break
				}
			}
			if poolID == 0 {
				return fmt.Errorf("couldn't fetch pool id for staking pool app id:%d", poolAppID)
			}
			newInfo.LocalPools[poolID] = poolAppID

		}

		promNumPools.Set(float64(len(newInfo.LocalPools)))
		promNumStakers.Set(float64(localStakers))
		promTotalStaked.Set(float64(localTotalStaked) / 1e6)

		promRewardAvailable.Set(localTotalRewards)

		promMaxStakeAllowed.Set(float64(constraints.MaxAlgoPerValidator) / 1e6)

		r.SetInfo(newInfo)
	}
	return nil
}

func (r *Reti) getLocalSignerForSimulateCalls() (types.Address, error) {
	return DummyAlgoSender, nil
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
