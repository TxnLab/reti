package main

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"strconv"
	"strings"
	"text/tabwriter"

	"github.com/algorand/go-algorand-sdk/v2/crypto"
	"github.com/algorand/go-algorand-sdk/v2/types"
	"github.com/urfave/cli/v3"

	"github.com/TxnLab/reti/internal/lib/algo"
	"github.com/TxnLab/reti/internal/lib/misc"
	"github.com/TxnLab/reti/internal/lib/nfdonchain"
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
				Name:   "ledger",
				Usage:  "List detailed ledger for a specific pool",
				Action: PoolLedger,
				Flags: []cli.Flag{
					&cli.UintFlag{
						Name:     "pool",
						Usage:    "Pool id (the number in 'pool list')",
						Value:    1,
						Required: true,
					},
					&cli.UintFlag{
						Name:  "validator",
						Usage: "validator id (if desired to view arbitrary validator)",
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
		fmt.Fprintln(tw, "Pool (O=Online)\tPool App id\t# stakers\tAmt Staked\tRwd Avail\tAPR %\tVote\tProp.\t")
	} else {
		fmt.Fprintln(tw, "Pool (O=Online)\tNode\tPool App id\t# stakers\tAmt Staked\tRwd Avail\tAPR %\tVote\tProp.\t")

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
		apr, _ := App.retiClient.GetAvgApr(pool.PoolAppId)
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
		floatApr, _, _ := new(big.Float).Parse(apr.String(), 10)
		floatApr.Quo(floatApr, big.NewFloat(10000.0))

		if !showAll {
			fmt.Fprintf(tw, "%d %s\t%d\t%d\t%s\t%s\t%s\t%s\t%s\t\n", i+1, onlineStr, pool.PoolAppId, pool.TotalStakers,
				algo.FormattedAlgoAmount(pool.TotalAlgoStaked), algo.FormattedAlgoAmount(rewardAvail),
				floatApr.String(),
				voteData, partData,
			)
		} else {
			fmt.Fprintf(tw, "%d %s\t%s\t%d\t%d\t%s\t%s\t%s\t%s\t%s\t\n", i+1, onlineStr, nodeStr, pool.PoolAppId, pool.TotalStakers,
				algo.FormattedAlgoAmount(pool.TotalAlgoStaked), algo.FormattedAlgoAmount(rewardAvail),
				floatApr.String(),
				voteData, partData)

		}
	}
	if !showAll {
		fmt.Fprintf(tw, "TOTAL\t\t%d\t%s\t%s\t\n", state.TotalStakers, algo.FormattedAlgoAmount(state.TotalAlgoStaked),
			algo.FormattedAlgoAmount(totalRewards))
	} else {
		fmt.Fprintf(tw, "TOTAL\t\t\t%d\t%s\t%s\t\n", state.TotalStakers, algo.FormattedAlgoAmount(state.TotalAlgoStaked),
			algo.FormattedAlgoAmount(totalRewards))
	}
	tw.Flush()
	fmt.Print(out.String())
	return err
}

func PoolLedger(ctx context.Context, command *cli.Command) error {
	var validatorId = App.retiValidatorID

	if command.Uint("validator") != 0 {
		validatorId = command.Uint("validator")
	}
	config, err := App.retiClient.GetValidatorConfig(validatorId)
	if err != nil {
		return fmt.Errorf("get validator config err:%w", err)
	}
	pools, err := App.retiClient.GetValidatorPools(validatorId)
	if err != nil {
		return fmt.Errorf("unable to GetValidatorPools: %w", err)
	}

	poolId := int(command.Uint("pool"))
	if poolId == 0 {
		return fmt.Errorf("pool numbers must start at 1.  See the pool list -all output for list")
	}
	if poolId > len(pools) {
		return fmt.Errorf("pool with id %d does not exist. See the pool list -all output for list", poolId)
	}
	params, _ := App.algoClient.SuggestedParams().Do(ctx)

	lastPayout, err := App.retiClient.GetLastPayout(pools[poolId-1].PoolAppId)
	nextEpoch := lastPayout - (lastPayout % uint64(config.EpochRoundLength)) + uint64(config.EpochRoundLength)
	if nextEpoch < uint64(params.FirstRoundValid) {
		nextEpoch = uint64(params.FirstRoundValid) - (uint64(params.FirstRoundValid) % uint64(config.EpochRoundLength))
	}
	pctTimeInEpoch := func(stakerEntry uint64) int {
		if nextEpoch == 0 {
			return 100
		}
		if nextEpoch < stakerEntry {
			return 0
		}
		timeInEpoch := (nextEpoch - stakerEntry) * 1000 / uint64(config.EpochRoundLength)
		if timeInEpoch < 0 {
			timeInEpoch = 0
		}
		if timeInEpoch > 1000 {
			timeInEpoch = 1000
		}
		return int(timeInEpoch / 10)
	}

	ledger, err := App.retiClient.GetLedgerForPool(pools[poolId-1].PoolAppId)
	if err != nil {
		return fmt.Errorf("unable to GetLedgerForPool: %w", err)
	}

	rewardAvail := App.retiClient.PoolAvailableRewards(pools[poolId-1].PoolAppId, pools[poolId-1].TotalAlgoStaked)

	var nfdLookup *nfdonchain.NfdApi
	if command.Bool("nfd") {
		nfdLookup, err = nfdonchain.NewNfdApi(App.algoClient, command.String("network"))
		if err != nil {
			misc.Warnf(App.logger, "unable to use nfd lookups: %v", err)
		}
	}

	out := new(strings.Builder)
	tw := tabwriter.NewWriter(out, 0, 0, 2, ' ', tabwriter.AlignRight)
	fmt.Fprintln(tw, "Account\tStaked\tTotal Rewarded\tRwd Tokens\tPct\tEntry Round\t")
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
		fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%d\t%d\t\n", stakerName, algo.FormattedAlgoAmount(stakerData.Balance), algo.FormattedAlgoAmount(stakerData.TotalRewarded),
			stakerData.RewardTokenBalance, pctTimeInEpoch(stakerData.EntryRound), stakerData.EntryRound)
	}
	apr, _ := App.retiClient.GetAvgApr(pools[poolId-1].PoolAppId)
	fmt.Fprintf(tw, "Reward Avail: %s\t\n", algo.FormattedAlgoAmount(rewardAvail))
	stakeAccum, _ := App.retiClient.GetStakeAccum(pools[poolId-1].PoolAppId)
	stakeAccum.Div(stakeAccum, big.NewInt(30857))
	stakeAccum.Div(stakeAccum, big.NewInt(1e6))
	fmt.Fprintf(tw, "Avg Stake: %s\t\n", stakeAccum.String())
	floatApr, _, _ := new(big.Float).Parse(apr.String(), 10)
	floatApr.Quo(floatApr, big.NewFloat(10000.0))
	fmt.Fprintf(tw, "APR %%: %s\t\n", floatApr.String())
	fmt.Fprintf(tw, "Last Epoch: %d\t\n", lastPayout-(lastPayout%uint64(config.EpochRoundLength)))
	fmt.Fprintf(tw, "Next Payout: %d\t\n", nextEpoch)
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

func PayoutPool(ctx context.Context, command *cli.Command) error {
	var info = App.retiClient.Info()
	poolID := command.Uint("pool")
	if _, found := info.LocalPools[poolID]; !found {
		return fmt.Errorf("pool num:%d not on this node", poolID)
	}
	signerAddr, _ := types.DecodeAddress(info.Config.Manager)

	return App.retiClient.EpochBalanceUpdate(int(poolID), info.LocalPools[poolID], signerAddr)
}
