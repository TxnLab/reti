package main

import (
	"log/slog"
	"os"

	"github.com/TxnLab/reti/internal/lib/misc"
)

func main() {
	app := initApp()

	misc.LoadEnvironmentSettings()
	err := app.Run(os.Args)
	if err != nil {
		slog.Error("Error", "msg", err)
	}
}
