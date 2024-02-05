package service

import "github.com/urfave/cli/v2"

func GetDaemonCmdOpts() *cli.Command {
	return &cli.Command{
		Name:    "daemon",
		Aliases: []string{"d"},
		Usage:   "Run the application as a daemon",
		Action:  runAsDaemon,
	}
}

func runAsDaemon(c *cli.Context) error {
	// Add your daemon logic here
	return nil
}
