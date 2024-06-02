package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"os"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"

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
	} else {
		// not on console - output as json, but change json key names to be more compatibl w/ what google logging
		// expects
		opts := &slog.HandlerOptions{
			AddSource: true,
			Level:     logLevel,
			ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
				if a.Key == slog.MessageKey {
					a.Key = "message"
				} else if a.Key == slog.LevelKey && len(groups) == 0 {
					a.Key = "severity"
				}
				return a
			},
		}
		logger = slog.New(slog.NewJSONHandler(os.Stdout, opts))
	}
	slog.SetDefault(logger)
	if os.Getenv("DEBUG") == "1" {
		logLevel.Set(slog.LevelDebug)
	}

	misc.LoadEnvSettings(logger)

	// We initialize our wrapper instance first, so we can call its methods in the 'Before' lambda func
	// in initialization of cli App instance.
	// signer will be set in the initClients method.
	appConfig := &RetiApp{logger: logger}

	appConfig.cliCmd = &cli.Command{
		Name:    "réti node manager",
		Usage:   "Configuration tool and background daemon for Algorand validator pools",
		Version: getVersionInfo(),
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
			},
			&cli.StringFlag{
				Name:    "network",
				Usage:   "Algorand network to use",
				Value:   "mainnet",
				Aliases: []string{"n"},
				Sources: cli.EnvVars("ALGO_NETWORK"),
			},
			&cli.UintFlag{
				Name:        "retiid",
				Usage:       "[DEV ONLY] The application id of the Reti master validator contract.",
				Sources:     cli.EnvVars("RETI_APPID"),
				Destination: &appConfig.retiAppID,
				OnlyOnce:    true,
			},
			&cli.UintFlag{
				Name:        "validator",
				Usage:       "The Validator id for your validator.  Can be unset if defining for first time.",
				Sources:     cli.EnvVars("RETI_VALIDATORID"),
				Value:       0,
				Destination: &appConfig.retiValidatorID,
				OnlyOnce:    true,
			},
			&cli.BoolFlag{
				Name:  "usehostname",
				Usage: "Use the hostname (assuming -0, -1, -2, etc. suffix) as node number.  For use when paired w/ Kubernetes statefulsets",
				Value: false,
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
// also validates) and an nfd nfdApi client - for nfd updates or fetches if caller
// desires
func (ac *RetiApp) initClients(ctx context.Context, cmd *cli.Command) error {
	network := cmd.String("network")

	if envfile := cmd.String("envfile"); envfile != "" {
		err := loadNamedEnvFile(ctx, envfile)
		if err != nil {
			return err
		}
	}
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
	misc.LoadEnvForNetwork(ac.logger, network)

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
	if ac.retiNodeNum == 0 && cmd.Bool("usehostname") {
		// we're assumed in kubernetes environment, try getting the node number from our hostname suffix
		// ie: somehost-0 - where the node num would be 0 (and we add 1)
		if hostname, err := os.Hostname(); err == nil {
			parts := strings.Split(hostname, "-")
			if len(parts) > 1 {
				nodeNum, err := strconv.ParseUint(parts[len(parts)-1], 10, 64)
				if err == nil {
					ac.retiNodeNum = nodeNum + 1
					misc.Infof(ac.logger, "used hostname %s to set node number to:%d", hostname, ac.retiNodeNum)
				}
			}
		}
	}

	if ac.retiAppID == 0 {
		return fmt.Errorf("the id of the Reti Validator contract must be set using either -id or RETI_APPID env var!")
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
	if strVal := os.Getenv(envName); strVal != "" {
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

func loadNamedEnvFile(ctx context.Context, envFile string) error {
	misc.Infof(App.logger, "loading env file:%s", envFile)
	return godotenv.Load(envFile)
}

// Version is replaced at build time during docker builds w/ 'release' version
// If not defined, we just return the git rev.
var Version string

func getVersionInfo() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "The version information could not be determined"
	}
	var vcsRev = "(unknown)"
	if fnd := slices.IndexFunc(info.Settings, func(v debug.BuildSetting) bool { return v.Key == "vcs.revision" }); fnd != -1 {
		vcsRev = info.Settings[fnd].Value[0:7]
	}
	if Version != "" {
		return fmt.Sprintf("%s [%s]", Version, vcsRev)
	}
	return vcsRev
}
