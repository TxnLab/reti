package main

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"text/tabwriter"

	"github.com/algorand/go-algorand-sdk/v2/types"
	"github.com/urfave/cli/v3"

	"github.com/TxnLab/reti/internal/lib/algo"
	"github.com/TxnLab/reti/internal/lib/misc"
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
				},
			},
			{
				Name:     "add",
				Aliases:  []string{"a"},
				Usage:    "Add a new staking pool to this node",
				Category: "pool",
				Action:   PoolAdd,
			},
			{
				Name:  "claim",
				Usage: "Claim an existing pool for this node, using manager address as verified. Signing keys must be present for this address to load",
				Flags: []cli.Flag{
					&cli.UintFlag{
						Name:     "pool",
						Usage:    "Pool ID (the number in 'pool list' to claim for this node.  Do NOT use the same pool on multiple nodes !!",
						Required: true,
					},
				},
				Action: ClaimPool,
			},
			{
				Name:     "stake",
				Usage:    "Mostly for testing - but allows adding stake w/ a locally available account Add a new staking pool to this node",
				Category: "pool",
				Action:   StakeAdd,
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:     "from",
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
						Usage:    "The validator id to stake to",
						Required: true,
					},
				},
			},
		},
	}
}

func checkConfigured(ctx context.Context, command *cli.Command) error {
	_, err := LoadValidatorInfo()
	if err != nil {
		return fmt.Errorf("validator not configured: %w", err)
	}
	return nil
}

func PoolsList(ctx context.Context, command *cli.Command) error {
	info, err := LoadValidatorInfo()
	if err != nil {
		return fmt.Errorf("validator not configured: %w", err)
	}
	signerAddr, _ := types.DecodeAddress(info.Config.Owner)

	state, err := App.retiClient.GetValidatorState(info.Config.ID, signerAddr)
	if err != nil {
		return fmt.Errorf("failed to get validator state: %w", err)
	}

	// Walk every pool (and also see if it's on this node)
	pools, err := App.retiClient.GetValidatorPools(info.Config.ID, signerAddr)
	if err != nil {
		return fmt.Errorf("failed to get validator pools: %w", err)
	}

	// Display user-friendly version of pool list inside info using the TabWriter class, displaying
	// final output using fmt.Print type statements
	out := new(strings.Builder)
	tw := tabwriter.NewWriter(out, 0, 0, 4, ' ', tabwriter.AlignRight)
	fmt.Fprintln(tw, "Pool (*=Local)\tPool App ID\tTotal Stakers\tTotal Staked\t")
	for i, pool := range pools {
		var isLocal string
		// Flag the pool id if it's a pool on this node
		if slices.Contains(info.Pools, pool) {
			isLocal = " (*)"
		} else if !command.Value("all").(bool) {
			continue
		}
		fmt.Fprintf(tw, "%d%s\t%d\t%d\t%s\t\n", i+1, isLocal, pool.PoolAppID, pool.TotalStakers, algo.FormattedAlgoAmount(pool.TotalAlgoStaked))
	}
	fmt.Fprintf(tw, "TOTAL\t\t%d\t%s\t\n", state.TotalStakers, algo.FormattedAlgoAmount(state.TotalAlgoStaked))

	tw.Flush()
	fmt.Print(out.String())
	return err
}

func PoolAdd(ctx context.Context, command *cli.Command) error {
	info, err := LoadValidatorInfo()
	if err != nil {
		return fmt.Errorf("validator not configured: %w", err)
	}

	if len(info.Pools) >= info.Config.PoolsPerNode {
		return fmt.Errorf("maximum number of pools have been reached on this node. No more can be added")
	}

	poolKey, err := App.retiClient.AddStakingPool(info)
	if err != nil {
		return err
	}
	slog.Info("added new pool", "key", poolKey.String())
	info.Pools = append(info.Pools, reti.PoolInfo{
		PoolAppID:       poolKey.PoolAppID,
		TotalStakers:    0,
		TotalAlgoStaked: 0,
	})
	return SaveValidatorInfo(info)
}

func ClaimPool(ctx context.Context, command *cli.Command) error {
	info, err := LoadValidatorInfo()
	if err != nil {
		return fmt.Errorf("validator not configured: %w", err)
	}

	if len(info.Pools) >= info.Config.PoolsPerNode {
		return fmt.Errorf("maximum number of pools have been reached on this node. No more can be added")
	}

	signer, err := App.signer.FindFirstSigner([]string{info.Config.Owner, info.Config.Manager})
	if err != nil {
		return fmt.Errorf("neither owner or manager address for your validator has local keys present")
	}
	signerAddr, _ := types.DecodeAddress(signer)

	// Walk every pool (and also see if it's on this node)
	pools, err := App.retiClient.GetValidatorPools(info.Config.ID, signerAddr)
	if err != nil {
		return fmt.Errorf("failed to get validator pools: %w", err)
	}

	idToClaim := int(command.Value("pool").(uint64))
	if idToClaim > len(pools) {
		return fmt.Errorf("pool with ID %d does not exist. See the pool list -all output for list", idToClaim)
	}
	if slices.ContainsFunc(info.Pools, func(info reti.PoolInfo) bool {
		return info.PoolAppID == pools[idToClaim-1].PoolAppID
	}) {
		return fmt.Errorf("pool with ID %d has already been claimed by this validator", idToClaim)
	}
	// 0 out the totals we store in local state - we use same struct for convenience but these values aren't used
	pools[idToClaim-1].TotalStakers = 0
	pools[idToClaim-1].TotalAlgoStaked = 0
	info.Pools = append(info.Pools, pools[idToClaim-1])

	err = SaveValidatorInfo(info)

	misc.Infof(App.logger, "You have successfully imported/claimed the pool")
	if err != nil {
		return err
	}
	return nil
}

func StakeAdd(ctx context.Context, command *cli.Command) error {
	// from, account, validator
	stakerAddr, err := types.DecodeAddress(command.Value("from").(string))
	if err != nil {
		return err
	}
	poolKey, err := App.retiClient.AddStake(command.Value("validator").(uint64), stakerAddr, command.Value("amount").(uint64)*1e6)
	if err != nil {
		return err
	}
	misc.Infof(App.logger, "stake added into pool:%d", poolKey.PoolID)
	return nil
}
