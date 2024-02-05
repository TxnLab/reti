/*
 * Copyright (c) 2022. TxnLab Inc.
 * All Rights reserved.
 */

package misc

import (
	"github.com/joho/godotenv"
)

func LoadEnvironmentSettings() {
	godotenv.Load(".env.local")
	godotenv.Load() // The Original .env
}
