package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"

	"github.com/algorand/go-algorand-sdk/v2/types"
	"github.com/manifoldco/promptui"
	"github.com/urfave/cli/v3"

	"github.com/TxnLab/reti/internal/lib/algo"
	"github.com/TxnLab/reti/internal/lib/reti"
)

func GetValidatorCmdOpts() *cli.Command {
	return &cli.Command{
		Name:    "validator",
		Aliases: []string{"v"},
		Usage:   "Configure validator options",
		Commands: []*cli.Command{
			{
				Name:   "init",
				Usage:  "Initialize self as validator - creating or resetting configuration - should only be done ONCE, EVER !",
				Action: InitValidator,
			},
			{
				Name:   "info",
				Usage:  "Display info about the validator from the chain",
				Action: DisplayValidatorInfo,
			},
			{
				Name:   "state",
				Usage:  "Display info about the validator's current state from the chain",
				Action: DisplayValidatorState,
			},
			{
				Name:  "change",
				Usage: "Change configuration parameters of validator",
				Commands: []*cli.Command{
					{
						Name:  "commission",
						Usage: "Change the commission address",
						Flags: []cli.Flag{
							&cli.StringFlag{
								Name:     "address",
								Usage:    "The algorand address to send commissions to.",
								Required: true,
							},
						},
						Action: ChangeCommission,
					},
				},
			},
		},
	}
}

func InitValidator(ctx context.Context, cmd *cli.Command) error {
	if App.retiClient.IsConfigured() {
		result, _ := yesNo("A validator configuration already appears to exist, do you REALLY want to add an entirely new validator configuration")
		if result != "y" {
			return nil
		}
		return DefineValidator()
	}
	result, _ := yesNo("Validator not configured.  Create brand new validator")
	if result != "y" {
		return nil
	}
	return DefineValidator()
}

func DisplayValidatorInfo(ctx context.Context, command *cli.Command) error {
	if !App.retiClient.IsConfigured() {
		return fmt.Errorf("validator not configured")
	}
	var config = App.retiClient.Info().Config
	fmt.Println(config.String())
	constraints, err := App.retiClient.GetProtocolConstraints()
	if err != nil {
		return err
	}
	fmt.Printf("Amt when saturated: %s\n", algo.FormattedAlgoAmount(constraints.AmtConsideredSaturated))
	fmt.Printf("Max Algo per Validator: %s\n", algo.FormattedAlgoAmount(constraints.MaxAlgoPerValidator))
	return nil
}

func DisplayValidatorState(ctx context.Context, command *cli.Command) error {
	if !App.retiClient.IsConfigured() {
		return fmt.Errorf("validator not configured")
	}
	// Get information from the chain about the current state
	state, err := App.retiClient.GetValidatorState(App.retiClient.Info().Config.ID)
	if err != nil {
		return err
	}
	slog.Info(state.String())
	return nil
}

func ChangeCommission(ctx context.Context, command *cli.Command) error {
	if !App.retiClient.IsConfigured() {
		return fmt.Errorf("validator not configured")
	}
	var info = App.retiClient.Info()

	signer, err := App.signer.FindFirstSigner([]string{info.Config.Owner, info.Config.Manager})
	if err != nil {
		return fmt.Errorf("neither owner or manager address for your validator has local keys present")
	}
	signerAddr, _ := types.DecodeAddress(signer)

	commissionAddress, err := types.DecodeAddress(command.String("address"))
	if err != nil {
		return err
	}

	err = App.retiClient.ChangeValidatorCommissionAddress(info.Config.ID, signerAddr, commissionAddress)
	if err != nil {
		return err
	}
	return App.retiClient.LoadState(ctx)
}

func DefineValidator() error {
	var (
		err      error
		nfdAppId uint64
		nfdName  string
	)

	// Build up a new validator config
	config := reti.ValidatorConfig{}

	owner, err := getAlgoAccount("Enter account address for the 'owner' of the validator", "")
	if err != nil {
		return err
	}
	if !App.signer.HasAccount(owner) {
		return fmt.Errorf("The mnemonics aren't available for this account.  Aborting")
	}
	config.Owner = owner

	manager, err := getAlgoAccount("Enter account address for the 'manager' of the validator", owner)
	if err != nil {
		return err
	}
	if !App.signer.HasAccount(manager) {
		return fmt.Errorf("The mnemonics aren't available for this account.  Aborting")
	}
	config.Manager = manager
	if y, _ := yesNo("Do you want to associate an NFD with this"); y == "y" {
		nfdAppId, nfdName, err = getNFDAppId("Enter the NFD Name for this validator", config.Owner)
		if err != nil {
			return err
		}
		config.NFDForInfo = nfdAppId
	}
	// Use the promptui library to ask questions for each of the configuration items in ValidatorConfig
	config.PayoutEveryXMins, err = getInt("Enter the payout frequency (in minutes - 1, 60 (1 hr), max 7 days)", 1, 1, 60*24*7)
	if err != nil {
		return err
	}

	config.PercentToValidator, err = getInt("Enter the payout percentage to the validator (in four decimals, ie: 5% = 50000)", 50000, 0, 1000000)
	if err != nil {
		return err
	}

	config.ValidatorCommissionAddress, err = getAlgoAccount("Enter the address that receives the validation commission each epoch payout", config.Owner)
	if err != nil {
		return err
	}

	minStake, err := getInt("Enter the minimum algo stake required to enter the pool", 1000, 1, 1_000_000_000)
	if err != nil {
		return err
	}
	config.MinEntryStake = uint64(minStake) * 1e6

	maxPerPool, err := getInt("Enter the maximum algo stake allowed per pool", 0, 0, 100_000_000)
	if err != nil {
		return err
	}
	config.MaxAlgoPerPool = uint64(maxPerPool) * 1e6

	config.PoolsPerNode, err = getInt("Enter the number of pools to allow per node [max 3 recommended]", 3, 3, 6)
	if err != nil {
		return err
	}

	info := &reti.ValidatorInfo{Config: config}

	validatorId, err := App.retiClient.AddValidator(info, nfdName)
	if err != nil {
		return err
	}
	info.Config.ID = validatorId
	slog.Info("New Validator added, your Validator id is:", "id", info.Config.ID)
	return App.retiClient.LoadState(context.Background())
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

func getNFDAppId(prompt string, owner string) (uint64, string, error) {
	var (
		nfdId   uint64
		nfdName string
	)
	_, err := (&promptui.Prompt{
		Label: prompt,
		Validate: func(name string) error {
			if IsNFDNameValid(name) != nil {
				return invalidNFD
			}
			nfd, _, err := App.nfdApi.NfdApi.NfdGetNFD(context.Background(), name, nil)
			if err != nil {
				return err
			}
			if nfd.Owner != owner {
				return fmt.Errorf("nfd owner:%s is not same as owner you specified:%s", nfd.Owner, owner)
			}
			nfdId = uint64(nfd.AppID)
			nfdName = nfd.Name
			return nil
		},
	}).Run()
	if err != nil {
		return 0, "", err
	}
	return nfdId, nfdName, nil
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
