* Arbitrary Validators
  * Anyone can add themselves as a validator.  Most configuration settings are fixed (so fees, payout schedule can't change arbitrarily)
  * Reasonable guidelines are enforced in node running code.
  * Validators define:
    * The 'owner' address of the validator (preferably a cold-wallet)
    * A 'management' address (a hot-wallet that will need to accessible on each node by the 'reti node daemon').  This
      account only has authority to tell staking pool contract instances to 'go online' against a participation-key, add pools,
      and to update staked balances as part of regular 'epoch' payouts.
    * How often payout balance adjustments are made (every day, every week, etc) - the 'epoch' time.
    * The percentage of earned rewards (at payout time) that goes to the validator to pay their operating costs
    * An Algorand address to send validator fees to - changeable only by the owner.
    * The 'minimum' stake allowed to enter their pools - this prevents dusting a valuable resource (or competing validators 
      filling up the pools of other validators with tiny amounts).  With 100 slots available per pool,
      minimum stake of 1,000 ALGO would mean minimum 100,000 ALGO stake if the pool was filled with stakers.  Users can remove 
      stake at will but can't go below the minimum, unless they exit the pool entirely, removing all of their ALGO.
    * A 'maximum' allowed stake per pool - this should be below the max allowed before incentives stop.
    * An optional NFT creator account specifying that stakers must hold an ASA created by that creator in order to stake with the pool.
    * Number of pools per node (this equates to a participation key [account]).  Maximum of 3 will be recommended
      but validator storage will allow up to 6 pools.
    * Max number of 'nodes' - this will be enforced softly via the node/key management process, but the effective number of pools becomes
      {max nodes} * {max pools per node}.  Currently, this would be 72.
    * An optional NFD ID to associate with the validator (that must be owned by the owner or manager) so that services will be able to link stakers 
      to information about the validator. The validator would presumably describe their services, justifying their rates, promoting how they run their infrastructure, etc.  
      Mechanisms will be provided which will allow the users to have the created staking pool contract accounts 'verify' against the NFD so 
      that all staking pool operations link to that validator on-chain.
    * NFTs by Creator and min amount(Optional)
      * A project running a validator can set a creator account such that all stakers must hold an ASA created by this account (w/ optional minimum 
        amount (for tokens).  This can be used to restrict validator pools to members of a particular community.
    * Reward token and reward rate (Optional)
      * A validator can define a token that users are awarded in addition to the ALGO they receive for being in the pool.
        This will allow projects to allow rewarding members their own token for eg.  Hold at least 5000 VEST to enter a Vestige staking pool, they have 1 day epochs, 
        and all stakers get X amount of VEST as daily rewards (added to stakers ‘available’ balance) for removal at any time.

* Staking Pools
  * On each node, validators can add a new pool (up to their defined limit).
  * Each pool is a new instance of a 'staking pool' contract.  The new contract instance is created by the master Validator contract instance
    of which there is only one permanent instance.  It creates the new staking pool contract using a pre-created 'template' instance from which
    it gets the bytecode.  
  * Because each is a new contract instance, the staking pool is a new algorand account that can participate in consensus.  It is this account
    that goes 'online' against a particular participation key.
  * Users add stake by calling the master validator contract and electing to add stake to a specific validator (by an ID).  Free space is found
    amongst the validators pools and the algo is sent from the user through the validator contract to the pool (and thus its contract account).
  * A 'ledger' is maintained in each pool of up to (currently) 100 stakers (based on general storage and feasibility estimates) that tracks
    each staker by their account, (last) entry time into the pool, amount currently staked, and historical amount rewarded.
  * The entry time is set each time a user adds stake so that users can't game rewards (the time is actually 'set forward' approx 16 minutes to account
    for algorand online balances being 320 rounds behind).  A naive approach would allow them to add a huge amount 
    of algo just prior to the epoch payout and get rewarded as if they'd been part of the pool the entire time.  Tracking entry time allows their reward
    to be cut for partial epoch participation.
  * The 'payout' process:
    * Determines the 'reward' amount based on the current pool balance vs the known 'staked' amount.  
    * Directly pays the validator their % (which is immutable and part of defining the validator record itself).
    * Walks the 'ledger' of stakers, and updates their balance to include their percentage of the shared reward (and thus compounding)
    * The % share the user gets based on their stake is adjusted based on the % of time they were 'in the epoch'.  A
      staker adding/entering stake 95% of the way through an epoch would only receive 5% of the reward they would have received had they been in the pool
      for the entire epoch. 
    * After paying 'partial' epoch holders, the remaining reward (which now has extra) is divided across the 'in pool 100% of the epoch' stakers with 
      their relative % of the pool being based on their % of the total (minus the stake of the partial epoch stakers!).
    * The partial epoch holders will be full holders in the next epoch, assuming they don't add stake again.  Each time adding stake resets their clock in the epoch.
    * Some validators epochs might be as short as 1 day, so the differences will be small but preventing gaming is still critical.
  * Users can remove stake at will as well as any awarded reward tokens (optionalº, being able to remove their tracked 'ledger balance' (which continues to 
    compound and grow as reward epochs occur).
    * The contract will allow anyone to call to 'pay out staker X' rewarded community tokens - this will allow projects to pay to do automated drops of their community 
      token via their staking pools.  It may be expensive to do this for each staker, but the option will remain. 

* Reti node daemon
  * Is a combination CLI / Service daemon that will run on Linux / OSX and which node runners will run as a background service.
  * This service can act as the configuration agent, letting users configure the validator, add pools, etc. but the UI for it will be easiest choice (because of 
    wallet integrations.
  * Each node daemon will have access to a 'manager' account hot-wallet which it can sign transactions with.  This manager account can be switched out
    by the owner of that validator to a new account at will if there is a compromise.  The only accounts that can ever remove user funds are stakers removing only 
    their (compounded) balance.  Other accounts can trigger sending of 'reward tokens' to stakers though as this can only pay out to the staker and no one else.
  * On each node, it will monitor the staking pools defined and automatically create short-lived (no more than 30d) participation keys with that
    nodes algod instance.
  * The participation keys will be monitored for expiration and new keys will be created in advance so that its always online.
  * As participation keys are created, the paired staking pool will be instructed via the 'manager' to issue a transaction to go online against 
    that participation key.
  * The node daemon will likely provide a number of prometheus compatible metrics for scraping into compatible agents (staking amounts, etc.) but 
    broader monitoring will be best handled independently.

* Monitoring
  * Monitoring of actual validator performance will be best handled by the ecosystem itself - tracking expected proposal/vote percentages per pool per validator, etc.
  * Users will use this data to determine which validators they want to stake which.  It may be services or people they trust, or may simply be who provides the 
    current best bang for the buck with lowest fees and best uptime/proposal reliability. 
