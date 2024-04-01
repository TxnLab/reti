# Metrics

When running as a daemon, using the 'daemon' command, some simple Prometheus compatible metrics are exposed via the standard /metrics HTTP endpoint (defaulting on port 6260):

These metrics are reported \*per node\* and the assumption is that you fetch these metrics from all of your nodes and sum / max them.

The current Prometheus metrics are:

<table><thead><tr><th width="340">Metric</th><th>Type</th><th>Description</th></tr></thead><tbody><tr><td>reti_max_stake_allowed_total</td><td>gauge</td><td>Current maximum stake per validator allowed by the protocol.  This is defined as 15% of online stake.</td></tr><tr><td>reti_max_stake_before_saturated_total</td><td>gauge</td><td>Current stake per validator allowed by the protocol before the validator is considered 'saturated' and rewards are diminished.  This is defined as 10% of online stake.</td></tr><tr><td>reti_pool_count</td><td>gauge</td><td>Total number of pools assigned to this node.</td></tr><tr><td>reti_reward_available_total</td><td>gauge</td><td>Rewards currently available for the pools on this node.   This will be the amount in excess of known stake (minus MBR)</td></tr><tr><td>reti_staked_total</td><td>gauge</td><td>The total amount of stake in the pools on this node.</td></tr><tr><td>reti_staker_count</td><td>gauge</td><td>The total number of stakes in pools on this node.</td></tr></tbody></table>
