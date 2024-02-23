package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/algod"
	"github.com/urfave/cli/v3"

	"github.com/TxnLab/reti/internal/lib/algo"
	"github.com/TxnLab/reti/internal/lib/misc"
	"github.com/TxnLab/reti/internal/lib/nfdapi/swagger"
	"github.com/TxnLab/reti/internal/lib/reti"
)

var logLevel = new(slog.LevelVar) // Info by default

func initApp() *RetiApp {
	h := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: logLevel})
	slog.SetDefault(slog.New(h))

	logger := slog.Default()
	if os.Getenv("DEBUG") == "1" {
		logLevel.Set(slog.LevelDebug)
	}
	// This will load and initialize mnemonics from the environment, etc.
	signer := algo.NewLocalKeyStore(logger)

	// We initialize our wrapper instance first, so we can call its methods in the 'Before' lambda func
	// in initialization of cli App instance.
	appConfig := &RetiApp{signer: signer, logger: logger}

	appConfig.cliCmd = &cli.Command{
		Name:    "réti node manager",
		Usage:   "Configuration tool and background daemon for Algorand validator pools",
		Version: misc.GetVersionInfo(),
		Before: func(ctx context.Context, cmd *cli.Command) error {
			// This is further bootstrap of the 'app' but within context of 'cli' helper as it will
			// have access to flags and options (network to use for eg) already set.
			return appConfig.initClients(ctx, cmd)
		},
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:    "network",
				Usage:   "Algorand network to use",
				Value:   "mainnet",
				Aliases: []string{"n"},
				Sources: cli.EnvVars("ALGO_NETWORK"),
			},
			&cli.UintFlag{
				Name:        "id",
				Usage:       "The application ID of the Reti master validator contract",
				Sources:     cli.EnvVars("RETI_APPID"),
				Required:    true,
				Destination: &appConfig.retiAppID,
				Aliases:     []string{"i"},
				OnlyOnce:    true,
			},
		},
		Commands: []*cli.Command{
			GetDaemonCmdOpts(),
			GetValidatorCmdOpts(),
			GetPoolCmdOpts(),
		},
	}
	return appConfig
}

type RetiApp struct {
	cliCmd     *cli.Command
	logger     *slog.Logger
	signer     algo.MultipleWalletSigner
	algoClient *algod.Client
	nfdApi     *swagger.APIClient
	retiClient *reti.Reti

	// just here for flag bootstrapping destination
	retiAppID uint64
}

// initClients initializes both an an algod client (to correct network - which it
// also validates) and an nfd nfdApi clinet - for nfd updates or fetches if caller
// desires
func (ac *RetiApp) initClients(ctx context.Context, cmd *cli.Command) error {
	network := cmd.Value("network").(string)

	switch network {
	case "sandbox", "betanet", "testnet", "mainnet", "voitestnet":
	default:
		return fmt.Errorf("unknown network:%s", network)
	}
	var (
		algoClient *algod.Client
		api        *swagger.APIClient
		err        error
	)

	// Initialize algod client / networks (testing connectivity as well)
	cfg := algo.GetNetworkConfig(network)
	algoClient, err = algo.GetAlgoClient(ac.logger, cfg)
	if err != nil {
		return err
	}

	// Inititialize NFD API (if even used)
	nfdApiCfg := swagger.NewConfiguration()
	nfdApiCfg.BasePath = cfg.NFDAPIUrl
	api = swagger.NewAPIClient(nfdApiCfg)
	_, _ = algoClient, api

	ac.algoClient = algoClient
	ac.nfdApi = api

	// Initialize the 'reti' client
	retiClient, err := reti.New(ac.retiAppID, ac.logger, ac.algoClient, ac.signer)
	if err != nil {
		return err
	}
	ac.retiClient = retiClient

	return nil
}
