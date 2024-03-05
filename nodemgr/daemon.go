package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"maps"
	"sort"
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

const OnlineStatus = "Online"

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

	checkTime := time.NewTicker(1 * time.Minute)
	blockTimeUpdate := time.NewTicker(30 * time.Minute)
	defer checkTime.Stop()
	defer blockTimeUpdate.Stop()

	// Check our key validity once a minute
	for {
		select {
		case <-ctx.Done():
			return
		case <-checkTime.C:
			// Make sure our 'config' is fresh in case the user updated it
			err := d.refetchConfig()
			if err != nil {
				// try later.
				break
			}
			d.updatePoolVersions(ctx)
			d.checkPools(ctx)
		case <-blockTimeUpdate.C:
			d.setAverageBlockTime(ctx)
		}
	}
}

type onlineInfo struct {
	poolAppID                 uint64
	isOnline                  bool
	selectionParticipationKey []byte
	firstValid                uint64
}

func (d *Daemon) checkPools(ctx context.Context) {
	// get online status and partkey info for all our accounts (ignoring any that don't have balances yet)
	var poolAccounts = map[string]onlineInfo{}
	for _, pool := range d.info.Pools {
		acctInfo, err := algo.GetBareAccount(context.Background(), d.algoClient, crypto.GetApplicationAddress(pool.PoolAppID).String())
		if err != nil {
			d.logger.Warn("account fetch error", "account", crypto.GetApplicationAddress(pool.PoolAppID).String(), "error", err)
			return
		}
		info := onlineInfo{
			poolAppID:                 pool.PoolAppID,
			isOnline:                  acctInfo.Status == OnlineStatus,
			selectionParticipationKey: acctInfo.Participation.SelectionParticipationKey,
			firstValid:                acctInfo.Participation.VoteFirstValid,
		}
		if acctInfo.Amount-acctInfo.MinBalance > 1e6 {
			poolAccounts[crypto.GetApplicationAddress(pool.PoolAppID).String()] = info
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
	maps.DeleteFunc(partKeys, func(address string, keys []algo.ParticipationKey) bool {
		_, found := poolAccounts[address]
		return !found
	})

	err = d.ensureParticipation(ctx, poolAccounts, partKeys)
	if err != nil {
		misc.Errorf(d.logger, "error ensuring participation: %v", err)
		return
	}
}

func (d *Daemon) updatePoolVersions(ctx context.Context) {
	managerAddr, _ := types.DecodeAddress(d.info.Config.Manager)

	versString, err := algo.GetVersionString(ctx, d.algoClient)
	if err != nil {
		misc.Errorf(d.logger, "unable to fetch version string from algod instance, err:%v", err)
		return
	}
	for _, pool := range d.info.Pools {
		algodVer, err := App.retiClient.GetAlgodVer(pool.PoolAppID)
		if err != nil && !errors.Is(err, algo.ErrStateKeyNotFound) {
			misc.Errorf(d.logger, "unable to fetch algod version from staking pool app id:%d, err:%v", pool.PoolAppID, err)
			return
		}
		if algodVer != versString {
			// Update version in staking pool
			err = App.retiClient.UpdateAlgodVer(d.info, pool.PoolAppID, versString, managerAddr)
			if err != nil {
				misc.Errorf(d.logger, "unable to update algod version in staking pool app id:%d, err:%v", pool.PoolAppID, err)
				return
			}
		}
	}
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
	misc.Infof(d.logger, "average block time set to:%v", d.AverageBlockTime())
	return nil
}

// getExpiringKeys checks the expiration status of each key in the given list
// based on the current node status and average block time. It returns a list of
// keys that will expire within 1 week.
func (d *Daemon) getExpiringKeys(partKeys algo.PartKeysByAddress) []algo.ParticipationKey {
	status, err := d.algoClient.Status().Do(context.Background())
	if err != nil {
		d.logger.Warn("failure in getting current node status w/in getExpiringKeys", "error", err)
		return nil
	}
	curRound := status.LastRound
	avgBlockTime := d.AverageBlockTime()

	// check partKeys that will expire within 1 week based on average block time (avgBlockTime)
	// the last valid round of the key has to be compared to curRound and based on block time, determine if
	// its near expiration
	var expiringKeys []algo.ParticipationKey
	for _, keys := range partKeys {
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
	// generate keys good for one month based on current avg block time - nothing is returned until key is actually created
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

func (d *Daemon) ensureParticipation(ctx context.Context, poolAccounts map[string]onlineInfo, partKeys algo.PartKeysByAddress) error {
	/** conditions to cover for participation keys / accounts
	1) Part key found but expired - delete it
	2) Account has NO local participation key (online or offline) (ie: they could've moved to new node)
		Create brand new 1-month key - will go online as part of subsequent checks once part key becomes visible
	3) Account is NOT online but has one or more part keys
		Go online against newest part key - done
	4) Account has ONE local part key AND IS ONLINE
		Assumed 'steady state' - check lifetime of CURRENT key and if expiring within 1 week
		If expiring soon, create new key w/ firstValid set to existing key's lastValid - 1 day of rounds.
	5) Account is online and has multiple local part keys
		If Online (assumed steady state when a future pending part key has been created)
			Sort keys descending by first valid
			If part key first valid is >= current round AND not current part. key id for account
				Go online against this new key - done.  prior key will be removed a week later when it's out of valid range
	*/
	// 1) part key found that is expired - remove
	if err := d.ensureParticipationRemoveExpired(ctx, poolAccounts, partKeys); err != nil {
		return err
	}
	// 2) get accounts without (local) part. keys at all.
	if err := d.ensureParticipationNoKeysYet(ctx, poolAccounts, partKeys); err != nil {
		return err
	}
	// 3) Not online...
	if err := d.ensureParticipationNotOnline(ctx, poolAccounts, partKeys); err != nil {
		return err
	}
	// 4) Account has 1 part key, IS ONLINE and might expire soon (needing to generate new key)
	if err := d.ensureParticipationCheckNeedsRenewed(ctx, poolAccounts, partKeys); err != nil {
		return err
	}
	// 5 Account is online - see if there's a newer key to 'switch' to
	if err := d.ensureParticipationCheckNeedsSwitched(ctx, poolAccounts, partKeys); err != nil {
		return err
	}
	return nil
}

// 1) Part key found but expired - delete it
func (d *Daemon) ensureParticipationRemoveExpired(ctx context.Context, accounts map[string]onlineInfo, partKeys algo.PartKeysByAddress) error {
	status, err := d.algoClient.Status().Do(context.Background())
	if err != nil {
		return fmt.Errorf("unable to fetch node status: %w", err)
	}
	for _, keys := range partKeys {
		for _, key := range keys {
			if key.Key.VoteLastValid < status.LastRound {
				misc.Infof(d.logger, "key:%s for account:%s is expired, removing", key.Id, key.Address)
				err = algo.DeleteParticipationKey(ctx, d.algoClient, d.logger, key.Id)
				if err != nil {
					if err != nil {
						return fmt.Errorf("error deleting participation key for id:%s, err:%w", key.Id, err)
					}
				}
			}
		}
	}
	return nil
}

// Handle condition 2) in ensureParticipation
// 2) Account has NO local participation key (online or offline)
func (d *Daemon) ensureParticipationNoKeysYet(ctx context.Context, poolAccounts map[string]onlineInfo, partKeys algo.PartKeysByAddress) error {
	for account, _ := range poolAccounts {
		// for accounts w/ no keys at all - we just create keys - we'll go online as part of later checks
		if _, found := partKeys[account]; !found {
			_, err := d.createPartKey(ctx, account, 0)
			if err != nil {
				misc.Errorf(d.logger, "error generating part key for missing account:%s, err:%v", account, err)
				return nil
			}
		}
	}
	// go online, etc. as part of normal checks - so just return now and next pass will fix
	return nil
}

// Handle condition 3) in ensureParticipation
// 3) Account is NOT online but has one or more part keys - go online against newest
func (d *Daemon) ensureParticipationNotOnline(ctx context.Context, poolAccounts map[string]onlineInfo, partKeys algo.PartKeysByAddress) error {
	var (
		err            error
		managerAddr, _ = types.DecodeAddress(d.info.Config.Manager)
	)

	for account, info := range poolAccounts {
		if !info.isOnline {
			keysForAccount, found := partKeys[account]
			if !found {
				continue
			}
			// sort the part keys by whichever has highest firstValid
			sort.Slice(keysForAccount, func(i, j int) bool {
				return keysForAccount[i].Key.VoteFirstValid > keysForAccount[j].Key.VoteFirstValid
			})
			keyToUse := keysForAccount[0]
			misc.Infof(d.logger, "account:%s is NOT online, going online against newest of %d part keys, id:%s", account, len(keysForAccount), keyToUse.Id)

			err = App.retiClient.GoOnline(d.info, info.poolAppID, managerAddr,
				keyToUse.Key.VoteParticipationKey, keyToUse.Key.SelectionParticipationKey, keyToUse.Key.StateProofKey,
				keyToUse.Key.VoteFirstValid, keyToUse.Key.VoteLastValid, keyToUse.Key.VoteKeyDilution)
			if err != nil {
				return fmt.Errorf("unable to go online for account:%s [pool app id:%d]", account, info.poolAppID)
			}
			misc.Infof(d.logger, "participation key went online for account:%s [pool app id:%d]", account, info.poolAppID)
		}
	}
	return nil
}

/*
Account has 1 part key AND IS ONLINE

	We only allow 1 part key so we don't keep trying to create new key when we're close to expiration.
	Assumed 'steady state' - check lifetime of key and if expiring within 1 week
	If expiring soon, create new key w/ firstValid set to existing key's lastValid - 1 day of rounds.  done
*/
func (d *Daemon) ensureParticipationCheckNeedsRenewed(ctx context.Context, poolAccounts map[string]onlineInfo, partKeys algo.PartKeysByAddress) error {
	status, err := d.algoClient.Status().Do(context.Background())
	if err != nil {
		d.logger.Warn("failure in getting current node status w/in getExpiringKeys", "error", err)
		return nil
	}
	curRound := status.LastRound
	avgBlockTime := d.AverageBlockTime()

	for account, info := range poolAccounts {
		if !info.isOnline {
			continue
		}
		if len(partKeys[account]) != 1 {
			continue
		}
		activeKey := partKeys[account][0]
		if bytes.Compare(activeKey.Key.SelectionParticipationKey, info.selectionParticipationKey) == 0 {
			if activeKey.EffectiveFirstValid > curRound {
				// activeKey isn't even in range yet ignore for now
				continue
			}
			expValidDistance := time.Duration(activeKey.Key.VoteLastValid-curRound) * avgBlockTime
			if expValidDistance.Hours() < 24*7 {
				oneDayOfBlocks := (24 * time.Hour) / avgBlockTime
				misc.Infof(d.logger, "activeKey: %s for %s expiring in %v, creating new key with ~1 day lead-time", activeKey.Id, activeKey.Address, expValidDistance)
				d.createPartKey(ctx, account, activeKey.Key.VoteLastValid-uint64(oneDayOfBlocks))
			}
		}
	}
	return nil

}

/*
*
 5. Account is online and has multiple local part keys
    If Online (assumed steady state when a future pending part key has been created)
    Sort keys descending by first valid
    If part key first valid is >= current round AND not current part. key id for account
    Go online against this new key - done.  prior key will be removed a week later when it's out of valid range
*/
func (d *Daemon) ensureParticipationCheckNeedsSwitched(ctx context.Context, poolAccounts map[string]onlineInfo, partKeys algo.PartKeysByAddress) error {
	managerAddr, _ := types.DecodeAddress(d.info.Config.Manager)

	status, err := d.algoClient.Status().Do(context.Background())
	if err != nil {
		d.logger.Warn("failure in getting current node status w/in getExpiringKeys", "error", err)
		return nil
	}
	curRound := status.LastRound

	for account, info := range poolAccounts {
		if !info.isOnline {
			continue
		}
		keysForAccount, found := partKeys[account]
		if !found {
			continue
		}
		// get the CURRENTLY active key for this account by finding the key w/in keysForAccount that matches the
		// selection key w/in info
		var activeKey algo.ParticipationKey
		for _, key := range keysForAccount {
			if bytes.Compare(key.Key.SelectionParticipationKey, info.selectionParticipationKey) == 0 {
				activeKey = key
				break
			}
		}
		if activeKey.Id == "" {
			return fmt.Errorf("unable to find the participation key that is online against account:%s", account)
		}
		// sort the part keys by whichever has highest firstValid
		sort.Slice(keysForAccount, func(i, j int) bool {
			return keysForAccount[i].Key.VoteFirstValid > keysForAccount[j].Key.VoteFirstValid
		})
		keyToCheck := keysForAccount[0]
		if keyToCheck.Id == activeKey.Id {
			// newest key is key we're already online with... done
			continue
		}
		if keyToCheck.EffectiveFirstValid > curRound {
			// activeKey isn't even in range yet ignore for now
			continue
		}
		// Ok, time to switch to the new key - it's in valid range
		misc.Infof(d.logger, "account:%s is NOT online, going online against newest of %d part keys, id:%s", account, len(keysForAccount), keyToCheck.Id)
		err = App.retiClient.GoOnline(d.info, info.poolAppID, managerAddr,
			keyToCheck.Key.VoteParticipationKey, keyToCheck.Key.SelectionParticipationKey, keyToCheck.Key.StateProofKey,
			keyToCheck.Key.VoteFirstValid, keyToCheck.Key.VoteLastValid, keyToCheck.Key.VoteKeyDilution)
		if err != nil {
			return fmt.Errorf("unable to go online for account:%s [pool app id:%d]", account, info.poolAppID)
		}
		misc.Infof(d.logger, "participation key went online for account:%s [pool app id:%d]", account, info.poolAppID)
	}
	return nil

}
