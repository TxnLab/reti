package algo

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/algod"
	"github.com/algorand/go-algorand-sdk/v2/client/v2/common"

	"github.com/TxnLab/reti/internal/lib/misc"
)

type ParticipationKey struct {
	Address             string `json:"address"`
	EffectiveFirstValid uint64 `json:"effective-first-valid"`
	EffectiveLastValid  uint64 `json:"effective-last-valid"`
	Id                  string `json:"id"`
	Key                 struct {
		SelectionParticipationKey []byte `json:"selection-participation-key"`
		StateProofKey             []byte `json:"state-proof-key"`
		VoteFirstValid            uint64 `json:"vote-first-valid"`
		VoteKeyDilution           uint64 `json:"vote-key-dilution"`
		VoteLastValid             uint64 `json:"vote-last-valid"`
		VoteParticipationKey      []byte `json:"vote-participation-key"`
	} `json:"key"`
	LastBlockProposal uint64 `json:"last-block-proposal"`
	LastVote          uint64 `json:"last-vote"`
}

type PartKeysByAddress map[string][]ParticipationKey

func GetParticipationKeys(ctx context.Context, algoClient *algod.Client) (PartKeysByAddress, error) {
	var response []ParticipationKey

	err := (*common.Client)(algoClient).Get(ctx, &response, fmt.Sprintf("/v2/participation"), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("unable to get participation keys")
	}
	// collate and return the ParticipationKey slice into a map by 'Address' within the ParticipationKey
	participationKeys := PartKeysByAddress{}
	for _, key := range response {
		// decode the base64 values
		//vpk, _ := base64.StdEncoding.DecodeString(key.Key.VoteParticipationKey)
		//selpk, _ := base64.StdEncoding.DecodeString(key.Key.SelectionParticipationKey)
		//stproofk, _ := base64.StdEncoding.DecodeString(key.Key.StateProofKey)
		//key.Key.VoteParticipationKey = string(vpk)
		//key.Key.SelectionParticipationKey = string(selpk)
		//key.Key.StateProofKey = string(stproofk)

		participationKeys[key.Address] = append(participationKeys[key.Address], key)
	}
	return participationKeys, nil
}

type GenerateParticipationKeysParams struct {
	// Dilution Key dilution for two-level participation keys (defaults to sqrt of validity window).
	//Dilution *uint64 `form:"dilution,omitempty" json:"dilution,omitempty"`

	// First First round for participation key.
	First uint64 `form:"first" url:"first" json:"first"`

	// Last Last round for participation key.
	Last uint64 `form:"last" url:"last" json:"last"`
}

// GenerateParticipationKey generates a participation key for an account within a specific validity window.
// It sends a POST request to the Algorand node API to generate the participation key.
// After the request is sent, it polls the node every 10 seconds to check if the key has been generated.
// If the key is successfully generated, it returns the participation key.
// If the key is not generated within 30 minutes, it returns an error.
func GenerateParticipationKey(ctx context.Context, algoClient *algod.Client, logger *slog.Logger, account string, firstValid, lastValid uint64) (*ParticipationKey, error) {
	var response struct{}
	var params = GenerateParticipationKeysParams{
		First: firstValid,
		Last:  lastValid,
	}

	misc.Infof(logger, "generating part key for account:%s, first/last valid of %d - %d", account, firstValid, lastValid)
	err := (*common.Client)(algoClient).Post(ctx, &response, fmt.Sprintf("/v2/participation/generate/%s", account), params, nil, nil)
	if err != nil {
		return nil, fmt.Errorf("error generating participation key for account:%s, err:%w", account, err)
	}
	// now we poll, waiting for the key to be generated
	for {
		select {
		case <-ctx.Done():
			return nil, context.Canceled
		case <-time.After(10 * time.Second):
			// poll every 10 seconds checking to see if key has been generated
			partKeys, err := GetParticipationKeys(ctx, algoClient)
			if err != nil {
				return nil, fmt.Errorf("unable to get part keys as part of polling after key generation request, err:%w", err)
			}
			for _, keys := range partKeys {
				for _, key := range keys {
					if key.Address == account && key.Key.VoteFirstValid == firstValid {
						// this is our key - we're good, it's been successfully created !
						misc.Infof(logger, "Participation key generated for account:%s, first valid:%d", account, firstValid)
						return &key, nil
					}
				}
			}
		case <-time.After(30 * time.Minute):
			misc.Errorf(logger, "something went wrong - 30 minutes and no key was generated for:%s - aborting", account)
			return nil, fmt.Errorf("something went wrong - 30 minutes and no key was generated for:%s - aborting", account)
		}
	}
}

func DeleteParticipationKey(ctx context.Context, algoClient *algod.Client, logger *slog.Logger, partKeyID string) error {
	var response string
	misc.Infof(logger, "delete part key id:%s", partKeyID)
	err := (*common.Client)(algoClient).Delete(ctx, &response, fmt.Sprintf("/v2/participation/%s", partKeyID), nil, nil)
	if err != nil {
		return fmt.Errorf("error delete participation key for id:%s, err:%w", partKeyID, err)
	}
	return nil
}
