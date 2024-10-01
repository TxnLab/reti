package nfdonchain

import (
	"context"
	"fmt"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/algod"
)

type NfdApi struct {
	algoClient    *algod.Client
	registryAppID uint64
}

func NewNfdApi(algoClient *algod.Client, network string) (*NfdApi, error) {
	var appId uint64

	switch network {
	case "fnet":
		appId = 0 // nfds aren't deployed on fnet
	case "betanet":
		appId = 842656530
	case "testnet":
		appId = 84366825
	case "mainnet":
		appId = 760937186
	default:
		return nil, fmt.Errorf("invalid network:%s for nfd api", network)
	}
	return &NfdApi{algoClient: algoClient, registryAppID: appId}, nil
}

type NFDProperties struct {
	Internal    map[string]string `json:"internal"`
	UserDefined map[string]string `json:"userDefined"`
	Verified    map[string]string `json:"verified"`
}

// GetNFD retrieves the properties of an NFD by its application ID.
// if fullFetch is true, all user-defined and verified properties are fetched, otherwise only internal properties
// are fetched.
func (n *NfdApi) GetNFD(ctx context.Context, appID uint64, fullFetch bool) (NFDProperties, error) {
	// Load the global state of this NFD
	appData, err := n.algoClient.GetApplicationByID(appID).Do(ctx)
	if err != nil {
		return NFDProperties{}, err
	}
	var boxData map[string][]byte
	if fullFetch {
		// Now load all the box data (V2) in parallel
		boxData, err = n.getApplicationBoxes(ctx, appID)
		if err != nil {
			return NFDProperties{}, err
		}
	}
	// Fetch everything into key/value map...
	properties := fetchAllStateAsNFDProperties(appData.Params.GlobalState, boxData)
	// ...then merge properties like bio_00, bio_01, into 'bio'
	properties.UserDefined = mergeNFDProperties(properties.UserDefined)

	return properties, nil
}
