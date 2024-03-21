# Rewards

## Payout Process

* Determines the 'reward' amount based on the current pool balance vs the known 'staked' amount.
* Directly pays the validator their commission, which is immutable and part of defining the validator record itself.
* Walks the 'ledger' of stakers, and updates their balance to include their percentage of the shared reward (and thus compounding)
* The % share the user gets is based on their stake and is adjusted based on the % of time they were 'in the epoch'. A staker adding/entering stake 95% of the way through an epoch would only receive 5% of the reward they would have received had they been in the pool for the entire epoch.
* After paying 'partial' epoch holders, the remaining reward (which now has extra) is divided across the 'in pool 100% of the epoch' stakers with their relative % of the pool being based on their % of the total (minus the stake of the partial epoch stakers).
* The partial epoch holders will be full holders in the next epoch, assuming they don't add stake again. Each time adding stake resets their clock in the epoch.
* Some validators epochs might be extremely short (can be as low as minute), so the differences will be small but preventing gaming is still critical, particularly for larger epoch settings.
* Users can remove stake at will.  If a validator offers a token as additional rewards, the entire balance of any rewarded tokens are paid out when removing any amount of stake.
