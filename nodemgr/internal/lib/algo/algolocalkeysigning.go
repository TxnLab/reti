/*
 * Copyright (c) 2022. TxnLab Inc.
 * All Rights reserved.
 */

package algo

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"golang.org/x/crypto/ed25519"

	"github.com/algorand/go-algorand-sdk/v2/crypto"
	"github.com/algorand/go-algorand-sdk/v2/mnemonic"
	"github.com/algorand/go-algorand-sdk/v2/types"

	"github.com/TxnLab/reti/internal/lib/misc"
)

func NewLocalKeyStore(log *slog.Logger) MultipleWalletSigner {
	keyStore := &localKeyStore{
		log:  log,
		keys: map[string]ed25519.PrivateKey{},
	}
	keyStore.loadFromEnvironment()
	return keyStore
}

type localKeyStore struct {
	log *slog.Logger

	keys map[string]ed25519.PrivateKey
}

func (lk *localKeyStore) HasAccount(publicAddress string) bool {
	_, found := lk.keys[publicAddress]
	return found
}

func (lk *localKeyStore) SignWithAccount(ctx context.Context, tx types.Transaction, publicAddress string) (string, []byte, error) {
	key, found := lk.keys[publicAddress]
	if !found {
		return "", nil, fmt.Errorf("key not found for address %s", publicAddress)
	}
	return crypto.SignTransaction(key, tx)
}

// loadFromEnvironment loads mnemonics from environment variables (can be in .env files as well) starting with "ALGO_MNEMONIC"
// and adds them to the localKeyStore's keys map. The number of loaded mnemonics is logged as well as the pks of each.
// If an error occurs while adding a mnemonic, a fatal error is logged and the application exits.
func (lk *localKeyStore) loadFromEnvironment() {
	var numMnemonics int
	for _, envVal := range os.Environ() {
		if !strings.HasPrefix(envVal, "ALGO_MNEMONIC") {
			continue
		}
		key := envVal[0:strings.IndexByte(envVal, '=')]
		envMnemonic := os.Getenv(key)
		if envMnemonic == "" {
			break
		}
		if err := lk.addMnemonic(envMnemonic); err != nil {
			lk.log.Error(fmt.Sprintf("fatal error in envMnemonic load, idx key:%s, err:%v", key, err))
			os.Exit(1)
		}
		numMnemonics++
	}
	misc.Infof(lk.log, "loaded %d mnemonics", numMnemonics)
}

func (lk *localKeyStore) addMnemonic(mnemonicPhrase string) error {
	key, err := mnemonic.ToPrivateKey(mnemonicPhrase)
	if err != nil {
		return fmt.Errorf("failed to add mnemonic: %w", err)
	}
	account, err := crypto.AccountFromPrivateKey(key)
	if err != nil {
		return fmt.Errorf("failed to add mnemonic: %w", err)
	}
	lk.keys[account.Address.String()] = key
	misc.Infof(lk.log, "Added data for pk:%s", account.Address.String())
	return nil
}
