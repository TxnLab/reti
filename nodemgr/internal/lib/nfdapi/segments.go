package nfdapi

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/antihax/optional"
	"github.com/ssgreg/repeat"

	"github.com/TxnLab/reti/internal/lib/nfdapi/swagger"
)

func GetAllSegmentsOfRoot(ctx context.Context, api *swagger.APIClient, parentAppID uint64, view string) ([]*swagger.NfdRecord, error) {
	var (
		offset, limit int64 = 0, 200
		records       swagger.NfdV2SearchRecords
		err           error
		nfds          []*swagger.NfdRecord
	)

	for ; ; offset += limit {
		if view == "" {
			view = "brief"
		}
		err = retryNfdApiCalls(func() error {
			records, _, err = api.NfdApi.NfdSearchV2(ctx, &swagger.NfdApiNfdSearchV2Opts{
				ParentAppID: optional.NewInt64(int64(parentAppID)),
				State:       optional.NewInterface("owned"),
				View:        optional.NewString(view),
				Limit:       optional.NewInt64(limit),
				Offset:      optional.NewInt64(offset),
			})
			return err
		})

		if err != nil {
			return nil, fmt.Errorf("error while fetching segments: %w", err)
		}

		if records.Nfds == nil || len(*records.Nfds) == 0 {
			break
		}
		for _, record := range *records.Nfds {
			if record.DepositAccount == "" {
				continue
			}
			newRecord := record
			nfds = append(nfds, &newRecord)
		}
	}
	return nfds, nil
}

func retryNfdApiCalls(meth func() error) error {
	return repeat.Repeat(
		repeat.Fn(func() error {
			err := meth()
			if err != nil {
				if rate, match := isRateLimited(err); match {
					time.Sleep(time.Duration(rate.SecsRemaining+1) * time.Second)
					return repeat.HintTemporary(err)
				}
				var swaggerError swagger.GenericSwaggerError
				if errors.As(err, &swaggerError) {
					if moderr, match := swaggerError.Model().(swagger.ModelError); match {
						return fmt.Errorf("message:%s, err:%w", moderr.Message, err)
					}
				}
			}
			return err
		}),
		repeat.StopOnSuccess(),
	)
}

func isRateLimited(err error) (*swagger.RateLimited, bool) {
	if swaggerError, match := isSwaggerError(err); match {
		if limit, match := swaggerError.Model().(swagger.RateLimited); match {
			return &limit, true
		}
	}
	return nil, false
}

func isSwaggerError(err error) (*swagger.GenericSwaggerError, bool) {
	var swaggerError swagger.GenericSwaggerError
	if errors.As(err, &swaggerError) {
		return &swaggerError, true
	}
	return nil, false
}
