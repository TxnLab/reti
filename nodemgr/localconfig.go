package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/TxnLab/reti/internal/lib/reti"
)

func ConfigFilename() (string, error) {
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	cfgPath := filepath.Join(cfgDir, "reti", "reti.json")
	err = os.MkdirAll(filepath.Dir(cfgPath), 0775) // user+group RWX, others RX
	if err != nil {
		return "", fmt.Errorf("error making directory:%s, error:%w", cfgDir, err)
	}
	return cfgPath, nil
}

func LoadValidatorInfo() (*reti.ValidatorInfo, error) {
	return LoadConfig()
}

func SaveValidatorInfo(info *reti.ValidatorInfo) error {
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
	slog.Info("state saved", "file", cfgName)
	return nil
}

func LoadConfig() (*reti.ValidatorInfo, error) {
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
	var info reti.ValidatorInfo
	err = decoder.Decode(&info)
	if err != nil {
		return nil, err
	}

	return &info, nil
}
