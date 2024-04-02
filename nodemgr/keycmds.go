package main

import (
	"context"
	"encoding/base64"
	"fmt"

	"github.com/algorand/go-algorand-sdk/v2/crypto"
	"github.com/algorand/go-algorand-sdk/v2/types"
	"github.com/urfave/cli/v3"

	"github.com/TxnLab/reti/internal/lib/algo"
)

func GetKeyCmdOpts() *cli.Command {
	return &cli.Command{
		Name:    "key",
		Aliases: []string{"k"},
		Usage:   "Participation key related commands",
		Before:  checkConfigured,
		Commands: []*cli.Command{
			{
				Name:    "list",
				Aliases: []string{"l"},
				Usage:   "List part keys on this node",
				Action:  KeysList,
				Flags: []cli.Flag{
					&cli.BoolFlag{
						Name:  "all",
						Usage: "Show ALL pools for this validator not just for this node",
						Value: false,
					},
				},
			},
		},
	}
}

func KeysList(ctx context.Context, command *cli.Command) error {
	partKeys, err := algo.GetParticipationKeys(ctx, App.algoClient)
	if err != nil {
		return err
	}
	for _, poolAppID := range App.retiClient.Info().LocalPools {
		addr := crypto.GetApplicationAddress(poolAppID)
		for account, keys := range partKeys {
			if !command.Bool("all") && addr.String() != account {
				continue
			}
			for _, key := range keys {
				selkey, _ := types.EncodeAddress(key.Key.SelectionParticipationKey)
				stproofKey := base64.StdEncoding.EncodeToString(key.Key.StateProofKey)
				votekey, _ := types.EncodeAddress(key.Key.VoteParticipationKey)
				fmt.Println("id:", key.Id)
				fmt.Println("Address:", key.Address)
				fmt.Println("Vote First Valid:", key.Key.VoteFirstValid)
				fmt.Println("Vote Last Valid:", key.Key.VoteLastValid)
				fmt.Println("Effective First Valid:", key.EffectiveFirstValid)
				fmt.Println("Effective Last Valid:", key.EffectiveLastValid)
				fmt.Println("Vote Key Dilution:", key.Key.VoteKeyDilution)
				fmt.Println("Selection Participation Key:", selkey)
				fmt.Println("state Proof Key:", stproofKey)
				fmt.Println("Vote Participation Key:", votekey)
				fmt.Println("Last Vote:", key.LastVote)
				fmt.Println("Last Block Proposal:", key.LastBlockProposal)
				fmt.Println()
			}
		}
	}
	return nil
}
