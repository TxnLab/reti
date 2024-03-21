package reti

import (
	"errors"
)

var (
	ErrCantFetchValidators      = errors.New("couldn't fetch num of validators from global state of validator application")
	ErrCantFetchPoolKey         = errors.New("couldn't fetch poolkey data")
	ErrNotEnoughRewardAvailable = errors.New("reward available not at least least 1 ALGO - skipping payout")
)
