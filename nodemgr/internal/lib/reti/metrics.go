package reti

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	promNumPools = promauto.NewGauge(prometheus.GaugeOpts{
		Subsystem: "reti",
		Name:      "pool_count",
	})
	promNumStakers = promauto.NewGauge(prometheus.GaugeOpts{
		Subsystem: "reti",
		Name:      "staker_count",
	})
	promTotalStaked = promauto.NewGauge(prometheus.GaugeOpts{
		Subsystem: "reti",
		Name:      "staked_total",
	})
	promRewardAvailable = promauto.NewGauge(prometheus.GaugeOpts{
		Subsystem: "reti",
		Name:      "reward_available",
	})
)
