# Reti Node Daemon

## Overview

* **Functionality:** Acts as both a command-line interface and a service daemon, compatible across Linux and OSX platforms. Windows could be supported in the future but is still problematic.
* **Management:** Facilitates validator and pool configuration, leveraging a 'manager' account for transaction signatures.
* **Participation Key Management:** Automates the creation and renewal of participation keys to maintain pool activity and online status.

***

## Details

* The Reti Node Daemon Is a combination CLI / Service daemon that will run on Linux / OSX and which node runners will run as a background service.
* This service can act as the configuration agent, letting users configure the validator, add pools, etc. but the UI for it will be easiest choice due to wallet integrations.
* Each node daemon will have access to a 'manager' account hot-wallet which it can sign transactions with. This manager account can be switched out by the owner of that validator to a new account at will if there is a compromise.&#x20;
* The only accounts that can ever remove user funds are stakers removing only their (compounded) balance.  The 'epoch update' call is made by the daemon for all pools, all aligned by the epoch time.    This epoch update is what initiates the payout to the validator for their commission as well as updating the balances of all stakers.  Any account can trigger this contract call, as it allows anyone to update eligible rewards even if the validator goes offline somehow.
* On each node, it will monitor the staking pools defined and automatically create short-lived (no more than 30 day) participation keys with that nodes algod instance.
* The participation keys will be monitored for expiration and new keys will be created in advance so that its always online.
* As participation keys are created, the paired staking pool will be instructed via the 'manager' to issue a transaction to go online against that participation key.
* The node daemon will likely provide a number of prometheus compatible metrics for scraping into compatible agents (staking amounts, etc.) but broader monitoring will be best handled independently.
