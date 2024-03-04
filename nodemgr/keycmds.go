package main

import (
	"context"
	"fmt"

	"github.com/urfave/cli/v3"

	"github.com/TxnLab/reti/internal/lib/algo"
)

func GetKeyCmdOpts() *cli.Command {
	return &cli.Command{
		Name:    "key",
		Aliases: []string{"k"},
		Usage:   "Participation key related commands",
		Commands: []*cli.Command{
			{
				Name:    "list",
				Aliases: []string{"l"},
				Usage:   "List part keys on this node",
				Action:  KeysList,
			},
		},
	}
}

func KeysList(ctx context.Context, command *cli.Command) error {
	keys, err := algo.GetParticipationKeys(ctx, App.algoClient)
	if err != nil {
		return err
	}
	for _, key := range keys {
		fmt.Println("Address:", key.Address)
		fmt.Println("Effective First Valid:", key.EffectiveFirstValid)
		fmt.Println("Effective Last Valid:", key.EffectiveLastValid)
		fmt.Println("ID:", key.Id)
		fmt.Println("Selection Participation Key:", key.Key.SelectionParticipationKey)
		fmt.Println("State Proof Key:", key.Key.StateProofKey)
		fmt.Println("Vote First Valid:", key.Key.VoteFirstValid)
		fmt.Println("Vote Key Dilution:", key.Key.VoteKeyDilution)
		fmt.Println("Vote Last Valid:", key.Key.VoteLastValid)
		fmt.Println("Vote Participation Key:", key.Key.VoteParticipationKey)
		fmt.Println("Last Block Proposal:", key.LastBlockProposal)
		fmt.Println("Last Vote:", key.LastVote)
		fmt.Println()
	}
	return nil
}
