package main

import (
	"context"
	"fmt"
	"iter"
	"maps"
	"slices"
	"strings"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/common/models"
	"github.com/algorand/go-algorand-sdk/v2/types"
	"github.com/antihax/optional"
	"github.com/mailgun/holster/v4/syncutil"

	"github.com/TxnLab/reti/internal/lib/misc"
	"github.com/TxnLab/reti/internal/lib/nfdapi/swagger"
	"github.com/TxnLab/reti/internal/lib/reti"
)

func (d *Daemon) checkForEvictions(ctx context.Context) error {
	info := App.retiClient.Info()
	if info.Config.EntryGatingType == reti.GatingTypeNone {
		return nil
	}
	signer, err := App.signer.FindFirstSigner([]string{info.Config.Owner, info.Config.Manager})
	if err != nil {
		return fmt.Errorf("neither owner or manager address for your validator has local keys present")
	}
	signerAddr, _ := types.DecodeAddress(signer)

	stakersAndPools, err := d.collectStakersAndPools(info)
	if err != nil {
		return err
	}
	ineligible, err := d.getIneligibleStakers(ctx, maps.Keys(stakersAndPools))
	if err != nil {
		return err
	}
	for _, staker := range ineligible {
		for _, pool := range stakersAndPools[staker] {
			stakerAddr, _ := types.DecodeAddress(staker)
			err = App.retiClient.RemoveStake(pool, signerAddr, stakerAddr, 0 /* all stake */)
			if err != nil {
				return fmt.Errorf("error removing stake for pool %d, appid:%d: %v", pool.PoolId, pool.PoolAppId, err)
			}
			misc.Infof(d.logger, "[EVICTION] Staker:%s removed from pool %d because no longer meeting gating criteria", staker, pool.PoolId)
		}
	}
	return nil
}

// collectStakersAndPools iterates through each pool, collecting all unique stakers (and their pools)
func (d *Daemon) collectStakersAndPools(info reti.ValidatorInfo) (map[string][]reti.ValidatorPoolKey, error) {
	stakersAndPools := make(map[string][]reti.ValidatorPoolKey)

	for poolIdx, pool := range info.Pools {
		ledger, err := App.retiClient.GetLedgerForPool(pool.PoolAppId)
		if err != nil {
			if strings.Contains(err.Error(), "box not found") {
				continue
			}
			return nil, fmt.Errorf("error getting ledger for pool #%d, appid:%d: %v", poolIdx+1, pool.PoolAppId, err)
		}

		for _, stakerData := range ledger {
			if stakerData.Account == types.ZeroAddress {
				continue
			}

			accountID := stakerData.Account.String()
			stakersAndPools[accountID] = append(stakersAndPools[accountID],
				reti.ValidatorPoolKey{
					ID:        info.Config.ID,
					PoolId:    uint64(poolIdx + 1),
					PoolAppId: pool.PoolAppId,
				})
		}
	}

	return stakersAndPools, nil
}

func (d *Daemon) getIneligibleStakers(ctx context.Context, accounts iter.Seq[string]) ([]string, error) {
	var (
		fanOut       = syncutil.NewFanOut(20)
		ineligibleCh = make(chan string, 2)
	)
	for account := range accounts {
		fanOut.Run(func(val any) error {
			isEligible, err := d.isAccountEligible(ctx, account)
			if err != nil {
				return err
			}
			if !isEligible {
				ineligibleCh <- account
			}
			return nil
		}, account)
	}
	var errs []error
	go func() {
		errs = fanOut.Wait()
		close(ineligibleCh)
	}()
	var ineligible []string
	for account := range ineligibleCh {
		ineligible = append(ineligible, account)
	}
	if len(errs) > 0 {
		return nil, errs[0]
	}
	return ineligible, nil
}

func (d *Daemon) isAccountEligible(ctx context.Context, account string) (bool, error) {
	info := App.retiClient.Info()
	gatingMinBalance := info.Config.GatingAssetMinBalance

	// get all assets held by the staking account first
	accountInfo, err := d.algoClient.AccountInformation(account).Do(ctx)
	if err != nil {
		return false, fmt.Errorf("error getting account info for account %s: %v", account, err)
	}
	heldAssets := accountInfo.Assets

	var (
		valToVerify uint64
	)

	switch info.Config.EntryGatingType {
	case reti.GatingTypeAssetsCreatedBy:
		creatorAddress := info.Config.EntryGatingAddress
		assetIds, err := d.collectCreatedAssets(ctx, []string{creatorAddress})
		if err != nil {
			return false, err
		}
		valToVerify = d.findValueToVerify(heldAssets, assetIds, gatingMinBalance)
	case reti.GatingTypeAssetId:
		gatingAssetIds := slices.DeleteFunc(info.Config.EntryGatingAssets, func(id uint64) bool {
			return id == 0
		})
		valToVerify = d.findValueToVerify(heldAssets, gatingAssetIds, gatingMinBalance)
	case reti.GatingTypeCreatedByNFDAddresses:
		nfdAppId := info.Config.EntryGatingAssets[0]
		nfd, err := App.nfdOnChain.GetNFD(ctx, nfdAppId, true)
		if err != nil {
			return false, fmt.Errorf("error getting nfd info for appid %d: %v", nfdAppId, err)
		}
		if len(nfd.Verified["caAlgo"]) == 0 {
			return false, fmt.Errorf("nfd %d defined as gating for this validator has no verified addresses", nfdAppId)
		}
		createdAssetIds, err := d.collectCreatedAssets(ctx, strings.Split(nfd.Verified["caAlgo"], ","))
		if err != nil {
			return false, err
		}
		return d.findValueToVerify(heldAssets, createdAssetIds, gatingMinBalance) > 0, nil
	case reti.GatingTypeSegmentOfNFD:
		nfds, _, err := App.nfdApi.NfdApi.NfdSearchV2(ctx, &swagger.NfdApiNfdSearchV2Opts{
			State:       optional.NewInterface("owned"),
			Owner:       optional.NewString(account),
			ParentAppID: optional.NewInt64(int64(info.Config.EntryGatingAssets[0])),
			Limit:       optional.NewInt64(1),
		})
		if err != nil {
			return false, fmt.Errorf("error getting children nfds for parent appid %d: owned by %s: %v", info.Config.EntryGatingAssets[0], account, err)
		}
		return nfds.Total >= 1, nil

	default:
		return false, fmt.Errorf("unknown gating type")
	}
	if valToVerify == 0 {
		return false, nil
	}
	return true, nil
}

func (d *Daemon) collectCreatedAssets(ctx context.Context, addresses []string) ([]uint64, error) {
	assetIdMap := make(map[uint64]bool)
	for _, address := range addresses {
		creatorAccountInfo, err := d.algoClient.AccountInformation(address).Do(ctx)
		if err != nil {
			return nil, fmt.Errorf("error getting account info for creator address %s: %v", address, err)
		}
		for _, asset := range creatorAccountInfo.CreatedAssets {
			if !assetIdMap[asset.Index] {
				assetIdMap[asset.Index] = true
			}
		}
	}
	return slices.Collect(maps.Keys(assetIdMap)), nil
}

func (d *Daemon) findValueToVerify(heldAssets []models.AssetHolding, gatingAssets []uint64, minBalance uint64) uint64 {
	// Find the first gating asset held in heldAssets that meets the minimum balance requirement
	idx := slices.IndexFunc(heldAssets, func(heldAsset models.AssetHolding) bool {
		return slices.ContainsFunc(gatingAssets, func(asset uint64) bool {
			return asset == heldAsset.AssetId && heldAsset.Amount >= minBalance
		})
	})
	if idx == -1 {
		return 0
	}
	return heldAssets[idx].AssetId
}
