package algo

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"math/big"
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
	formattedAmount := fmt.Sprintf("%.6f", float64(microAlgos)/1000000)
	// chop trailing 0's and decimal (if nothing else)
	formattedAmount = strings.TrimRight(formattedAmount, "0")
	formattedAmount = strings.TrimRight(formattedAmount, ".")
	return formattedAmount
}

func GetAlgoClient(log *slog.Logger, config NetworkConfig) (*algod.Client, error) {
	var (
		apiURL     string
		apiToken   string
		apiHeaders []*common.Header
		serverAddr *url.URL
		err        error
	)
	if config.NodeDataDir != "" {
		// Read address and admin token from main-net directory
		apiURL, apiToken, err = GetNetAndTokenFromFiles(
			filepath.Join(config.NodeDataDir, "algod.net"),
			filepath.Join(config.NodeDataDir, "algod.admin.token"))
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
	customTransport.MaxConnsPerHost = 100
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

func GetUint64FromGlobalState(globalState []models.TealKeyValue, keyName string) (uint64, error) {
	for _, gs := range globalState {
		rawKey, _ := base64.StdEncoding.DecodeString(gs.Key)
		if string(rawKey) == keyName && gs.Value.Type == 2 {
			return gs.Value.Uint, nil
		}
	}
	return 0, ErrStateKeyNotFound
}

func GetUint128FromGlobalState(globalState []models.TealKeyValue, keyName string) (*big.Int, error) {
	for _, gs := range globalState {
		rawKey, _ := base64.StdEncoding.DecodeString(gs.Key)
		if string(rawKey) == keyName && gs.Value.Type == 1 {
			value, _ := base64.StdEncoding.DecodeString(gs.Value.Bytes)
			return new(big.Int).SetBytes(value), nil
		}
	}
	return nil, ErrStateKeyNotFound
}

func GetStringFromGlobalState(globalState []models.TealKeyValue, keyName string) (string, error) {
	for _, gs := range globalState {
		rawKey, _ := base64.StdEncoding.DecodeString(gs.Key)
		if string(rawKey) == keyName && gs.Value.Type == 1 {
			value, _ := base64.StdEncoding.DecodeString(gs.Value.Bytes)
			return string(value), nil
		}
	}
	return "", ErrStateKeyNotFound
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

func GetVersionString(ctx context.Context, algoClient *algod.Client) (string, error) {
	vers, err := algoClient.Versions().Do(ctx)
	if err != nil {
		return "", fmt.Errorf("error fetching /versions from algod: %w", err)
	}
	return fmt.Sprintf("%d.%d.%d %s [%s]", vers.Build.Major, vers.Build.Minor, vers.Build.BuildNumber, vers.Build.Branch, vers.Build.CommitHash), nil
}

func CalcBlockTimes(ctx context.Context, algoClient *algod.Client, numRounds uint64) (time.Duration, error) {
	status, err := algoClient.Status().Do(ctx)
	if err != nil {
		return 0, fmt.Errorf("unable to fetch node status: %w", err)
	}
	var blockTimes []time.Time
	for round := status.LastRound - numRounds; round < status.LastRound; round++ {
		block, err := algoClient.Block(round).Do(ctx)
		if err != nil {
			return 0, fmt.Errorf("unable to fetch block in getAverageBlockTime, err:%w", err)
		}
		blockTimes = append(blockTimes, time.Unix(block.TimeStamp, 0))
	}
	var totalBlockTime time.Duration
	for i := 1; i < len(blockTimes); i++ {
		totalBlockTime += blockTimes[i].Sub(blockTimes[i-1])
	}
	return totalBlockTime / time.Duration(len(blockTimes)-1), nil
}
