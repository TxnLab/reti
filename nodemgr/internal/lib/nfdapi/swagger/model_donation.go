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

// Donation contains basic information about donation totals to specific addresses from accounts related to an NFD
type Donation struct {
	// Sender or Receiver Algorand address depending on request
	Address string `json:"address"`
	// Total donation in microAlgos
	Total int64 `json:"total"`
}
