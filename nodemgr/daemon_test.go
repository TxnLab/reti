package main

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestDurationToNextEpochRefactored(t *testing.T) {
	testCases := []struct {
		name           string
		epochMinutes   int
		currentTime    time.Time
		expectedDurMin float64
	}{
		{"11:10:15->12:00:00", 60, time.Date(2024, 1, 1, 11, 10, 15, 0, time.UTC), 60.0},
		{"11:55:55->12:00:00", 60, time.Date(2024, 1, 1, 11, 55, 15, 0, time.UTC), 4.75},
		{"00:00:00->01:00:00", 15, time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC), 15.0},
		{"00:15:30->00:30:00", 15, time.Date(2024, 1, 1, 0, 15, 30, 0, time.UTC), 15.0},
		{"00:30:45->00:45:00", 15, time.Date(2024, 1, 1, 0, 30, 45, 0, time.UTC), 15.0},
		{"00:45:00->01:00:00", 15, time.Date(2024, 1, 1, 0, 45, 0, 0, time.UTC), 15.0},
		{"00:07:30->00:15:00", 15, time.Date(2024, 1, 1, 0, 7, 30, 0, time.UTC), 7.5},
		{"00:15:00->00:30:00", 30, time.Date(2024, 1, 1, 0, 15, 0, 0, time.UTC), 15.0},
		{"00:30:00->01:00:00", 60, time.Date(2024, 1, 1, 0, 30, 0, 0, time.UTC), 30.0},
		{"01 12:00:00->02 00:00:00", 24 * 60, time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC), 12 * 60.0},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			actualDur := durationToNextEpoch(tc.currentTime, tc.epochMinutes)
			//fmt.Printf("dur:%v from:%v to:%v", tc.epochMinutes, tc.currentTime, tc.currentTime.Add(actualDur))

			assert.InDelta(t, tc.expectedDurMin, actualDur.Minutes(), 0.01,
				"case: %s, expected duration of around %f minutes, but got duration of %v", tc.name, tc.expectedDurMin, actualDur)
		})
	}
}
