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
  * configure sidecar - specify validator id - only owner or manager can do stuff - manager is hotwallet configured w/ sidecar
    * Does user specify explicit node id at configuration time?
    * What triggers **adding pools**?
      * Does runner have to explicitly allocate the pools?
      * what links them to partkeys?  add pool - get data - adds to "purely local data" ??
    * How are pools assigned to nodes?
  * watcher
    * looks for 
