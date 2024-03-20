# Validators

Anyone can add themselves as a validator.

There are guidelines enforced in the node running code to ensure no one validator amasses a dangerous stake on a single node.

Validators are limited to 3 pools per node, and 4 nodes per validator, for a maximum of 12 pools.

**Validators can define:**

* The 'owner' address of the validator (preferably a cold-wallet)
* A 'management' address (a hot-wallet that will need to accessible on each node by the 'reti node daemon'). This account only has authority to tell staking pool contract instances to 'go online' against a participation-key, add pools, and to update staked balances as part of regular 'epoch' payouts.
* How often payout balance adjustments are made (every minute, hour, day, etc) - the 'minimum epoch' time.
  * This determines how often the validator pays themselves and how often staker balances are adjusted to reflect the newly received rewards.
* The commission rate - the percentage of earned rewards (at payout time) that goes to the validator to pay their operating costs
* An Algorand address to send validator fees to - changeable only by the owner.
* The 'minimum' stake allowed to enter their pools - this prevents dusting (competing validators filling up the pools of other validators with tiny amounts). With 200 slots available per pool, minimum stake of 1,000 ALGO would mean minimum 200,000 ALGO stake if the pool was filled with stakers. Users can remove stake at will but can't go below the minimum, unless they exit the pool entirely, removing all of their ALGO.
* A 'maximum' allowed stake per pool - this should be below the max allowed before incentives stop.
* An optional NFT creator account specifying that stakers must hold an ASA created by that creator in order to stake with the pool.
* Number of pools per node (this equates to a participation key \[account]). Maximum of 3 will be recommended but validator storage will allow up to 6 pools.
* Max number of 'nodes' - this will be enforced softly via the node/key management process, but the effective number of pools becomes {max nodes} \* {max pools per node}. Currently, this would be 72.
* An optional NFD ID to associate with the validator (that must be owned by the owner or manager) so that services will be able to link stakers to information about the validator. The validator would presumably describe their services, justifying their rates, promoting how they run their infrastructure, etc. Mechanisms will be provided which will allow the users to have the created staking pool contract accounts 'verify' against the NFD so that all staking pool operations link to that validator on-chain.
* NFTs by Creator and min amount(Optional)
  * A project running a validator can set a creator account such that all stakers must hold an ASA created by this account (w/ optional minimum amount (for tokens). This can be used to restrict validator pools to members of a particular community.
* Reward token and reward rate (Optional)
  * A validator can define a token that users are awarded in addition to the ALGO they receive for being in the pool. This will allow projects to allow rewarding members their own token for eg. Hold at least 5000 VEST to enter a Vestige staking pool, they have 1 day epochs, and all stakers get X amount of VEST as daily rewards (added to stakers ‘available’ balance) for removal at any time.
