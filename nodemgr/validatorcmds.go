package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strconv"
	"strings"
	"text/tabwriter"

	"github.com/algorand/go-algorand-sdk/v2/types"
	"github.com/mailgun/holster/v4/syncutil"
	"github.com/manifoldco/promptui"
	"github.com/urfave/cli/v3"

	"github.com/TxnLab/reti/internal/lib/algo"
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
				Action: DisplayValidatorInfo,
				Flags: []cli.Flag{
					&cli.UintFlag{
						Name:  "validator",
						Usage: "validator id (if desired to view arbitrary validator)",
					},
				},
			},
			{
				Name:   "state",
				Usage:  "Display info about the validator's current state from the chain",
				Action: DisplayValidatorState,
				Flags: []cli.Flag{
					&cli.UintFlag{
						Name:  "validator",
						Usage: "validator id (if desired to view arbitrary validator)",
					},
				},
			},
			{
				Name:  "change",
				Usage: "Change configuration parameters of validator",
				Commands: []*cli.Command{
					{
						Name:  "manager",
						Usage: "Change the manager address",
						Flags: []cli.Flag{
							&cli.StringFlag{
								Name:     "address",
								Usage:    "The algorand address to be the new manager address.",
								Required: true,
							},
						},
						Action: ChangeManager,
					},
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
			{
				Name:  "stakerData",
				Usage: "Display pools a particular account is in",
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:     "account",
						Usage:    "The stakers address to get staking pool data for",
						Required: true,
					},
				},
				Action: DisplayStakerData,
			},
			{
				Name:   "exportAllStakers",
				Usage:  "Exports info about ALL stakers to a .csv file",
				Action: exportAllStakers,
			},
			{
				Name:   "refundStakers",
				Usage:  "Remove all stakers from all pools, sending them all their stake (may cost a lot in fees!)",
				Action: refundAllStakers,
			},
			{
				Name:  "emptyTokenRewards",
				Usage: "Return available token rewards in pool 1 to specified account.  Typicaly used when sunsetting validator",
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:     "account",
						Usage:    "The address to send the excess reward tokens to",
						Required: true,
					},
				},
				Action: emptyTokenRewards,
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
	var validatorId = App.retiValidatorID

	if command.Uint("validator") != 0 {
		validatorId = command.Uint("validator")
	}
	if validatorId == 0 {
		if !App.retiClient.IsConfigured() {
			return fmt.Errorf("validator not configured")
		}
	}
	config, err := App.retiClient.GetValidatorConfig(validatorId)
	if err != nil {
		return fmt.Errorf("get validator config err:%w", err)
	}
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
	var validatorId = App.retiValidatorID

	if command.Uint("validator") != 0 {
		validatorId = command.Uint("validator")
	}
	if validatorId == 0 {
		if !App.retiClient.IsConfigured() {
			return fmt.Errorf("validator not configured")
		}
	}
	// Get information from the chain about the current state
	state, err := App.retiClient.GetValidatorState(validatorId)
	if err != nil {
		return err
	}
	slog.Info(state.String())
	return nil
}

func ChangeManager(ctx context.Context, command *cli.Command) error {
	if !App.retiClient.IsConfigured() {
		return fmt.Errorf("validator not configured")
	}
	var info = App.retiClient.Info()

	signer, err := App.signer.FindFirstSigner([]string{info.Config.Owner, info.Config.Manager})
	if err != nil {
		return fmt.Errorf("neither owner or manager address for your validator has local keys present")
	}
	signerAddr, _ := types.DecodeAddress(signer)

	managerAddress, err := types.DecodeAddress(command.String("address"))
	if err != nil {
		return err
	}

	err = App.retiClient.ChangeValidatorManagerAddress(info.Config.ID, signerAddr, managerAddress)
	if err != nil {
		return err
	}
	return App.retiClient.LoadState(ctx)
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
	config.EpochRoundLength, err = getInt("Enter the epoch length in rounds (21 would be ~1m, 1285 would be ~1 hour, max 1 million)", 21, 1, 1e6)
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

func DisplayStakerData(ctx context.Context, command *cli.Command) error {
	// account, amount, validator, pool
	stakerAddr, err := types.DecodeAddress(command.String("account"))
	if err != nil {
		return err
	}
	// This staker must have staked something!
	poolKeys, err := App.retiClient.GetStakedPoolsForAccount(stakerAddr)
	if err != nil {
		return err
	}
	out := new(strings.Builder)
	tw := tabwriter.NewWriter(out, 0, 0, 2, ' ', tabwriter.AlignRight)
	fmt.Fprintln(tw, "Validator ID\tPool ID\tApp ID\t")

	for _, key := range poolKeys {
		fmt.Fprintf(tw, "%d\t%d\t%d\t\n", key.ID, key.PoolId, key.PoolAppId)
	}
	tw.Flush()
	slog.Info(out.String())
	return nil
}

func exportAllStakers(ctx context.Context, command *cli.Command) error {
	if App.retiClient.RetiAppId == 0 {
		return fmt.Errorf("validator not configured")
	}
	numVs, err := App.retiClient.GetNumValidators()
	if err != nil {
		return err
	}
	type StakerInfo struct {
		Account  string  `json:"account"`
		Stake    float64 `json:"stake"`
		NumPools uint64  `json:"numPools"`
	}
	var stakers = map[string]StakerInfo{}

	for valID := 1; valID <= int(numVs); valID++ {
		pools, err := App.retiClient.GetValidatorPools(uint64(valID))
		if err != nil {
			return fmt.Errorf("error getting validator pools %d: %w", valID, err)
		}
		for _, pool := range pools {
			ledger, err := App.retiClient.GetLedgerForPool(pool.PoolAppId)
			if err != nil {
				if strings.Contains(err.Error(), "box not found") {
					// probably didn't finish initializing pool
					continue
				}
				return fmt.Errorf("error getting ledger for pool %d: %w", pool.PoolAppId, err)
			}
			for _, stakerData := range ledger {
				if stakerData.Account == types.ZeroAddress {
					continue
				}
				existingData, found := stakers[stakerData.Account.String()]
				if found {
					existingData.Stake += float64(stakerData.Balance) / 1e6
					existingData.NumPools++
					stakers[stakerData.Account.String()] = existingData
				} else {
					stakers[stakerData.Account.String()] = StakerInfo{
						Account:  stakerData.Account.String(),
						Stake:    float64(stakerData.Balance) / 1e6,
						NumPools: 1,
					}
				}
			}
		}
	}
	// output the stakers data as a csv file
	csvData := "Account,Stake,NumPools\n"
	for _, staker := range stakers {
		csvData += fmt.Sprintf("%s,%f,%d\n", staker.Account, staker.Stake, staker.NumPools)
	}
	return os.WriteFile("stakers.csv", []byte(csvData), 0644)
}

func refundAllStakers(ctx context.Context, command *cli.Command) error {
	signer, err := App.signer.FindFirstSigner([]string{App.retiClient.Info().Config.Owner, App.retiClient.Info().Config.Manager})
	if err != nil {
		return fmt.Errorf("neither owner or manager address for your validator has local keys present")
	}
	signerAddr, _ := types.DecodeAddress(signer)
	misc.Infof(App.logger, "signing unstake with:%s", signer)

	var (
		info   = App.retiClient.Info()
		fanOut = syncutil.NewFanOut(20)
	)

	type removeStakeRequest struct {
		poolKey reti.ValidatorPoolKey
		staker  types.Address
	}
	unstakeRequests := make(chan removeStakeRequest, 200)

	go func() {
		defer close(unstakeRequests)
		for i, pool := range info.Pools {
			ledger, err := App.retiClient.GetLedgerForPool(pool.PoolAppId)
			if err != nil {
				misc.Errorf(App.logger, "error getting ledger for pool %d: %v", pool.PoolAppId, err)
				return
			}
			for _, stakerData := range ledger {
				if stakerData.Account == types.ZeroAddress {
					continue
				}
				unstakeRequests <- removeStakeRequest{poolKey: reti.ValidatorPoolKey{ID: info.Config.ID, PoolId: uint64(i + 1), PoolAppId: pool.PoolAppId}, staker: stakerData.Account}
			}
		}
	}()
	for send := range unstakeRequests {
		fanOut.Run(func(val any) error {
			sendReq := val.(removeStakeRequest)
			err = App.retiClient.RemoveStake(sendReq.poolKey, signerAddr, sendReq.staker, 0)
			if err != nil {
				misc.Errorf(App.logger, "error removing stake for pool %d, staker:%s, err:%v", sendReq.poolKey.PoolAppId, sendReq.staker.String(), err)
			} else {
				misc.Infof(App.logger, "Stake Removed for pool %d, staker:%s", sendReq.poolKey.PoolAppId, sendReq.staker.String())
			}
			return nil
		}, send)
	}
	fanOut.Wait()

	return nil
}

func emptyTokenRewards(ctx context.Context, command *cli.Command) error {
	signer, err := App.signer.FindFirstSigner([]string{App.retiClient.Info().Config.Owner})
	if err != nil {
		return fmt.Errorf("owner address for your validator doesn't have local keys present")
	}
	receiverAddr, err := types.DecodeAddress(command.String("account"))
	if err != nil {
		return err
	}
	signerAddr, _ := types.DecodeAddress(signer)
	info := App.retiClient.Info()

	err = App.retiClient.EmptyTokenRewards(info.Config.ID, signerAddr, receiverAddr)
	if err != nil {
		misc.Errorf(App.logger, "error emptying token rewards, err:%v", err)
	}

	return nil
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
