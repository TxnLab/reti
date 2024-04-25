package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/algod"
	"github.com/algorand/go-algorand-sdk/v2/crypto"
	"github.com/algorand/go-algorand-sdk/v2/types"
	"github.com/mailgun/holster/v4/syncutil"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/ssgreg/repeat"

	"github.com/TxnLab/reti/internal/lib/algo"
	"github.com/TxnLab/reti/internal/lib/misc"
	"github.com/TxnLab/reti/internal/lib/reti"
)

const (
	OnlineStatus             = "Online"
	GeneratedKeyLengthInDays = 7
	DaysPriorToExpToRenew    = 1
)

// Daemon provides a 'little' separation in that we initalize it with some data from the App global set up by
// the process startup, but the Daemon tries to be fairly retrieval with its data retrieval and use.
type Daemon struct {
	logger     *slog.Logger
	algoClient *algod.Client

	// embed mutex for locking state for members below the mutex
	sync.RWMutex
	avgBlockTime time.Duration
}

func newDaemon() *Daemon {
	return &Daemon{
		logger:     App.retiClient.Logger,
		algoClient: App.algoClient,
	}
}

func (d *Daemon) start(ctx context.Context, wg *sync.WaitGroup, cancel context.CancelFunc, listenPort int) {
	misc.Infof(d.logger, "Réti daemon, version:%s started", getVersionInfo())
	wg.Add(1)
	go func() {
		defer wg.Done()
		// note that KeyWatcher is allowed to cancel the context and cause the daemon to exit
		// this is so an exit (and presumed restart) can be triggered when the manager address is changed
		// out from underneath the daemon
		d.KeyWatcher(ctx, cancel)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		d.EpochUpdater(ctx)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		http.Handle("/ready", isReady())
		http.Handle("/metrics", promhttp.Handler())

		host := fmt.Sprintf(":%d", listenPort)
		srv := &http.Server{Addr: host}
		go func() {
			misc.Infof(d.logger, "HTTP server listening on %q", host)
			_ = srv.ListenAndServe()
		}()

		<-ctx.Done()
		misc.Infof(d.logger, "shutting down HTTP server at %q", host)

		// Shutdown gracefully with a 30s max wait.
		ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()

		_ = srv.Shutdown(ctx)
	}()
}

func isReady() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

// KeyWatcher keeps track of both active pools for this node (updated via configuration file) as well
// as participation keys with the algod daemon.  It creates and maintains participation keys as necessary.
func (d *Daemon) KeyWatcher(ctx context.Context, cancel context.CancelFunc) {
	defer d.logger.Info("Exiting KeyWatcher")
	d.logger.Info("Starting KeyWatcher")

	// make sure avg block time is set first
	err := d.setAverageBlockTime(ctx)
	if err != nil {
		misc.Errorf(d.logger, "unable to fetch blocks to determine block times: %v", err)
		os.Exit(1)
	}
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
			// they could have added new pools, moved them between nodes, etc.
			curManager := App.retiClient.Info().Config.Manager
			err := d.refetchConfig()
			if err != nil {
				misc.Warnf(d.logger, "error in fetching configuration, will retry.  err:%v", err)
				break
			}
			if curManager != App.retiClient.Info().Config.Manager {
				d.logger.Warn("Manager account was changed, restarting daemon to ensure proper keys available")
				cancel()
				return
			}

			d.updatePoolVersions(ctx)
			d.checkPools(ctx)
		case <-blockTimeUpdate.C:
			_ = d.setAverageBlockTime(ctx)
		}
	}
}

type onlineInfo struct {
	poolAppId                 uint64
	isOnline                  bool
	selectionParticipationKey []byte
	firstValid                uint64
}

func (d *Daemon) checkPools(ctx context.Context) {
	// get online status and partkey info for all our accounts (ignoring any that don't have balances yet)
	var poolAccounts = map[string]onlineInfo{}
	for poolId, poolAppId := range App.retiClient.Info().LocalPools {
		acctInfo, err := algo.GetBareAccount(ctx, d.algoClient, crypto.GetApplicationAddress(poolAppId).String())
		if err != nil {
			d.logger.Warn("account fetch error", "account", crypto.GetApplicationAddress(poolAppId).String(), "error", err)
			return
		}
		info := onlineInfo{
			poolAppId:                 poolAppId,
			isOnline:                  acctInfo.Status == OnlineStatus,
			selectionParticipationKey: acctInfo.Participation.SelectionParticipationKey,
			firstValid:                acctInfo.Participation.VoteFirstValid,
		}
		if acctInfo.Amount-acctInfo.MinBalance > 1e6 {
			poolAccounts[crypto.GetApplicationAddress(poolAppId).String()] = info
		}
		// ensure pools were initialized properly (since it's a two-step process - the second step may have been skipped?)
		err = App.retiClient.CheckAndInitStakingPoolStorage(&reti.ValidatorPoolKey{
			ID:        App.retiClient.Info().Config.ID,
			PoolId:    poolId,
			PoolAppId: poolAppId,
		})
		if err != nil {
			misc.Errorf(d.logger, "error ensuring participation init: %v", err)
			return
		}
	}
	// now get all the current participation keys for our node
	partKeys, err := algo.GetParticipationKeys(ctx, d.algoClient)
	if err != nil {
		d.logger.Warn("participation key fetch error", "error", err)
		return
	}
	// first, remove all expired keys ! (regardless if currently for our node or not)
	anyRemoved, err := d.removeExpiredKeys(ctx, partKeys)
	if err != nil {
		misc.Errorf(d.logger, "error removing an expired key: %v", err)
		return
	}
	if anyRemoved {
		// get part key list again because we removed some...
		partKeys, err = algo.GetParticipationKeys(ctx, d.algoClient)
		if err != nil {
			d.logger.Warn("participation key fetch error", "error", err)
			return
		}
	}
	// filter partKeys to just the accounts matching our pools.
	// Other accounts aren't our problem or under our control at this point
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
	managerAddr, _ := types.DecodeAddress(App.retiClient.Info().Config.Manager)

	versString, err := algo.GetVersionString(ctx, d.algoClient)
	if err != nil {
		misc.Errorf(d.logger, "unable to fetch version string from algod instance, err:%v", err)
		return
	}
	versString = fmt.Sprintf("%s : %s", versString, getVersionInfo())

	for _, poolAppId := range App.retiClient.Info().LocalPools {
		algodVer, err := App.retiClient.GetAlgodVer(poolAppId)
		if err != nil && !errors.Is(err, algo.ErrStateKeyNotFound) {
			misc.Errorf(d.logger, "unable to fetch algod version from staking pool app id:%d, err:%v", poolAppId, err)
			return
		}
		if algodVer != versString {
			// Update version in staking pool
			err = App.retiClient.UpdateAlgodVer(poolAppId, versString, managerAddr)
			if err != nil {
				misc.Errorf(d.logger, "unable to update algod version in staking pool app id:%d, err:%v", poolAppId, err)
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

	blockTime, err := algo.CalcBlockTimes(ctx, d.algoClient, numRounds)
	if err != nil {
		return err
	}
	d.Lock()
	d.avgBlockTime = blockTime
	d.Unlock()
	misc.Infof(d.logger, "average block time set to:%v", d.AverageBlockTime())
	return nil
}

func (d *Daemon) refetchConfig() error {
	var err error
	err = repeat.Repeat(
		repeat.Fn(func() error {
			err = App.retiClient.LoadState(context.Background())
			if err != nil {
				return repeat.HintTemporary(err)
			}
			return nil
		}),
		repeat.StopOnSuccess(),
		repeat.LimitMaxTries(10),
		repeat.FnOnError(func(err error) error {
			misc.Warnf(d.logger, "retrying fetch of validator info, error:%v", err.Error())
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
	keyDurationInSeconds := GeneratedKeyLengthInDays * 60 * 60 * 24
	lastValid := firstValid + uint64(float64(keyDurationInSeconds)/d.AverageBlockTime().Seconds())
	return algo.GenerateParticipationKey(ctx, d.algoClient, d.logger, account, firstValid, lastValid)
}

// 1) Part key found but expired - delete it
func (d *Daemon) removeExpiredKeys(ctx context.Context, partKeys algo.PartKeysByAddress) (bool, error) {
	status, err := d.algoClient.Status().Do(ctx)
	if err != nil {
		return false, fmt.Errorf("unable to fetch node status: %w", err)
	}
	var anyRemoved bool
	for _, keys := range partKeys {
		for _, key := range keys {
			if key.Key.VoteLastValid < status.LastRound {
				misc.Infof(d.logger, "key:%s for account:%s is expired, removing", key.Id, key.Address)
				err = algo.DeleteParticipationKey(ctx, d.algoClient, d.logger, key.Id)
				if err != nil {
					return false, fmt.Errorf("error deleting participation key for id:%s, err:%w", key.Id, err)
				}
				anyRemoved = true
			}
		}
	}
	return anyRemoved, nil
}

func (d *Daemon) ensureParticipation(ctx context.Context, poolAccounts map[string]onlineInfo, partKeys algo.PartKeysByAddress) error {
	/** conditions to cover for participation keys / accounts
	1) account has NO local participation key (online or offline) (ie: they could've moved to new node)
		Create brand new 'GeneratedKeyLengthInDays' length key - will go online as part of subsequent checks once part.
		key reaches first valid.
	2) account is NOT online but has one or more part keys
		Go online against newest part key - done
	3) account has ONE local part key AND IS ONLINE
		Assumed 'steady state' - check lifetime of CURRENT key and if expiring within 1 day
		If expiring soon, create new key w/ firstValid set to existing key's lastValid - 1 day of rounds.
	4) account is online and has multiple local part keys
		If Online (assumed steady state when a future pending part key has been created)
			Sort keys descending by first valid
			If part key first valid is >= current round AND not current part. key id for account
				Go online against this new key - done.  prior key will be removed a week later when it's out of valid range
	*/
	// get accounts without (local) part. keys at all.
	if err := d.ensureParticipationNoKeysYet(ctx, poolAccounts, partKeys); err != nil {
		return err
	}
	// Not online...
	if err := d.ensureParticipationNotOnline(ctx, poolAccounts, partKeys); err != nil {
		return err
	}
	// account has 1 part key, IS ONLINE and might expire soon (needing to generate new key)
	if err := d.ensureParticipationCheckNeedsRenewed(ctx, poolAccounts, partKeys); err != nil {
		return err
	}
	// account is online - see if there's a newer key to 'switch' to
	if err := d.ensureParticipationCheckNeedsSwitched(ctx, poolAccounts, partKeys); err != nil {
		return err
	}
	return nil
}

// Handle: account has NO local participation key (online or offline)
func (d *Daemon) ensureParticipationNoKeysYet(ctx context.Context, poolAccounts map[string]onlineInfo, partKeys algo.PartKeysByAddress) error {
	for account := range poolAccounts {
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

// Handle: account is NOT online but has one or more part keys - go online against newest
func (d *Daemon) ensureParticipationNotOnline(_ context.Context, poolAccounts map[string]onlineInfo, partKeys algo.PartKeysByAddress) error {
	var (
		err            error
		managerAddr, _ = types.DecodeAddress(App.retiClient.Info().Config.Manager)
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

			err = App.retiClient.GoOnline(info.poolAppId, managerAddr, keyToUse.Key.VoteParticipationKey, keyToUse.Key.SelectionParticipationKey, keyToUse.Key.StateProofKey, keyToUse.Key.VoteFirstValid, keyToUse.Key.VoteLastValid, keyToUse.Key.VoteKeyDilution)
			if err != nil {
				return fmt.Errorf("unable to go online for key:%s, account:%s [pool app id:%d], err:%w", keyToUse.Id, account, info.poolAppId, err)
			}
			misc.Infof(d.logger, "participation key:%s went online for account:%s [pool app id:%d]", keyToUse.Id, account, info.poolAppId)
		}
	}
	return nil
}

/*
account has 1 part key AND IS ONLINE

	We only allow 1 part key so we don't keep trying to create new key when we're close to expiration.
	Assumed 'steady state' - check lifetime of key and if expiring within 1 day
	If expiring soon, create new key w/ firstValid set to existing key's lastValid - 1 day of rounds.  done
*/
func (d *Daemon) ensureParticipationCheckNeedsRenewed(ctx context.Context, poolAccounts map[string]onlineInfo, partKeys algo.PartKeysByAddress) error {
	status, err := d.algoClient.Status().Do(ctx)
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
			if expValidDistance.Hours() <= 24*DaysPriorToExpToRenew {
				oneDayOfBlocks := (24 * time.Hour) / avgBlockTime
				misc.Infof(d.logger, "activeKey: %s for %s expiring in %v, creating new key with ~1 day lead-time", activeKey.Id, activeKey.Address, expValidDistance)
				_, err = d.createPartKey(ctx, account, activeKey.Key.VoteLastValid-uint64(oneDayOfBlocks))
				if err != nil {
					d.logger.Warn("failure in creating new key w/in ensureParticipationCheckNeedsRenewed", "error", err)
					continue
				}
			}
		}
	}
	return nil

}

/*
Handle: account is online and has multiple local part keys

	If Online (assumed steady state when a future pending part key has been created)
	Sort keys descending by first valid
	If part key first valid is >= current round AND not current part. key id for account
	Go online against this new key - done.  prior key will be removed a week later when it's out of valid range
*/
func (d *Daemon) ensureParticipationCheckNeedsSwitched(ctx context.Context, poolAccounts map[string]onlineInfo, partKeys algo.PartKeysByAddress) error {
	managerAddr, _ := types.DecodeAddress(App.retiClient.Info().Config.Manager)

	status, err := d.algoClient.Status().Do(ctx)
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
			// user apparently did something stupid or data has been lost, because the account is 'online' yet
			// the key it's online against isn't present - so have the account go offline and then we can start over with
			// the keys we have or don't have on next pass.
			misc.Errorf(d.logger, "account:%s is online but its part. key isn't present locally! - offlining account", account)
			err = App.retiClient.GoOffline(info.poolAppId, managerAddr)
			if err != nil {
				return fmt.Errorf("unable to go offline for account:%s [pool app id:%d], err: %w", account, info.poolAppId, err)
			}
			return nil
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
		if keyToCheck.Key.VoteFirstValid > curRound {
			// activeKey isn't even in range yet ignore for now
			continue
		}
		// Ok, time to switch to the new key - it's in valid range
		misc.Infof(d.logger, "account:%s is NOT online, going online against newest of %d part keys, id:%s", account, len(keysForAccount), keyToCheck.Id)
		err = App.retiClient.GoOnline(info.poolAppId, managerAddr, keyToCheck.Key.VoteParticipationKey, keyToCheck.Key.SelectionParticipationKey, keyToCheck.Key.StateProofKey, keyToCheck.Key.VoteFirstValid, keyToCheck.Key.VoteLastValid, keyToCheck.Key.VoteKeyDilution)
		if err != nil {
			return fmt.Errorf("unable to go online for account:%s [pool app id:%d], err: %w", account, info.poolAppId, err)
		}
		misc.Infof(d.logger, "participation key went online for account:%s [pool app id:%d]", account, info.poolAppId)
	}
	return nil

}

func (d *Daemon) EpochUpdater(ctx context.Context) {
	d.logger.Info("EpochUpdater started")
	defer d.logger.Info("EpochUpdater stopped")

	epochMinutes := App.retiClient.Info().Config.EpochRoundLength

	dur := durationToNextEpoch(time.Now(), epochMinutes)
	epochTimer := time.NewTimer(dur)
	defer epochTimer.Stop()
	misc.Infof(d.logger, "First epoch trigger in:%v", dur)

	for {
		select {
		case <-ctx.Done():
			return
		case <-epochTimer.C:
			signerAddr, _ := types.DecodeAddress(App.retiClient.Info().Config.Manager)
			epochTimer.Reset(durationToNextEpoch(time.Now(), epochMinutes))
			var (
				wg   syncutil.WaitGroup
				info = App.retiClient.Info()
			)
			for i, pool := range info.Pools {
				i := i
				appid := pool.PoolAppId
				if _, found := info.LocalPools[uint64(i+1)]; !found {
					continue
				}
				wg.Run(func(val any) error {
					if !accountHasAtLeast(ctx, App.algoClient, info.Config.Manager, 100_000 /* .1 spendable */) {
						return errors.New("manager account should have at least .1 ALGO spendable.  Aborting epochUpdate call")
					}

					// Retry up to 5 times - waiting 5 seconds between each try
					err := repeat.Repeat(
						repeat.Fn(func() error {
							err := App.retiClient.EpochBalanceUpdate(i+1, appid, signerAddr)
							if err != nil {
								// Assume epoch update failed because it's just 'slightly' too early?
								return repeat.HintTemporary(fmt.Errorf("epoch balance update failed for pool app id:%d, err:%w", i+1, err))
							}
							return nil
						}),
						repeat.StopOnSuccess(),
						repeat.LimitMaxTries(5),
						repeat.FnOnError(func(err error) error {
							misc.Warnf(d.logger, "retrying epoch update of validator, error:%v", err.Error())
							return err
						}),
						repeat.WithDelay(
							repeat.SetContextHintStop(),
							(&repeat.FixedBackoffBuilder{
								Delay: 5 * time.Second,
							}).Set(),
						),
					)
					return err
				}, nil)
			}
			errs := wg.Wait()
			for _, err := range errs {
				d.logger.Error("error returned from EpochUpdater", "error", err)
			}
		}
	}
}

// accountHasAtLeast checks if an account has at least a certain amount of microAlgos (spendable)
// Errors are just treated as failures
func accountHasAtLeast(ctx context.Context, algoClient *algod.Client, accountAddr string, microAlgos uint64) bool {
	acctInfo, err := algo.GetBareAccount(ctx, algoClient, accountAddr)
	if err != nil {
		return false
	}
	return acctInfo.Amount-acctInfo.MinBalance >= microAlgos
}

func durationToNextEpoch(curTime time.Time, epochMinutes int) time.Duration {
	dur := curTime.Round(time.Duration(epochMinutes) * time.Minute).Sub(curTime)
	if dur <= 0 {
		// We've rounded backwards - so go to that rounded time, and then get time from curTime to that future time.
		// ie: 12:10:00 hourly epoch - rounds down to 12:00:00 but next epoch is 13:00:00, so duration should be 50 minutes.
		dur = curTime.Add(dur).Add(time.Duration(epochMinutes) * time.Minute).Sub(curTime)
	}
	slog.Debug(fmt.Sprintf("%v epoch duration in mins:%d, dur to next epoch:%v", curTime, epochMinutes, dur))
	return dur
}
