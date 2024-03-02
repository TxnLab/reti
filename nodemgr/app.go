package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"os"
	"strconv"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/algod"
	"github.com/urfave/cli/v3"
	"golang.org/x/term"

	"github.com/TxnLab/reti/internal/lib/algo"
	"github.com/TxnLab/reti/internal/lib/misc"
	"github.com/TxnLab/reti/internal/lib/nfdapi/swagger"
	"github.com/TxnLab/reti/internal/lib/reti"
)

var logLevel = new(slog.LevelVar) // Info by default

func initApp() *RetiApp {
	log.SetFlags(0)
	var logger *slog.Logger
	if term.IsTerminal(int(os.Stdout.Fd())) {
		// Are we running on something where output is a tty - so we're being run as CLI vs as a daemon
		logger = slog.New(misc.NewMinimalHandler(os.Stdout,
			misc.MinimalHandlerOptions{SlogOpts: slog.HandlerOptions{Level: logLevel}}))

		//logger = slog.Default()
		//logger = slog.NewLogLogger()
		//logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel,
		//	ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
		//		if a.Key == slog.TimeKey ||
		//			a.Key == slog.LevelKey {
		//			return slog.Attr{}
		//		}
		//		//if a.Key == slog.TimeKey && len(groups) == 0 {
		//		//	return slog.Attr{}
		//		//} else if a.Key == slog.LevelKey && len(groups) == 0 {
		//		//	return slog.Attr{}
		//		//}
		//		return a
		//	}}))
	} else {
		logger = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))
	}
	slog.SetDefault(logger)
	if os.Getenv("DEBUG") == "1" {
		logLevel.Set(slog.LevelDebug)
	}
	// We initialize our wrapper instance first, so we can call its methods in the 'Before' lambda func
	// in initialization of cli App instance.
	// signer will be set in the initClients method.
	appConfig := &RetiApp{logger: logger}

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
func (ac *RetiApp) initClients(_ context.Context, cmd *cli.Command) error {
	network := cmd.Value("network").(string)

	// quick validity check on possible network names...
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

	// Now load .env.{network} overrides -ie: .env.sandbox containing generated mnemonics
	// by bootstrap testing script
	misc.LoadEnvForNetwork(network)

	// Initialize algod client / networks / reti validator app id (testing connectivity as well)
	cfg := algo.GetNetworkConfig(network)
	algoClient, err = algo.GetAlgoClient(ac.logger, cfg)
	if err != nil {
		return err
	}
	ac.retiAppID = cfg.RetiAppID
	if ac.retiAppID == 0 {
		// allow secondary override (and apologize as this is getting a bit spaghetti) of app id via
		// the network sepcific .env file we just loaded.
		if idStr := os.Getenv("RETI_APPID"); idStr != "" {
			ac.retiAppID, err = strconv.ParseUint(idStr, 10, 64)
			if err != nil {
				return err
			}
		}
	}
	if ac.retiAppID == 0 {
		return fmt.Errorf("the ID of the Reti Validator contract must be set using either -id or RETI_APPID env var!")
	}

	// This will load and initialize mnemonics from the environment - and handles all 'local' signing for the app
	ac.signer = algo.NewLocalKeyStore(ac.logger)

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
