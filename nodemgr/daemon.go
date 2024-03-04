package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/algod"
	"github.com/algorand/go-algorand-sdk/v2/crypto"
	"github.com/algorand/go-algorand-sdk/v2/types"
	"github.com/ssgreg/repeat"

	"github.com/TxnLab/reti/internal/lib/algo"
	"github.com/TxnLab/reti/internal/lib/misc"
	"github.com/TxnLab/reti/internal/lib/reti"
)

// Daemon provides a 'little' separation in that we initalize it with some data from the App global set up by
// the process startup, but the Daemon tries to be fairly retrieval with its data retrieval and use.
type Daemon struct {
	logger     *slog.Logger
	algoClient *algod.Client

	info *reti.ValidatorInfo

	// embed mutex for locking state for members below the mutex
	sync.RWMutex
	avgBlockTime time.Duration
}

func newDaemon() *Daemon {
	info, err := LoadValidatorInfo()
	if err != nil {
		log.Fatalf("Failed to load validator info: %v", err)
	}

	return &Daemon{
		logger:     App.logger,
		algoClient: App.algoClient,
		info:       info,
	}
}

func (d *Daemon) start(ctx context.Context, wg *sync.WaitGroup) {
	d.logger.Info("Starting Réti daemon")

	wg.Add(1)
	go func() {
		defer wg.Done()
		d.KeyWatcher(ctx)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		defer d.logger.Info("exiting daemon start function")
		<-ctx.Done()
	}()

}

// KeyWatcher keeps track of both active pools for this node (updated via configuration file) as well
// as participation keys with the algod daemon.  It creates and maintains participation keys as necessary.
func (d *Daemon) KeyWatcher(ctx context.Context) {
	defer d.logger.Info("Exiting KeyWatcher")
	d.logger.Info("Starting KeyWatcher")

	// make sure avg block time is set first
	d.setAverageBlockTime(ctx)
	d.checkPools(ctx)

	// Check our key validity once a minute
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(1 * time.Minute):
			// Make sure our 'config' is fresh in case the user updated it
			err := d.refetchConfig()
			if err != nil {
				// try later.
				break
			}
			d.checkPools(ctx)
		case <-time.After(30 * time.Minute):
			d.setAverageBlockTime(ctx)
		}
	}
}

type onlineInfo struct {
	poolAppID                 uint64
	isOnline                  bool
	selectionParticipationKey string
	firstValid                uint64
}

const OnlineStatus = "Online"

func (d *Daemon) checkPools(ctx context.Context) {
	managerAddr, _ := types.DecodeAddress(d.info.Config.Manager)

	// get online status and partkey info for all our accounts (ignoring any that don't have balances yet)
	var poolAcounts = map[string]onlineInfo{}
	for _, pool := range d.info.Pools {
		acctInfo, err := algo.GetBareAccount(context.Background(), d.algoClient, crypto.GetApplicationAddress(pool.PoolAppID).String())
		if err != nil {
			d.logger.Warn("account fetch error", "account", crypto.GetApplicationAddress(pool.PoolAppID).String(), "error", err)
			return
		}
		info := onlineInfo{
			poolAppID:                 pool.PoolAppID,
			isOnline:                  acctInfo.Status == OnlineStatus,
			selectionParticipationKey: string(acctInfo.Participation.SelectionParticipationKey),
			firstValid:                acctInfo.Participation.VoteFirstValid,
		}
		if acctInfo.Amount-acctInfo.MinBalance > 1e6 {
			poolAcounts[crypto.GetApplicationAddress(pool.PoolAppID).String()] = info
		}
	}
	// now get all the current participation keys for our node
	partKeys, err := algo.GetParticipationKeys(ctx, d.algoClient)
	if err != nil {
		d.logger.Warn("participation key fetch error", "error", err)
		return
	}
	// filter partKeys to just the accounts matching our pools.
	// Other accounts aren't our problem or under our control
	partKeys = slices.DeleteFunc(partKeys, func(key algo.ParticipationKey) bool {
		_, found := poolAcounts[key.Address]
		return !found
	})

	// get accounts without part. keys at all.
	missingAccounts := getAccountsWithoutPartKeys(partKeys, poolAcounts)
	// for accounts w/ no keys at all - we just create keys and instantly go online with them
	if len(missingAccounts) > 0 {
		for account := range missingAccounts {
			_, err := d.createPartKey(ctx, account, 0)
			if err != nil {
				misc.Errorf(d.logger, "error generating part key for missing account:%s, err:%v", account, err)
				return
			}
		}
		// go online, etc. as part of normal checks - so just return now and next pass will fix
		return
	}
	// TODO do we have keys that we just haven't gone online for yet ?
	for account, info := range poolAcounts {
		if !info.isOnline {
			// go online - get part key waiting for this account
			idx := slices.IndexFunc(partKeys, func(key algo.ParticipationKey) bool {
				return key.Address == account
			})
			if idx == -1 {
				misc.Errorf(d.logger, "unable to find participation key to go online for account:%s [pool app id:%d]", account, info.poolAppID)
				return
			}
			vpk, _ := base64.StdEncoding.DecodeString(partKeys[idx].Key.VoteParticipationKey)
			selpk, _ := base64.StdEncoding.DecodeString(partKeys[idx].Key.SelectionParticipationKey)
			stproofk, _ := base64.StdEncoding.DecodeString(partKeys[idx].Key.StateProofKey)

			err = App.retiClient.GoOnline(d.info, info.poolAppID, managerAddr,
				vpk, selpk, stproofk,
				partKeys[idx].Key.VoteFirstValid, partKeys[idx].Key.VoteLastValid, partKeys[idx].Key.VoteKeyDilution)
			if err != nil {
				misc.Errorf(d.logger, "unable to go online for account:%s [pool app id:%d]", account, info.poolAppID)
				return
			}
			misc.Infof(d.logger, "participation key went online for account:%s [pool app id:%d]", account, info.poolAppID)
		}
	}

	// what keys do we have with mixed ranges (active now but something that we're waiting to rotate into)

	partKeys = d.getExpiringKeys(partKeys)
	misc.Debugf(d.logger, "accounts w/out participation keys: %v", missingAccounts)
	misc.Debugf(d.logger, "accounts w/ soon to expire keys: %v", partKeys)
}

func (d *Daemon) AverageBlockTime() time.Duration {
	d.RLock()
	defer d.RUnlock()
	return d.avgBlockTime
}

func (d *Daemon) setAverageBlockTime(ctx context.Context) error {
	// Get the latest block via the algoClient.Status() call, then
	// fetch the most recent X blocks - fetching the timestamps from each and
	// determining the approximate current average block time.
	const numRounds = 10

	status, err := d.algoClient.Status().Do(context.Background())
	if err != nil {
		return fmt.Errorf("unable to fetch node status: %w", err)
	}
	var blockTimes []time.Time
	for round := status.LastRound - numRounds; round < status.LastRound; round++ {
		block, err := d.algoClient.Block(round).Do(ctx)
		if err != nil {
			return fmt.Errorf("unable to fetch block in getAverageBlockTime, err:%w", err)
		}
		blockTimes = append(blockTimes, time.Unix(block.TimeStamp, 0))
	}
	var totalBlockTime time.Duration
	for i := 1; i < len(blockTimes); i++ {
		totalBlockTime += blockTimes[i].Sub(blockTimes[i-1])
	}
	d.Lock()
	d.avgBlockTime = totalBlockTime / time.Duration(len(blockTimes)-1)
	d.Unlock()
	misc.Infof(d.logger, "average block time set to:%v", d.avgBlockTime)
	return nil
}

// getExpiringKeys checks the expiration status of each key in the given list
// based on the current node status and average block time. It returns a list of
// keys that will expire within 1 week.
func (d *Daemon) getExpiringKeys(keys []algo.ParticipationKey) []algo.ParticipationKey {
	status, err := d.algoClient.Status().Do(context.Background())
	if err != nil {
		d.logger.Warn("failure in getting current node status w/in getExpiringKeys", "error", err)
		return nil
	}
	curRound := status.LastRound
	avgBlockTime := d.AverageBlockTime()

	// check keys that will expire within 1 week based on average block time (avgBlockTime)
	// the last valid round of the key has to be compared to curRound and based on block time, determine if
	// its near expiration
	var expiringKeys []algo.ParticipationKey
	for _, key := range keys {
		if key.EffectiveFirstValid > curRound {
			// key isn't even in range yet ignore for now
			continue
		}
		expValidDistance := time.Duration(key.Key.VoteLastValid-curRound) * avgBlockTime
		if expValidDistance.Hours() < 24*7 {
			misc.Infof(d.logger, "key: %s for %s expiring in %v", key.Id, key.Address, expValidDistance)
			expiringKeys = append(expiringKeys, key)
		}
	}
	return expiringKeys
}

func (d *Daemon) refetchConfig() error {
	var err error
	err = repeat.Repeat(
		repeat.Fn(func() error {
			d.info, err = LoadValidatorInfo()
			if err != nil {
				return repeat.HintTemporary(err)
			}
			return nil
		}),
		repeat.StopOnSuccess(),
		repeat.LimitMaxTries(10),
		repeat.FnOnError(func(err error) error {
			d.logger.Warn("retrying fetch of validator info, error:%v", err.Error())
			return err
		}),
		repeat.WithDelay(
			repeat.SetContextHintStop(),
			(&repeat.FullJitterBackoffBuilder{
				BaseDelay: 5 * time.Second,
				MaxDelay:  10 * time.Second,
			}).Set(),
		),
	)
	return err
}

func (d *Daemon) createPartKey(ctx context.Context, account string, firstValid uint64) (*algo.ParticipationKey, error) {
	// generate keys good for one month based on current avg block time
	status, err := d.algoClient.Status().Do(context.Background())
	if err != nil {
		return nil, fmt.Errorf("unable to fetch node status: %w", err)
	}
	if firstValid == 0 {
		firstValid = status.LastRound
	}
	monthInSeconds := 60 * 60 * 24 * 30
	lastValid := firstValid + uint64(float64(monthInSeconds)/d.AverageBlockTime().Seconds())
	return algo.GenerateParticipationKey(ctx, d.algoClient, d.logger, account, firstValid, lastValid)
}

func getAccountsWithoutPartKeys(partKeys []algo.ParticipationKey, poolAcounts map[string]onlineInfo) map[string]onlineInfo {
	var partKeyAccounts = map[string]onlineInfo{}
	for _, key := range partKeys {
		partKeyAccounts[key.Address] = onlineInfo{
			selectionParticipationKey: key.Key.SelectionParticipationKey,
		}
	}
	var filteredAccounts = map[string]onlineInfo{}

	for addr, info := range poolAcounts {
		_, found := partKeyAccounts[addr]
		if !found {
			filteredAccounts[addr] = info
		}
	}
	return filteredAccounts
}
