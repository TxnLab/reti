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

func (n NetworkConfig) String() string {
	return fmt.Sprintf("NodeDataDir: %s, NFDAPIUrl: %s, NodeURL: %s, NodeToken: (length:%d), NodeHeaders: %v, RetiAppID: %d", n.NodeDataDir, n.NFDAPIUrl, n.NodeURL, len(n.NodeToken), n.NodeHeaders, n.RetiAppID)
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
	// ALGO_ALGOD_ADMIN_TOKEN is what we assume users will use, so it takes precedence for the node token
	// (which is required to be an admin token)
	if token := misc.GetSecret("ALGO_ALGOD_ADMIN_TOKEN"); token != "" {
		cfg.NodeToken = token
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
		cfg.RetiAppID = 673404372
		cfg.NFDAPIUrl = "https://api.testnet.nf.domains"
		cfg.NodeURL = "https://testnet-api.algonode.cloud"
	case "betanet":
		cfg.RetiAppID = 2019373722
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
		cfg.NFDAPIUrl = "https://api.nf.domains"
		cfg.NodeURL = "https://testnet-api.voi.nodely.io"
	}
	return cfg
}

// GetNetAndTokenFromFiles reads the address and token from files in the local Algorand data directory.
// It takes two parameters: netFile (file path of the address file) and tokenFile (file path of the token file).
// It returns apiURL (the API URL), apiToken (the API token), and an error (if any).
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
