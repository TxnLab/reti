/*
 * Copyright (c) 2021. TxnLab Inc.
 * All Rights reserved.
 */

package algo

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/TxnLab/reti/internal/lib/misc"
)

type NetworkConfig struct {
	NodeDataDir string

	NFDAPIUrl string

	NodeURL     string
	NodeToken   string
	NodeHeaders map[string]string

	RetiAppID uint64
}

func GetNetworkConfig(network string) NetworkConfig {
	cfg := getDefaults(network)

	nodeDataDir := os.Getenv("ALGORAND_DATA")
	if nodeDataDir != "" {
		cfg.NodeDataDir = nodeDataDir
	}

	nfdAPIUrl := os.Getenv("ALGO_NFD_URL")
	if nfdAPIUrl != "" {
		cfg.NFDAPIUrl = nfdAPIUrl
	}

	if appIDEnv := os.Getenv("RETI_APPID"); appIDEnv != "" {
		cfg.RetiAppID, _ = strconv.ParseUint(appIDEnv, 10, 64)
	}

	nodeURL := misc.GetSecret("ALGO_ALGOD_URL")
	if nodeURL != "" {
		cfg.NodeURL = nodeURL
	}

	nodeToken := misc.GetSecret("ALGO_ALGOD_TOKEN")
	if nodeToken != "" {
		cfg.NodeToken = nodeToken
	}
	NodeHeaders := misc.GetSecret("ALGO_ALGOD_HEADERS")
	// parse NodeHeaders from key:value,[key:value...] pairs and put into cfg.NodeHeaders map
	cfg.NodeHeaders = map[string]string{}
	for _, header := range strings.Split(NodeHeaders, ",") {
		parts := strings.SplitN(header, ":", 2) // Just split on first : - they can have :'s in value.
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			value := strings.TrimSpace(parts[1])
			cfg.NodeHeaders[key] = value
		}
	}

	return cfg
}

func getDefaults(network string) NetworkConfig {
	cfg := NetworkConfig{}
	switch network {
	case "mainnet":
		cfg.RetiAppID = 0 // TODO
		cfg.NFDAPIUrl = "https://api.nf.domains"
		cfg.NodeURL = "https://mainnet-api.algonode.cloud"
	case "testnet":
		cfg.RetiAppID = 0 // TODO
		cfg.NFDAPIUrl = "https://api.testnet.nf.domains"
		cfg.NodeURL = "https://testnet-api.algonode.cloud"
	case "betanet":
		cfg.RetiAppID = 0 // TODO
		cfg.NFDAPIUrl = "https://api.betanet.nf.domains"
		cfg.NodeURL = "https://betanet-api.algonode.cloud"
	case "sandbox":
		cfg.RetiAppID = 0 // should come from .env.sandbox !!
		cfg.NFDAPIUrl = "https://api.testnet.nf.domains"
		cfg.NodeURL = "http://localhost:4001"
		cfg.NodeToken = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	//-----
	// VOI
	//-----
	case "voitestnet":
		//cfg.NFDAPIUrl = "https://api.betanet.nf.domains"
		cfg.NodeURL = "https://testnet-api.voi.nodely.io"
	}
	return cfg
}

// GetNetAndTokenFromFiles reads the address and token from the specified files in the local Algorand data directory.
//
// The function takes two arguments: netFile (string) and tokenFile (string), which represent the paths to the files.
// It returns the API URL (string), the API token (string), and any error encountered.
//
// Example usage:
//
//	apiURL, apiToken, err := GetNetAndTokenFromFiles("algod.net", "algod.token")
//
// The function internally uses os.ReadFile function to read the address and token files.
// It then trims any leading or trailing whitespace from the read contents and returns the cleaned values.
// If any error occurs during file reading, the function returns an empty string for both API URL and API token,
// along with an error indicating the specific file reading failure.
func GetNetAndTokenFromFiles(netFile, tokenFile string) (string, string, error) {
	// Read address and token from (local) algorand data directory
	netPath, err := os.ReadFile(netFile)
	if err != nil {
		return "", "", fmt.Errorf("error reading file: %s: %w", netFile, err)
	}
	apiKeyBytes, err := os.ReadFile(tokenFile)
	if err != nil {
		return "", "", fmt.Errorf("error reading file: %s: %w", tokenFile, err)
	}
	apiURL := fmt.Sprintf("http://%s", strings.TrimSpace(string(netPath)))
	apiToken := strings.TrimSpace(string(apiKeyBytes))
	return apiURL, apiToken, nil
}
