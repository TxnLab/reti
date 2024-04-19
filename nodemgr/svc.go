package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/urfave/cli/v3"

	"github.com/TxnLab/reti/internal/lib/misc"
)

func GetDaemonCmdOpts() *cli.Command {
	return &cli.Command{
		Name:    "daemon",
		Aliases: []string{"d"},
		Usage:   "Run the application as a daemon",
		Before:  checkConfigured, // make sure validator is already configured
		Action:  runAsDaemon,
		Flags: []cli.Flag{
			&cli.IntFlag{
				Name:     "port",
				Usage:    "port to expose prometheus /metrics and /ready endpoint",
				Value:    6260,
				Required: false,
			},
		},
	}
}

func runAsDaemon(ctx context.Context, cmd *cli.Command) error {
	var wg sync.WaitGroup

	if err := App.retiClient.LoadState(ctx); err != nil {
		return err
	}

	// Create channel used by both the signal handler and server goroutines
	// to notify the main goroutine when to stop the server.
	errc := make(chan error)

	// Setup interrupt handler so that ctrl-c or sigterm gracefully stops the process
	go func() {
		c := make(chan os.Signal, 1)
		signal.Notify(c, syscall.SIGINT, syscall.SIGTERM)
		errc <- fmt.Errorf("%s", <-c)
	}()
	ctx, cancel := context.WithCancel(context.Background())

	newDaemon().start(ctx, &wg, cancel, int(cmd.Int("port")))

	select {
	case err := <-errc: // wait for termination signal
		misc.Infof(App.logger, "exiting (%v)", err)
		// Send cancellation signal to the goroutines.
		cancel()
	case <-ctx.Done():
		misc.Infof(App.logger, "exiting - cancelled internally")
	}
	misc.Infof(App.logger, "waiting on backround tasks..")
	wg.Wait()

	misc.Infof(App.logger, "exited")
	return nil
}
