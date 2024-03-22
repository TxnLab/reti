package misc

import (
	"github.com/joho/godotenv"
)

func LoadEnvSettings() {
	godotenv.Load(".env.local")
	godotenv.Load() // .env
}

func LoadEnvForNetwork(network string) {
	godotenv.Load(".env." + network)
}
