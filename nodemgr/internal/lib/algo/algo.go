package algo

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/algorand/go-algorand-sdk/v2/client/v2/algod"
	"github.com/algorand/go-algorand-sdk/v2/client/v2/common"
	"github.com/algorand/go-algorand-sdk/v2/client/v2/common/models"
	"github.com/algorand/go-algorand-sdk/v2/types"
	"github.com/ssgreg/repeat"

	"github.com/TxnLab/reti/internal/lib/misc"
)

// DefaultValidRoundRange - max valid round range to have transactions be valid for (and to check for confirmation)
const DefaultValidRoundRange = 100

func FormattedAlgoAmount(microAlgos uint64) string {
	return fmt.Sprintf("%.6f", types.MicroAlgos(microAlgos).ToAlgos())
}

func GetAlgoClient(log *slog.Logger, config NetworkConfig, maxConnections int) (*algod.Client, error) {
	var (
		apiURL     string
		apiToken   string
		apiHeaders []*common.Header
		serverAddr *url.URL
		err        error
	)
	if config.NodeDataDir != "" {
		// Read address and token from main-net directory
		apiURL, apiToken, err = GetNetAndTokenFromFiles(
			filepath.Join(config.NodeDataDir, "algod.net"),
			filepath.Join(config.NodeDataDir, "algod.token"))
		if err != nil {
			return nil, fmt.Errorf("error reading config: %w", err)
		}
	} else {
		apiURL = config.NodeURL
		apiToken = config.NodeToken
		// Convert config.NodeHeaders map into []*common.Header slice
		for key, value := range config.NodeHeaders {
			apiHeaders = append(apiHeaders, &common.Header{
				Key:   key,
				Value: value,
			})
		}
		// Strip off trailing slash if present in url which the Algorand client doesn't handle properly
		apiURL = strings.TrimRight(apiURL, "/")
	}
	serverAddr, err = url.Parse(apiURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse url:%v, error:%w", apiURL, err)
	}
	if serverAddr.Scheme == "tcp" {
		serverAddr.Scheme = "http"
	}
	misc.Infof(log, "Connecting to Algorand node at:%s", serverAddr.String())

	// Override the default transport so we can properly support multiple parallel connections to same
	// host (and allow connection resuse)
	customTransport := http.DefaultTransport.(*http.Transport).Clone()
	customTransport.MaxIdleConns = 100
	customTransport.MaxConnsPerHost = min(100, maxConnections)
	customTransport.MaxIdleConnsPerHost = 100
	client, err := algod.MakeClientWithTransport(serverAddr.String(), apiToken, apiHeaders, customTransport)
	if err != nil {
		return nil, fmt.Errorf(`failed to make algod client (url:%s), error:%w`, serverAddr.String(), err)
	}
	// Immediately hit server to verify connectivity
	_, err = client.SuggestedParams().Do(context.Background())
	if err != nil {
		return nil, fmt.Errorf("failed to get suggested params from algod client, error:%w", err)
	}
	return client, nil
}

func SuggestedParams(ctx context.Context, logger *slog.Logger, client *algod.Client) types.SuggestedParams {
	var (
		txParams types.SuggestedParams
		err      error
	)
	// don't accept no for an answer from this api ! just keep trying
	err = repeat.Repeat(
		repeat.Fn(func() error {
			txParams, err = client.SuggestedParams().Do(ctx)
			if err != nil {
				return repeat.HintTemporary(err)
			}
			return nil
		}),
		repeat.StopOnSuccess(),
		repeat.FnOnError(func(err error) error {
			misc.Infof(logger, "retrying suggestedparams call, error:%s", err.Error())
			return err
		}),
		repeat.WithDelay(repeat.ExponentialBackoff(1*time.Second).Set()),
	)

	// move FirstRoundValid back 1 just to cover for different nodes maybe being 'slightly' behind - so we
	// don't create a transaction starting at round 100 but the node we submit to is only at round 99
	txParams.FirstRoundValid--
	txParams.LastRoundValid = txParams.FirstRoundValid + DefaultValidRoundRange
	// Just set fixed fee for now - we don't want to send during high cost periods anyway.
	txParams.FlatFee = true
	txParams.Fee = types.MicroAlgos(txParams.MinFee)
	return txParams
}

type AccountWithMinBalance struct {
	models.Account
	MinBalance uint64 `json:"min-balance,omitempty"`
}

// GetBareAccount just returns account information without asset data, but also includes the minimum balance that's
// missing from the SDKs.
func GetBareAccount(ctx context.Context, algoClient *algod.Client, account string) (AccountWithMinBalance, error) {
	var response AccountWithMinBalance
	var params = algod.AccountInformationParams{
		Exclude: "all",
	}

	err := (*common.Client)(algoClient).Get(ctx, &response, fmt.Sprintf("/v2/accounts/%s", account), params, nil)
	if err != nil {
		return AccountWithMinBalance{}, err
	}
	return response, nil
}
