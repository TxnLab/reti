package validator

import (
	"log/slog"

	"github.com/urfave/cli/v2"
)

func GetValidatorCmdOpts() *cli.Command {
	return &cli.Command{
		Name:    "validator",
		Aliases: []string{"v"},
		Usage:   "Configure validator options",
		Subcommands: []*cli.Command{
			{
				Name:     "init",
				Usage:    "Initialize self as validator - creating or resetting configuration - should only be done ONCE, EVER !",
				Category: "validator",
				Action: func(context *cli.Context) error {
					// do something with the context here
					app := context.App
					slog.Info("in init", "name", app.Name)
					return nil
				},
			},
			{
				Name:     "load",
				Usage:    "Load validator information from chain, using manager address as locator.  Signing keys must be present for this address to load",
				Category: "validator",
			},
			{
				Name:     "add",
				Aliases:  []string{"a"},
				Usage:    "Add a new staking pool to this node",
				Category: "pool",
				Action: func(context *cli.Context) error {
					return nil
				},
			},
		},
	}
}
