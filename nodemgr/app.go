package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"os"
	"strconv"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/algod"
	"github.com/joho/godotenv"
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
			misc.MinimalHandlerOptions{SlogOpts: slog.HandlerOptions{Level: logLevel, AddSource: true}}))

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
		logger = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel, AddSource: true}))
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
				Name:    "envfile",
				Usage:   "env file to load",
				Sources: cli.EnvVars("RETI_ENVFILE"),
				Aliases: []string{"e"},
				Action:  loadNamedEnvFile,
			},
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
				OnlyOnce:    true,
			},
			&cli.UintFlag{
				Name:        "validator",
				Usage:       "The Validator ID for your validator.  Can be unset if defining for first time.",
				Sources:     cli.EnvVars("RETI_VALIDATORID"),
				Value:       0,
				Destination: &appConfig.retiValidatorID,
				OnlyOnce:    true,
			},
			&cli.UintFlag{
				Name:        "node",
				Usage:       "The node number (1+) this node represents in those configured for this validator. Configuration is updated/configured based on this node",
				Sources:     cli.EnvVars("RETI_NODENUM"),
				Value:       0,
				Destination: &appConfig.retiNodeNum,
				OnlyOnce:    true,
			},
		},
		Commands: []*cli.Command{
			GetDaemonCmdOpts(),
			GetValidatorCmdOpts(),
			GetPoolCmdOpts(),
			GetKeyCmdOpts(),
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
	retiAppID       uint64
	retiValidatorID uint64
	retiNodeNum     uint64
}

// initClients initializes both an an algod client (to correct network - which it
// also validates) and an nfd nfdApi clinet - for nfd updates or fetches if caller
// desires
func (ac *RetiApp) initClients(ctx context.Context, cmd *cli.Command) error {
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
	// allow secondary override of the IDs via the network specific .env file we just loaded which we couldn't
	// have known until we'd processed the 'network' override - but only if not already set via CLI, etc.
	if ac.retiAppID == 0 {
		setIntFromEnv(&ac.retiAppID, "RETI_APPID")
	}
	if ac.retiValidatorID == 0 {
		setIntFromEnv(&ac.retiValidatorID, "RETI_VALIDATORID")
	}
	if ac.retiNodeNum == 0 {
		setIntFromEnv(&ac.retiNodeNum, "RETI_NODENUM")
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
	retiClient, err := reti.New(ac.retiAppID, ac.logger, ac.algoClient, ac.signer, ac.retiValidatorID, ac.retiNodeNum)
	if err != nil {
		return err
	}
	ac.retiClient = retiClient
	return retiClient.LoadState(ctx)
}

func setIntFromEnv(val *uint64, envName string) error {
	if strVal := os.Getenv("envName"); strVal != "" {
		intVal, err := strconv.ParseUint(strVal, 10, 64)
		if err != nil {
			return err
		}
		*val = intVal
	}
	return nil
}

func checkConfigured(ctx context.Context, command *cli.Command) error {
	if !App.retiClient.IsConfigured() {
		return errors.New("validator not configured")
	}
	return nil
}

func loadNamedEnvFile(ctx context.Context, command *cli.Command, envFile string) error {
	misc.Infof(App.logger, "loading env file:%s", envFile)
	return godotenv.Load(envFile)
}
