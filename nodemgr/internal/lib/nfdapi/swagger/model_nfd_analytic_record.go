/*
 * NFD Management Service
 *
 * Service for querying and managing NFDs
 *
 * API version: 1.0
 * Contact: feedback@txnlab.dev
 * Generated by: Swagger Codegen (https://github.com/swagger-api/swagger-codegen.git)
 */
package swagger

import (
	"time"
)

// NFDAnalyticRecord is an NFD Analytics record in a time-series collection, with timestamp, price, and event data for that point in time.
type NfdAnalyticRecord struct {
	Data *NfdAnalyticEvent `json:"data,omitempty"`
	// price of event in microAlgos
	Price int64 `json:"price,omitempty"`
	// price of event in USD
	PriceUsd  float64   `json:"priceUsd,omitempty"`
	Timestamp time.Time `json:"timestamp,omitempty"`
}
