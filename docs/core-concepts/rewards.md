# Rewards

Staking pools will receive rewards when they propose blocks, as long as they're above the 30K ALGO threshold and below the maximum amount defined by the protocl (around 70M currently) and have good performance. Rewards for stakers and validators are distributed periodically at the end of each epoch, which is a fixed period of time determined by the validator. The reward distribution and calculation is designed to prevent gaming of the system.

There is a special limit per-validator of 10% of all online stake.  A type of slashing occurs if this is reached.  See **Saturation** below.

#### Reward Calculation

The total reward for the pool is calculated based on the current pool balance and the known staked amount. This reward is then distributed between the validator and stakers according to the following process:

1. **Validator Commission**: The validator receives their predefined commission, which is an immutable percentage set when defining the validator record.
2. **Staker Reward Distribution**: The remaining reward is distributed among the stakers proportionally based on their stake and the duration they were active in the epoch.
   * Stakers who were active for the entire epoch receive their full share of the reward based on their percentage of the total staked amount.
   * Stakers who added or removed stake during the epoch receive a partial reward proportional to the time they were active in the epoch.
3. **Compounding**: Staker rewards are directly added to their staked balance, compounding their future rewards.

#### Soft caps and Validator Saturation

* While developing this solution, [Stefano De Angelis](https://github.com/deanstef) suggested a Saturation model whereby stake is still allowed to be added to pools, but a **Saturated** validator starts to have diminished rewards. &#x20;
*   This Saturation level is a _soft_ limit designed to prevent too much stake going to to one validator and which scales with the total online stake.

    **More than 10% of the currently online stake** **will be considered a Saturated validator.**  The AVM  will have a new opcode so that contracts may query the current online stake value.  The pools will use this value for the soft limit.
* **Any validator exceeding this total threshold will be considered over-saturated and be negatively impacted.**  The effective APR is reduced.  In this state, the following changes:
  * **Rewards accrued in each epoch are reduced proportionally to the amount 'over' the threshold.**
  * **The validator receives no rewards**
  * The remainder (rewards - paid outreduced rewards) is sent back to the fee sink where it will accrue for future payout to the protocol and node runners.
  * The intended result is that this will encourage stakers to exit the pool or at least lower their stake to be within the thresholds. &#x20;
    * For example, if the current saturation limit for a validator is twice the amount staked in the pool, the reward will be halved.  The below example showing a fictional 200 ALGO reward being available, with 100,000 ALGO being the 'soft limit' per validator and 200,000 ALGO currently staked to the validator.  The 200 reward becomes 100 ALGO in this example.

$$
reward = \frac{algoReward * maxStakePerValidator}{totalStakeInValidator} = \frac{200*100000}{200000} = 100
$$

#### Hard caps

* **There is a 15% of online stake 'hard' cap** - where new stakers or additional stake can no longer be added to a validator.  This is to help safeguard the protocol.

#### Partial Epoch Staking

To prevent gaming of the system, stakers who add or remove stake during an epoch receive only a partial reward for that epoch. The partial reward is calculated based on the percentage of time the staker was active in the epoch.

For example, if a staker adds stake 95% of the way through an epoch, they would only receive 5% of the reward they would have received if they had been staked for the entire epoch.

After receiving their partial reward, these stakers become full stakers for the subsequent epoch, assuming they do not add stake again. Each time a staker adds stake, their "clock" in the epoch resets.  Accrued stake can always be removed without penalty however removing before an epoch forfeits any rewards accrued so far for that epoch.

#### Epoch Duration

Epochs can vary in duration, with some validators having extremely short epochs (as low as one minute). While the differences in partial rewards may be small for short epochs, preventing gaming of the system remains critical, particularly for larger epoch settings.

#### Token Rewards

Some validators may offer additional token rewards to incentivize staking. If a validator offers such rewards, the entire balance of any rewarded tokens is paid out to the staker when they remove any amount of stake from the pool.

#### Stake Removal

Stakers can remove their stake from the pool at any time. When stake is removed, the staker can decide how much they want to withdraw. It must either be the entire stake, or a balance above the minimum entry for the pool.&#x20;

## Payout Process

* Determines the 'reward' amount based on the current pool balance vs the known 'staked' amount.
* Directly pays the validator their commission, which is immutable and part of defining the validator record itself.
* Walks the 'ledger' of stakers, and updates their balance to include their percentage of the shared reward (and thus compounding)
* The % share the user gets is based on their stake and is adjusted based on the % of time they were 'in the epoch'. A staker adding/entering stake 95% of the way through an epoch would only receive 5% of the reward they would have received had they been in the pool for the entire epoch.
* After paying 'partial' epoch holders, the remaining reward (which now has extra) is divided across the 'in pool 100% of the epoch' stakers with their relative % of the pool being based on their % of the total (minus the stake of the partial epoch stakers).
* The partial epoch holders will be full holders in the next epoch, assuming they don't add stake again. Each time adding stake resets their clock in the epoch.
* Some validators epochs might be extremely short (can be as low as minute), so the differences will be small but preventing gaming is still critical, particularly for larger epoch settings.
* Users can remove stake at will.  If a validator offers a token as additional rewards, the entire balance of any rewarded tokens are paid out when removing any amount of stake.
