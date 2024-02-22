package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strconv"

	"github.com/algorand/go-algorand-sdk/v2/abi"
	"github.com/algorand/go-algorand-sdk/v2/client/v2/common/models"
	"github.com/algorand/go-algorand-sdk/v2/crypto"
	"github.com/algorand/go-algorand-sdk/v2/transaction"
	"github.com/algorand/go-algorand-sdk/v2/types"
	"github.com/manifoldco/promptui"
	"github.com/urfave/cli/v3"

	"github.com/TxnLab/reti/internal/lib/algo"
)

func GetValidatorCmdOpts() *cli.Command {
	return &cli.Command{
		Name:    "validator",
		Aliases: []string{"v"},
		Usage:   "Configure validator options",
		Commands: []*cli.Command{
			{
				Name:     "init",
				Usage:    "Initialize self as validator - creating or resetting configuration - should only be done ONCE, EVER !",
				Category: "validator",
				Action:   InitValidator,
			},
			{
				Name:      "claim",
				Usage:     "Claim a validator from chain, using manager address as verified.  Signing keys must be present for this address to load",
				Category:  "validator",
				ArgsUsage: "id - specify validator ID to claim",
				Arguments: []cli.Argument{
					&cli.IntArg{
						Name:      "id",
						UsageText: "Validator ID to claim (you must be owner or manager!)",
						Min:       1,
						Max:       -1,
					},
				},
				Action: ClaimValidator,
			},
			{
				Name:     "add",
				Aliases:  []string{"a"},
				Usage:    "Add a new staking pool to this node",
				Category: "pool",
				Action: func(context context.Context, cmd *cli.Command) error {
					return nil
				},
			},
		},
	}
}

func InitValidator(ctx context.Context, cmd *cli.Command) error {
	v, err := LoadValidatorInfo()
	if errors.Is(err, os.ErrNotExist) {
		return DefineValidator()
	}
	if err != nil {
		return cli.Exit(err, 1)
	}
	slog.Info("validator", "id", v.ID)
	return nil
}

func ClaimValidator(ctx context.Context, command *cli.Command) error {
	_, err := LoadValidatorInfo()
	if err == nil {
		return cli.Exit(errors.New("validator configuration already defined"), 1)
	}
	// load from chain

	return nil
}

func DefineValidator() error {
	var (
		result   string
		err      error
		nfdAppID uint64
		nfdName  string
	)

	params, err := App.algoClient.SuggestedParams().Do(context.Background())

	// Build up a new validator config
	info := &ValidatorInfo{}

	result, err = yesNo("Validator not configured.  Create brand new validator")
	if result != "y" {
		return err
	}
	owner, err := getAlgoAccount("Enter account address for the 'owner' of the validator", "")
	if err != nil {
		return err
	}
	if !App.signer.HasAccount(owner) {
		return fmt.Errorf("The mnemonics aren't available for this account.  Aborting")
	}
	info.Owner = owner

	manager, err := getAlgoAccount("Enter account address for the 'manager' of the validator", owner)
	if err != nil {
		return err
	}
	if !App.signer.HasAccount(manager) {
		return fmt.Errorf("The mnemonics aren't available for this account.  Aborting")
	}
	info.Manager = manager
	if y, _ := yesNo("Do you want to associate an NFD with this"); y == "y" {
		nfdAppID, nfdName, err = getNFDAppID("Enter the NFD Name for this validator", info.Owner)
		if err != nil {
			return err
		}
		info.NFDForInfo = nfdAppID
	}
	config := ValidatorConfig{}
	// Use the promptui library to ask questions for each of the configuration items in ValidatorConfig
	config.PayoutEveryXDays, err = getInt("Enter the payout frequency (in days)", 1, 1, 365)
	if err != nil {
		return err
	}

	config.PercentToValidator, err = getInt("Enter the payout percentage to the validator (in four decimals, ie: 5% = 50000)", 50000, 0, 1000000)
	if err != nil {
		return err
	}

	config.ValidatorCommissionAddress, err = getAlgoAccount("Enter the address that receives the validation commission each epoch payout", info.Owner)
	if err != nil {
		return err
	}

	minStake, err := getInt("Enter the minimum algo stake required to enter the pool", 1000, 1, 1_000_000_000)
	if err != nil {
		return err
	}
	config.MinAllowedStake = uint64(minStake) * 1e6

	maxPerPool, err := getInt("Enter the maximum algo stake allowed per pool", 20_000_000, 200_000, 100_000_000)
	if err != nil {
		return err
	}
	config.MaxAlgoPerPool = uint64(maxPerPool) * 1e6

	config.PoolsPerNode, err = getInt("Enter the number of pools to allow per node [max 3 recommended]", 3, 3, 6)
	if err != nil {
		return err
	}

	info.Config = config

	validatorID, err := addValidator(info, params, nfdName)
	if err != nil {
		return err
	}
	info.ID = validatorID

	return SaveValidatorInfo(info)
}

func addValidator(info *ValidatorInfo, params types.SuggestedParams, nfdName string) (uint64, error) {
	var err error

	ownerAddr, _ := types.DecodeAddress(info.Owner)
	managerAddr, _ := types.DecodeAddress(info.Manager)
	commissionAddr, _ := types.DecodeAddress(info.Config.ValidatorCommissionAddress)

	// first determine how much we have to add in MBR to the validaotr
	mbrs, err := getMbrAmounts(params, ownerAddr)
	if err != nil {
		return 0, err
	}

	// Now try to actually create the validator !!
	atc := transaction.AtomicTransactionComposer{}

	method, err := abi.MethodFromSignature("addValidator(pay,address,address,uint64,string,(uint16,uint32,address,uint64,uint64,uint8))uint64")
	if err != nil {
		return 0, err
	}
	// We we need to set all teh box references ourselves still in go, so we need the id of the 'next' validator
	// We'll do the next two just to be safe
	curValidatorID, err := getNumValidators()
	if err != nil {
		return 0, err
	}
	slog.Info("mbrs", "validatormbr", mbrs.AddValidatorMbr)

	// Pay the mbr to add a validator
	paymentTxn, err := transaction.MakePaymentTxn(
		ownerAddr.String(),
		crypto.GetApplicationAddress(App.retiAppID).String(),
		mbrs.AddValidatorMbr,
		nil,
		"",
		params)
	payTxWithSigner := transaction.TransactionWithSigner{
		Txn:    paymentTxn,
		Signer: algo.SignWithAccountForATC(App.signer, ownerAddr.String()),
	}

	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:  App.retiAppID,
		Method: method,
		MethodArgs: []any{
			// MBR payment
			payTxWithSigner,
			// rest of args
			ownerAddr,
			managerAddr,
			info.NFDForInfo,
			nfdName,
			[]any{uint16(info.Config.PayoutEveryXDays),
				uint16(info.Config.PercentToValidator),
				commissionAddr,
				info.Config.MinAllowedStake,
				info.Config.MaxAlgoPerPool,
				uint8(info.Config.PoolsPerNode),
			},
		},
		BoxReferences: []types.AppBoxReference{
			{AppID: 0, Name: GetValidatorListBoxName(curValidatorID + 1)},
			{AppID: 0, Name: GetValidatorListBoxName(curValidatorID + 2)},
			{AppID: 0, Name: nil}, // extra i/o
		},
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          ownerAddr,
		Signer:          algo.SignWithAccountForATC(App.signer, ownerAddr.String()),
	})

	res, err := atc.Execute(App.algoClient, context.Background(), 4)
	if err != nil {
		return 0, err
	}
	if validatorID, ok := res.MethodResults[0].ReturnValue.(uint64); ok {
		return validatorID, nil
	}
	return 0, nil
}

func GetValidatorListBoxName(id uint64) []byte {
	prefix := []byte("v")
	ibytes := make([]byte, 8)
	binary.BigEndian.PutUint64(ibytes, id)
	return bytes.Join([][]byte{prefix, ibytes[:]}, nil)
}

type MbrAmounts struct {
	AddValidatorMbr uint64
	AddPoolMbr      uint64
	PoolInitMbr     uint64
	AddStakerMbr    uint64
}

func getMbrAmounts(params types.SuggestedParams, caller types.Address) (MbrAmounts, error) {
	method, err := abi.MethodFromSignature("getMbrAmounts()(uint64,uint64,uint64,uint64)")
	if err != nil {
		return MbrAmounts{}, err
	}
	atc := transaction.AtomicTransactionComposer{}
	atc.AddMethodCall(transaction.AddMethodCallParams{
		AppID:           App.retiAppID,
		Method:          method,
		SuggestedParams: params,
		OnComplete:      types.NoOpOC,
		Sender:          caller,
		Signer:          transaction.EmptyTransactionSigner{},
	})
	result, err := atc.Simulate(context.Background(), App.algoClient, models.SimulateRequest{
		AllowEmptySignatures:  true,
		AllowUnnamedResources: true,
	})
	if err != nil {
		return MbrAmounts{}, err
	}

	if results, ok := result.MethodResults[0].ReturnValue.([]any); ok {
		if len(results) != 4 {
			return MbrAmounts{}, errors.New("invalid number of results")
		}
		var mbrs MbrAmounts
		mbrs.AddValidatorMbr = results[0].(uint64)
		mbrs.AddPoolMbr = results[1].(uint64)
		mbrs.PoolInitMbr = results[2].(uint64)
		mbrs.AddStakerMbr = results[3].(uint64)
		return mbrs, nil
	}
	return MbrAmounts{}, fmt.Errorf("unknown result type:%#v", result.MethodResults)
}

func getNumValidators() (uint64, error) {
	appInfo, err := App.algoClient.GetApplicationByID(App.retiAppID).Do(context.Background())
	if err != nil {
		return 0, err
	}
	for _, gs := range appInfo.Params.GlobalState {
		rawKey, _ := base64.StdEncoding.DecodeString(gs.Key)
		key := string(rawKey)
		if key == "numV" && gs.Value.Type == 2 {
			return gs.Value.Uint, nil
		}
	}
	return 0, err
}

func getInt(prompt string, defVal int, minVal int, maxVal int) (int, error) {
	validate := func(input string) error {
		value, err := strconv.Atoi(input)
		if err != nil {
			return err
		}
		if value < minVal || value > maxVal {
			return fmt.Errorf("value must be between %d and %d", minVal, maxVal)
		}
		return nil
	}
	result, err := (&promptui.Prompt{
		Label:    prompt,
		Default:  strconv.Itoa(defVal),
		Validate: validate,
	}).Run()
	if err != nil {
		return 0, err
	}
	value, _ := strconv.Atoi(result)
	return value, nil
}

func getNFDAppID(prompt string, owner string) (uint64, string, error) {
	var (
		nfdID   uint64
		nfdName string
	)
	_, err := (&promptui.Prompt{
		Label: prompt,
		Validate: func(name string) error {
			if IsNFDNameValid(name) != nil {
				return invalidNFD
			}
			nfd, _, err := App.api.NfdApi.NfdGetNFD(context.Background(), name, nil)
			if err != nil {
				return err
			}
			if nfd.Owner != owner {
				return fmt.Errorf("nfd owner:%s is not same as owner you specified:%s", nfd.Owner, owner)
			}
			nfdID = uint64(nfd.AppID)
			nfdName = nfd.Name
			return nil
		},
	}).Run()
	if err != nil {
		return 0, "", err
	}
	return nfdID, nfdName, nil
}

func getAlgoAccount(prompt string, defVal string) (string, error) {
	return (&promptui.Prompt{
		Label:   prompt,
		Default: defVal,
		Validate: func(s string) error {
			_, err := types.DecodeAddress(s)
			return err
		},
	}).Run()
}

func yesNo(prompt string) (string, error) {
	return (&promptui.Prompt{
		Label:     prompt,
		IsConfirm: true,
	}).Run()
}

var validNFDNameWSuffixRegex = regexp.MustCompile(`^([a-z0-9]{1,27}\.){0,1}(?P<basename>[a-z0-9]{1,27})\.algo$`)

var invalidNFD = errors.New("invalid nfd name")

// IsNFDNameValid is simple validity check if an NFD name is valid based on allowing/disallowing emojis, and whether
// the .algo suffix is required to be there.
func IsNFDNameValid(name string) error {
	var match bool

	match = validNFDNameWSuffixRegex.MatchString(name)

	if match {
		return nil
	}
	return fmt.Errorf("invalid name:%s", name)
}
