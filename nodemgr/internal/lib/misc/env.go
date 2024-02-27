/*
 * Copyright (c) 2022. TxnLab Inc.
 * All Rights reserved.
 */

package misc

import (
	"fmt"

	"github.com/joho/godotenv"
)

func LoadEnvSettings() {
	godotenv.Load(".env.local")
	godotenv.Load() // .env
}

func LoadEnvForNetwork(network string) {
	godotenv.Load(fmt.Sprint(".env.%s", network))
}
