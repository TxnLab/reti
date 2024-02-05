/*
 * Copyright (c) 2021. TxnLab Inc.
 * All Rights reserved.
 */

package algo

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"

	"golang.org/x/crypto/ed25519"

	"github.com/algorand/go-algorand-sdk/v2/crypto"
	"github.com/algorand/go-algorand-sdk/v2/encoding/msgpack"
	"github.com/algorand/go-algorand-sdk/v2/transaction"
	"github.com/algorand/go-algorand-sdk/v2/types"

	"github.com/TxnLab/reti/internal/lib/misc"
)

type TxnSigner interface {
	// SignTxn signs the specified transaction, returning Transaction ID, signed transaction bytes, and error
	SignTxn(ctx context.Context, tx types.Transaction) (string, []byte, error)
}

type MultipleWalletSigner interface {
	HasAccount(publicAddress string) bool
	SignWithAccount(ctx context.Context, tx types.Transaction, publicAddress string) (string, []byte, error)
}

// SignGroupTransactions takes the slice of Transactions and of TxnSigner implementations and signs each according to the
// matching TxnSigner implementation for each transaction.
func SignGroupTransactions(ctx context.Context, txns []types.Transaction, signers []TxnSigner) ([]byte, []string, error) {
	var (
		txIDs []string
		gid   types.Digest
		err   error
	)
	if len(txns) != len(signers) {
		return nil, nil, fmt.Errorf("number of transactions (%d) does not match number of signers (%d)", len(txns), len(signers))
	}
	// now we have to compose the group transactions [if more than 1 transaction]
	if len(txns) > 1 {
		gid, err = crypto.ComputeGroupID(txns)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to compute group ID: %w", err)
		}
	}
	var signedTxns []byte
	for i, txn := range txns {
		if len(txns) > 1 {
			txn.Group = gid
		}

		txid, bytes, err := signers[i].SignTxn(ctx, txn)
		if err != nil {
			return nil, nil, fmt.Errorf("error signing txn %d: %w", i, err) // TOOD - get better txn printer
		}
		signedTxns = append(signedTxns, bytes...)
		txIDs = append(txIDs, txid)
	}
	return signedTxns, txIDs, nil
}

// SignGroupTransactionsForFrontend takes the slice of Transactions and of TxnSigner implementations and signs each according to the
// matching TxnSigner implementation for each transaction - returning as a json array of base64 encoded strings
func SignGroupTransactionsForFrontend(ctx context.Context, log *slog.Logger, txns []types.Transaction, signers []TxnSigner) ([]byte, error) {
	var (
		txIDs    []string
		gid      types.Digest
		err      error
		jsonResp [][]string
	)

	if len(txns) == 0 {
		// Return 'empty' json array - nothing to sign...
		return []byte("[]"), nil
	}
	// now we have to compose the group transactions [if more than 1 transaction]
	if len(txns) > 1 {
		gid, err = crypto.ComputeGroupID(txns)
		if err != nil {
			return nil, fmt.Errorf("failed to compute group ID: %w", err)
		}
	}
	for i, txn := range txns {
		if len(txns) > 1 {
			txn.Group = gid
		}
		txID, bytes, err := signers[i].SignTxn(ctx, txn)
		if err != nil {
			return nil, fmt.Errorf("error signing txn %d: %w", i, err) // TOOD - get better txn printer
		}
		var signType = "s"
		if _, isUnsigned := signers[i].(*noSigner); isUnsigned {
			signType = "u"
		}
		txnTuple := []string{signType, base64.StdEncoding.EncodeToString(bytes)}
		jsonResp = append(jsonResp, txnTuple)
		txIDs = append(txIDs, txID)
	}
	misc.Infof(log, "SignGroupTransactionsForFrontend: txids:%#v", txIDs)

	return json.Marshal(jsonResp)
}

func SignByUser(signers []TxnSigner) []TxnSigner {
	return append(signers, &noSigner{})
}

func SignWithKey(signers []TxnSigner, privateKey ed25519.PrivateKey) []TxnSigner {
	return append(signers, &skSigner{
		sk: privateKey,
	})
}

func SignWithAccountForATC(keyManager MultipleWalletSigner, publicAddress string) transaction.TransactionSigner {
	return &kmdSigner{
		keyManager: keyManager,
		address:    publicAddress,
	}
}

func SignWithAccount(signers []TxnSigner, keyManager MultipleWalletSigner, publicAddress string) []TxnSigner {
	return append(signers, &kmdSigner{
		keyManager: keyManager,
		address:    publicAddress,
	})
}

func SignWithLogicSig(signers []TxnSigner, logicSigAccount crypto.LogicSigAccount) []TxnSigner {
	return append(signers, &logicSigSigner{
		logicSigAccount: logicSigAccount,
	})
}

type noSigner struct{}

func (n *noSigner) SignTxn(ctx context.Context, tx types.Transaction) (string, []byte, error) {
	return crypto.GetTxID(tx), msgpack.Encode(tx), nil
}

type skSigner struct {
	sk ed25519.PrivateKey
}

func (s *skSigner) SignTxn(ctx context.Context, tx types.Transaction) (string, []byte, error) {
	return crypto.SignTransaction(s.sk, tx)
}

type kmdSigner struct {
	keyManager MultipleWalletSigner
	address    string
}

func (k *kmdSigner) SignTxn(ctx context.Context, tx types.Transaction) (string, []byte, error) {
	return k.keyManager.SignWithAccount(ctx, tx, k.address)
}

func (k *kmdSigner) SignTransactions(txGroup []types.Transaction, indexesToSign []int) ([][]byte, error) {
	stxs := make([][]byte, len(indexesToSign))
	for i, pos := range indexesToSign {
		_, stxBytes, err := k.keyManager.SignWithAccount(context.Background(), txGroup[pos], k.address)
		if err != nil {
			return nil, err
		}

		stxs[i] = stxBytes
	}

	return stxs, nil
}

func (k *kmdSigner) Equals(other transaction.TransactionSigner) bool {
	if castedSigner, ok := other.(*kmdSigner); ok {
		return castedSigner.address == k.address
	}
	return false
}

type logicSigSigner struct {
	logicSigAccount crypto.LogicSigAccount
}

func (l *logicSigSigner) SignTxn(_ context.Context, tx types.Transaction) (string, []byte, error) {
	return crypto.SignLogicSigAccountTransaction(l.logicSigAccount, tx)
}
