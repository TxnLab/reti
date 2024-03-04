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
		SelectionParticipationKey string `json:"selection-participation-key"`
		StateProofKey             string `json:"state-proof-key"`
		VoteFirstValid            uint64 `json:"vote-first-valid"`
		VoteKeyDilution           uint64 `json:"vote-key-dilution"`
		VoteLastValid             uint64 `json:"vote-last-valid"`
		VoteParticipationKey      string `json:"vote-participation-key"`
	} `json:"key"`
	LastBlockProposal uint64 `json:"last-block-proposal"`
	LastVote          uint64 `json:"last-vote"`
}

func GetParticipationKeys(ctx context.Context, algoClient *algod.Client) ([]ParticipationKey, error) {
	var response []ParticipationKey

	err := (*common.Client)(algoClient).Get(ctx, &response, fmt.Sprintf("/v2/participation"), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("unable to get participation keys")
	}
	return response, nil
}

type GenerateParticipationKeysParams struct {
	// Dilution Key dilution for two-level participation keys (defaults to sqrt of validity window).
	//Dilution *uint64 `form:"dilution,omitempty" json:"dilution,omitempty"`

	// First First round for participation key.
	First uint64 `form:"first" url:"first" json:"first"`

	// Last Last round for participation key.
	Last uint64 `form:"last" url:"last" json:"last"`
}

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
			for _, key := range partKeys {
				if key.Address == account && key.Key.VoteFirstValid == firstValid {
					// this is our key - we're good, it's been successfully created !
					misc.Infof(logger, "Participation key generated for account:%s, first valid:%d", account, firstValid)
					return &key, nil
				}
			}
		case <-time.After(30 * time.Minute):
			misc.Errorf(logger, "something went wrong - 30 minutes and no key was generated for:%s - aborting", account)
			return nil, fmt.Errorf("something went wrong - 30 minutes and no key was generated for:%s - aborting", account)
		}
	}
}
