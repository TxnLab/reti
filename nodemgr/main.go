package main

import (
	"log/slog"
	"os"

	"github.com/urfave/cli/v2"

	"github.com/TxnLab/reti/internal/lib/misc"
	"github.com/TxnLab/reti/internal/service"
	"github.com/TxnLab/reti/internal/validator"
)

func main() {
	app := initAppOptions()

	misc.LoadEnvironmentSettings()
	err := app.Run(os.Args)
	if err != nil {
		slog.Error("Error", "msg", err)
	}
}

func initAppOptions() *cli.App {
	return &cli.App{
		Name:    "réti node manager",
		Usage:   "Configuration tool as well as Validator pool / participation key manager service",
		Version: misc.GetVersionInfo(),
		Commands: []*cli.Command{
			service.GetDaemonCmdOpts(),
			validator.GetValidatorCmdOpts(),
		},
	}
}

//func initSigner(sender string) *algo.MultipleWalletSigner{
//	signer := algo.NewLocalKeyStore(logger)
//	if sender == "" {
//		flag.Usage()
//		log.Fatalln("You must specify a sender account!")
//	}
//	if !signer.HasAccount(sender) {
//		log.Fatalf("The sender account:%s has no mnemonics specified.", sender)
//	}
//	return signer
//}
//
//func initClients(network string) {
//	cfg := algo.GetNetworkConfig(network)
//	var err error
//	algoClient, err = algo.GetAlgoClient(logger, cfg, maxSimultaneousSends)
//	if err != nil {
//		log.Fatalln(err)
//	}
//	nfdApiCfg := nfdapi.NewConfiguration()
//	nfdApiCfg.BasePath = cfg.NFDAPIUrl
//	api = nfdapi.NewAPIClient(nfdApiCfg)
//}
//
