# Validators

{% hint style="warning" %}
Many parameters can ONLY be set up front, when defining the validator.

Allowing them to be changed at will would be dangerous for stakers.
{% endhint %}

**General Process:** Anyone is able to add themselves as a Validator. The protocol has safeguards in place to ensure Validators can't amass a dangerous amount of stake in a single pool, or combined across all pools for a single validator.

***

**Key Elements Defined by Validators:**

* **Owner Address:** Ideally, a cold-wallet address for security.
* **Management Address:** A hot-wallet address accessible by the 'reti node daemon' for operational commands.
* **Payout Epoch Time (in minutes):** Frequency of payout balance adjustments (daily, weekly, etc.).  The node daemon will honor this time and trigger the 'epoch' based on the specified schedule for all pools.   The commission is paid out every epoch.  If the epoch is per day, then the commission % is that amount, per day.
* **Validator Commission Percentage:** Percentage the validator takes out of earned rewards per-epoch for covering operating costs. &#x20;
* **Commission Address:** An Algorand address designated for receiving the validator commission, changeable by the owner.
* **Minimum Stake:** Establishes a lower limit for participation to avoid minimal contributions.
* **Maximum Stake Per Pool:** Can be set by validator to a lower amount than protocol maximum, or left as unset (0). &#x20;
  * The default maximum is based on taking the LESSER of:
    * 15% of online stake / number of pools
    * The max Algo per account allowed that still receives incentive rewards.  This amount is currently 70 million algo but will likely change over time.
* **Pools Per Node:** There is a hard limit of 3 pools per node but the validator can define a smaller amount as a signal of how they will run deploy and limit their pools.
* **NFD ID (Optional):** For associating validators with detailed information for transparency.
* **Token / NFD Gating:** Validators can require that stakers hold certain types of assets in order to join their pools. This can be used to restrict validator pools to members of a particular community - NFT holders, special 'membership' tokens, etc. Supported options are:
  * **Tokens/NFTs** by Creator and min amount (Optional): Can set a creator account such that all stakers must hold an ASA created by this account (w/ optional minimum amount for tokens).
  * **Specific ASA ID**.
  * **Tokens/NFTs created by any address linked within a particular NFD**. This is so NFT projects with multiple creation wallets can just reference their NFD and then anyone holding an asset created by any account linked w/in the NFD is eligible.
  * **Owning a segment (including via linked addresses) of a particular NFD Root.** A project could have its own project root NFD, e.g., orange.algo, barb.algo, voi.algo, etc., and specify that only people owning a segment of a specific root can join.
  * **Reward token and reward rate (Optional)** : A validator can define a token that users are awarded in addition to the ALGO they receive for being in the pool. This will allow projects to allow rewarding members their own token, e.g., hold at least 5000 VEST/COOP/AKTA, etc., to enter a staking pool, with 1 day epochs, and all stakers get X amount of their token as daily rewards (added to stakers' available balance) for removal at any time.
* **Sunsetting information** : Validators will be able to sunset their validators, leaving guidance for stakers that they're going away or moving to a new validator configuration.

***

