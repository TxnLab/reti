/*
 * Copyright (c) 2022. TxnLab Inc.
 * All Rights reserved.
 */
package misc

import (
	"os"
	"strings"
)

var secretsMap = map[string]string{}

func SecretKeys() []string {
	var uniqKeys = map[string]bool{}
	for _, envVal := range os.Environ() {
		key := envVal[0:strings.IndexByte(envVal, '=')]
		uniqKeys[key] = true
	}
	for k, _ := range secretsMap {
		uniqKeys[k] = true
	}
	var retStrings []string
	for k, _ := range uniqKeys {
		retStrings = append(retStrings, k)
	}
	return retStrings
}

func GetSecret(key string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return secretsMap[key]
}
