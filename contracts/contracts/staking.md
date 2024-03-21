## Staking

* User wants to add stake to a validator
  * First has to determine where the user is already staked - could be in multiple validators
    * Need way to efficiently get list of validator pools the account is in (multiple for same validator is possible)
  * If not in an existing pool, need to find a free pool (w/in balance range), if not available need to create a new pool 
* Creating a pool

## Methods

* addValidator(owner, manager, nfdAppID, validatorConfig{payoutDays, validatorPct, poolsPerNode, maxNodes)
  * returns a validator id - adds/initializes new ValidatorList entry

### Validator actions
* addPool(validatorId)
  * returns ValidatorPoolKey {ID, PoolID}
  * Must be called by owner or manager of validator - adds a new pool up to max pools in ValidatorList for validator

### User action
* Wants to stake to a validator
  * addStake(validatorId) 
  * Fetches from StakerPoolList (up to 4 validator/pool entries) and determines if already present
    * Only allow to be in 1 pool per validator ??
    * Can't search every pool for a validator as each is a different box - so then track which pool has space?
    * If NOT - then stakes to that validator in next 'free' slot
    * If found - then adds more in that existing pool and slot

* Pool tracking
  * Validator info - tracks pool with most available 'free' (how, across many pools? - needs to resort by free?)
    * This limits total number of pools 
  * Knows how much in each pool - a

* node runners
  * configure sidecar process
    * Add validator - needs done through some type of UI where user can sign w/ arbitrary wallet?
    * cli for management - add / configure validator
      * add validator - need to sign w/ owner keys somehow?  walletconnect paste URL ?
      * Need hotwallet for manager address
    * for each node - add new 'node' - it allocates a sequential id for that node 
  * watcher process
    * Sees new node for its configured validator id get added by watching chain via node its running on?
      * Checks status of pools - if none exist - adds first.  If one at 95% - adds new pool - up to 3 per node
      * only allow new pools no more than X days apart ??
    * monitors all pools and their part keys - keeping them refreshed/online by telling pool to go online against it.
  * 
  * 
  * specify validator id - only owner or manager can do stuff - manager is hotwallet configured w/ sidecar
    * Does user specify explicit node id at configuration time?
    * What triggers **adding pools**?
      * Does runner have to explicitly allocate the pools?
      * what links them to partkeys?  add pool - get data - adds to "purely local data" ??
    * How are pools assigned to nodes?
  * watcher
    * looks for 

* validator
  * config/init
    * to initially create and identify yourself as a validator
    * set: maximum stake allowed for all pools
    * payout schedule
    * % fees to validator
  * inherit
    * used to configure new node with data about your existing validator config - configure with owner or manager address?
    * node has to have keys to manager to allow it?  
  * modify
    * change nfd 
    * change manager
    * change owner ????  (seems iffy)
  * nodes
    * need config'd at all? or just matter of configuring pools already gate this?
    * add 
    * what about remove?
    * do we really 'care' about formal definition of nodes or is it just matter of adding pools to current config and a max is allowed?
  * pool
    * add pool
      * checks pool count on machine - based on config - does it really care about formal def of node?
    
