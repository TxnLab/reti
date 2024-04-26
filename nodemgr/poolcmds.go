package main

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/algorand/go-algorand-sdk/v2/crypto"
	"github.com/algorand/go-algorand-sdk/v2/types"
	"github.com/urfave/cli/v3"

	"github.com/TxnLab/reti/internal/lib/algo"
	"github.com/TxnLab/reti/internal/lib/misc"
	"github.com/TxnLab/reti/internal/lib/nfdonchain"
	"github.com/TxnLab/reti/internal/lib/reti"
)

func GetPoolCmdOpts() *cli.Command {
	return &cli.Command{
		Name:    "pool",
		Aliases: []string{"p"},
		Usage:   "Add/Configure staking pools for this node",
		Before:  checkConfigured,
		Commands: []*cli.Command{
			{
				Name:    "list",
				Aliases: []string{"l"},
				Usage:   "List pools on this node",
				Action:  PoolsList,
				Flags: []cli.Flag{
					&cli.BoolFlag{
						Name:  "all",
						Usage: "Show ALL pools for this validator not just for this node",
						Value: false,
					},
					&cli.BoolFlag{
						Name:    "offline",
						Aliases: []string{"o"},
						Usage:   "Don't try to connect to the algod nodes to determine status",
						Value:   false,
					},
				},
			},
			{
				Name:    "ledger",
				Aliases: []string{"l"},
				Usage:   "List detailed ledger for a specific pool",
				Action:  PoolLedger,
				Flags: []cli.Flag{
					&cli.UintFlag{
						Name:     "pool",
						Usage:    "Pool id (the number in 'pool list')",
						Value:    1,
						Required: true,
					},
					&cli.BoolFlag{
						Name:  "nfd",
						Usage: "Whether to display NFD names instead of staker addresses",
					},
				},
			},
			{
				Name:     "add",
				Aliases:  []string{"a"},
				Usage:    "Add a new staking pool to this node",
				Category: "pool",
				Action:   PoolAdd,
				Flags: []cli.Flag{
					&cli.UintFlag{
						Name:  "node",
						Usage: "The node number (1+) to add this pool to - defaults to current node",
						Value: 0,
					},
				},
			},
			{
				Name:  "claim",
				Usage: "Claim an existing pool for this node, using manager address as verified. Signing keys must be present for this address to load",
				Flags: []cli.Flag{
					&cli.UintFlag{
						Name:     "pool",
						Usage:    "Pool id (the number in 'pool list' to claim for this node.  Do NOT use the same pool on multiple nodes !!",
						Required: true,
					},
				},
				Action: ClaimPool,
			},
			{
				Name:  "payout",
				Usage: "Try to force a manual epoch update (payout).  Normally happens automatically as part of daemon operations",
				Flags: []cli.Flag{
					&cli.UintFlag{
						Name:     "pool",
						Usage:    "Pool id (the number in 'pool list')",
						Value:    1,
						Required: true,
					},
				},
				Action: PayoutPool,
			},
			{
				Name:     "stake",
				Usage:    "Mostly for testing - but allows adding stake w/ a locally available account Add a new staking pool to this node",
				Category: "pool",
				Action:   StakeAdd,
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:     "account",
						Usage:    "The account to send stake 'from' - the staker account.",
						Required: true,
					},
					&cli.UintFlag{
						Name:     "amount",
						Usage:    "The amount of whole algo to stake",
						Required: true,
					},
					&cli.UintFlag{
						Name:     "validator",
						Aliases:  []string{"v"},
						Usage:    "The validator id to stake to",
						Required: true,
					},
				},
			},
			{
				Name:     "unstake",
				Usage:    "Mostly for testing - but allows adding stake w/ a locally available account Add a new staking pool to this node",
				Category: "pool",
				Action:   StakeRemove,
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:     "account",
						Usage:    "The staker account wanting to remove stake",
						Required: true,
					},
					&cli.UintFlag{
						Name:     "amount",
						Usage:    "The amount of whole algo to unstake",
						Required: true,
					},
					&cli.UintFlag{
						Name:     "validator",
						Aliases:  []string{"v"},
						Usage:    "The validator id stake is with",
						Required: true,
					},
					&cli.UintFlag{
						Name:     "pool",
						Aliases:  []string{"p"},
						Usage:    "The pool id to remove the stake from",
						Required: true,
					},
				},
			},
		},
	}
}

func PoolsList(ctx context.Context, command *cli.Command) error {
	// Display user-friendly version of pool list inside info using the TabWriter class, displaying
	// final output using fmt.Print type statements
	var (
		totalRewards uint64
		showAll      = command.Bool("all")
		offlineAlgod = command.Bool("offline")
		info         = App.retiClient.Info()
		partKeys     = algo.PartKeysByAddress{}
	)

	state, err := App.retiClient.GetValidatorState(App.retiClient.Info().Config.ID)
	if err != nil {
		return fmt.Errorf("failed to get validator state: %w", err)
	}

	// we just want the latest round so we can show last vote/proposal relative to current round
	status, err := App.algoClient.Status().Do(ctx)

	if !offlineAlgod {
		partKeys, err = algo.GetParticipationKeys(ctx, App.algoClient)
		if err != nil {
			return err
		}
	}
	getParticipationData := func(account string, selectionPartKey []byte) (uint64, uint64) {
		if keys, found := partKeys[account]; found {
			for _, key := range keys {
				if bytes.Compare(key.Key.SelectionParticipationKey, selectionPartKey) == 0 {
					return key.LastVote, key.LastBlockProposal
				}
			}
		}
		return 0, 0
	}

	out := new(strings.Builder)
	tw := tabwriter.NewWriter(out, 0, 0, 2, ' ', tabwriter.AlignRight)
	fmt.Fprintln(tw, "Viewing pools for our Node:", App.retiClient.NodeNum)
	if !showAll {
		fmt.Fprintln(tw, "Pool (O=Online)\tPool App id\t# stakers\tAmt Staked\tRwd Avail\tVote\tProp.\t")
	} else {
		fmt.Fprintln(tw, "Pool (O=Online)\tNode\tPool App id\t# stakers\tAmt Staked\tRwd Avail\tVote\tProp.\t")

	}
	for i, pool := range info.Pools {
		var (
			onlineStr = " "
			nodeStr   string
		)
		// find the pool in the node assignments (so we can show node num if necessary)
		nodeNum := 0
		for nodeIdx, nodeConfigs := range info.NodePoolAssignments.Nodes {
			for _, appId := range nodeConfigs.PoolAppIds {
				if appId == pool.PoolAppId {
					nodeNum = nodeIdx + 1
					break
				}
			}
		}
		if nodeNum == 0 {
			return fmt.Errorf("unable to determine node number for pool appid:%d", pool.PoolAppId)
		}
		if uint64(nodeNum) == App.retiClient.NodeNum {
			nodeStr = "*"
		} else if !showAll {
			continue
		} else {
			nodeStr = strconv.Itoa(nodeNum)
		}
		acctInfo, err := algo.GetBareAccount(context.Background(), App.algoClient, crypto.GetApplicationAddress(pool.PoolAppId).String())
		if err != nil {
			return fmt.Errorf("account fetch error, account:%s, err:%w", crypto.GetApplicationAddress(pool.PoolAppId).String(), err)
		}
		if acctInfo.Status == OnlineStatus {
			onlineStr = "O"
		}

		rewardAvail := App.retiClient.PoolAvailableRewards(pool.PoolAppId, pool.TotalAlgoStaked)
		totalRewards += rewardAvail

		lastVote, lastProposal := getParticipationData(crypto.GetApplicationAddress(pool.PoolAppId).String(), acctInfo.Participation.SelectionParticipationKey)
		var (
			voteData string
			partData string
		)
		if lastVote != 0 {
			// round might get behind last vote/proposal so handle that as well.
			if status.LastRound <= lastVote {
				voteData = "latest"
			} else {
				voteData = fmt.Sprintf("-%d", status.LastRound-lastVote)
			}
		}
		if lastProposal != 0 {
			if status.LastRound <= lastProposal {
				partData = "latest"
			} else {
				partData = fmt.Sprintf("-%d", status.LastRound-lastProposal)
			}
		}
		if !showAll {
			fmt.Fprintf(tw, "%d %s\t%d\t%d\t%s\t%s\t%s\t%s\t\n", i+1, onlineStr, pool.PoolAppId, pool.TotalStakers,
				algo.FormattedAlgoAmount(pool.TotalAlgoStaked), algo.FormattedAlgoAmount(rewardAvail),
				voteData, partData)
		} else {
			fmt.Fprintf(tw, "%d %s\t%s\t%d\t%d\t%s\t%s\t%s\t%s\t\n", i+1, onlineStr, nodeStr, pool.PoolAppId, pool.TotalStakers,
				algo.FormattedAlgoAmount(pool.TotalAlgoStaked), algo.FormattedAlgoAmount(rewardAvail),
				voteData, partData)

		}
	}
	fmt.Fprintf(tw, "TOTAL\t\t%d\t%s\t%s\t\n", state.TotalStakers, algo.FormattedAlgoAmount(state.TotalAlgoStaked),
		algo.FormattedAlgoAmount(totalRewards))

	tw.Flush()
	fmt.Print(out.String())
	return err
}

func PoolLedger(ctx context.Context, command *cli.Command) error {
	var (
		nextPayTime   time.Time
		info          = App.retiClient.Info()
		epochDuration = time.Duration(info.Config.PayoutEveryXMins) * time.Minute
	)
	poolId := int(command.Uint("pool"))
	if poolId == 0 {
		return fmt.Errorf("pool numbers must start at 1.  See the pool list -all output for list")
	}
	if poolId > len(info.Pools) {
		return fmt.Errorf("pool with id %d does not exist. See the pool list -all output for list", poolId)
	}

	lastPayout, err := App.retiClient.GetLastPayout(info.Pools[poolId-1].PoolAppId)
	if err == nil {
		nextPayTime = time.Unix(int64(lastPayout), 0).Add(time.Duration(info.Config.PayoutEveryXMins) * time.Minute)
	} else {
		nextPayTime = time.Now()
	}
	if nextPayTime.Before(time.Now()) {
		// there haven't been payouts for a while (no rewards) - so treat 'now' as the next pay time
		// so 'time in epoch' is valid
		nextPayTime = time.Now()
	}
	pctTimeInEpoch := func(stakerEntryTime uint64) int {
		entryTime := time.Unix(int64(stakerEntryTime), 0)
		timeInEpoch := nextPayTime.Sub(entryTime).Seconds() / epochDuration.Seconds() * 100
		if timeInEpoch < 0 {
			// they're past the epoch because of entry time + 320 rounds (~16mins)
			timeInEpoch = 0
		}
		if timeInEpoch > 100 {
			timeInEpoch = 100
		}
		return int(timeInEpoch)
	}

	ledger, err := App.retiClient.GetLedgerForPool(info.Pools[poolId-1].PoolAppId)
	if err != nil {
		return fmt.Errorf("unable to GetLedgerForPool: %w", err)
	}

	rewardAvail := App.retiClient.PoolAvailableRewards(info.Pools[poolId-1].PoolAppId, info.Pools[poolId-1].TotalAlgoStaked)

	var nfdLookup *nfdonchain.NfdApi
	if command.Bool("nfd") {
		nfdLookup, err = nfdonchain.NewNfdApi(App.algoClient, command.String("network"))
		if err != nil {
			misc.Warnf(App.logger, "unable to use nfd lookups: %v", err)
		}
	}

	out := new(strings.Builder)
	tw := tabwriter.NewWriter(out, 0, 0, 2, ' ', tabwriter.AlignRight)
	fmt.Fprintln(tw, "account\tStaked\tTotal Rewarded\tRwd Tokens\tPct\tEntry Time\t")
	for _, stakerData := range ledger {
		if stakerData.Account == types.ZeroAddress {
			continue
		}
		var stakerName = stakerData.Account.String()
		if nfdLookup != nil {
			if nfds, err := nfdLookup.FindByAddress(context.Background(), stakerData.Account.String()); err == nil {
				nfdInfo, err := nfdLookup.GetNFD(context.Background(), nfds[0], false)
				if err == nil {
					stakerName = nfdInfo.Internal["name"]
				}
			}

		}
		fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%d\t%s\t\n", stakerName, algo.FormattedAlgoAmount(stakerData.Balance), algo.FormattedAlgoAmount(stakerData.TotalRewarded),
			stakerData.RewardTokenBalance, pctTimeInEpoch(stakerData.EntryTime), time.Unix(int64(stakerData.EntryTime), 0).UTC().Format(time.RFC3339))
	}
	fmt.Fprintf(tw, "Pool Reward Avail: %s\t\n", algo.FormattedAlgoAmount(rewardAvail))
	fmt.Fprintf(tw, "Last Payout: %s\t\n", time.Unix(int64(lastPayout), 0).UTC().Format(time.RFC3339))
	tw.Flush()
	slog.Info(out.String())
	return nil
}

func PoolAdd(ctx context.Context, command *cli.Command) error {
	nodeNum := command.Uint("node")
	if nodeNum == 0 {
		// just add to our current node if not specified
		nodeNum = App.retiClient.NodeNum
	}
	if len(App.retiClient.Info().LocalPools) >= App.retiClient.Info().Config.PoolsPerNode {
		return fmt.Errorf("maximum number of pools have been reached on this node. No more can be added")
	}

	poolKey, err := App.retiClient.AddStakingPool(nodeNum)
	if err != nil {
		return err
	}
	slog.Info("added new pool", "key", poolKey.String())
	return App.retiClient.LoadState(ctx)
}

func ClaimPool(ctx context.Context, command *cli.Command) error {
	var info = App.retiClient.Info()
	if len(info.LocalPools) >= info.Config.PoolsPerNode {
		return fmt.Errorf("maximum number of pools have been reached on this node. No more can be added")
	}

	_, err := App.signer.FindFirstSigner([]string{info.Config.Owner, info.Config.Manager})
	if err != nil {
		return fmt.Errorf("neither owner or manager address for your validator has local keys present")
	}

	poolId := command.Uint("pool")
	if poolId == 0 {
		return fmt.Errorf("pool numbers must start at 1.  See the pool list -all output for list")
	}
	if _, found := info.LocalPools[poolId]; found {
		return fmt.Errorf("pool with id %d has already been claimed by this validator", poolId)
	}
	if poolId > uint64(len(info.Pools)) {
		return fmt.Errorf("pool with id %d does not exist. See the pool list -all output for list", poolId)
	}
	err = App.retiClient.MovePoolToNode(info.Pools[poolId-1].PoolAppId, App.retiClient.NodeNum)
	if err != nil {
		return fmt.Errorf("error in call to MovePoolToNode, err:%w", err)
	}

	misc.Infof(App.logger, "You have successfully moved the pool")
	if err != nil {
		return err
	}
	return nil
}

func StakeAdd(ctx context.Context, command *cli.Command) error {
	// account, amount, validator
	stakerAddr, err := types.DecodeAddress(command.String("account"))
	if err != nil {
		return err
	}
	poolKey, err := App.retiClient.AddStake(
		command.Uint("validator"),
		stakerAddr,
		command.Uint("amount")*1e6,
		0, // TODO do we bother handle token gating in CLI ?  best left to the UI
	)
	if err != nil {
		return err
	}
	misc.Infof(App.logger, "stake added into pool:%d", poolKey.PoolId)
	return nil
}

func StakeRemove(ctx context.Context, command *cli.Command) error {
	// account, amount, validator, pool
	stakerAddr, err := types.DecodeAddress(command.String("account"))
	if err != nil {
		return err
	}
	validatorId := command.Uint("validator")
	var poolKey *reti.ValidatorPoolKey
	// This staker must have staked something!
	poolKeys, err := App.retiClient.GetStakedPoolsForAccount(stakerAddr)
	if err != nil {
		return err
	}
	for _, key := range poolKeys {
		if key.ID == validatorId && key.PoolId == command.Uint("pool") {
			poolKey = key
			break
		}
	}
	if poolKey == nil {
		return fmt.Errorf("staker has not staked in the specified pool")
	}

	err = App.retiClient.RemoveStake(*poolKey, stakerAddr, command.Uint("amount")*1e6)
	if err != nil {
		return err
	}
	misc.Infof(App.logger, "stake removed from pool:%d", poolKey.PoolId)
	return nil
}

func PayoutPool(ctx context.Context, command *cli.Command) error {
	var info = App.retiClient.Info()
	poolID := command.Uint("pool")
	if _, found := info.LocalPools[poolID]; !found {
		return fmt.Errorf("pool num:%d not on this node", poolID)
	}
	signerAddr, _ := types.DecodeAddress(info.Config.Manager)

	return App.retiClient.EpochBalanceUpdate(int(poolID), info.LocalPools[poolID], signerAddr)
}
