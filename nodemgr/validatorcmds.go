package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strconv"

	"github.com/algorand/go-algorand-sdk/v2/types"
	"github.com/manifoldco/promptui"
	"github.com/urfave/cli/v3"

	"github.com/TxnLab/reti/internal/lib/misc"
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
				Action: ValidatorInfo,
			},
			{
				Name:   "state",
				Usage:  "Display info about the validator's current state from the chain",
				Action: ValidatorState,
			},
			{
				Name:  "claim",
				Usage: "Claim a validator from chain, using manager address as verified. Signing keys must be present for this address to load",
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:     "account",
						Usage:    "Account (owner or manager) you can sign for that will claim this validator for this node",
						Required: true,
					},
					&cli.UintFlag{
						Name:     "id",
						Usage:    "Validator ID to claim (you must be owner or manager!)",
						Required: true,
					},
				},
				Action: ClaimValidator,
			},
		},
	}
}

func InitValidator(ctx context.Context, cmd *cli.Command) error {
	v, err := LoadValidatorInfo()
	if err == nil {
		result, _ := yesNo("A validator configuration already appears to exist, do you REALLY want to add an entirely new validator configuration")
		if result != "y" {
			return nil
		}
		return DefineValidator()
	}
	if errors.Is(err, os.ErrNotExist) {
		result, _ := yesNo("Validator not configured.  Create brand new validator")
		if result != "y" {
			return nil
		}
		return DefineValidator()
	}
	if err != nil {
		return cli.Exit(err, 1)
	}
	slog.Info("validator", "id", v.Config.ID)
	return nil
}

func ValidatorInfo(ctx context.Context, command *cli.Command) error {
	v, err := LoadValidatorInfo()
	if err != nil {
		return fmt.Errorf("validator not configured: %w", err)
	}
	// Get information from the chain about the current state
	ownerAddr, err := types.DecodeAddress(v.Config.Owner)
	if err != nil {
		return err
	}
	config, err := App.retiClient.GetValidatorConfig(v.Config.ID, ownerAddr)
	if err != nil {
		return err
	}
	fmt.Println(config.String())
	return err
}

func ValidatorState(ctx context.Context, command *cli.Command) error {
	v, err := LoadValidatorInfo()
	if err != nil {
		return fmt.Errorf("validator not configured: %w", err)
	}
	// Get information from the chain about the current state
	ownerAddr, err := types.DecodeAddress(v.Config.Owner)
	if err != nil {
		return err
	}
	state, err := App.retiClient.GetValidatorState(v.Config.ID, ownerAddr)
	if err != nil {
		return err
	}
	slog.Info(state.String())
	return nil
}

func ClaimValidator(ctx context.Context, command *cli.Command) error {
	_, err := LoadValidatorInfo()
	if err == nil {
		return cli.Exit(errors.New("validator configuration already defined"), 1)
	}
	// load from chain
	addr, err := types.DecodeAddress(command.Value("account").(string))
	if err != nil {
		return fmt.Errorf("invalid address specified: %w", err)
	}

	if !App.signer.HasAccount(addr.String()) {
		return fmt.Errorf("account:%s isn't an account you have keys to!", addr.String())
	}
	id := command.Value("id").(uint64)

	App.logger.Info("Claiming validator", "id", id)

	config, err := App.retiClient.GetValidatorConfig(id, addr)
	if err != nil {
		return fmt.Errorf("error fetching config from chain: %w", err)
	}
	if config.Owner != addr.String() && config.Manager != addr.String() {
		return fmt.Errorf("you are not the owner or manager of valid validator:%d, account:%s is owner", id, config.Owner)
	}
	info := &reti.ValidatorInfo{Config: *config}

	err = SaveValidatorInfo(info)

	misc.Infof(App.logger, "You have successfully imported/claimed this validator, but you must now claim pools for this node as none will be assigned")
	if err != nil {
		return err
	}
	return nil
}

func DefineValidator() error {
	var (
		err      error
		nfdAppID uint64
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
		nfdAppID, nfdName, err = getNFDAppID("Enter the NFD Name for this validator", config.Owner)
		if err != nil {
			return err
		}
		config.NFDForInfo = nfdAppID
	}
	// Use the promptui library to ask questions for each of the configuration items in ValidatorConfig
	config.PayoutEveryXDays, err = getInt("Enter the payout frequency (in days)", 1, 1, 365)
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

	maxPerPool, err := getInt("Enter the maximum algo stake allowed per pool", 20_000_000, 200_000, 100_000_000)
	if err != nil {
		return err
	}
	config.MaxAlgoPerPool = uint64(maxPerPool) * 1e6

	config.PoolsPerNode, err = getInt("Enter the number of pools to allow per node [max 3 recommended]", 3, 3, 6)
	if err != nil {
		return err
	}

	info := &reti.ValidatorInfo{Config: config}

	validatorID, err := App.retiClient.AddValidator(info, nfdName)
	if err != nil {
		return err
	}
	info.Config.ID = validatorID
	slog.Info("New Validator added, your Validator ID is:", "id", info.Config.ID)

	return SaveValidatorInfo(info)
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
			nfd, _, err := App.nfdApi.NfdApi.NfdGetNFD(context.Background(), name, nil)
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
