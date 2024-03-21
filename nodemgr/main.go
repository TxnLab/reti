package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/TxnLab/reti/internal/lib/misc"
)

var App *RetiApp

func main() {
	App = initApp()

	misc.LoadEnvSettings()
	err := App.cliCmd.Run(context.Background(), os.Args)
	if err != nil {
		slog.Error("Error in execution:", "msg", err)
		os.Exit(1)
	}
}
