package main

import (
	"context"
	"log/slog"
	"os"
)

var App *RetiApp

func main() {
	App = initApp()
	err := App.cliCmd.Run(context.Background(), os.Args)
	if err != nil {
		slog.Error("Error in execution:", "msg", err)
		os.Exit(1)
	}
}
