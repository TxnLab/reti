package service

import (
	"context"

	"github.com/urfave/cli/v3"
)

func GetDaemonCmdOpts() *cli.Command {
	return &cli.Command{
		Name:    "daemon",
		Aliases: []string{"d"},
		Usage:   "Run the application as a daemon",
		Action:  runAsDaemon,
	}
}

func runAsDaemon(c context.Context, _ *cli.Command) error {
	// Add your daemon logic here
	return nil
}
