package main

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/urfave/cli/v3"

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
				Name:   "list",
				Usage:  "List pools on this node",
				Action: PoolsList,
			},
			{
				Name:     "add",
				Aliases:  []string{"a"},
				Usage:    "Add a new staking pool to this node",
				Category: "pool",
				Action:   PoolAdd,
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
	_ = info
	//Get information from the chain about the current state
	//ownerAddr, err := types.DecodeAddress(info.Config.Owner)
	//if err != nil {
	//	return err
	//}
	//for _, pool := range info.Pools {
	//	slog.Info()
	//}
	//config, err := App.retiClient.GetValidatorConfig(info.Config.ID, ownerAddr)
	//if err != nil {
	//	return err
	//}
	//slog.Info(config.String())
	return err
}

func PoolAdd(ctx context.Context, command *cli.Command) error {
	info, err := LoadValidatorInfo()
	if err != nil {
		return fmt.Errorf("validator not configured: %w", err)
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
