# Rewards

## Payout Process

* Determines the 'reward' amount based on the current pool balance vs the known 'staked' amount.
* Directly pays the validator their commission, which is immutable and part of defining the validator record itself.
* Walks the 'ledger' of stakers, and updates their balance to include their percentage of the shared reward (and thus compounding)
* The % share the user gets is based on their stake and is adjusted based on the % of time they were 'in the epoch'. A staker adding/entering stake 95% of the way through an epoch would only receive 5% of the reward they would have received had they been in the pool for the entire epoch.
* After paying 'partial' epoch holders, the remaining reward (which now has extra) is divided across the 'in pool 100% of the epoch' stakers with their relative % of the pool being based on their % of the total (minus the stake of the partial epoch stakers).
* The partial epoch holders will be full holders in the next epoch, assuming they don't add stake again. Each time adding stake resets their clock in the epoch.
* Some validators epochs might be as short as 1 day, so the differences will be small but preventing gaming is still critical.
* The node daemon via the epoch update will update the staking poools 'algod' version for public visibility
* Users can remove stake at will as well as any awarded reward tokens (optionalº, being able to remove their tracked 'ledger balance' (which continues to compound and grow as reward epochs occur).\* **could u clarify** \*
  * The contract will allow anyone to call to 'pay out staker X' rewarded community tokens - this will allow projects to pay to do automated drops of their community token via their staking pools. It may be expensive to do this for each staker, but the option will remain.
