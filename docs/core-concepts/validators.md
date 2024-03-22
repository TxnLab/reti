# Validators

As a decentralized protocol, anyone can add themselves as a validator.

There are guidelines enforced in the node running code to ensure no one validator amasses a dangerous stake on a single node. Validators are limited to 3 pools per node, and 4 nodes per validator, for a maximum of 12 pools.&#x20;

***

**Validators can define:**

{% hint style="warning" %}
Many parameters can ONLY be set up front, when defining the validator.

Allowing them to be changed at will would be dangerous for stakers.
{% endhint %}

* The 'owner' address of the validator (it's recommended to use a cold-wallet).
* A 'management' address (a hot-wallet that will need to be accessible on each node by the 'reti node daemon'). This account only has authority to tell staking pool contract instances to 'go online' against a participation-key, add pools, and to update staked balances as part of regular 'epoch' payouts.
* Payout frequency - How often payout balance adjustments are made (every minute, hour, day, etc) - the 'minimum epoch' time.
  * This determines how often the validator pays themselves as well as how often staker balances are adjusted to reflect the newly received rewards.
* The commission rate - the percentage of earned rewards (at payout time) that goes to the validator to pay their operating costs
* An Algorand address to send validator fees to - changeable only by the owner.
* The 'minimum' stake allowed to enter their pools - this prevents dusting (competing validators filling up the pools of other validators with tiny amounts). With 200 slots available per pool, minimum stake of 1,000 ALGO would mean minimum 200,000 ALGO stake if the pool was filled with stakers. Users can remove stake at will but can't go below the minimum, unless they exit the pool entirely, removing all of their ALGO.
* A 'maximum' allowed stake per pool - this should be below the max allowed before incentives stop but the protocol maximum will likely already be below this number.
* An optional NFT creator account specifying that stakers must hold an ASA created by that creator in order to stake with the pool.
* Number of pools per node (this equates to a participation key \[account]). Maximum of 3 will be recommended but validator storage will allow up to 6 pools.
* Max number of 'nodes' - this will be enforced softly via the node/key management process, but the effective number of pools becomes {max nodes} \* {max pools per node}. Currently, this would be 72.
* An optional NFD ID to associate with the validator (that must be owned by the owner or manager) so that services will be able to link stakers to information about the validator. The validator would presumably describe their services, justifying their rates, promoting how they run their infrastructure, etc. Mechanisms will be provided which will allow the users to have the created staking pool contract accounts 'verify' against the NFD so that all staking pool operations link to that validator on-chain.
* **Reward token and reward rate** (Optional)
  * A validator can define a token that users are awarded in addition to the ALGO they receive for being in the pool. This will allow projects to allow rewarding members their own token for eg. Hold at least 5000 VEST to enter a Vestige staking pool, they have 1 day epochs, and all stakers get X amount of VEST as daily rewards (added to stakers ‘available’ balance) for removal at any time.
* **Token / NFD Gating:** Validators can require stakers hold certain types of assets in order to join their pools. This can be used to restrict validator pools to members of a particular community - NFT holders, special 'membership' tokens, etc.&#x20;
  * **Supported entry options are**:
    * **Tokens/NFTs** by Creator and Min amount (Optional): Can set a creator account such that all stakers must hold an ASA created by this account (w/ optional minimum amount for tokens).
    * **Specific ASA ID**.
    * **Tokens/NFTs created by any address linked within a particular NFD**. This is so NFT projects with multiple creation wallets can just reference their NFD and then anyone holding an asset created by any account linked w/in the NFD is eligible.
    * **Owning a segment (including via linked addresses) of a particular NFD Root.** A project could have its own project root NFD, e.g., orange.algo, barb.algo, voi.algo, etc., and specify that only people owning a segment of a specific root can join.
    * **Reward token and reward rate (Optional)** : A validator can define a token that users are awarded in addition to the ALGO they receive for being in the pool. This will allow projects to allow rewarding members their own token, e.g., hold at least 5000 VEST/COOP/AKTA, etc., to enter a staking pool, with 1 day epochs, and all stakers get X amount of their token as daily rewards (added to stakers' available balance) for removal at any time.
* **Sunsetting information** : Validators will be able to sunset their validators, leaving guidance for stakers that they're going away or moving to a new validator configuration.
