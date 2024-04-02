package algo

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"log/slog"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/algod"
	"github.com/algorand/go-algorand-sdk/v2/client/v2/common/models"
	"github.com/algorand/go-algorand-sdk/v2/encoding/msgpack"
	"github.com/algorand/go-algorand-sdk/v2/transaction"
	"github.com/algorand/go-algorand-sdk/v2/types"
)

// DecodeAndSignNFDTransactions decodes and signs transactions that came from an NFD API for user signing, signing each
// transaction which needs signed using the given signer
func DecodeAndSignNFDTransactions(nfdnTxnResponse string, signer MultipleWalletSigner) (string, []byte, error) {
	type TxnPair [2]string
	var (
		txns       []TxnPair
		err        error
		resp       []byte
		firstTxnId string
	)

	// First trim/unquote the string.
	err = json.Unmarshal([]byte(nfdnTxnResponse), &txns)
	if err != nil {
		return "", nil, err
	}
	for i, txn := range txns {
		rawBytes, err := base64.StdEncoding.DecodeString(txn[1])
		if err != nil {
			log.Fatal("Error decoding txn:", i, " error:", err)
		}
		txnId, bytes, err := decodeAndSignTransaction(signer, txn[0], rawBytes)
		if err != nil {
			return "", nil, err
		}
		resp = append(resp, bytes...)
		if i == 0 {
			firstTxnId = txnId
		}
	}
	return firstTxnId, resp, nil
}

func decodeAndSignTransaction(signer MultipleWalletSigner, txnType string, msgPackBytes []byte) (string, []byte, error) {
	var (
		uTxn types.Transaction
	)

	if txnType == "s" {
		// Already a signed txn
		return "", msgPackBytes, nil
	}
	dec := msgpack.NewDecoder(bytes.NewReader(msgPackBytes))
	err := dec.Decode(&uTxn)
	if err != nil {
		return "", nil, fmt.Errorf("error in unmarshalling, error: %w", err)
	}
	txnid, bytes, err := signer.SignWithAccount(context.Background(), uTxn, uTxn.Sender.String())
	if err != nil {
		return "", nil, fmt.Errorf("error signing txn for sender:%s, error: %w", uTxn.Sender.String(), err)
	}
	return txnid, bytes, nil
}

func sendAndWaitTxns(ctx context.Context, log *slog.Logger, algoClient *algod.Client, txnBytes []byte) (models.PendingTransactionInfoResponse, error) {
	txid, err := algoClient.SendRawTransaction(txnBytes).Do(ctx)
	if err != nil {
		return models.PendingTransactionInfoResponse{}, fmt.Errorf("sendAndWaitTxns failed to send txns: %w", err)
	}
	log.Info("sendAndWaitTxns", "txid", txid)
	resp, err := transaction.WaitForConfirmation(algoClient, txid, 100, ctx)
	if err != nil {
		return models.PendingTransactionInfoResponse{}, fmt.Errorf("sendAndWaitTxns failure in confirmation wait: %w", err)
	}
	log.Info("sendAndWaitTxns", "confirmed-round", resp.ConfirmedRound)
	return resp, nil
}
