package reti

import "errors"

var (
	errCantFetchValidators = errors.New("couldn't fetch num of validators from global state of validator application")
)
