package nfdonchain

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"

	"github.com/algorand/go-algorand-sdk/v2/types"
)

func (n *NfdApi) FindByName(ctx context.Context, nfdName string) (uint64, error) {
	// First try to resolve via V2
	boxValue, err := n.algoClient.GetApplicationBoxByName(n.registryAppID, getRegistryBoxNameForNFD(nfdName)).Do(ctx)
	if err == nil {
		// The box data is stored as
		// {ASA ID}{APP ID} - packed 64-bit ints
		if len(boxValue.Value) != 16 {
			return 0, fmt.Errorf("box data is invalid - length:%d but should be 16 for nfd name:%s", len(boxValue.Value), nfdName)
		}
		appID := binary.BigEndian.Uint64(boxValue.Value[8:])
		return appID, nil
	}
	// fall back to V1 approach
	nameLSIG, err := getNFDSigNameLSIG(nfdName, n.registryAppID)
	if err != nil {
		return 0, fmt.Errorf("failed to get nfd sig name lsig: %w", err)
	}
	// Read the local state for our registry SC from this specific account
	address, _ := nameLSIG.Address()
	account, err := n.algoClient.AccountApplicationInformation(address.String(), n.registryAppID).Do(ctx)
	if err != nil {
		return 0, fmt.Errorf("failed to get account data for account:%s : %w", address, err)
	}

	// We found our registry contract in the local state of the account
	nfdAppID, _ := fetchBToIFromState(account.AppLocalState.KeyValue, "i.appid")
	if nfdAppID == 0 {
		return 0, errors.New("no NFD found by that name")
	}
	fmt.Println("Found as V1 name")
	return nfdAppID, nil
}

func (n *NfdApi) FindByAddress(ctx context.Context, lookupAddress string) ([]uint64, error) {
	var nfdAppIDs []uint64
	// sanity check that this is valid address
	algoAddress, err := types.DecodeAddress(lookupAddress)
	if err != nil {
		return nil, err
	}

	// First try to resolve via V2
	boxValue, err := n.algoClient.GetApplicationBoxByName(n.registryAppID, getRegistryBoxNameForAddress(algoAddress)).Do(ctx)
	if err == nil {
		// Get the set of nfd app ids referenced by this address - we just grab the first for now
		nfdAppIDs, err = fetchUInt64sFromPackedValue(boxValue.Value)
		if err != nil {
			return nil, fmt.Errorf("box address lookup data is invalid, error: %w", err)
		}
	} else {
		// error should be 404 not found and checked, but but this is simple example, so... assume it's just not found
		// fall back to V1 approach
		revAddressLSIG, err := getNFDSigRevAddressLSIG(algoAddress, n.registryAppID)
		if err != nil {
			return nil, fmt.Errorf("failed to get nfd sig name lsig: %w", err)
		}
		// Read the local state for our registry SC from this specific account
		address, _ := revAddressLSIG.Address()
		account, err := n.algoClient.AccountApplicationInformation(address.String(), n.registryAppID).Do(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to get account data for account:%s : %w", address, err)
		}

		// We found our registry contract in the local state of the account
		for idx := 0; idx < 16; idx++ {
			thisKeyIDs, _ := fetchUint64sFromState(account.AppLocalState.KeyValue, fmt.Sprintf("i.apps%d", idx))
			if thisKeyIDs == nil {
				break
			}
			nfdAppIDs = append(nfdAppIDs, thisKeyIDs...)
		}
	}
	if len(nfdAppIDs) == 0 {
		return nil, fmt.Errorf("no NFDs found for this address")
	}
	return nfdAppIDs, nil
}
