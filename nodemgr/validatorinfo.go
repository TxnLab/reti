package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const (
	MaxNodes        = 12
	MaxPoolsPerNode = 6
)

type ValidatorInfo struct {
	ID         uint64 // ID of this validator (sequentially assigned)
	Owner      string // Account that controls config - presumably cold-wallet
	Manager    string // Account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign for the transactions
	NFDForInfo uint64 // Optional NFD AppID which the validator uses to describe their validator pool
	//NFDName    string // Optional NFD Name to verify
	Config ValidatorConfig
	State  *ValidatorCurState `json:"state,omitempty"`
	Pools  []PoolInfo         `json:"pools,omitempty"`
}

type ValidatorConfig struct {
	// Payout frequency - ie: 7, 30, etc.
	PayoutEveryXDays int
	// Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -
	PercentToValidator int
	// account that receives the validation commission each epoch payout (can be ZeroAddress)
	ValidatorCommissionAddress string
	// minimum stake required to enter pool - but must withdraw all if want to go below this amount as well(!)
	MinEntryStake uint64
	// maximum stake allowed per pool (to keep under incentive limits)
	MaxAlgoPerPool uint64
	// Number of pools to allow per node (max of 3 is recommended)
	PoolsPerNode int
}

type ValidatorCurState struct {
	NumPools        int    // current number of pools this validator has - capped at MaxPools
	TotalStakers    uint64 // total number of stakers across all pools
	TotalAlgoStaked uint64 // total amount staked to this validator across ALL of its pools
}

type PoolInfo struct {
	NodeID          int
	PoolAppID       uint64 // The App ID of this staking pool contract instance
	TotalStakers    int
	TotalAlgoStaked uint64
}

func ConfigFilename() (string, error) {
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cfgDir, "reti.json"), nil
}

func LoadValidatorInfo() (*ValidatorInfo, error) {
	return LoadConfig()
}

func SaveValidatorInfo(info *ValidatorInfo) error {
	// Save the data from ValidatorInfo into the config file, by
	// first saving into a temp file and then replacing the config file only if successfully written.
	cfgName, err := ConfigFilename()
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(cfgName), filepath.Base(cfgName)+".*")
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(temp)
	err = encoder.Encode(info)
	if err != nil {
		_ = temp.Close()
		_ = os.Remove(temp.Name())
		return fmt.Errorf("error saving configuration: %w", err)
	}

	err = temp.Close()
	if err != nil {
		return err
	}

	err = os.Rename(temp.Name(), cfgName)
	if err != nil {
		return err
	}
	return nil
}

func LoadConfig() (*ValidatorInfo, error) {
	cfgName, err := ConfigFilename()
	if err != nil {
		return nil, err
	}
	// read json file into ValidatorInfo struct
	file, err := os.Open(cfgName)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	decoder := json.NewDecoder(file)
	var info ValidatorInfo
	err = decoder.Decode(&info)
	if err != nil {
		return nil, err
	}

	return &info, nil
}
