package misc

import (
	"errors"
	"log/slog"
	"os"

	"github.com/joho/godotenv"
)

func LoadEnvSettings(log *slog.Logger) {
	loadEnvFile(log, ".env.local")
	loadEnvFile(log, ".env")
}

func LoadEnvForNetwork(log *slog.Logger, network string) {
	loadEnvFile(log, ".env."+network)
}

func loadEnvFile(log *slog.Logger, filename string) {
	err := godotenv.Load(filename)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		Warnf(log, "error loading %s, err: %v", filename, err)
	}
}
