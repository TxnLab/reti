package main

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/algod"
	"github.com/urfave/cli/v2"

	"github.com/TxnLab/reti/internal/lib/algo"
	"github.com/TxnLab/reti/internal/lib/misc"
	nfdapi "github.com/TxnLab/reti/internal/lib/nfdapi/swagger"
	"github.com/TxnLab/reti/internal/service"
	"github.com/TxnLab/reti/internal/validator"
)

func main() {
	app := initApp()

	misc.LoadEnvironmentSettings()
	err := app.Run(os.Args)
	if err != nil {
		slog.Error("Error", "msg", err)
	}
}

func initApp() *AppConfig {
	logger := slog.Default()
	signer := algo.NewLocalKeyStore(logger)

	// We initialize our wrapper instance first, so we can pass to the 'Before' lambda func
	// in initialization of cli App instance.
	appConfig := &AppConfig{signer: signer, logger: logger}
	appConfig.App = &cli.App{
		Name:    "réti node manager",
		Usage:   "Configuration tool and background daemon for Algorand validator pools",
		Version: misc.GetVersionInfo(),
		Before: func(ctx *cli.Context) error {
			return appConfig.initClients(ctx)
		},
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:    "network",
				Usage:   "Algorand network to use",
				Value:   "mainnet",
				Aliases: []string{"n"},
				EnvVars: []string{"ALGO_NETWORK"},
			},
		},
		Commands: []*cli.Command{
			service.GetDaemonCmdOpts(),
			validator.GetValidatorCmdOpts(),
		},
	}
	return appConfig
}

type AppConfig struct {
	*cli.App
	logger     *slog.Logger
	signer     algo.MultipleWalletSigner
	algoClient *algod.Client
	api        *nfdapi.APIClient
}

// initClients initializes both an an algod client (to correct network - which it
// also validates) and an nfd api clinet - for nfd updates or fetches if caller
// desires
func (ac *AppConfig) initClients(ctx *cli.Context) error {
	network := ctx.Value("network").(string)

	switch network {
	case "betanet", "testnet", "mainnet", "voitestnet":
	default:
		return fmt.Errorf("unknown network:%s", network)
	}
	var (
		algoClient *algod.Client
		api        *nfdapi.APIClient
		err        error
	)

	cfg := algo.GetNetworkConfig(network)
	algoClient, err = algo.GetAlgoClient(ac.logger, cfg)
	if err != nil {
		return err
	}
	nfdApiCfg := nfdapi.NewConfiguration()
	nfdApiCfg.BasePath = cfg.NFDAPIUrl
	api = nfdapi.NewAPIClient(nfdApiCfg)
	_, _ = algoClient, api

	ac.algoClient = algoClient
	ac.api = api

	return nil
}
