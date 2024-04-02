# Validators

{% hint style="warning" %}
Many parameters can ONLY be set up front, when defining the validator.

Allowing them to be changed at will would be dangerous for stakers.
{% endhint %}

**General Process:** Anyone is able to add themselves as a Validator. The protocol has safeguards in place to ensure Validators can't amass a dangerous amount of stake on a single node.&#x20;

***

**Key Elements Defined by Validators:**

* **owner Address:** Ideally, a cold-wallet address for security.
* **Management Address:** A hot-wallet address accessible by the 'reti node daemon' for operational commands.
* **Payout Epoch Time:** Frequency of payout balance adjustments (daily, weekly, etc.).
* **Validator Fee Percentage:** Share of earned rewards for covering operating costs.
* **Fee Payment Address:** An Algorand address designated for receiving validator fees, changeable by the owner.
* **Minimum Stake:** Establishes a lower limit for participation to avoid minimal contributions.
* **Maximum Stake Per Pool:** Capped to encourage equitable incentive distribution and safety of the network.
* **pools Per Node:** Recommends a maximum of 3 pools per node, with a possibility of extending up to 6.
* **Maximum nodes:** Soft limit on node count to manage the overall number of pools effectively.
* **NFD id (Optional):** For associating validators with detailed information for transparency.
* **Token / NFD Gating:** Validators can require stakers hold certain types of assets in order to join their pools. This can be used to restrict validator pools to members of a particular community - NFT holders, special 'membership' tokens, etc. Supported options are:
  * **Tokens/NFTs** by Creator and min amount (Optional): Can set a creator account such that all stakers must hold an ASA created by this account (w/ optional minimum amount for tokens).
  * **Specific ASA id**.
  * **Tokens/NFTs created by any address linked within a particular NFD**. This is so NFT projects with multiple creation wallets can just reference their NFD and then anyone holding an asset created by any account linked w/in the NFD is eligible.
  * **Owning a segment (including via linked addresses) of a particular NFD Root.** A project could have its own project root NFD, e.g., orange.algo, barb.algo, voi.algo, etc., and specify that only people owning a segment of a specific root can join.
  * **Reward token and reward rate (Optional)** : A validator can define a token that users are awarded in addition to the ALGO they receive for being in the pool. This will allow projects to allow rewarding members their own token, e.g., hold at least 5000 VEST/COOP/AKTA, etc., to enter a staking pool, with 1 day epochs, and all stakers get X amount of their token as daily rewards (added to stakers' available balance) for removal at any time.
* **Sunsetting information** : Validators will be able to sunset their validators, leaving guidance for stakers that they're going away or moving to a new validator configuration.

***

