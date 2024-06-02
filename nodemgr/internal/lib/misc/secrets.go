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

// GetSecret retrieves the value of a secret identified by the given key.
// If the secret is found in an environment variable, it returns the value.
// Otherwise, it return the value secretsMap if found.
// This abstraction is just an env abstraction at the moment but could easily
// be changed to fetch secrets other ways if necessary.
func GetSecret(key string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return secretsMap[key]
}
